# Comparison browser acceptance — 2026-09-13

## Scope and evidence

Actual clicks, WebGL interaction, and downloads in Comet on Windows, using
`ui_preview/banner_summit_logo_notes_preview.html`. No production explorer,
index, archive, or scientific product notes were changed during these checks.

- Reference A: `science/LIDAR/SD/20200218/snow_depth`.
- Comparison B: `science/LIDAR/SD/20210315/snow_depth`.
- Fixed analysis raster: **632 × 689 cells at 24 m**, EPSG:6340.
- Shared finite cells: **291,145 / 435,448 (66.9%)**.
- Displayed mean B − A: −0.03345 m; MAE: 0.1283 m; RMSE: 0.1916 m.
  These are disagreement statistics on quantized website previews, not a
  native-resolution accuracy assessment.

## Passed in the live browser

- Run B − A from the two archive layers; open the temporary 3D tab.
- Switch the temporary map between A, B, and B − A.
- Apply Magma and Robust 2–98%; terrain and both color bars update together.
- Reverse Magma and apply Detail 10–90%; updated colors and limits appear.
- Orbit terrain with the modeless color inspector still open.
- Select ordinary vegetation height with that inspector open: inspector and
  comparison strip close, vegetation data and its own palette appear.
- Return explicitly to the temporary tab: comparison and its colors restore.
- Reload: temporary tab/results disappear and the normal DEM opens.
- Download from both **Export PNG** and **Export 2D PNG**; reopen the actual files.
  Both are **768 × 1051 PNGs** with an unscaled **632 × 689** map raster and
  annotation margins. Neither is a screenshot of lit terrain.
- Inspect the complete downloaded figures: title, color bar, units, source
  paths, grid/CRS, percentile/reversal labels, and caveats are readable without
  clipping. Nodata renders white in the final figure.

Local evidence retained under `ui_preview/comparison_acceptance_20260913/`:

| File | Export button / appearance | SHA-256 |
| --- | --- | --- |
| `difference_magma_robust.png` | Terrain strip / Magma, Robust 2–98%, symmetric ±0.56353 m | `756a71844903f9231c9119628bdb502d22038699fcc26904d4b205a46a37dc33` |
| `difference_magma_reversed_detail.png` | Inspector / reversed Magma, Detail 10–90%, symmetric ±0.25906 m | `a54f4793490a5ce6fc6d8e5497cb1f542202812d32f0d20bf803eda2517b505d` |

## Corrected labels and user acceptance

The temporary layer's main legend called the comparison percentile selection
“Manual value range”, although the inspector and PNG labels were correct.
Its Info card also inherited the old archive coverage calculation and showed
100.5% by mixing analysis-grid finite counts with native DEM counts. Neither
label changes the subtraction or exported values.

Both labels were corrected in the comparison bridge only: the legend uses the
actual comparison stretch description, and the Info card reports the integer
shared-cell count over total comparison-grid cells, not native DEM coverage.
Four regression tests were added. The complete six-file comparison suite passed
**76/76**, including three real-data checks; no skipped tests.

The separate candidate is
`ui_preview/banner_summit_comparison_acceptance_preview.html`. On 2026-09-13,
Anant reported **“all of them passed”** after checking both requested corrections:

- Info: **shared cells — 291,145 / 435,448**, not coverage over 100%.
- Selecting **Robust 2–98%** updates the main legend instead of displaying
  “Manual value range”.

This records the user's visual acceptance, not an additional agent-controlled
browser run. The candidate's manifest records its exact sources and unchanged
production-page hashes. The approved product-notes preview, its manifest, and
production pages remain separate and unchanged by these comparison fixes.

Final source review also reproduced a label-only edge case: choosing Robust or
Detail in the original legend with tied/missing/invalid stored limits falls
back to full limits, but comparison provenance still claimed percentiles.
`appearance()` now explicitly labels that full-range fallback using the same
range-validity rule as the renderer. Numerical values and limits are unchanged.
The new regression failed before the fix and passed afterward; **77/77** tests
now pass across all six comparison suites, plus **6/6** Python add-on tests.

This final edge-case guard is **source-tested only** and was not rebuilt into
the user-accepted candidate. Its accepted SHA-256 remains
`d01e3a78ed6047b0f2728304cb002e9175c9ff661b317885543352637dd73894`.
No production rollout or deployment was performed.

## Remaining browser coverage

- User-supplied GeoTIFF file selection, band selection, conversion inputs, and
  large-file cancellation in a real browser (offline TIFF tests are separate).
- Custom numeric percentile entry, saved custom palette edits, and manual
  main-legend limit edits through real browser controls.
- Other seven sites, other browsers/devices, small screens, and hosted pages.
- Fresh-install reproducibility and scientific batch rollout are separate work.

Automated baseline: 69 tests passed across `test_core.js`, `test_tiff.js`,
`test_export_style.js`, `test_panel.js`, and `test_ui.js`. DOM/canvas mocks do not
replace the live checks listed above; unchecked paths are not certified here.
