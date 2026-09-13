# Release notes

## v1.0.05 — in preparation

SnowEx Field Atlas: aligned LiDAR/UAVSAR archives and interactive site explorers
for snow research across eight western U.S. field sites.

**Author:** Anant Gahlaut, CryoGARS, Boise State University.

### Release scope

- Per-site HDF5 construction with spatial alignment and LiDAR–radar matching.
- Enrichment with terrain derivatives, vegetation-based canopy fractions,
  coherence masks, and available approximate radar geometry.
- Eight browser explorers and a shared Field Atlas entrance.
- Archive verification, transfer manifests, and offline regression fixtures.
- Public-facing overview, workflow guide, scientific limitations, and source
  attribution links.

The current explorer snapshot contains 1,664 display layers, 15 site-specific
snow-depth dates, and 67 site/date-pair/flight-line radar groups. These counts
describe the existing exports, not independent observations or a new HDF5 audit.
In-situ points, trained retrieval models, radar-derived SWE, and NISAR products
are outside the current explorer release.

### Version convention

`v1.0.05` is the project release label. The final `05` denotes the fifth
enrichment cycle. This is a project convention; do not silently normalize the
release label or imply that it is the stored algorithm version.

Existing explorer payloads record `product_version = 0.1.0` and
`enrichment_version = 3.0.0`. The corrected producer writes enrichment `3.1.0`
for new outputs using cleaned bases for derived terrain/canopy/incidence layers
and projection-DEM diagnostics (SNEX-007). It records input-stage lineage;
cleaning thresholds and derivative formulas are unchanged. Production updates
remain pending verified backups and the held coordinated rebuild.
No source commit was recorded in the historical exports. Documentation changes
do not reprocess the archive or alter those provenance fields.

### Validation during preparation — 2026-09-08

- All 250 offline Python tests passed in the existing scientific environment.
- Entrance interactions, DEM notes, and 1,664 standalone product-guide renders
  passed the selected Node.js checks.
- All 17 JavaScript blocks compiled across the eight explorers and entrance.

These are synthetic and script-level checks. Full archive hashes were not
recomputed, the data pipeline was not rerun, and browser appearance, WebGL
behaviour, accessibility, and hosted delivery were not assessed in this pass.
The older `check_workspace.js` is incompatible with the current template and
needs repair or retirement before being used as a release check.

### Limitations and publication status

Known issues include absent snow-depth labels at Reynolds Creek, later canopy
inputs for Grand Mesa's 2017 observations, the current aspect convention,
approximate radar geometry, and incomplete historical processing provenance.
See [scientific notes](docs/scientific-notes.md).

The development repository is private at
[AnantGahlaut/cryogars-atlas](https://github.com/AnantGahlaut/cryogars-atlas).
No public release or demo has been published. Licensing, distributable data
selection, clean-environment installation, and final release checks are tracked
in [the checklist](docs/release-checklist.md).
