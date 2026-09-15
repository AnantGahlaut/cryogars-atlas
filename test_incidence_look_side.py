"""SNEX-008: viewing-side eligibility for the existing peg-track model.

These isolated grids test geometry and masks, not geodetic accuracy or radar
coverage. The projected peg is fixed so the expected vectors are analytic.
"""

import math
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np

from enrich_hdf5 import local_incidence


class IncidenceLookSideTests(unittest.TestCase):
    transform = (3.0, 0.0, -7.5, 0.0, -3.0, 7.5)

    def calculate(self, direction, heading=0.0, dem=None, transform=None,
                  peg=(0.0, 0.0)):
        if dem is None:
            dem = np.full((5, 5), 2000.0)
        transformer = SimpleNamespace(
            from_crs=lambda *args, **kwargs: SimpleNamespace(
                transform=lambda *coords: peg))
        with patch("enrich_hdf5.projected_peg_track", return_value=(*peg, heading), create=True):
            return local_incidence(
                dem, self.transform if transform is None else transform,
                32612, 44.0, -115.0, heading, 12000.0, direction)

    def test_cardinal_headings_select_the_declared_side(self):
        east, north = np.meshgrid(np.arange(-6.0, 7.0, 3.0),
                                  np.arange(6.0, -7.0, -3.0))
        # Independent compass cases: northbound looks left toward west;
        # eastbound looks left toward north, and the reverse headings swap.
        cases = [(0.0, east < 0, east > 0, np.abs(east)),
                 (90.0, north > 0, north < 0, np.abs(north)),
                 (180.0, east > 0, east < 0, np.abs(east)),
                 (270.0, north < 0, north > 0, np.abs(north))]
        for heading, left, right, distance in cases:
            for direction, eligible in [("Left", left), ("Right", right)]:
                with self.subTest(heading=heading, direction=direction):
                    local, flat = self.calculate(direction, heading)
                    expected = np.degrees(np.arctan2(distance, 10000.0))
                    expected[~eligible] = np.nan
                    for output in (local, flat):
                        np.testing.assert_array_equal(
                            np.isfinite(output), eligible)
                        np.testing.assert_allclose(output, expected, atol=1e-6)
                        self.assertEqual(output.dtype, np.dtype("float32"))

    def test_direction_accepts_whitespace_and_case(self):
        for canonical, variants in [
                ("Left", ["left", " LEFT ", "\tLeFt\n"]),
                ("Right", ["right", " RIGHT ", "\tRiGhT\n"])]:
            expected = self.calculate(canonical)
            for variant in variants:
                with self.subTest(direction=variant):
                    actual = self.calculate(variant)
                    for output, reference in zip(actual, expected):
                        np.testing.assert_array_equal(output, reference)

    def test_invalid_direction_is_rejected(self):
        for direction in [None, "", " ", "Unknown", "L", "leftward", 1, True]:
            with self.subTest(direction=direction):
                with self.assertRaises(ValueError):
                    self.calculate(direction)

    def test_near_track_roundoff_is_excluded_from_both_sides(self):
        # The central column is 0.05 micrometres east of the track, within the
        # specified 1e-7 m numerical tolerance, not a physical swath buffer.
        transform = (3.0, 0.0, -7.5 + 5e-8, 0.0, -3.0, 7.5)
        for direction in ("Left", "Right"):
            with self.subTest(direction=direction):
                local, flat = self.calculate(direction, transform=transform)
                self.assertTrue(np.isnan(local[:, 2]).all())
                self.assertTrue(np.isnan(flat[:, 2]).all())
                self.assertEqual(int(np.isfinite(local).sum()), 10)
                np.testing.assert_array_equal(np.isfinite(local), np.isfinite(flat))

    def test_finite_cells_outside_the_tolerance_remain_eligible(self):
        transform = (3.0, 0.0, -7.5 + 2e-7, 0.0, -3.0, 7.5)
        local, flat = self.calculate("Right", transform=transform)
        self.assertTrue(np.isfinite(local[:, 2]).all())
        self.assertTrue(np.isfinite(flat[:, 2]).all())

    def test_sloped_surface_uses_the_original_ground_to_platform_vector(self):
        east, north = np.meshgrid(np.arange(-6.0, 7.0, 3.0),
                                  np.arange(6.0, -7.0, -3.0))
        dem = 2000.0 + 0.1 * east + 0.2 * north
        original = dem.copy()
        # The entire grid is west of a northbound track at x=30 metres.
        local, flat = self.calculate("Left", dem=dem, peg=(30.0, 0.0))
        normal = np.array([-0.1, -0.2, 1.0])
        normal /= np.linalg.norm(normal)
        ground_to_platform = np.array([30.0, 0.0, 10000.0])
        ground_to_platform /= np.linalg.norm(ground_to_platform)
        expected = math.degrees(math.acos(float(normal @ ground_to_platform)))
        self.assertAlmostEqual(float(local[2, 2]), expected, places=5)
        self.assertAlmostEqual(float(flat[2, 2]),
                               math.degrees(math.atan2(30.0, 10000.0)), places=6)
        self.assertTrue(np.isfinite(local).all())
        np.testing.assert_array_equal(dem, original)
        wrong_local, wrong_flat = self.calculate("Right", dem=dem, peg=(30.0, 0.0))
        self.assertTrue(np.isnan(wrong_local).all())
        self.assertTrue(np.isnan(wrong_flat).all())
        np.testing.assert_array_equal(dem, original)

    def test_missing_dem_centres_are_masked_in_both_outputs(self):
        dem = np.full((5, 5), 2000.0)
        dem[2, 0] = np.nan
        dem[3, 1] = np.inf
        original = dem.copy()
        local, flat = self.calculate("Left", dem=dem)
        eligible = np.zeros((5, 5), dtype=bool)
        eligible[:, :2] = True
        eligible[2, 0] = eligible[3, 1] = False
        np.testing.assert_array_equal(np.isfinite(local), eligible)
        np.testing.assert_array_equal(np.isfinite(flat), eligible)
        np.testing.assert_array_equal(dem, original)


if __name__ == "__main__":
    unittest.main()
