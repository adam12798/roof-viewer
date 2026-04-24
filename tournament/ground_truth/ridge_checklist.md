# Ridge Checklist — 20 Meadow (mn9805q0ddm)

## Expected Ridges: 3

Three distinct ridges on separate roof planes at different elevations. They are roughly co-linear (all ~N-S) but must NOT be merged. Each must be detected independently.

### Ridge 1: Main Upper Ridge
- **Description:** Ridge of the main (largest) gable roof section at the top/north of the building
- **Orientation:** Roughly N-S (nearly vertical in satellite view)
- **Length:** Longest of the three (~6-8m estimated)
- **Position:** Center of the upper roof section, dividing east and west slopes
- **Elevation:** Highest of the three ridges
- **Confidence expectation:** High — dominant ridge, clear gable

### Ridge 2: Middle Ridge
- **Description:** Ridge of the middle roof section, between upper and lower
- **Orientation:** Roughly N-S, co-linear with Ridge 1
- **Length:** Medium (~3-5m estimated)
- **Position:** Center of the middle roof section
- **Elevation:** Mid-height — separate plane from Ridge 1
- **Confidence expectation:** Medium — smaller section, may be harder to detect

### Ridge 3: Lower/Front Ridge
- **Description:** Ridge of the lower front section (garage/addition), darker shingles visible in satellite
- **Orientation:** Roughly N-S, co-linear with Ridges 1 and 2
- **Length:** Shortest (~3-4m estimated)
- **Position:** Center of the lower/front roof section
- **Elevation:** Lowest of the three ridges
- **Confidence expectation:** Medium — smaller section, different shingle color

## Critical Failure Modes
- **Merging ridges:** Collapsing 2 or 3 ridges into one long line due to co-linear alignment — this is WRONG
- **Missing small ridges:** Detecting only Ridge 1 and ignoring Ridges 2 and 3 — this is a FAILURE
- **Extending Ridge 1:** Making Ridge 1 span the full building length (covering all three sections) — this is a merge failure

## NOT ridges (false positive traps)
- Shadow edges on the west side — NOT ridges
- Eave lines along the roof perimeter — NOT ridges
- Driveway/walkway edges below the building — NOT ridges
- Tree shadow edges on the east side — NOT ridges
- Roof section boundaries (horizontal lines between sections) — NOT ridges, these are eaves/steps

## Success Criteria
- [ ] Ridge 1 (main upper) found as independent line
- [ ] Ridge 2 (middle) found as independent line
- [ ] Ridge 3 (lower/front) found as independent line
- [ ] No merging — each ridge is a separate line segment
- [ ] No false ridges (shadows, eaves, rakes, driveway lines)
- [ ] Each ridge placement is close to its section's actual peak centerline
- [ ] Each ridge length matches its section (not overextended into adjacent sections)
- [ ] Ridge confidence is meaningful (>0.5 for each)
