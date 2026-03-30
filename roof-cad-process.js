/* ══════════════════════════════════════════════════════════════════════════
   ROOF CAD ENGINE — Independent roof geometry processing module
   Extracted from server.js for modularity and reuse.

   Handles: hip roof geometry computation, section mesh building,
   interior line generation, section selection/deletion with auto-updating lines.
   ══════════════════════════════════════════════════════════════════════════ */

/* ── State ── */
var roofFaces3d = [];
var roofSelectedFace = -1;
var roofSelectedSection = -1;
var roofDrawingMode = false;
var roofTempVertices = [];
var roofTempHandles = [];
var roofTempLines = null;
var roofDraggingHandle = -1;
var roofDraggingFaceIdx = -1;

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

   Returns: { v0, v1, v2, v3, r0x, r0z, r1x, r1z, m0x, m0z, m1x, m1z, inset, ldx, ldz }
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
  return { v0: v0, v1: v1, v2: v2, v3: v3, r0x: r0x, r0z: r0z, r1x: r1x, r1z: r1z,
           m0x: m0x, m0z: m0z, m1x: m1x, m1z: m1z, inset: inset, ldx: ldx, ldz: ldz };
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
*/

/* ══════════════════════════════════════════════════════════════════════════
   MESH BUILDING — Creates individual THREE.Mesh per section
   ══════════════════════════════════════════════════════════════════════════ */

/*
   buildRoofSectionMeshes(verts, color, pitchDeg, deletedSections, selectedSection)

   Returns: Array of 4 THREE.Mesh objects (or null for deleted sections)
            For non-hip (flat/non-rect), returns array of 1 mesh.

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

  // When a hip triangle is deleted, trapezoids expand to fill the gap:
  // Ridge endpoints shift to short-side midpoints at same height
  var er0x = ds[0] ? hip.m0x : hip.r0x;
  var er0z = ds[0] ? hip.m0z : hip.r0z;
  var er1x = ds[1] ? hip.m1x : hip.r1x;
  var er1z = ds[1] ? hip.m1z : hip.r1z;

  var sectionPositions = [
    // Section 0: Hip tri v0-R0-v3
    [hip.v0.x, baseY, hip.v0.z, hip.r0x, ridgeY, hip.r0z, hip.v3.x, baseY, hip.v3.z],
    // Section 1: Hip tri v1-v2-R1
    [hip.v1.x, baseY, hip.v1.z, hip.v2.x, baseY, hip.v2.z, hip.r1x, ridgeY, hip.r1z],
    // Section 2: Front trapezoid v0-v1-eR1-eR0 (expands when hip tris deleted)
    [hip.v0.x, baseY, hip.v0.z, hip.v1.x, baseY, hip.v1.z, er1x, ridgeY, er1z,
     hip.v0.x, baseY, hip.v0.z, er1x, ridgeY, er1z, er0x, ridgeY, er0z],
    // Section 3: Back trapezoid v3-eR0-eR1-v2 (expands when hip tris deleted)
    [hip.v3.x, baseY, hip.v3.z, er0x, ridgeY, er0z, er1x, ridgeY, er1z,
     hip.v3.x, baseY, hip.v3.z, er1x, ridgeY, er1z, hip.v2.x, baseY, hip.v2.z]
  ];

  var meshes = [];
  for (var i = 0; i < 4; i++) {
    if (ds[i]) { meshes.push(null); continue; }
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

   When sections are deleted, lines update as follows:

   HIP LINES — a hip line is the fold between two adjacent roof planes.
   It only exists if BOTH adjacent sections exist:
     v0→R0 : border of section 0 and section 2 — needs both alive
     v3→R0 : border of section 0 and section 3 — needs both alive
     v1→R1 : border of section 1 and section 2 — needs both alive
     v2→R1 : border of section 1 and section 3 — needs both alive

   RIDGE LINE — always present (if any section alive), but endpoints shift:
     - Section 0 (hip tri A) deleted → ridge extends from m0 (midpoint of short side)
       instead of R0, at the SAME HEIGHT (ridge height does not change)
     - Section 1 (hip tri B) deleted → ridge extends to m1 instead of R1
     - Both deleted → ridge spans full length m0 to m1 (gable-style)
*/
function buildHipRoofLines(verts, pitchDeg, deletedSections) {
  if (!verts || verts.length !== 4) return null;
  var ds = deletedSections || [false, false, false, false];

  var hip = computeHipGeometry(verts, pitchDeg);
  var ridgeY = hip.inset * Math.tan((pitchDeg || 10) * Math.PI / 180) + 0.12;
  var baseY = 0.12;

  // Ridge endpoints shift to short-side midpoints when hip triangles are deleted
  var re0x = ds[0] ? hip.m0x : hip.r0x;
  var re0z = ds[0] ? hip.m0z : hip.r0z;
  var re1x = ds[1] ? hip.m1x : hip.r1x;
  var re1z = ds[1] ? hip.m1z : hip.r1z;

  var positions = [];

  // Hip lines — only drawn if both adjacent sections exist
  if (!ds[0] && !ds[2]) positions.push(hip.v0.x, baseY, hip.v0.z, hip.r0x, ridgeY, hip.r0z);
  if (!ds[0] && !ds[3]) positions.push(hip.v3.x, baseY, hip.v3.z, hip.r0x, ridgeY, hip.r0z);
  if (!ds[1] && !ds[2]) positions.push(hip.v1.x, baseY, hip.v1.z, hip.r1x, ridgeY, hip.r1z);
  if (!ds[1] && !ds[3]) positions.push(hip.v2.x, baseY, hip.v2.z, hip.r1x, ridgeY, hip.r1z);

  // Ridge line — always present if any section alive
  var anyAlive = !ds[0] || !ds[1] || !ds[2] || !ds[3];
  if (anyAlive) {
    positions.push(re0x, ridgeY, re0z, re1x, ridgeY, re1z);
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
     pitch:            number,                  // degrees 0-90
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

function finalizeRoofFace(verts, pitch, azimuth, height, deletedSections) {
  var face = {
    id: 'rf_' + Date.now().toString(36) + '_' + roofFaces3d.length,
    vertices: verts,
    pitch: pitch || 0,
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
   1. Mark section as deleted in face.deletedSections
   2. Rebuild face — mesh for that section is skipped, lines auto-update
   3. If all 4 sections deleted → remove entire face

   Face deletion:
   1. Remove all THREE objects from scene
   2. Splice from roofFaces3d array
   3. Update selection indices
*/

function deleteRoofSection(faceIdx, sectionIdx) {
  if (faceIdx < 0 || faceIdx >= roofFaces3d.length) return;
  var face = roofFaces3d[faceIdx];
  if (!face.deletedSections || sectionIdx < 0 || sectionIdx >= face.deletedSections.length) return;
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
}

/* ══════════════════════════════════════════════════════════════════════════
   SERIALIZATION — Save/load with deletedSections
   ══════════════════════════════════════════════════════════════════════════ */

function serializeRoofFaces() {
  return roofFaces3d.map(function(f) {
    return {
      vertices: f.vertices,
      pitch: f.pitch,
      azimuth: f.azimuth,
      height: f.height,
      color: f.color,
      deletedSections: f.deletedSections
    };
  });
}

// Loading: call finalizeRoofFace with saved deletedSections
// design.roofFaces.forEach(function(rf) {
//   finalizeRoofFace(rf.vertices, rf.pitch, rf.azimuth, rf.height, rf.deletedSections);
// });

/* ══════════════════════════════════════════════════════════════════════════
   INPUT HANDLING — Click for section select, Delete/Backspace for removal
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
*/

/* ══════════════════════════════════════════════════════════════════════════
   PROPERTIES PANEL — Section info display
   ══════════════════════════════════════════════════════════════════════════

   HTML additions to roofPropsSection:
     <div id="roofSectionInfo">       — shows "Selected: Hip Triangle A" etc.
     <button id="btnDeleteRoofSection"> — orange button, deletes selected section

   Section names: ['Hip Triangle A', 'Hip Triangle B', 'Front Trapezoid', 'Back Trapezoid']

   updateRoofPropsPanel() shows/hides section info based on roofSelectedSection.
*/
