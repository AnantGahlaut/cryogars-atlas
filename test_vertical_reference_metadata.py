"""Reference descriptions are source-specific; none applies a height shift."""
import unittest
import enrich_hdf5 as E


class VerticalReferenceMetadataTests(unittest.TestCase):
    def test_qsi_version_one_reference(self):
        attrs = {'source_dataset': 'SNEX20_QSI_DEM_3m',
                 'source_url': 'https://data.nsidc.earthdatacloud.nasa.gov/SNEX20_QSI_DEM_3m/1/file.tif'}
        r = E.dem_vertical_reference(attrs)
        self.assertIn('NAVD88', r['dem_vertical_reference'])
        self.assertIn('GEOID12b', r['dem_vertical_reference'])
        attrs['source_url'] = attrs['source_url'].replace('/1/', '/2/')
        self.assertEqual(E.dem_vertical_reference(attrs)['dem_vertical_reference_status'], 'unresolved')

    def test_only_the_identified_grand_mesa_dtm_gets_the_authors_reference(self):
        attrs = {'source_dataset': 'SNEX_HRSI_SD_DEM_CO',
                 'source_filename': 'SNEX_HRSI_SD_DEM_CO_GM_DTM_1m_V01.0.tif'}
        self.assertEqual(E.dem_vertical_reference(attrs)['dem_vertical_reference'], 'WGS84 ellipsoidal height')
        attrs['source_filename'] = 'unverified_snow_on_dem.tif'
        self.assertEqual(E.dem_vertical_reference(attrs)['dem_vertical_reference_status'], 'unresolved')

    def test_horizontal_crs_does_not_establish_unknown_vertical_reference(self):
        for attrs in ({}, {'crs_epsg': 32612}, {'source_dataset': 'LiDAR_Veg_Ht_Idaho_1532',
                       'source_filename': 'RCEW_DEM_1m.tif'}):
            self.assertEqual(E.dem_vertical_reference(attrs)['dem_vertical_reference_status'], 'unresolved')


if __name__ == '__main__':
    unittest.main()
