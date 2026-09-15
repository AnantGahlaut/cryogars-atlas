"""Forward unit metadata regressions on temporary rasters and archives only."""

from datetime import date
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import h5py
import numpy as np
import rasterio
from rasterio.transform import Affine

import build_hdf5 as B
import enrich_hdf5 as E


UNIT_DECLARATIONS = {
    "Amplitude Units": "Linear Amplitude",
    "Interferogram Units": "Linear Power and Phase in Radians",
    "Unwrapped Phase Units": "Radians",
    "Correlation Units": "Scalar Between 0 and 1",
    "DEM Units": "Meters",
}
RADAR_VALUES = {"amp1": 2.0, "amp2": 3.0, "int": 4.0 + 5.0j,
                "cor": 0.75, "unw": 1.5, "hgt": 2000.0}


class TestProductUnits(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.grid = B.derive_common_grid(
            "EPSG:6340", Affine(3, 0, 600000, 0, -3, 4900000),
            (600000, 4899988, 600012, 4900000))
        self.h5 = h5py.File(self.root / "units.h5", "w")
        self.addCleanup(self.h5.close)

    def lidar(self, kind):
        path = self.root / f"{kind}.tif"
        value = {"DEM": 2000.0, "SD": 1.25, "VH": 8.0}[kind]
        with rasterio.open(path, "w", driver="GTiff", count=1,
                           height=4, width=4, dtype="float32", crs="EPSG:6340",
                           transform=Affine(*self.grid.transform), nodata=-9999) as dst:
            dst.write(np.full(self.grid.shape, value, dtype="float32"), 1)
        return B.LidarGranule(
            site_key="banner_summit", product=kind,
            short_name=f"SNEX20_QSI_{kind}_3m", filename=path.name,
            url="fixture://" + path.name, date_begin=date(2020, 2, 18),
            date_end=date(2020, 2, 19), footprint_wkt="", native_res_m=3.0)

    def radar(self, declarations=None, overwrite=False):
        """Exercise both ingest paths; isolate geographic alignment from units."""
        declarations = UNIT_DECLARATIONS if declarations is None else declarations
        annotation = "\n".join(f"{key} (&) = {value}"
                               for key, value in declarations.items())
        for prefix in ("grd", "grd_phs"):
            annotation += "\n" + "\n".join(
                f"{prefix}.{key} = {value}" for key, value in {
                    "set_rows": 4, "set_cols": 4, "row_addr": 44,
                    "col_addr": -115, "row_mult": -0.001, "col_mult": 0.001,
                }.items())

        def read_block(_zip_path, member, layout, _grid):
            kind = B.parse_grd_member(member)[1]
            return np.full(self.grid.shape, RADAR_VALUES[kind],
                           dtype=layout.dtype), layout.transform

        datasets = {}
        for level, kinds in (("AMPLITUDE_GRD", ("amp1", "amp2")),
                             ("INTERFEROMETRY_GRD", ("int", "unw", "cor", "hgt"))):
            path = self.root / f"{level}.zip"
            with zipfile.ZipFile(path, "w") as zf:
                zf.writestr("source.ann", annotation)
                for kind in kinds:
                    zf.writestr(f"fixture_L090HH_01.{kind}.grd", b"fixture")
            product = dict(level=level, scene_name="fixture", file_id=level,
                           url="fixture://source", date_ref="20200218",
                           date_sec="20200219")
            with patch.object(B, "read_grd_from_zip", side_effect=read_block), \
                 patch.object(B, "reproject_array", side_effect=lambda a, *args: a):
                B.ingest_uavsar_archive(self.h5, product, "PAIR", self.grid,
                                       path, overwrite=overwrite)
            group = self.h5[B.uavsar_group_path(level, "PAIR")]["HH"]
            datasets.update({kind: group[kind] for kind in kinds})
        return datasets

    def test_lidar_new_and_overwrite_have_metres_without_invented_height_reference(self):
        for kind, quantity in (("DEM", "ground_surface_elevation"),
                               ("SD", "snow_depth"), ("VH", "vegetation_height")):
            with self.subTest(kind=kind):
                granule = self.lidar(kind)
                for overwrite in (False, True):
                    B.ingest_lidar_granule(self.h5, granule, self.grid,
                                          self.root, overwrite=overwrite)
                    group = B.lidar_group_path(kind, granule.date_key)
                    ds = self.h5[group][B.LIDAR_ARRAY_NAME[kind]]
                    self.assertEqual(ds.attrs.get("units"), "m")
                    self.assertEqual(ds.attrs.get("quantity"), quantity)
                    self.assertNotIn("vertical_datum", ds.attrs)
                    np.testing.assert_array_equal(ds[...],
                        {"DEM": 2000.0, "SD": 1.25, "VH": 8.0}[kind])

    def test_skipping_historical_lidar_does_not_backfill_or_relabel_old_values(self):
        granule = self.lidar("SD")
        B.ingest_lidar_granule(self.h5, granule, self.grid, self.root)
        ds = self.h5[B.lidar_group_path("SD", granule.date_key)]["snow_depth"]
        for key in ("units", "quantity"):
            if key in ds.attrs:
                del ds.attrs[key]
        old_attrs = dict(ds.attrs)
        with patch.object(B, "open_lidar_raster", side_effect=AssertionError("reread")):
            B.ingest_lidar_granule(self.h5, granule, self.grid, self.root)
        self.assertNotIn("units", ds.attrs)
        self.assertNotIn("quantity", ds.attrs)
        self.assertEqual(ds.attrs["artifact_id"], old_attrs["artifact_id"])

    def test_radar_units_distinguish_complex_components_and_survive_overwrite_and_copy(self):
        expected = {"amp1": ("radar_backscatter_amplitude", "linear amplitude"),
                    "amp2": ("radar_backscatter_amplitude", "linear amplitude"),
                    "int": ("complex_interferogram", "linear power"),
                    "unw": ("unwrapped_interferometric_phase", "rad"),
                    "cor": ("interferometric_coherence", "1"),
                    "hgt": ("projection_dem_elevation", "m")}
        for overwrite in (False, True):
            for kind, ds in self.radar(overwrite=overwrite).items():
                with self.subTest(kind=kind, overwrite=overwrite):
                    quantity, units = expected[kind]
                    self.assertEqual(ds.attrs.get("units"), units)
                    self.assertEqual(ds.attrs.get("quantity"), quantity)
                    self.assertEqual(ds.attrs.get("units_status"), "source_annotation")
                    np.testing.assert_array_equal(ds[...], RADAR_VALUES[kind])
                    if kind in ("amp1", "amp2", "int"):
                        self.assertEqual(ds.attrs.get("radiometric_reference"), "not_established")
                        self.assertIn("product-native", ds.attrs.get("units_note", ""))
                    if kind == "int":
                        self.assertEqual(ds.attrs.get("phase_units"), "rad")
                        self.assertEqual(ds.attrs.get("magnitude_units"), "linear power")
                    if kind == "hgt":
                        self.assertNotIn("elevation-change", ds.attrs["description"])
                        self.assertNotIn("vertical_datum", ds.attrs)
                    copied = E.write_grid(self.h5.require_group(f"copied_{overwrite}"),
                                          kind, ds[...], 4, {})
                    E.inherit_processing(copied, ds, {}, "fixture_copy")
                    for key in ("quantity", "units", "units_status", "source_units"):
                        self.assertEqual(copied.attrs[key], ds.attrs[key])

    def test_unrecognized_annotation_units_remain_unknown_without_conversion(self):
        declarations = dict(UNIT_DECLARATIONS)
        declarations.update({"Amplitude Units": "dB", "Unwrapped Phase Units": "Degrees",
                             "Interferogram Units": "provider custom units"})
        datasets = self.radar(declarations)
        for kind, raw in (("amp1", "dB"), ("amp2", "dB"),
                           ("unw", "Degrees"), ("int", "provider custom units")):
            with self.subTest(kind=kind):
                ds = datasets[kind]
                self.assertEqual(ds.attrs.get("units"), "unknown")
                self.assertEqual(ds.attrs.get("units_status"), "unrecognized_source_declaration")
                self.assertEqual(ds.attrs.get("source_units"), raw)
                np.testing.assert_array_equal(ds[...], RADAR_VALUES[kind])

    def test_missing_annotation_units_identify_documented_defaults_as_defaults(self):
        for kind, ds in self.radar({}).items():
            with self.subTest(kind=kind):
                self.assertEqual(ds.attrs.get("units_status"), "provider_documentation_default")
                self.assertTrue(ds.attrs.get("units"))
                self.assertEqual(ds.attrs.get("source_units"), "")

    def test_skipping_historical_radar_preserves_unrecorded_units(self):
        datasets = self.radar()
        for ds in datasets.values():
            del ds.attrs["units"]
            del ds.attrs["quantity"]
        old_ids = {kind: ds.attrs["artifact_id"] for kind, ds in datasets.items()}
        for kind, ds in self.radar().items():
            self.assertNotIn("units", ds.attrs)
            self.assertNotIn("quantity", ds.attrs)
            self.assertEqual(ds.attrs["artifact_id"], old_ids[kind])

    def test_dem_tiff_is_projection_elevation_in_metres(self):
        granule = self.lidar("DEM")
        product = dict(scene_name="fixture", file_id="DEM_TIFF", url="fixture://dem")
        B.ingest_uavsar_dem_tiff(self.h5, product, "PAIR", self.grid,
                                self.root / granule.filename)
        ds = self.h5[B.uavsar_group_path("DEM_TIFF", "PAIR")]["elevation"]
        self.assertEqual(ds.attrs.get("quantity"), "projection_dem_elevation")
        self.assertEqual(ds.attrs.get("units"), "m")
        self.assertEqual(ds.attrs.get("units_status"), "provider_documentation_default")
        self.assertNotIn("vertical_datum", ds.attrs)
        self.assertNotIn("onboard", ds.attrs["description"])
        self.assertNotIn("instrument and date", ds.attrs["description"])
        np.testing.assert_array_equal(ds[...], 2000.0)


if __name__ == "__main__":
    unittest.main()
