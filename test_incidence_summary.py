"""SNEX-008 summaries use finite incidence cells, without changing geometry.

Only synthetic temporary archives are written. Annotation retrieval and the
geometry calculation are patched so the summary receives controlled angles.
The actual geometry remains covered by test_scientific_methods.py.
"""

from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import h5py
import numpy as np

import enrich_hdf5 as E
from test_derivative_inputs import ANNOTATION, DEM, GEOMETRY, RADAR_SOURCE, SHAPE, identify


CASES = (
    ("mixed", [89.9, 90.0, 100.0, np.nan, np.inf, -np.inf], 2, 3, 2 / 3),
    ("all_below", [0.0, 45.0, 89.9], 0, 3, 0.0),
    ("all_at_or_above", [90.0, 100.0, 180.0], 3, 3, 1.0),
    ("no_finite_cells", [np.nan, np.inf, -np.inf], 0, 0, np.nan),
)


class TestIncidenceSummary(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        temp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(temp.cleanup)
        directory = Path(temp.name)
        cls.source = directory / "source.h5"
        with h5py.File(cls.source, "w") as h5:
            identify(h5)
            h5.create_dataset(DEM, data=np.full(SHAPE, 2000.0, dtype="float32"))
            h5.create_dataset(f"{RADAR_SOURCE}/HH/cor", data=np.ones(SHAPE, dtype="float32"))
            h5[RADAR_SOURCE].attrs["source_url"] = "https://fixture.invalid/product.zip"
        cls.original_bytes = cls.source.read_bytes()
        cls.results = {}

        for name, values, numerator, denominator, fraction in CASES:
            local = np.full(SHAPE, np.nan, dtype="float32")
            local.flat[:len(values)] = values
            flat = np.arange(np.prod(SHAPE), dtype="float32").reshape(SHAPE) / 100.0
            local_bytes, flat_bytes = local.tobytes(), flat.tobytes()
            output = directory / f"{name}.enriched.h5"
            with patch.object(E, "cached_annotation", return_value={}), \
                    patch.object(E, "annotation_scalars", return_value=ANNOTATION), \
                    patch.object(E, "local_incidence", return_value=(local, flat)) as incidence:
                result, _ = E.enrich(cls.source, output, directory / "cache", session=object())
            cls.results[name] = {
                "path": output,
                "local": local,
                "flat": flat,
                "original_local_bytes": local_bytes,
                "original_flat_bytes": flat_bytes,
                "result": result,
                "incidence_calls": incidence.call_count,
            }

    def test_fraction_uses_only_finite_cells_and_includes_exactly_90_degrees(self):
        for name, _, numerator, denominator, expected_fraction in CASES:
            with self.subTest(case=name), h5py.File(self.results[name]["path"], "r") as h5:
                attrs = h5[f"{GEOMETRY}/local_incidence_angle"].attrs
                self.assertIn("incidence_ge_90_fraction", attrs)
                self.assertEqual(attrs["incidence_ge_90_cell_count"], numerator)
                self.assertEqual(attrs["incidence_valid_cell_count"], denominator)
                if denominator:
                    self.assertAlmostEqual(attrs["incidence_ge_90_fraction"], expected_fraction)
                    self.assertEqual(attrs["incidence_ge_90_status"], "computed")
                else:
                    self.assertTrue(np.isnan(attrs["incidence_ge_90_fraction"]))
                    self.assertEqual(attrs["incidence_ge_90_status"], "no_valid_incidence")

    def test_new_metadata_does_not_claim_a_terrain_shadow_calculation(self):
        for name, *_ in CASES:
            with self.subTest(case=name), h5py.File(self.results[name]["path"], "r") as h5:
                attrs = h5[f"{GEOMETRY}/local_incidence_angle"].attrs
                self.assertNotIn("radar_shadow_fraction", attrs)
                self.assertNotIn("shadow_note", attrs)
                self.assertIn("incidence_ge_90_note", attrs)
                note = attrs["incidence_ge_90_note"].lower()
                self.assertIn("finite", note)
                self.assertIn("90", note)
                self.assertIn("terrain", note)

    def test_summary_leaves_source_and_both_geometry_arrays_unchanged(self):
        self.assertEqual(self.source.read_bytes(), self.original_bytes)
        for name, *_ in CASES:
            record = self.results[name]
            with self.subTest(case=name), h5py.File(record["path"], "r") as h5:
                self.assertEqual(record["result"], 0)
                self.assertEqual(record["incidence_calls"], 1)
                self.assertEqual(record["local"].tobytes(), record["original_local_bytes"])
                self.assertEqual(record["flat"].tobytes(), record["original_flat_bytes"])
                self.assertEqual(h5[f"{GEOMETRY}/local_incidence_angle"][...].tobytes(),
                                 record["original_local_bytes"])
                self.assertEqual(h5[f"{GEOMETRY}/incidence_angle_flat"][...].tobytes(),
                                 record["original_flat_bytes"])


if __name__ == "__main__":
    unittest.main()
