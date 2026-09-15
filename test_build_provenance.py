"""New-build lineage checks using tiny local files, never production archives."""
import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


class ProvenanceTests(unittest.TestCase):
    def helper(self):
        self.assertIsNotNone(importlib.util.find_spec('build_provenance'),
                             'new builds need a shared provenance helper')
        import build_provenance
        return build_provenance

    def test_sources_settings_and_inputs_have_distinct_fingerprints(self):
        p = self.helper()
        with tempfile.TemporaryDirectory() as directory:
            script = Path(directory) / 'producer.py'
            script.write_bytes(b'# first source\n')
            sources = p.capture_sources(script)
            first = p.new_record('test', sources, {'stride': 2}, inputs=[{'id': 'a'}])
            second = p.new_record('test', sources, {'stride': 3}, inputs=[{'id': 'a'}])
            third = p.new_record('test', sources, {'stride': 2}, inputs=[{'id': 'b'}])
            script.write_bytes(b'# second source\n')
            fourth = p.new_record('test', p.capture_sources(script), {'stride': 2}, inputs=[{'id': 'a'}])
            self.assertEqual(len({r['recipe_sha256'] for r in (first, second, third, fourth)}), 4)
            self.assertEqual(first['sources'][str(script.resolve())]['sha256'],
                             hashlib.sha256(b'# first source\n').hexdigest())
            self.assertIn('python', first['dependencies'])
            self.assertEqual(first['prior_lineage_status'], 'unknown_not_recorded')

    def test_parent_is_preserved_stat_identity_is_not_a_content_hash(self):
        p = self.helper()
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'input.h5'
            source.write_bytes(b'tiny synthetic archive')
            identity = p.file_identity(source)
            self.assertEqual(identity['identity_method'], 'filename_size_mtime_not_content_hash')
            self.assertNotIn('sha256', identity)
            parent = {'file': identity, 'lineage': p.read_lineage({})}
            record = p.new_record('test', p.capture_sources(__file__), {}, parent=parent)
            attrs = {}
            p.store_lineage(attrs, record)
            self.assertEqual(p.read_lineage(attrs)['parent'], parent)
            self.assertEqual(attrs['artifact_id'], record['artifact_id'])

    def test_modified_source_does_not_get_claimed_as_executed_source(self):
        p = self.helper()
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'producer.py'
            source.write_bytes(b'# executed\n')
            captured = p.capture_sources(source)
            source.write_bytes(b'# changed while running\n')
            record = p.new_record('test', captured, {})
            self.assertEqual(record['source_status'], 'changed_since_capture')
            self.assertEqual(record['sources'], captured)

    def test_helper_keeps_its_import_hash_if_edited_before_caller_captures(self):
        p = self.helper()
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'copied_provenance.py'
            raw = Path(p.__file__).read_bytes()
            source.write_bytes(raw)
            spec = importlib.util.spec_from_file_location('copied_provenance', source)
            copied = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(copied)
            source.write_bytes(raw + b'\n# edited after import\n')
            record = copied.new_record('test', copied.capture_sources(), {})
            self.assertEqual(record['sources'][str(source.resolve())]['sha256'], hashlib.sha256(raw).hexdigest())
            self.assertEqual(record['source_status'], 'changed_since_capture')

    def test_producers_use_already_loaded_companion_snapshots(self):
        import subprocess
        import sys
        names = ('build_provenance', 'processing_metadata', 'build_hdf5',
                 'make_index', 'explorer_addon', 'comparison_addon', 'refresh_explorers')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            originals = {}
            for name in names:
                raw = Path(__file__).with_name(name + '.py').read_bytes()
                originals[name] = raw
                (root / (name + '.py')).write_bytes(raw)
            for companion, producer, field in (
                    ('processing_metadata', 'build_hdf5', '_BUILD_SOURCES'),
                    ('make_index', 'refresh_explorers', '_RENDER_SOURCES'),
                    ('explorer_addon', 'refresh_explorers', '_RENDER_SOURCES'),
                    ('comparison_addon', 'refresh_explorers', '_RENDER_SOURCES')):
                with self.subTest(companion=companion):
                    for name, raw in originals.items():
                        (root / (name + '.py')).write_bytes(raw)
                    script = (
                        "import importlib,json; from pathlib import Path; "
                        f"c=importlib.import_module('{companion}'); p=Path(c.__file__); "
                        "p.write_bytes(p.read_bytes()+b'\\n# after module import\\n'); "
                        f"m=importlib.import_module('{producer}'); "
                        "from build_provenance import new_record; "
                        f"r=new_record('test', m.{field}, {{}}); "
                        "print(json.dumps({'sha256':r['sources'][str(p.resolve())]['sha256'],"
                        "'status':r['source_status']}))")
                    result = subprocess.run([sys.executable, '-B', '-c', script], cwd=root,
                                            check=True, capture_output=True, text=True,
                                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
                    result = json.loads(result.stdout)
                    self.assertEqual(result['sha256'], hashlib.sha256(originals[companion]).hexdigest())
                    self.assertEqual(result['status'], 'changed_since_capture')

    def test_native_dependency_versions_describe_loaded_runtime(self):
        import h5py
        import rasterio
        import pyproj
        p = self.helper()
        versions = p.new_record('test', p.capture_sources(__file__), {})['dependencies']
        self.assertEqual(versions.get('native_libraries'), {
            'hdf5': h5py.version.hdf5_version, 'gdal': rasterio.__gdal_version__,
            'proj': pyproj.proj_version_str})

    def test_renderer_records_implementation_without_changing_data_payload(self):
        from make_index import PAYLOAD
        from refresh_explorers import render_explorer
        from test_make_index import fixture
        raw = json.dumps(fixture(), indent=2)
        rendered = render_explorer(raw)
        self.assertEqual(PAYLOAD.search(rendered)[1], raw)
        marker = '<script id="render-provenance" type="application/json">'
        self.assertTrue(marker in rendered, "new rendering must identify its source files")
        record = json.loads(rendered.split(marker, 1)[1].split('</script>', 1)[0])
        self.assertEqual(record['stage'], 'explorer_render')
        names = {Path(name).name for name in record['sources']}
        self.assertTrue({'refresh_explorers.py', 'build_provenance.py', 'explorer_template.html',
                         'explorer_addon.py', 'comparison_addon.py', 'product_guide.js'} <= names)
        self.assertEqual(record['inputs'][0]['sha256'], hashlib.sha256(raw.encode('utf-8')).hexdigest())

    def test_builder_write_and_skip_have_separate_honest_lineage(self):
        import build_hdf5 as builder
        import h5py
        import numpy as np
        from test_build_hdf5 import _grid
        p = self.helper()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'tiny.h5'
            grid = _grid(4, 4)
            with h5py.File(path, 'w') as f:
                old = f.create_dataset('science/LIDAR/DEM/grids/historical', data=np.ones(grid.shape))
                old.attrs['content_key'] = 'old'
                builder.write_identification(f, builder.SITES['banner_summit'], grid)
                args = dict(description='test', resampling_method='bilinear',
                            source='synthetic', grid=grid,
                            extra={'source_filename': 'original.tif', 'source_url': 'fixture://original'})
                fresh = builder.write_array(old.parent, 'elevation', np.ones(grid.shape),
                                            content_key='new', **args)
                record = p.read_lineage(fresh.attrs)
                self.assertEqual(record.get('stage'), 'builder_array_write')
                self.assertEqual(record['parameters']['resampling_method'], 'bilinear')
                self.assertEqual(record['inputs'][0]['source_filename'], 'original.tif')
                first_id = fresh.attrs['artifact_id']
                builder.write_array(old.parent, 'elevation', np.full(grid.shape, 99),
                                    content_key='new', **args)
                self.assertEqual(fresh.attrs['artifact_id'], first_id)
                self.assertEqual(float(fresh[0, 0]), 1.0)
                builder.write_array(old.parent, 'historical', np.full(grid.shape, 99),
                                    content_key='old', **args)
                self.assertEqual(p.read_lineage(old.attrs)['status'], 'unknown_not_recorded')
                self.assertEqual(p.read_lineage(f['identification'].attrs)['parameters']['science_lineage'],
                                 'per_dataset; skipped historical arrays remain unknown')

    def test_export_and_manifest_expose_actual_parent_and_producer(self):
        import h5py
        import numpy as np
        from types import SimpleNamespace
        import manifest
        import make_explorer as explorer
        from make_index import PAYLOAD
        p = self.helper()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / 'tiny.h5'
            upstream = p.new_record('enrichment', p.capture_sources(__file__), {'canopy_window': 30})
            with h5py.File(path, 'w') as f:
                ident = f.create_group('identification')
                ident.attrs.update(common_grid_shape=(4, 4), common_grid_transform=(3, 0, 0, 0, -3, 12),
                                   common_grid_resolution_m=3, site_name='Tiny')
                p.store_lineage(ident.attrs, upstream)
                ds = f.create_dataset(explorer.DEM_PATH, data=np.full((4, 4), 100, dtype='float32'))
                p.store_lineage(ds.attrs, upstream)
            before = path.read_bytes()
            args = SimpleNamespace(terrain_stride=2, stride=4, viewer_dir=root / 'viewer',
                                   template=Path(explorer.__file__).with_name('explorer_template.html'))
            code, _ = explorer.build_site('tiny', path, args, ['tiny'])
            self.assertEqual(code, 0)
            self.assertEqual(path.read_bytes(), before)
            payload = json.loads(PAYLOAD.search((args.viewer_dir / 'tiny_explorer.html').read_text(encoding='utf-8'))[1])
            self.assertIn('build_provenance', payload)
            record = payload['build_provenance']
            self.assertEqual(record['stage'], 'explorer_data_export')
            self.assertEqual(record['parent']['lineage'], upstream)
            self.assertEqual(record['parameters']['terrain_stride'], 2)
            self.assertEqual(record['parameters']['data_stride'], 4)
            self.assertEqual(record['parent']['file']['identity_method'], 'filename_size_mtime_not_content_hash')
            emitted = manifest.build([path], False)['files'][path.name]
            self.assertEqual(emitted['build_provenance'], upstream)
            self.assertEqual(emitted['datasets'][explorer.DEM_PATH]['build_provenance'], upstream)

    def test_recleaning_and_match_table_record_own_stage(self):
        import build_hdf5 as builder
        import h5py
        from test_build_hdf5 import _grid, _build_sample_file, _match
        p = self.helper()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / 'tiny.h5'
            _build_sample_file(path, _grid(4, 4))
            with h5py.File(path, 'a') as f:
                matches = builder.write_matches(f, [_match()], overwrite=True)
                self.assertEqual(p.read_lineage(matches.attrs).get('stage'), 'builder_match_table')
                match_id = matches.attrs['artifact_id']
                original_id = p.read_lineage(f['identification'].attrs)['artifact_id']
            import manifest
            emitted = manifest.build([path], False)['files'][path.name]
            self.assertIn('group_build_provenance', emitted)
            self.assertEqual(emitted['group_build_provenance']['matches']['artifact_id'], match_id)
            self.assertEqual(emitted['datasets']['matches/gap_days']['provenance_artifact_id'], match_id)
            self.assertEqual(builder.run_clean(['tiny'], root, fill_gaps=False), 0)
            with h5py.File(path, 'r') as f:
                record = p.read_lineage(f['identification'].attrs)
                self.assertEqual(record['stage'], 'archive_recleaning')
                self.assertFalse(record['parameters']['fill_gaps'])
                self.assertEqual(record['parent']['lineage']['artifact_id'], original_id)
                dem = p.read_lineage(f['science/LIDAR/DEM/grids/elevation'].attrs)
                self.assertEqual(dem['stage'], 'archive_recleaning_array')
                self.assertEqual(dem['parent']['dataset_path'], '/science/LIDAR/DEM/grids/elevation')

    def test_verified_download_digest_survives_without_hashing_twice(self):
        import build_hdf5 as builder
        from unittest.mock import patch, MagicMock
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'input.zip').write_bytes(b'synthetic')
            digest = hashlib.md5(b'synthetic').hexdigest()
            product = {'filename': 'input.zip', 'url': 'fixture://archive', 'bytes_': 9,
                       'md5sum': digest, 'source_md5_observed': 'stale',
                       'md5_mismatch_accepted': 'from a previous input'}
            with patch.dict('sys.modules', {'asf_search': MagicMock()}):
                with patch.object(builder, 'file_md5', wraps=builder.file_md5) as hashing:
                    builder.download_uavsar(product, root, None)
            self.assertEqual(hashing.call_count, 1)
            self.assertEqual(product.get('source_checksum_status'), 'verified_md5')
            self.assertEqual(product['source_md5_verified'], digest)
            self.assertNotIn('source_md5_observed', product)
            self.assertNotIn('md5_mismatch_accepted', product)

    def test_crc_accepted_mismatch_keeps_observed_digest_without_claiming_catalog_match(self):
        import build_hdf5 as builder
        import io
        import zipfile
        from unittest.mock import patch, MagicMock
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, 'w') as archive:
            archive.writestr('tiny.txt', b'synthetic')
        raw = stream.getvalue()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            product = {'filename': 'input.zip', 'url': 'fixture://archive', 'bytes_': len(raw),
                       'md5sum': '0' * 32}
            fake_asf = MagicMock()
            fake_asf.download_url.side_effect = lambda **kw: (Path(kw['path']) / kw['filename']).write_bytes(raw)
            with patch.dict('sys.modules', {'asf_search': fake_asf}):
                builder.download_uavsar(product, root, None)
            self.assertEqual(product['source_md5_observed'], hashlib.md5(raw).hexdigest())
            self.assertEqual(product['source_checksum_status'], 'zip_crc_passed_catalog_md5_mismatch')
            self.assertNotIn('source_md5_verified', product)

    def test_point_table_binds_consumed_csv_bytes(self):
        import build_hdf5 as builder
        import h5py
        from types import SimpleNamespace
        from unittest.mock import patch
        p = self.helper()
        raw = b'Longitude[DD],Latitude[DD]\n1,3\n'
        response = SimpleNamespace(content=raw, raise_for_status=lambda: None)
        session = SimpleNamespace(get=lambda *args, **kwargs: response)
        grid = builder.CommonGrid('EPSG:4326', 4326, (1, 0, 0, 0, -1, 4), 4, 4, 1)
        spec = builder.PointSpec('synthetic', 'fixture_collection', 'input.csv')
        with tempfile.TemporaryDirectory() as directory:
            with h5py.File(Path(directory) / 'tiny.h5', 'w') as f:
                with patch.object(builder, '_search_cmr', return_value=[{}]), \
                     patch.object(builder, '_granule_filename', return_value='input.csv'), \
                     patch.object(builder, '_granule_url', return_value='fixture://input.csv'):
                    self.assertEqual(builder.ingest_points(f, builder.SITES['banner_summit'], spec, grid, session), 1)
                record = p.read_lineage(f['insitu/synthetic'].attrs)
                self.assertEqual(record.get('stage'), 'builder_point_table')
                self.assertEqual(record['inputs'][0]['sha256'], hashlib.sha256(raw).hexdigest())
                self.assertEqual(f['insitu/synthetic/grid_row'].attrs['provenance_artifact_id'], record['artifact_id'])

    def test_local_build_records_inventory_settings_and_lidar_file_identifiers(self):
        import build_hdf5 as builder
        import h5py
        from test_build_hdf5 import _make_synthetic_lidar, _synthetic_inventory, BS
        p = self.helper()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            local = root / 'lidar'
            local.mkdir()
            _make_synthetic_lidar(local)
            inventory = root / 'inventory.json'
            inventory.write_text(json.dumps(_synthetic_inventory()), encoding='utf-8')
            self.assertEqual(builder.run_build([BS], inventory, root / 'out',
                                               local_dir=local, skip_uavsar=True, max_uavsar=2), 0)
            with h5py.File(root / 'out' / (BS + '.h5'), 'r') as f:
                record = p.read_lineage(f['identification'].attrs)
                self.assertIn('builder_run_parameters_json', record['parameters']['metadata'])
                settings = json.loads(record['parameters']['metadata']['builder_run_parameters_json'])
                self.assertTrue(settings['skip_uavsar'])
                self.assertEqual(settings['max_uavsar'], 2)
                self.assertEqual(settings['inventory']['sha256'], hashlib.sha256(inventory.read_bytes()).hexdigest())
                dem = p.read_lineage(f['science/LIDAR/DEM/grids/elevation'].attrs)
                identity = json.loads(dem['inputs'][0]['source_file_identity_json'])
                self.assertEqual(identity['identity_method'], 'filename_size_mtime_not_content_hash')
                self.assertTrue((local / identity['filename']).is_file())

    def test_radar_input_record_preserves_verified_checksum_and_annotation_bytes(self):
        import build_hdf5 as builder
        import h5py
        import numpy as np
        import zipfile
        from unittest.mock import patch
        from test_build_hdf5 import _grid, _layout
        p = self.helper()
        raw = b'grd.set_rows = 4\ngrds test\n'
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / 'input.zip'
            with zipfile.ZipFile(archive, 'w') as z:
                z.writestr('source.ann', raw)
                z.writestr('example_L090HH_01.cor.grd', b'fixture')
            product = {'level': 'INTERFEROMETRY_GRD', 'scene_name': 'synthetic',
                       'file_id': 'fixture_id', 'url': 'fixture://input.zip',
                       'source_checksum_status': 'verified_md5', 'source_md5_verified': 'provided_verified_digest'}
            grid = _grid(4, 4)
            with h5py.File(root / 'tiny.h5', 'w') as f:
                with patch.object(builder, 'grd_layout', return_value=_layout(4, 4)), \
                     patch.object(builder, 'read_grd_from_zip', return_value=(np.ones(grid.shape), grid.affine)), \
                     patch.object(builder, 'reproject_array', return_value=np.ones(grid.shape, dtype='float32')):
                    self.assertEqual(builder.ingest_uavsar_archive(f, product, 'test', grid, archive), 1)
                record = p.read_lineage(f['science/UAVSAR/INTERFEROMETRY_GRD/test/HH/cor'].attrs)
                inputs = record['inputs'][0]
                self.assertEqual(inputs.get('source_annotation_sha256'), hashlib.sha256(raw).hexdigest())
                self.assertEqual(inputs['source_md5_verified'], 'provided_verified_digest')
                self.assertEqual(inputs['source_checksum_status'], 'verified_md5')


if __name__ == '__main__':
    unittest.main()
