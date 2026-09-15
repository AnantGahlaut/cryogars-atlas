"""Offline checks of heading conversion against independent projection factors."""
import math
import unittest
import numpy as np
from pyproj import Proj, Transformer
import enrich_hdf5 as E


class ProjectedGeometryTests(unittest.TestCase):
    def test_off_meridian_track_uses_grid_bearing(self):
        # Projection-factor convergence is independent of the two-endpoint
        # tangent construction. These locations span the current site region.
        for lon, lat, epsg, heading in [(-108., 39., 32612, 78.),
                                       (-115., 44., 32611, 52.),
                                       (-106., 40., 32613, -100.)]:
            with self.subTest(lon=lon, heading=heading):
                px, py = Transformer.from_crs(4326, epsg, always_xy=True).transform(lon, lat)
                gamma = Proj(epsg).get_factors(lon, lat).meridian_convergence
                angle = math.radians(heading - gamma)
                direction = np.array([math.sin(angle), math.cos(angle)])
                # A ground point 10 km left and 30 km along the true grid track.
                centre = np.array([px, py]) + 30000 * direction + 10000 * np.array([-direction[1], direction[0]])
                transform = [3., 0., centre[0] - 7.5, 0., -3., centre[1] + 7.5]
                dem = np.full((5, 5), 2000.)
                local, flat = E.local_incidence(dem, transform, epsg, lat, lon, heading, 12000., 'Left')
                self.assertAlmostEqual(float(flat[2, 2]), 45., places=4)
                np.testing.assert_array_equal(local, flat)
                self.assertTrue(np.isfinite(flat).all())

    def test_projected_track_heading_matches_convergence(self):
        for lon, lat, epsg in [(-111., 39., 32612), (-108., 39., 32612),
                               (-115., 44., 32611)]:
            for heading in (0., 52., 90., 180., 270., -105., 359.):
                with self.subTest(lon=lon, heading=heading):
                    px, py, actual = E.projected_peg_track(lat, lon, heading, epsg)
                    gamma = Proj(epsg).get_factors(lon, lat).meridian_convergence
                    error = (actual - (heading - gamma) + 180.) % 360. - 180.
                    self.assertAlmostEqual(error, 0., places=6)
                    self.assertTrue(0. <= actual < 360.)
                    self.assertTrue(np.isfinite([px, py]).all())


if __name__ == '__main__':
    unittest.main()
