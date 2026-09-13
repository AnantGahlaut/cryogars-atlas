# Workflow guide

Run commands from the project directory. Paths below are placeholders: choose
archive and scratch directories with sufficient space, outside cloud-synced
source folders. Keep explicit `--out-dir` arguments so a command does not read
or write an unintended local `out` directory.

## Environment

| Task | Requirements |
| --- | --- |
| Browse a prepared export | Modern browser; WebGL for the 3D explorer |
| Rebuild only the entrance | Python standard library |
| Generate explorers from HDF5 | Python, NumPy, h5py |
| Build and enrich archives | Scientific/geospatial environment and source-data access |
| Refresh explorer interfaces and run JavaScript checks | Node.js; version 22.21.0 checked locally |

A candidate scientific environment is provided in
[`environment.yml`](../environment.yml):

```bash
conda env create -f environment.yml
conda activate snowex-atlas
```

The versions listed in that file match the installed scientific packages used
for this documentation pass. **A fresh installation from the file has not yet
been tested.** The successful offline run used an existing Windows Conda
environment with Python 3.11.15. Activate the environment before using Rasterio
so GDAL's runtime data paths are configured.

The full builder uses NumPy, h5py, Rasterio, SciPy, Shapely, pyproj, earthaccess,
asf_search, requests, and affine. NumPy and h5py suffice for explorer extraction.
Node.js is installed separately. Tests use Python's standard-library `unittest`;
pytest is not required.

## Browse or regenerate exports

Open `viewer/index.html` when you already have a generated bundle. For an
existing archive, build one site first:

```bash
python make_explorer.py --site mores_creek --out-dir "path/to/archive" --viewer-dir viewer
```

To generate all available sites and an entrance:

```bash
python make_explorer.py --all --out-dir "path/to/archive" --viewer-dir viewer
```

`--all` currently discovers site names only from base `<site>.h5` filenames.
If the directory contains enriched files only, use `--site <key>` for each site
and then run `python make_index.py --viewer-dir viewer`. Enriched files are
preferred; `--prefer-plain` selects base archives. Explicit
`--stride` and `--terrain-stride` options change display sampling. These commands
read full scientific arrays and can be costly, especially at Grand Mesa. Back
up existing generated pages before replacing them with a full extraction run.

## Acquire and build data

Discovery contacts NASA CMR and ASF. Downloads require a NASA Earthdata account
and any applicable provider authorization. Keep authentication in the user
account's credential configuration, outside the repository; never put actual
credentials in commands, notebooks, or release files.

1. Discover and write a site inventory:

   ```bash
   python build_hdf5.py --mode preflight --sites mores_creek --inventory "path/to/inventory.json"
   ```

2. Check configured authentication:

   ```bash
   python build_hdf5.py --mode check-auth
   ```

3. Download, align, and write the base archive:

   ```bash
   python build_hdf5.py --mode build --sites mores_creek --inventory "path/to/inventory.json" --out-dir "path/to/archive" --work-dir "path/to/scratch"
   ```

`--mode build` is essential: the script defaults to `preflight`. Normal build
reruns preserve completed arrays unless `--overwrite` is specified. Source
catalogues can change; preserve the actual inventory used for a reproducible
run. Do not infer a fixed download volume from historical estimates.

## Enrich safely

Enrichment reads `<site>.h5` and writes `<site>.enriched.h5`. The current code
removes an existing enriched destination before rebuilding it; it does not
perform an atomic replacement. Preserve a verified copy of finished outputs,
or use a separate candidate suffix:

```bash
python enrich_hdf5.py --site mores_creek --out-dir "path/to/archive" --suffix .candidate
```

After reviewing that candidate and retaining a backup, the standard command is:

```bash
python enrich_hdf5.py --site mores_creek --out-dir "path/to/archive"
```

Use `--all` in place of `--site mores_creek` to process all base site files.
Enrichment normally tries to fetch radar annotations through ASF. `--no-network`
skips annotation-derived radar geometry entirely, even when annotations are
cached, because the current geometry branch requires a session. In-situ observations are omitted by
default; `--with-insitu` opts in. Explorer extraction has a separate flag of the
same name.

Candidate files are not automatically selected by the explorer or the
`verify_enriched.py` command. The standard verified/viewed filename remains
`<site>.enriched.h5`. Do not rename a candidate over a finished file casually.

## Verify an archive and its transfer

Wait until all writers are finished before opening their archives:

```bash
python build_hdf5.py --mode verify --sites mores_creek --out-dir "path/to/archive"
python verify_enriched.py --site mores_creek --out-dir "path/to/archive"
python manifest.py --out-dir "path/to/archive"
python manifest.py --out-dir "path/to/archive" --verify
```

The first command checks base archive invariants. The independent enrichment
checker reads values and currently expects enrichment version 3.x. Manifest
creation writes `MANIFEST.json` and `MANIFEST.sha256`; verification checks the
existing manifest. Full scans and hashes can take considerable time.

Default manifests include per-file SHA-256 and per-dataset summary statistics.
Summary statistics alone cannot localize every possible corruption. The current
Python verifier only checks files it finds: it does not fail for a missing
manifest-listed file or an extra unlisted file. Check the expected file list
separately. On systems with `sha256sum`, run `sha256sum -c MANIFEST.sha256` from
the archive directory after transfer; this checks every listed file, including
whether it is missing.

The optional `--deep` dataset hashing also needs correction before being used
as reproducible evidence: object/string arrays are hashed from NumPy memory
representations rather than a stable serialization. Per-file SHA-256 hashes
do not have that limitation.

## Maintain the viewer without rereading HDF5

### Entrance only

Edit `index_template.html`, preserve a copy of the existing entrance, then run:

```bash
python make_index.py --viewer-dir viewer
```

This reads existing `*_explorer.html` payloads and writes only `viewer/index.html`.

### Isolated logo and notes

Edit `ui_preview/logo_notes_addon.html`, then run:

```bash
python explorer_addon.py --rollout
```

This command requires all eight site pages and the existing entrance. It backs
up existing pages and replaces the isolated add-on while checking
that original application code, styles, and embedded data remain intact. Full
builds and interface refreshes include the same add-on automatically.

### Shared explorer interface

When changing `explorer_template.html`, run:

```bash
python refresh_explorers.py --viewer-dir viewer
```

This backs up existing pages, checks replacement JavaScript with Node.js,
reuses each page's exact embedded payload, and regenerates the entrance.
Changing scientific data or sampling still requires extraction from HDF5.

`product_guide.js` contains additional scientific notes under review. Passing
its standalone checks does not mean those notes are the active side panel.

## Checks

Run the six source suites explicitly; do not discover tests inside backups:

```bash
python -m unittest test_build_hdf5 test_make_explorer test_make_index test_refresh_explorers test_explorer_addon test_scientific_methods
```

All **250 tests passed** in the existing scientific environment on 2026-09-08.
They use small offline fixtures and do not validate the entire research archive.

With the eight generated explorers and entrance present:

```bash
node ui_preview/check_index.js
node ui_preview/check_dem_notes.js
node ui_preview/check_product_guides.js
```

These passed during preparation, including 1,664 standalone product-guide
renders. `node ui_preview/check_preview.js viewer/index.html` checks JavaScript
syntax in a specified HTML file; it can also be run on each site page. All 17
script blocks in the nine current pages compiled.

**Known stale check:** `ui_preview/check_workspace.js` expects a removed
`layerDisplayName` function and fails against the current template. Repair or
retire it before making it part of release automation. Preview/rollout checks
that depend on local backup baselines are not portable source-only checks.

No browser appearance, WebGL behaviour, keyboard accessibility, small-screen
layout, or hosted deployment was assessed in this pass. Those remain separate
release-review tasks.

## Files required in a source release

Keep the archive builder/enricher, verifiers, explorer generators/templates,
`product_guide.js`, source tests, and public documentation together. The
following paths are runtime dependencies despite their preview-directory name:

- `assets/cryogars-logo.jpg`
- `ui_preview/logo_notes_addon.html`
- `ui_preview/check_preview.js`
- `ui_preview/check_logo_notes_rollout.js`

Generated viewers, data archives, local launch scripts, internal handoff notes,
logs, caches, backups, and credentials should be selected or excluded
deliberately. See [the release checklist](release-checklist.md).
