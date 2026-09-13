# Data sources and attribution

The pipeline combines source products from NASA's NSIDC DAAC, ORNL DAAC, and
NASA/JPL UAVSAR distributed through ASF. Source collection names describe
upstream products; the aligned archive and sampled browser exports are derived
representations.

## Terrain, snow depth, and vegetation

| Source collection | Use in this project | Dataset reference |
| --- | --- | --- |
| `SNEX20_QSI_DEM_3m`, Version 1 | DEM at the six QSI sites | [NSIDC / DOI 10.5067/VV382L4MQI7V](https://nsidc.org/data/snex20_qsi_dem_3m/versions/1) |
| `SNEX20_QSI_SD_3m`, Version 1 | Snow depth at the six QSI sites | [NSIDC / DOI 10.5067/4VO7438DP332](https://nsidc.org/data/snex20_qsi_sd_3m/versions/1) |
| `SNEX20_QSI_VH_3m`, Version 1 | Vegetation height across the eight sites | [NSIDC / DOI 10.5067/K67GKZQ9WUEI](https://nsidc.org/data/snex20_qsi_vh_3m/versions/1) |
| `SNEX20_GM_Lidar`, Version 1 | Grand Mesa 2020 snow depth | [DOI 10.5067/M9TPF6NWL53K](https://doi.org/10.5067/M9TPF6NWL53K) |
| `ASO_3M_SD`, Version 1 | Grand Mesa 2017 snow depth | [NSIDC / DOI 10.5067/KIE9QNVG7HP0](https://nsidc.org/data/aso_3m_sd/versions/1) |
| `SNEX_HRSI_SD_DEM_CO`, Version 1 | Grand Mesa LiDAR-derived snow-off DTM, resampled from 1 m to 3 m | [NSIDC / DOI 10.5067/7QCNCHVQMCI8](https://nsidc.org/data/snex_hrsi_sd_dem_co/versions/1) |
| `LiDAR_Veg_Ht_Idaho_1532` | Reynolds Creek 2014 LiDAR DEM, resampled from 1 m | [ORNL / DOI 10.3334/ORNLDAAC/1532](https://daac.ornl.gov/VEGETATION/guides/LiDAR_Veg_Ht_Idaho.html) |

The six QSI sites are Banner Summit, Mores Creek, Fraser, Little Cottonwood
Canyon, Cameron Pass, and Dry Creek. The QSI documentation describes the
[DEM, snow-depth, and vegetation-height products together](https://nsidc.org/data/documentation/snowex20-21-qsi-lidar-3m-utm-grid-dem-snow-depth-and-vegetation-height-version-1-user-guide).

The selected `SNEX_HRSI_SD_DEM_CO_GM_DTM_1m_V01.0.tif` is the collection's
LiDAR-derived snow-off terrain reference. The [official user guide, Section 2.3](https://nsidc.org/sites/default/files/documents/user-guide/snex_hrsi_sd_dem_co-v001-userguide.pdf)
describes airborne LiDAR processed with PDAL for reference DTM/DSM products;
satellite stereo imagery supplies the separate snow-on DEMs. Only this Grand
Mesa DTM is represented in the current viewer; the collection's satellite
snow-depth time series has not been ingested.

## Radar

[NASA/JPL UAVSAR](https://uavsar.jpl.nasa.gov/) provides L-band radar products.
The builder searches ASF by footprint and retains source product identifiers
and annotations for the selected `INTERFEROMETRY_GRD`, `AMPLITUDE_GRD`, and
`DEM_TIFF` products. The enriched structure groups available products by date
pair and flight line. Not every group contains every polarization or product.

Use the actual source product identifiers, dates, and processing versions from
the archive when citing a radar subset. Consult [UAVSAR documentation](https://uavsar.jpl.nasa.gov/science/documents.html)
and [ASF Vertex](https://search.asf.alaska.edu/) for product information and access.

## Optional products in the builder

The source also contains ingestion paths for in-situ observations and Grand
Mesa reference SWE/density from `SNEX20_GM_SWE_SD`
([DOI 10.5067/LANQ53RTJ2DR](https://doi.org/10.5067/LANQ53RTJ2DR)).
The current eight explorer payloads contain no SWE, snow-density, or in-situ
layers. Code support is not evidence that a specific archive or export carries
a product. Inspect the selected file and its provenance before claiming use.

## Citing an analysis

Use the dataset authors and formatted citations provided by the linked data
centres. Record the collection version, source granules, site, dates, subset,
and access date actually used. Cite the project release separately once its
repository URL and citation metadata are finalized.

The source references above were checked during release preparation on
2026-09-08. Collection-level references do not constitute a frozen granule
manifest or redistribution clearance for a particular release bundle.
