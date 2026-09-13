<p align="center">
  <img src="assets/cryogars-logo.jpg" alt="CryoGARS" width="140">
</p>

# SnowEx Field Atlas

**Aligned LiDAR and UAVSAR observations for snow research.**

SnowEx Field Atlas brings terrain, snow depth, vegetation height, and L-band
radar observations together on a common grid across eight field sites in the
western United States. It combines a per-site HDF5 archive with an interactive
3D explorer, making it possible to inspect measurements, acquisition dates,
spatial coverage, and processing metadata in one place.

**Author:** Anant Gahlaut · [CryoGARS](https://github.com/cryogars),
Cryosphere, Geophysics and Remote Sensing research lab, Boise State University.

**Release target: v1.0.05 · fifth enrichment cycle · research preview**

[Open 3D Atlas](https://anantgahlaut.github.io/cryogars-atlas-viewer/) ·
[Get started](#get-started) · [Field sites](#field-sites) ·
[Scientific notes](docs/scientific-notes.md) ·
[Data sources](docs/data-sources.md) · [Release notes](CHANGELOG.md)

## What the project provides

LiDAR and radar products arrive with different grids, footprints, acquisition
dates, and file conventions. This project organizes those differences into a
consistent archive while retaining the information needed to interpret them.

- **A common analysis grid.** Per-site archives align source rasters to a 3 m
  projected grid, with coordinate systems, transforms, units, and source
  metadata stored alongside the data.
- **LiDAR–radar matching.** Footprint-based discovery and temporal match tables
  help identify which observations can be studied together.
- **Enriched research layers.** Terrain derivatives, vegetation-based canopy
  fractions, coherence masks, and approximate radar geometry support exploration
  and subsequent method development.
- **An interactive field atlas.** Browse the archive hierarchy, inspect dates
  and metadata, compare layers on 3D terrain, and adjust colour palettes in a
  browser. Display data are embedded in each site export.
- **Temporary raster comparisons.** Import a numeric GeoTIFF or choose another
  same-product layer, inspect A/B/difference maps, and export a labelled 2D PNG.
  Runs locally in the browser at the exported website grid resolution; archive
  data stay untouched. See [comparison usage and limitations](docs/BROWSER_COMPARISON.md).
- **Archive verification and transfer checks.** Independent enrichment checks
  and SHA-256 manifests support quality review and file-integrity verification.

This release provides data preparation and exploration infrastructure for
snow-depth research. Validated machine-learning retrievals, radar-derived snow
water equivalent (SWE), and NISAR integration are future work.

## Field sites

The current explorer snapshot covers Colorado, Idaho, and Utah. Every site has
terrain, vegetation-height, and UAVSAR layers; snow-depth coverage varies.

| Site | State | Snow-depth dates | Vegetation-height dates | Radar groups | Display layers |
| --- | --- | ---: | ---: | ---: | ---: |
| Grand Mesa | Colorado | 6 | 2 | 27 | 446 |
| Banner Summit | Idaho | 2 | 2 | 11 | 329 |
| Mores Creek | Idaho | 2 | 2 | 10 | 305 |
| Little Cottonwood Canyon | Utah | 1 | 1 | 6 | 177 |
| Fraser | Colorado | 2 | 2 | 5 | 159 |
| Cameron Pass | Colorado | 1 | 1 | 5 | 149 |
| Dry Creek | Idaho | 1 | 1 | 2 | 64 |
| Reynolds Creek | Idaho | 0 | 1 | 1 | 35 |
| **Total** | **3 states** | **15** | **12** | **67** | **1,664** |

Counts were read from the eight existing explorer payloads during release
preparation. Dates are counted separately within each site. A radar group is a
site/date-pair/flight-line combination; shared flights can appear at multiple
sites. Display layers include derived products and radar channels, and are not
a count of independent observations or full-resolution HDF5 datasets.

Reynolds Creek provides terrain, vegetation, and radar context, but currently
has no LiDAR snow-depth labels for supervised snow-depth evaluation.

## Get started

### Explore a prepared viewer

**Repository status:** private development source at
[AnantGahlaut/cryogars-atlas](https://github.com/AnantGahlaut/cryogars-atlas).
A source checkout does not include generated viewer pages or the HDF5 archive.

**[Open the public 3D Atlas](https://anantgahlaut.github.io/cryogars-atlas-viewer/)**
to explore all eight sites without installing anything or signing in. The
prepared viewer snapshot is hosted separately from this private development
repository; the full-resolution HDF5 archive is not included. A code license
has not yet been selected.

With a generated viewer bundle, open `viewer/index.html` in a modern browser,
select a field site, and choose **Open 3D explorer**. No Python installation or
HDF5 download is needed to browse a prepared export. The 3D explorers require
WebGL.

The entrance page has no external dependencies. Site exports embed their
application and sampled data, but currently request Google Fonts; local font
fallbacks are provided. The eight site pages together occupy approximately
105 MiB, so larger sites can take time to load.

### Generate a viewer from an existing archive

Use a Python environment with NumPy and h5py installed. Run commands from this
project's directory and replace `path/to/archive` with the directory containing
your per-site HDF5 files:

```bash
python make_explorer.py --site mores_creek --out-dir "path/to/archive" --viewer-dir viewer
```

The builder prefers `<site>.enriched.h5` when available, falls back to
`<site>.h5`. Open `viewer/mores_creek_explorer.html` after this single-site build.
For automatic all-site discovery and an entrance page, use `--all` in place of
`--site mores_creek`; discovery currently requires the base `<site>.h5` filenames
to be present, even when enriched files supply the data. This command reads and
samples archive arrays; large sites require substantial memory and processing
time. See [the workflow guide](docs/workflows.md) for dependencies, acquisition,
enrichment, verification, and UI maintenance.

### Read an archive in Python

Read a small window without loading an entire site into memory:

```python
import h5py

with h5py.File("path/to/archive/banner_summit.enriched.h5", "r") as archive:
    info = archive["identification"].attrs
    print("CRS:", info["common_crs_epsg"])
    print("Grid:", info["common_grid_shape"])

    surveys = archive["science/LIDAR/SD"]
    survey_date = sorted(surveys.keys())[0]
    depth = surveys[survey_date]["snow_depth"]
    window = depth[:256, :256]
    print(survey_date, window.shape, dict(depth.attrs))
```

Use the recorded affine transform and CRS to locate a window geographically.
Missing values must remain masked during analysis. Keep readers closed while
an archive build or enrichment process is writing the same file.

## How the archive is organized

```text
Source products and annotations
          |
          v
Discover footprints and temporal matches
          |
          v
Reproject and align to a per-site 3 m grid
          |
          v
<site>.h5  -->  enrichment  -->  <site>.enriched.h5
                                      |             |
                                      v             v
                               verify + hash   sample for display
                                                    |
                                                    v
                                            <site>_explorer.html
```

The enriched archive uses the following main groups; availability varies by site:

```text
identification/                       site, grid, and processing metadata
matches/                              LiDAR–radar matching records
science/
  LIDAR/
    DEM/grids/elevation
    SD/<survey_date>/snow_depth
    VH/<survey_date>/veg_height
    DERIVED/                          terrain and vegetation derivatives
  UAVSAR/
    <date1>_<date2>/<flight_line>/
      <polarization>/                 amplitude, phase, coherence, masks
      GEOMETRY/                       available radar geometry layers
```

The base `.h5` files already contain aligned and processed data; “raw archive”
in older project notes means the pre-enrichment archive, not untouched sensor
data. Enrichment writes a separate `.enriched.h5` product.

## Scientific interpretation

- **Grid spacing and measurement resolution differ.** Alignment to a 3 m grid
  does not create native 3 m radar information. The archive grid, display colour
  grid, and terrain mesh also have different sampling scales.
- **Dates and terrain sources differ.** Grand Mesa combines 2017 and 2020
  snow-depth surveys and uses a LiDAR-derived snow-off DTM from the HRSI
  collection, resampled from 1 m to 3 m. Reynolds Creek uses a 2014 LiDAR DEM.
  Six other sites use the QSI DEM products.
- **Canopy fractions are a vegetation-height proxy.** The 2017 Grand Mesa
  scenes rely on later canopy information. The centered window is 11 × 11 cells
  (33 × 33 m at 3 m spacing), from a nominal 30 m request. Edges truncate the
  window; missing vegetation cells are excluded from its denominator. A missing
  center can receive a fraction; no finite cells in the window gives no value.
- **Some derived geometry needs qualification.** The current aspect convention
  has a north/south reflection relative to conventional downhill bearings, and
  radar incidence uses approximate peg-track geometry.
- **Derivative input stages differ by generation.** The corrected source now
  computes terrain, canopy and incidence layers from the cleaned bases stored
  in the same output archive and records that stage. Existing production files
  await regeneration; their derivatives still reflect the earlier input policy.
- **Display and verification have limits.** Sampled colour stretches are not
  quantitative uncertainty estimates. Passing archive checks establishes the
  checked processing invariants, not retrieval accuracy or label truth.

Read [processing details and known limitations](docs/scientific-notes.md) before
quantitative analysis or model evaluation, including spatial and temporal data
separation and the limits of the recorded provenance.

## Documentation and development

| Resource | Contents |
| --- | --- |
| [Workflow guide](docs/workflows.md) | Environment, build commands, verification, and viewer maintenance |
| [Scientific notes](docs/scientific-notes.md) | Processing assumptions, display sampling, and known limitations |
| [Data sources](docs/data-sources.md) | Dataset identifiers, source links, and citation guidance |
| [Release notes](CHANGELOG.md) | Scope and version conventions for v1.0.05 |
| [Release checklist](docs/release-checklist.md) | Remaining publication and reproducibility work |

The repository includes small offline fixtures and regression tests. The
[workflow guide](docs/workflows.md#checks) distinguishes source tests, checks
requiring generated exports, and full-archive verification.

## Attribution and license

This work uses observations provided by the NASA SnowEx community, the NASA/JPL
UAVSAR team, and the NSIDC, ASF, and ORNL data archives. Cite the original
datasets and identify the site, acquisition dates, subset, and processing
version used in your analysis; see [data sources](docs/data-sources.md).

**Code license: not yet selected.** No code license is supplied in this working
copy. Source datasets retain their own attribution and use requirements.
