# v1.0.05 release checklist

**Status: private development repository; public release pending.** The author
approved creating and pushing source to the private repository. No public tag,
release, demo, or archive distribution is authorized by that initial push.

Release label: **v1.0.05**, with `05` denoting the fifth enrichment cycle.
Author: **Anant Gahlaut**. Destination organization:
[CryoGARS](https://github.com/cryogars), as a later transfer target. The current
private repository is
[AnantGahlaut/cryogars-atlas](https://github.com/AnantGahlaut/cryogars-atlas).
Organization access and transfer remain separate steps.

## Completed in this documentation pass

- [x] Rewrite the README around purpose, capabilities, site coverage, and entry points.
- [x] Read all eight current viewer payloads for site counts and recorded versions.
- [x] Separate the release label from product 0.1.0 and enrichment 3.0.0 provenance.
- [x] Add workflow, scientific-method, data-source, and release-note documents.
- [x] Credit Anant Gahlaut without personal development context.
- [x] Add local/data/credential exclusions and a candidate environment specification.
- [x] Run all 250 offline Python tests in an existing scientific environment.
- [x] Check entrance interactions, DEM notes, and standalone product-guide rendering.
- [x] Compile the 17 JavaScript blocks in the eight explorers and entrance.
- [x] Preserve and hash-check backups of the previous README and checklist.

## Decide before repository integration

- [x] Choose the initial private repository: `AnantGahlaut/cryogars-atlas`.
- [ ] Arrange any later CryoGARS transfer, preserving project history.
- [ ] Choose a code license and confirm additional contributors and acknowledgements.
- [ ] Add `LICENSE` and complete `CITATION.cff` with the final repository URL and
      contributor metadata; do not invent a DOI, funding award, or ORCID.
- [ ] Decide whether the public release is source-only, includes a viewer bundle,
      or also links to a separately hosted full-resolution archive.
- [ ] Confirm attribution and redistribution requirements for the selected
      datasets and derived demo layers. Current explorers omit in-situ points.
- [ ] Review the draft README and final release scope with the author.

## Scientific release decisions

- [x] Document missing Reynolds Creek labels, Grand Mesa canopy/date substitutions,
      differing elevation sources, and unestablished label uncertainty.
- [x] Explain that common-grid spacing differs from native and display resolution.
- [x] Describe palette percentiles as colour stretches, not retained-observation counts.
- [ ] Correct or explicitly exclude the current aspect product from quantitative use.
- [x] Resolve the canopy-window choice (SNEX-006): retain the centered calculation
      and describe 11 × 11 cells / 33 × 33 m support; source/docs corrected.
- [ ] Propagate the SNEX-006 description and explicit nominal/effective window
      metadata to backed-up archives and the coordinated explorer export.
- [x] Resolve derivative input stage (SNEX-007): new source uses the cleaned
      stored bases and records input-stage lineage; current cleaning retained.
- [ ] Regenerate affected terrain/canopy/incidence layers and projection-DEM
      diagnostics with verified backups; validate against their declared bases.
- [x] Correct incidence summary wording and denominator in source (SNEX-008):
      incidence >= 90 degrees over finite cells; empty summaries unavailable.
- [ ] Propagate the corrected incidence summary to backed-up final angle products
      and coordinated exports, preserving historical whole-grid metadata.
- [ ] Review approximate incidence geometry separately (remaining SNEX-008).
- [ ] Resolve inherited provenance statements that conflict with filtering/clipping.
- [ ] Record source commit, parameters, source-product versions, and environment for
      newly generated release artifacts; preserve historical provenance honestly.
- [ ] Verify and hash the actual archives selected for distribution after writers stop.
      This documentation pass did not reread or rehash the large HDF5 files.
- [ ] Make manifest verification fail for missing expected files and handle extra
      files explicitly; stabilize object/string serialization before using deep
      dataset hashes. Existing per-file SHA-256 hashes remain byte-integrity checks.

## Reproducibility and interaction

- [ ] Create a fresh environment from `environment.yml` and run the offline suites.
      The current pass validates an existing environment, not installation from scratch.
- [ ] Repair or retire stale `ui_preview/check_workspace.js`; it refers to a function
      absent from the current explorer template.
- [ ] Add portable automated checks in the selected repository. Separate checks
      requiring generated viewer pages from tests using synthetic source fixtures.
- [ ] Audit colours, legends, and saved palette copies against one palette definition.
- [ ] Have the author review palette controls, persistence, overlays, layer switching,
      automatic detail, keyboard access, and small-screen behaviour in a browser.
- [ ] Verify the eventual hosted demo and downloads after a deployment is authorized.

## Prepare the exact publishable contents

- [ ] Prepare and review the exact public release checkout. The working folder
      now has Git initialized with the private repository as `origin`.
- [ ] Include core source, templates, public docs, tests, environment, and logo.
- [ ] Retain `ui_preview/logo_notes_addon.html` and `ui_preview/check_preview.js`:
      production rendering and refresh still depend on those paths.
- [ ] Retain `ui_preview/check_logo_notes_rollout.js` for the documented add-on rollout.
- [ ] Exclude local launch/status helpers, internal handoffs, historical notes,
      logs, caches, backups, credentials, and generated inventories from source history.
- [ ] Review optional older atlas and preview helpers; omit obsolete ones from the
      chosen source package without deleting the working copies.
- [ ] Treat the eight generated explorers (about 105 MiB combined) as deliberate
      demo/release artifacts; omit older alternate viewers from that bundle.
- [ ] Scan the selected contents for credentials, local paths, private notes,
      oversized files, and unintended embedded source metadata.
- [ ] Replace draft distribution/license statements with finalized information.
- [ ] Publish only after the author's explicit go-ahead, then verify the repository,
      release label, files, citations, and any demo links.

The `.gitignore` is a preparation aid, not a substitute for inspecting the exact
files committed. Keep the full-resolution archive on its designated data host;
it does not need to be uploaded into Git source history.
