/* ══════════════════════════════════════════════════════════════════════════
   ROOF CAD ENGINE — Independent roof geometry processing module
   Extracted from server.js for modularity and reuse.

   Handles: hip roof geometry computation, section mesh building,
   interior line generation, section selection/deletion with auto-updating lines,
   undo/redo system, per-section pitch, properties panel with compass/slope.
   ══════════════════════════════════════════════════════════════════════════ */

/* ── State ── */
var roofFaces3d = [];
var roofSelectedFace = -1;
var roofSelectedSection = -1;
var roofDrawingMode = false;
var roofTempVertices = [];
var roofTempHandles = [];
var roofTempLines = null;
var roofSnapGuides = [];
var roofSnappedPos = null;
var roofDraggingHandle = -1;
var roofDraggingFaceIdx = -1;
var roofUndoStack = [];
var roofRedoStack = [];
var ROOF_UNDO_MAX = 50;

/* ══════════════════════════════════════════════════════════════════════════
   GEOMETRY — Hip roof math shared by mesh + line builders
   ══════════════════════════════════════════════════════════════════════════ */

/*
   Given a 4-vertex rectangle and pitch, computes the hip roof skeleton:

        v3 ──────────── v2          v0-v1 and v3-v2 are LONG sides
        │  \   back   / │          v0-v3 and v1-v2 are SHORT sides
        │   R0──────R1  │
        │  /  front   \ │          R0, R1 = ridge endpoints
        v0 ──────────── v1          inset = shortLen / 2 (45° hip angles)

   Returns: { v0, v1, v2, v3, r0x, r0z, r1x, r1z, m0x, m0z, m1x, m1z,
              inset, ldx, ldz, px, pz, mfx, mfz, mbx, mbz }

   Additional points (used for trapezoid deletion patterns):
     px, pz   — Peak: midpoint of the ridge line (R0-R1)
     mfx, mfz — Front midpoint: midpoint of v0-v1 (front long side)
     mbx, mbz — Back midpoint: midpoint of v3-v2 (back long side)
*/
function computeHipGeometry(verts, pitchDeg) {
  var d01 = Math.sqrt(Math.pow(verts[1].x - verts[0].x, 2) + Math.pow(verts[1].z - verts[0].z, 2));
  var d12 = Math.sqrt(Math.pow(verts[2].x - verts[1].x, 2) + Math.pow(verts[2].z - verts[1].z, 2));
  var v0, v1, v2, v3, longLen, shortLen;
  if (d01 >= d12) {
    v0 = verts[0]; v1 = verts[1]; v2 = verts[2]; v3 = verts[3];
    longLen = d01; shortLen = d12;
  } else {
    v0 = verts[1]; v1 = verts[2]; v2 = verts[3]; v3 = verts[0];
    longLen = d12; shortLen = d01;
  }
  var inset = shortLen / 2;
  var ldx = (v1.x - v0.x) / longLen, ldz = (v1.z - v0.z) / longLen;
  var m0x = (v0.x + v3.x) / 2, m0z = (v0.z + v3.z) / 2;
  var m1x = (v1.x + v2.x) / 2, m1z = (v1.z + v2.z) / 2;
  var r0x = m0x + ldx * inset, r0z = m0z + ldz * inset;
  var r1x = m1x - ldx * inset, r1z = m1z - ldz * inset;
  // Peak = midpoint of ridge, Mf = midpoint of v0-v1 (front), Mb = midpoint of v3-v2 (back)
  var px = (r0x + r1x) / 2, pz = (r0z + r1z) / 2;
  var mfx = (v0.x + v1.x) / 2, mfz = (v0.z + v1.z) / 2;
  var mbx = (v3.x + v2.x) / 2, mbz = (v3.z + v2.z) / 2;
  return { v0: v0, v1: v1, v2: v2, v3: v3, r0x: r0x, r0z: r0z, r1x: r1x, r1z: r1z,
           m0x: m0x, m0z: m0z, m1x: m1x, m1z: m1z, inset: inset, ldx: ldx, ldz: ldz,
           px: px, pz: pz, mfx: mfx, mfz: mfz, mbx: mbx, mbz: mbz };
}

/* ══════════════════════════════════════════════════════════════════════════
   SECTION GEOMETRY — Deletion-pattern-aware vertex computation
   ══════════════════════════════════════════════════════════════════════════

   computeSectionGeometry handles all deletion patterns:

   No deletions / only hip tri deletions:
     Standard 4-section hip roof. When hip tri deleted, adjacent trapezoids
     expand (ridge endpoints shift to short-side midpoints).

   Both trapezoids deleted:
     Remaining hip triangles become rectangles split at Mf/Mb line.
     S0 = rect v0-Mf-Mb-v3, S1 = rect Mf-v1-v2-Mb

   Only front trap (S2) deleted:
     Ridge collapses to single peak point P.
     S0 = trap v0-Mf-P-v3, S1 = trap Mf-v1-v2-P, S3 = tri v3-P-v2

   Only back trap (S3) deleted:
     Ridge collapses to single peak point P.
     S0 = trap v0-P-Mb-v3, S1 = trap v1-v2-Mb-P, S2 = tri v0-v1-P
*/
function computeSectionGeometry(hip, ds, ridgeY, baseY) {
  var h = hip;
  var rY = ridgeY, bY = baseY;
  // Helper to build triangle positions
  function tri(ax,ay,az, bx,by,bz, cx,cy,cz) {
    return [ax,ay,az, bx,by,bz, cx,cy,cz];
  }
  // Helper to build quad positions (2 triangles)
  function quad(ax,ay,az, bx,by,bz, cx,cy,cz, dx,dy,dz) {
    return [ax,ay,az, bx,by,bz, cx,cy,cz, ax,ay,az, cx,cy,cz, dx,dy,dz];
  }

  var anyTrapDel = ds[2] || ds[3];
  var bothTrapDel = ds[2] && ds[3];

  // Case: no trapezoids deleted — original hip roof logic (with hip tri expansion)
  if (!anyTrapDel) {
    var er0x = ds[0] ? h.m0x : h.r0x;
    var er0z = ds[0] ? h.m0z : h.r0z;
    var er1x = ds[1] ? h.m1x : h.r1x;
    var er1z = ds[1] ? h.m1z : h.r1z;
    return [
      // S0: hip tri v0-R0-v3
      tri(h.v0.x,bY,h.v0.z, h.r0x,rY,h.r0z, h.v3.x,bY,h.v3.z),
      // S1: hip tri v1-v2-R1
      tri(h.v1.x,bY,h.v1.z, h.v2.x,bY,h.v2.z, h.r1x,rY,h.r1z),
      // S2: front trap v0-v1-eR1-eR0
      quad(h.v0.x,bY,h.v0.z, h.v1.x,bY,h.v1.z, er1x,rY,er1z, er0x,rY,er0z),
      // S3: back trap v3-eR0-eR1-v2
      quad(h.v3.x,bY,h.v3.z, er0x,rY,er0z, er1x,rY,er1z, h.v2.x,bY,h.v2.z)
    ];
  }

  // Case: both trapezoids deleted — two rectangles split at Mf/Mb
  if (bothTrapDel) {
    return [
      // S0: rect v0-Mf-Mb-v3
      quad(h.v0.x,bY,h.v0.z, h.mfx,bY,h.mfz, h.mbx,bY,h.mbz, h.v3.x,bY,h.v3.z),
      // S1: rect Mf-v1-v2-Mb
      quad(h.mfx,bY,h.mfz, h.v1.x,bY,h.v1.z, h.v2.x,bY,h.v2.z, h.mbx,bY,h.mbz),
      null, null
    ];
  }

  // Case: only front trap (S2) deleted — ridge collapses to peak P
  if (ds[2] && !ds[3]) {
    return [
      // S0: trap v0-Mf-P-v3
      quad(h.v0.x,bY,h.v0.z, h.mfx,bY,h.mfz, h.px,rY,h.pz, h.v3.x,bY,h.v3.z),
      // S1: trap Mf-v1-v2-P
      quad(h.mfx,bY,h.mfz, h.v1.x,bY,h.v1.z, h.v2.x,bY,h.v2.z, h.px,rY,h.pz),
      null,
      // S3: tri v3-P-v2
      tri(h.v3.x,bY,h.v3.z, h.px,rY,h.pz, h.v2.x,bY,h.v2.z)
    ];
  }

  // Case: only back trap (S3) deleted — ridge collapses to peak P
  if (!ds[2] && ds[3]) {
    return [
      // S0: trap v0-P-Mb-v3
      quad(h.v0.x,bY,h.v0.z, h.px,rY,h.pz, h.mbx,bY,h.mbz, h.v3.x,bY,h.v3.z),
      // S1: trap v1-v2-Mb-P
      quad(h.v1.x,bY,h.v1.z, h.v2.x,bY,h.v2.z, h.mbx,bY,h.mbz, h.px,rY,h.pz),
      // S2: tri v0-v1-P
      tri(h.v0.x,bY,h.v0.z, h.v1.x,bY,h.v1.z, h.px,rY,h.pz),
      null
    ];
  }

  return [null, null, null, null];
}

/* ══════════════════════════════════════════════════════════════════════════
   SECTIONS — The 4 interior regions of a hip roof
   ══════════════════════════════════════════════════════════════════════════

   A hip roof rectangle is divided into 4 sections by the ridge + hip lines:

   Section 0: Hip Triangle A  — short side near v0/v3, vertices: v0, R0, v3
   Section 1: Hip Triangle B  — short side near v1/v2, vertices: v1, v2, R1
   Section 2: Front Trapezoid — long side v0-v1, vertices: v0, v1, R1, R0 (2 tris)
   Section 3: Back Trapezoid  — long side v3-v2, vertices: v3, R0, R1, v2 (2 tris)

   Each section can be independently:
   - Selected (highlighted in teal #00bfa5 at 55% opacity)
   - Deleted (mesh removed, lines auto-update)

   face.deletedSections = [false, false, false, false]  // tracks which are removed
   face.selectedSection = -1                             // -1 = none selected
   face.sectionPitches  = [p, p, p, p]                   // per-section pitch values
*/

/* ══════════════════════════════════════════════════════════════════════════
   MESH BUILDING — Creates individual THREE.Mesh per section
   ══════════════════════════════════════════════════════════════════════════ */

/*
   buildRoofSectionMeshes(verts, color, pitchDeg, deletedSections, selectedSection)

   Returns: Array of 4 THREE.Mesh objects (or null for deleted sections)
            For non-hip (flat/non-rect), returns array of 1 mesh.

   Uses computeSectionGeometry() helper for deletion-pattern-aware geometry.

   Each section gets its own mesh so it can be:
   - Independently raycasted for click selection
   - Colored independently (teal highlight on selected)
   - Removed independently when deleted

   All meshes are added to a THREE.Group stored as face.mesh
   so scene3d.add/remove(face.mesh) handles the whole set.
*/
function buildRoofSectionMeshes(verts, color, pitchDeg, deletedSections, selectedSection) {
  var pitch = pitchDeg || 0;
  var ds = deletedSections || [false, false, false, false];
  var ss = (selectedSection !== undefined) ? selectedSection : -1;

  // Non-rectangular or zero-pitch: single flat section
  if (verts.length !== 4 || pitch <= 0) {
    var shape = new THREE.Shape();
    shape.moveTo(verts[0].x, -verts[0].z);
    for (var i = 1; i < verts.length; i++) shape.lineTo(verts[i].x, -verts[i].z);
    shape.closePath();
    var geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2);
    return [_applyRoofSectionMaterial(geo, color, 0.05, ss === 0)];
  }

  var hip = computeHipGeometry(verts, pitch);
  var ridgeY = hip.inset * Math.tan(pitch * Math.PI / 180) + 0.05;
  var baseY = 0.05;

  // Compute section geometry based on deletion pattern
  var sectionPositions = computeSectionGeometry(hip, ds, ridgeY, baseY);

  var meshes = [];
  for (var i = 0; i < 4; i++) {
    if (ds[i] || !sectionPositions[i]) { meshes.push(null); continue; }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(sectionPositions[i], 3));
    geo.computeVertexNormals();
    meshes.push(_applyRoofSectionMaterial(geo, color, 0, ss === i));
  }
  return meshes;
}

/*
   Section material: selected sections get Aurora-style teal overlay.
   Non-selected sections get satellite texture (if available) or solid color.
*/
function _applyRoofSectionMaterial(geo, color, yOffset, isSelected) {
  if (isSelected) {
    var posAttr = geo.attributes.position;
    var uvs = new Float32Array(posAttr.count * 2);
    for (var i = 0; i < posAttr.count; i++) { uvs[i * 2] = 0; uvs[i * 2 + 1] = 0; }
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    var mat = new THREE.MeshBasicMaterial({
      color: 0x00bfa5, transparent: true, opacity: 0.55,
      side: THREE.DoubleSide, depthWrite: true
    });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = yOffset;
    return mesh;
  }
  return _applyRoofMaterial(geo, color, yOffset);
}

/* ══════════════════════════════════════════════════════════════════════════
   LINE BUILDING — Hip lines + ridge, respecting deleted sections
   ══════════════════════════════════════════════════════════════════════════

   Interior lines consist of:
   - 4 hip lines: diagonal lines from each corner to the nearest ridge endpoint
   - 1 ridge line: horizontal line connecting R0 to R1 at peak height

   When sections are deleted, lines update based on deletion pattern:

   NO TRAPEZOIDS DELETED (standard hip roof):
     HIP LINES — a hip line is the fold between two adjacent roof planes.
     It only exists if BOTH adjacent sections exist:
       v0->R0 : border of section 0 and section 2 — needs both alive
       v3->R0 : border of section 0 and section 3 — needs both alive
       v1->R1 : border of section 1 and section 2 — needs both alive
       v2->R1 : border of section 1 and section 3 — needs both alive
     RIDGE LINE — always present if any section alive. Endpoints shift to
     short-side midpoints when hip triangles deleted (gable-style).

   BOTH TRAPEZOIDS DELETED:
     Single vertical divider line from Mf to Mb (front to back midpoints).

   FRONT TRAP (S2) DELETED:
     Ridge collapses to peak point P. Lines drawn:
       Mf->P : divider between S0 and S1 (if both alive)
       v3->P : border between S0 and S3 (if both alive)
       v2->P : border between S1 and S3 (if both alive)

   BACK TRAP (S3) DELETED:
     Ridge collapses to peak point P. Lines drawn:
       Mb->P : divider between S0 and S1 (if both alive)
       v0->P : border between S0 and S2 (if both alive)
       v1->P : border between S1 and S2 (if both alive)
*/
function buildHipRoofLines(verts, pitchDeg, deletedSections) {
  if (!verts || verts.length !== 4) return null;
  var ds = deletedSections || [false, false, false, false];

  var hip = computeHipGeometry(verts, pitchDeg);
  var ridgeY = hip.inset * Math.tan((pitchDeg || 10) * Math.PI / 180) + 0.12;
  var baseY = 0.12;

  var positions = [];
  var anyTrapDel = ds[2] || ds[3];
  var bothTrapDel = ds[2] && ds[3];

  if (!anyTrapDel) {
    // No trapezoids deleted — standard hip roof lines
    var re0x = ds[0] ? hip.m0x : hip.r0x;
    var re0z = ds[0] ? hip.m0z : hip.r0z;
    var re1x = ds[1] ? hip.m1x : hip.r1x;
    var re1z = ds[1] ? hip.m1z : hip.r1z;

    if (!ds[0] && !ds[2]) positions.push(hip.v0.x,baseY,hip.v0.z, hip.r0x,ridgeY,hip.r0z);
    if (!ds[0] && !ds[3]) positions.push(hip.v3.x,baseY,hip.v3.z, hip.r0x,ridgeY,hip.r0z);
    if (!ds[1] && !ds[2]) positions.push(hip.v1.x,baseY,hip.v1.z, hip.r1x,ridgeY,hip.r1z);
    if (!ds[1] && !ds[3]) positions.push(hip.v2.x,baseY,hip.v2.z, hip.r1x,ridgeY,hip.r1z);
    // Ridge line
    var anyAlive = !ds[0] || !ds[1] || !ds[2] || !ds[3];
    if (anyAlive) positions.push(re0x,ridgeY,re0z, re1x,ridgeY,re1z);

  } else if (bothTrapDel) {
    // Both trapezoids deleted — vertical divider Mf->Mb
    if (!ds[0] || !ds[1]) {
      positions.push(hip.mfx,baseY,hip.mfz, hip.mbx,baseY,hip.mbz);
    }

  } else if (ds[2] && !ds[3]) {
    // Front trap deleted — ridge collapsed to peak P
    // Lines: Mf->P (divider between S0/S1), v3->P and v2->P (borders with S3 triangle)
    if (!ds[0] && !ds[1]) positions.push(hip.mfx,baseY,hip.mfz, hip.px,ridgeY,hip.pz);
    if (!ds[0] && !ds[3]) positions.push(hip.v3.x,baseY,hip.v3.z, hip.px,ridgeY,hip.pz);
    if (!ds[1] && !ds[3]) positions.push(hip.v2.x,baseY,hip.v2.z, hip.px,ridgeY,hip.pz);

  } else if (!ds[2] && ds[3]) {
    // Back trap deleted — ridge collapsed to peak P
    // Lines: Mb->P (divider between S0/S1), v0->P and v1->P (borders with S2 triangle)
    if (!ds[0] && !ds[1]) positions.push(hip.mbx,baseY,hip.mbz, hip.px,ridgeY,hip.pz);
    if (!ds[0] && !ds[2]) positions.push(hip.v0.x,baseY,hip.v0.z, hip.px,ridgeY,hip.pz);
    if (!ds[1] && !ds[2]) positions.push(hip.v1.x,baseY,hip.v1.z, hip.px,ridgeY,hip.pz);
  }

  if (positions.length === 0) return null;

  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2 }));
}

/* ══════════════════════════════════════════════════════════════════════════
   FACE LIFECYCLE — Create, rebuild, select, delete
   ══════════════════════════════════════════════════════════════════════════ */

/*
   Face data structure:
   {
     id:               string,
     vertices:         [{x, z}, ...],          // 4 corner vertices
     pitch:            number,                  // degrees 0-90 (max of sectionPitches)
     sectionPitches:   [number, ...],           // per-section pitch values (4 entries)
     azimuth:          number,                  // degrees 0-360
     height:           number,                  // eave height in meters
     color:            string,                  // hex color
     mesh:             THREE.Group,             // group containing section meshes
     sectionMeshes:    [Mesh|null, ...],        // individual section meshes (4 for hip)
     deletedSections:  [bool, bool, bool, bool],// which sections are removed
     selectedSection:  number,                  // -1 = none
     edgeLines:        THREE.LineSegments,       // outer edge outline
     hipLines:         THREE.LineSegments,       // interior hip + ridge lines
     handleMeshes:     [THREE.Mesh, ...],       // draggable corner spheres
     labelSprites:     [THREE.Sprite, ...],     // edge measurement labels
     selected:         boolean                  // whole-face selection state
   }
*/

function finalizeRoofFace(verts, pitch, azimuth, height, deletedSections, sectionPitches) {
  var p = pitch || 0;
  var sp = sectionPitches || [p, p, p, p];
  var face = {
    id: 'rf_' + Date.now().toString(36) + '_' + roofFaces3d.length,
    vertices: verts,
    pitch: p,
    sectionPitches: sp.slice(),
    azimuth: azimuth || 180,
    height: height || 0,
    color: '#f5a623',
    mesh: null, edgeLines: null, hipLines: null,
    sectionMeshes: [],
    deletedSections: deletedSections || [false, false, false, false],
    selectedSection: -1,
    handleMeshes: [], labelSprites: [],
    selected: false
  };
  var usePitch = face.pitch || 10;
  face.sectionMeshes = buildRoofSectionMeshes(verts, face.color, usePitch, face.deletedSections, -1);
  face.mesh = new THREE.Group();
  face.sectionMeshes.forEach(function(m) { if (m) face.mesh.add(m); });
  scene3d.add(face.mesh);
  face.edgeLines = buildRoofEdgeLines(verts, '#ffffff');
  scene3d.add(face.edgeLines);
  face.hipLines = buildHipRoofLines(verts, usePitch, face.deletedSections);
  if (face.hipLines) scene3d.add(face.hipLines);
  face.handleMeshes = buildRoofHandles(verts);
  face.labelSprites = buildEdgeLabels(verts);
  roofFaces3d.push(face);
  markDirty();
  return roofFaces3d.length - 1;
}

function rebuildRoofFace(idx) {
  var face = roofFaces3d[idx];
  if (face.mesh) scene3d.remove(face.mesh);
  if (face.edgeLines) scene3d.remove(face.edgeLines);
  if (face.hipLines) scene3d.remove(face.hipLines);
  face.labelSprites.forEach(function(s) { scene3d.remove(s); });

  var usePitch = face.pitch || 10;
  face.sectionMeshes = buildRoofSectionMeshes(face.vertices, face.color, usePitch, face.deletedSections, face.selectedSection);
  face.mesh = new THREE.Group();
  face.sectionMeshes.forEach(function(m) { if (m) face.mesh.add(m); });
  scene3d.add(face.mesh);
  face.edgeLines = buildRoofEdgeLines(face.vertices, face.selected ? '#00e5ff' : '#ffffff');
  scene3d.add(face.edgeLines);
  face.hipLines = buildHipRoofLines(face.vertices, usePitch, face.deletedSections);
  if (face.hipLines) scene3d.add(face.hipLines);
  face.labelSprites = buildEdgeLabels(face.vertices);

  face.vertices.forEach(function(v, i) {
    face.handleMeshes[i].position.set(v.x, 0.18, v.z);
  });
  markDirty();
}

/* ══════════════════════════════════════════════════════════════════════════
   SELECTION — Per-section click targeting
   ══════════════════════════════════════════════════════════════════════════

   findRoofFaceUnderCursor raycasts against ALL individual section meshes
   across all faces and returns { faceIdx, sectionIdx }.

   This allows clicking any visible section to select just that section,
   which highlights it in teal while the rest of the face stays normal.
*/

function findRoofFaceUnderCursor(event) {
  var canvas = document.getElementById('canvas3d');
  var rect = canvas.getBoundingClientRect();
  mouse3d.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse3d.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster3d.setFromCamera(mouse3d, camera3d);

  var allMeshes = [];
  var meshMap = [];
  for (var fi = 0; fi < roofFaces3d.length; fi++) {
    var sm = roofFaces3d[fi].sectionMeshes;
    if (!sm) continue;
    for (var si = 0; si < sm.length; si++) {
      if (sm[si]) {
        allMeshes.push(sm[si]);
        meshMap.push({ faceIdx: fi, sectionIdx: si });
      }
    }
  }

  var hits = raycaster3d.intersectObjects(allMeshes);
  if (hits.length > 0) {
    for (var i = 0; i < allMeshes.length; i++) {
      if (allMeshes[i] === hits[0].object) return meshMap[i];
    }
  }
  return { faceIdx: -1, sectionIdx: -1 };
}

function selectRoofSection(faceIdx, sectionIdx) {
  if (roofSelectedFace >= 0 && roofSelectedFace < roofFaces3d.length) {
    var old = roofFaces3d[roofSelectedFace];
    old.selected = false;
    old.selectedSection = -1;
    rebuildRoofFace(roofSelectedFace);
  }
  roofSelectedFace = faceIdx;
  roofSelectedSection = sectionIdx;
  var face = roofFaces3d[faceIdx];
  face.selected = true;
  face.selectedSection = sectionIdx;
  rebuildRoofFace(faceIdx);
  updateRoofPropsPanel();
}

function selectRoofFace(idx) {
  selectRoofSection(idx, -1);
}

function deselectRoofFace() {
  if (roofSelectedFace >= 0 && roofSelectedFace < roofFaces3d.length) {
    var old = roofFaces3d[roofSelectedFace];
    old.selected = false;
    old.selectedSection = -1;
    rebuildRoofFace(roofSelectedFace);
  }
  roofSelectedFace = -1;
  roofSelectedSection = -1;
  updateRoofPropsPanel();
}

/* ══════════════════════════════════════════════════════════════════════════
   DELETION — Section-level and face-level
   ══════════════════════════════════════════════════════════════════════════

   Section deletion:
   1. Push undo snapshot
   2. Mark section as deleted in face.deletedSections
   3. Rebuild face — mesh for that section is skipped, lines auto-update
   4. If all 4 sections deleted -> remove entire face

   Face deletion:
   1. Push undo snapshot
   2. Remove all THREE objects from scene
   3. Splice from roofFaces3d array
   4. Update selection indices
*/

function deleteRoofSection(faceIdx, sectionIdx) {
  if (faceIdx < 0 || faceIdx >= roofFaces3d.length) return;
  var face = roofFaces3d[faceIdx];
  if (!face.deletedSections || sectionIdx < 0 || sectionIdx >= face.deletedSections.length) return;
  pushRoofUndo();
  face.deletedSections[sectionIdx] = true;
  face.selectedSection = -1;
  roofSelectedSection = -1;

  var allDeleted = face.deletedSections.every(function(d) { return d; });
  if (allDeleted) {
    deleteRoofFace(faceIdx);
    return;
  }
  rebuildRoofFace(faceIdx);
  updateRoofPropsPanel();
}

function deleteRoofFace(idx) {
  if (idx < 0 || idx >= roofFaces3d.length) return;
  pushRoofUndo();
  var face = roofFaces3d[idx];
  if (face.mesh) scene3d.remove(face.mesh);
  if (face.edgeLines) scene3d.remove(face.edgeLines);
  if (face.hipLines) scene3d.remove(face.hipLines);
  face.handleMeshes.forEach(function(h) { scene3d.remove(h); });
  face.labelSprites.forEach(function(s) { scene3d.remove(s); });
  roofFaces3d.splice(idx, 1);
  if (roofSelectedFace === idx) { roofSelectedFace = -1; roofSelectedSection = -1; }
  else if (roofSelectedFace > idx) roofSelectedFace--;
  updateRoofPropsPanel();
  markDirty();
}

function clearAllRoofFaces() {
  roofFaces3d.forEach(function(face) {
    if (face.mesh) scene3d.remove(face.mesh);
    if (face.edgeLines) scene3d.remove(face.edgeLines);
    if (face.hipLines) scene3d.remove(face.hipLines);
    face.handleMeshes.forEach(function(h) { scene3d.remove(h); });
    face.labelSprites.forEach(function(s) { scene3d.remove(s); });
  });
  roofFaces3d = [];
  roofSelectedFace = -1;
  roofSelectedSection = -1;
  // Remove outline reference lines
  var toRemove = [];
  scene3d.traverse(function(obj) { if (obj.userData && obj.userData.roofOutline) toRemove.push(obj); });
  toRemove.forEach(function(obj) { scene3d.remove(obj); });
}

/* ══════════════════════════════════════════════════════════════════════════
   UNDO / REDO — Snapshot-based state management
   ══════════════════════════════════════════════════════════════════════════

   The undo system captures full roof state snapshots (all faces + selection).
   Max stack depth: ROOF_UNDO_MAX (50).

   captureRoofSnapshot() — serializes all face data (vertices, pitch,
     sectionPitches, azimuth, height, color, deletedSections) plus selection state.

   restoreRoofSnapshot(snapshot) — clears scene, rebuilds all faces from
     snapshot data, restores selection state.

   pushRoofUndo() — called before any mutating operation (delete, pitch change,
     vertex drag, etc.). Pushes current state onto undo stack, clears redo stack.

   roofUndo() / roofRedo() — pop from respective stack, push current state
     onto the opposite stack, restore the popped snapshot.

   Keyboard: Cmd+Z / Ctrl+Z for undo, Cmd+Shift+Z / Ctrl+Shift+Z for redo.
   Buttons: #undoBtn and #redoBtn, disabled state tracks stack emptiness.
*/

function captureRoofSnapshot() {
  return {
    faces: roofFaces3d.map(function(f) {
      return {
        vertices: f.vertices.map(function(v) { return {x: v.x, z: v.z}; }),
        pitch: f.pitch,
        sectionPitches: f.sectionPitches ? f.sectionPitches.slice() : null,
        azimuth: f.azimuth,
        height: f.height,
        color: f.color,
        deletedSections: f.deletedSections.slice()
      };
    }),
    selectedFace: roofSelectedFace,
    selectedSection: roofSelectedSection
  };
}

function restoreRoofSnapshot(snapshot) {
  clearAllRoofFaces();
  snapshot.faces.forEach(function(rf) {
    finalizeRoofFace(rf.vertices, rf.pitch, rf.azimuth, rf.height, rf.deletedSections, rf.sectionPitches);
  });
  roofSelectedFace = snapshot.selectedFace;
  roofSelectedSection = snapshot.selectedSection;
  if (roofSelectedFace >= 0 && roofSelectedFace < roofFaces3d.length) {
    var face = roofFaces3d[roofSelectedFace];
    face.selected = true;
    face.selectedSection = roofSelectedSection;
    rebuildRoofFace(roofSelectedFace);
  }
  updateRoofPropsPanel();
}

function pushRoofUndo() {
  roofUndoStack.push(captureRoofSnapshot());
  if (roofUndoStack.length > ROOF_UNDO_MAX) roofUndoStack.shift();
  roofRedoStack = [];
  updateUndoRedoButtons();
}

function roofUndo() {
  if (roofUndoStack.length === 0) return;
  roofRedoStack.push(captureRoofSnapshot());
  restoreRoofSnapshot(roofUndoStack.pop());
  updateUndoRedoButtons();
  markDirty();
}

function roofRedo() {
  if (roofRedoStack.length === 0) return;
  roofUndoStack.push(captureRoofSnapshot());
  restoreRoofSnapshot(roofRedoStack.pop());
  updateUndoRedoButtons();
  markDirty();
}

function updateUndoRedoButtons() {
  var undoBtn = document.getElementById('undoBtn');
  var redoBtn = document.getElementById('redoBtn');
  if (undoBtn) undoBtn.disabled = roofUndoStack.length === 0;
  if (redoBtn) redoBtn.disabled = roofRedoStack.length === 0;
}

/* ══════════════════════════════════════════════════════════════════════════
   COMPASS — Azimuth to compass direction
   ══════════════════════════════════════════════════════════════════════════ */

function azimuthToCompass(az) {
  var dirs = ['N','NE','E','SE','S','SW','W','NW'];
  var idx = Math.round(((az % 360) + 360) % 360 / 45) % 8;
  return dirs[idx];
}

/* ══════════════════════════════════════════════════════════════════════════
   SERIALIZATION — Save/load with deletedSections and sectionPitches
   ══════════════════════════════════════════════════════════════════════════ */

function serializeRoofFaces() {
  return roofFaces3d.map(function(f) {
    return {
      vertices: f.vertices,
      pitch: f.pitch,
      sectionPitches: f.sectionPitches,
      azimuth: f.azimuth,
      height: f.height,
      color: f.color,
      deletedSections: f.deletedSections
    };
  });
}

// Loading: call finalizeRoofFace with saved deletedSections and sectionPitches
// design.roofFaces.forEach(function(rf) {
//   finalizeRoofFace(rf.vertices, rf.pitch, rf.azimuth, rf.height, rf.deletedSections, rf.sectionPitches);
// });

/* ══════════════════════════════════════════════════════════════════════════
   PROPERTIES PANEL — Section info, compass, slope, per-section pitch
   ══════════════════════════════════════════════════════════════════════════

   HTML elements in roofPropsSection:
     #roofPropPitch     — pitch input (shows per-section pitch when section selected)
     #roofPropAzimuth   — azimuth input
     #roofPropAzDir     — compass direction label (e.g. "(SW)")
     #roofPropHeight    — height input (displayed in feet, stored in meters)
     #roofPropSlope     — slope display as x/12 format
     #roofPropArea      — area display in ft^2
     #roofEdgeLengthsList — edge length list
     #roofSectionInfo   — shows selected section name
     #btnDeleteRoofSection — deletes selected section

   Section names: ['Hip Triangle A', 'Hip Triangle B', 'Front Trapezoid', 'Back Trapezoid']

   Per-section pitch behavior:
   - When a section is selected, pitch input shows/edits that section's pitch
   - Changing section pitch updates face.sectionPitches[sectionIdx]
   - face.pitch is set to max of all sectionPitches
   - When no section selected, changing pitch updates ALL sectionPitches uniformly
*/

function updateRoofPropsPanel() {
  var section = document.getElementById('roofPropsSection');
  if (!section) return;
  if (roofSelectedFace < 0 || roofSelectedFace >= roofFaces3d.length) {
    section.style.display = 'none';
    return;
  }
  section.style.display = '';
  var face = roofFaces3d[roofSelectedFace];
  var sectionNames = ['Hip Triangle A', 'Hip Triangle B', 'Front Trapezoid', 'Back Trapezoid'];

  // Determine pitch to display (per-section if section selected)
  var displayPitch = face.pitch;
  if (roofSelectedSection >= 0 && face.sectionPitches && face.sectionPitches[roofSelectedSection] !== undefined) {
    displayPitch = face.sectionPitches[roofSelectedSection];
  }

  document.getElementById('roofPropPitch').value = displayPitch;
  document.getElementById('roofPropAzimuth').value = face.azimuth;
  var azDir = document.getElementById('roofPropAzDir');
  if (azDir) azDir.textContent = '(' + azimuthToCompass(face.azimuth) + ')';
  document.getElementById('roofPropHeight').value = (face.height * 3.28084).toFixed(1);

  // Slope as x/12
  var slopeVal = (12 * Math.tan(displayPitch * Math.PI / 180)).toFixed(1);
  var slopeEl = document.getElementById('roofPropSlope');
  if (slopeEl) slopeEl.textContent = slopeVal + ' / 12';

  // Area
  var areaFt2 = (calcPolygonArea(face.vertices) * 10.7639).toFixed(0);
  var areaEl = document.getElementById('roofPropArea');
  if (areaEl) areaEl.textContent = areaFt2 + ' ft\u00B2';

  // Edge lengths
  var edgeList = document.getElementById('roofEdgeLengthsList');
  if (edgeList) {
    var html = '<div style="font-size:0.7rem;color:#999;margin-top:8px;font-weight:600;">Edge Lengths</div>';
    for (var i = 0; i < face.vertices.length; i++) {
      var a = face.vertices[i], b = face.vertices[(i + 1) % face.vertices.length];
      var dx = b.x - a.x, dz = b.z - a.z;
      var ft = (Math.sqrt(dx * dx + dz * dz) * 3.28084).toFixed(1);
      html += '<div style="font-size:0.8rem;color:#ccc;padding:2px 0;">Edge ' + (i + 1) + ': ' + ft + ' ft</div>';
    }
    edgeList.innerHTML = html;
  }

  // Section info
  var sectionInfo = document.getElementById('roofSectionInfo');
  var btnDelSection = document.getElementById('btnDeleteRoofSection');
  var title = document.getElementById('roofPropsTitle');
  if (sectionInfo && btnDelSection) {
    if (roofSelectedSection >= 0 && roofSelectedSection < sectionNames.length) {
      sectionInfo.style.display = '';
      sectionInfo.textContent = sectionNames[roofSelectedSection];
      if (title) title.textContent = 'Roof face information';
      btnDelSection.style.display = '';
    } else {
      sectionInfo.style.display = 'none';
      if (title) title.textContent = 'Roof face information';
      btnDelSection.style.display = 'none';
    }
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   INPUT HANDLING — Click, Delete/Backspace, Undo/Redo, Pitch editing
   ══════════════════════════════════════════════════════════════════════════

   Click on roof (not in drawing mode):
     var hit = findRoofFaceUnderCursor(e);
     if (hit.faceIdx >= 0) {
       selectRoofSection(hit.faceIdx, hit.sectionIdx);
     } else if (roofSelectedFace >= 0) {
       deselectRoofFace();
     }

   Delete/Backspace key:
     if (roofSelectedSection >= 0) {
       deleteRoofSection(roofSelectedFace, roofSelectedSection);
     } else {
       deleteRoofFace(roofSelectedFace);
     }

   Undo: Cmd+Z / Ctrl+Z -> roofUndo()
   Redo: Cmd+Shift+Z / Ctrl+Shift+Z -> roofRedo()

   Pitch input change:
     pushRoofUndo();
     if (roofSelectedSection >= 0 && face.sectionPitches) {
       face.sectionPitches[roofSelectedSection] = val;
       face.pitch = Math.max.apply(null, face.sectionPitches);
     } else {
       face.pitch = val;
       if (face.sectionPitches) {
         for (var i = 0; i < face.sectionPitches.length; i++) face.sectionPitches[i] = val;
       }
     }
     rebuildRoofFace(roofSelectedFace);
     updateRoofPropsPanel();

   Azimuth input change:
     pushRoofUndo();
     face.azimuth = parseFloat(this.value) || 0;
     markDirty();

   Height input change:
     pushRoofUndo();
     face.height = (parseFloat(this.value) || 0) / 3.28084;  // ft -> m
     markDirty();
*/
