"""Transfer verification and decompressed fingerprints; fixtures are temporary."""

import contextlib
import copy
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

import h5py
import numpy as np

import manifest


class ManifestFixtures(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def archive(self, name="one.h5"):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        with h5py.File(path, "w") as h5:
            h5.create_group("identification")
            h5.create_dataset("values", data=np.arange(12).reshape(3, 4))
        return path

    def quiet(self, func, *args):
        output = io.StringIO()
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            result = func(*args)
        return result, output.getvalue()


class ManifestTests(ManifestFixtures):
    def test_incomplete_deep_build_and_verification_fail(self):
        path = self.archive()
        with h5py.File(path, 'a') as h5:
            h5.create_dataset('references', data=[h5['values'].ref], dtype=h5py.ref_dtype)
        code, _ = self.quiet(manifest.main, ['--out-dir', str(self.root), '--deep'])
        self.assertNotEqual(code, 0)
        code, _ = self.quiet(manifest.main, ['--out-dir', str(self.root), '--deep', '--verify'])
        self.assertNotEqual(code, 0)
        legacy_error = json.loads((self.root / 'MANIFEST.json').read_text())
        legacy_error.pop('complete', None)
        self.assertGreater(self.quiet(manifest.verify, [path], legacy_error, True)[0], 0)

    def test_enum_meanings_are_part_of_the_fingerprint(self):
        path = self.root / 'enums.h5'
        with h5py.File(path, 'w') as h5:
            dtypes = [np.dtype('i1'), h5py.enum_dtype({'snow': 0, 'ground': 1}, basetype='i1'),
                      h5py.enum_dtype({'ground': 0, 'snow': 1}, basetype='i1')]
            hashes = [manifest._dataset_sha256(h5.create_dataset(str(i), data=[0, 1], dtype=d))
                      for i, d in enumerate(dtypes)]
            self.assertEqual(len(set(hashes)), 3)

    def test_large_prefix_indices_are_not_materialized_before_first_read(self):
        import tracemalloc
        class StopAtFirstRead(Exception):
            pass
        outer = self
        class Dataset:
            shape = (200000, 3)
            dtype = np.dtype('int64')
            def __getitem__(self, key):
                outer.assertLess(tracemalloc.get_traced_memory()[1], 1_000_000)
                raise StopAtFirstRead
        tracemalloc.start()
        try:
            with mock.patch.object(manifest, 'CHUNK', 16), self.assertRaises(StopAtFirstRead):
                manifest._dataset_sha256(Dataset())
        finally:
            tracemalloc.stop()

    def test_complete_file_set_and_changed_bytes(self):
        path = self.archive()
        man, _ = self.quiet(manifest.build, [path], False)
        self.assertEqual(self.quiet(manifest.verify, [path], man, False)[0], 0)
        with h5py.File(path, "r+") as h5:
            h5["values"][0, 0] = 100
        result, output = self.quiet(manifest.verify, [path], man, False)
        self.assertEqual(result, 1)
        self.assertIn("sha256 mismatch", output)
        with path.open("ab") as out:
            out.write(b"added bytes")
        result, output = self.quiet(manifest.verify, [path], man, False)
        self.assertEqual(result, 1)
        self.assertIn("manifest says", output)

    def test_missing_expected_files_fail_even_when_all_missing(self):
        paths = [self.archive(), self.archive("two.h5")]
        man, _ = self.quiet(manifest.build, paths, False)
        for supplied, missing in ((paths[:1], 1), ([], 2)):
            with self.subTest(supplied=supplied):
                result, output = self.quiet(manifest.verify, supplied, man, False)
                self.assertEqual(result, missing)
                self.assertIn("missing", output.lower())

    def test_extra_files_fail(self):
        path = self.archive()
        man, _ = self.quiet(manifest.build, [path], False)
        extra = self.archive("extra.h5")
        self.assertEqual(self.quiet(manifest.verify, [path, extra], man, False)[0], 1)

    def test_colliding_supplied_and_manifest_names_fail(self):
        path = self.archive()
        collision = self.archive("other/ONE.h5")
        man, _ = self.quiet(manifest.build, [path], False)
        for paths in ([path, path], [path, collision]):
            with self.subTest(paths=paths):
                self.assertGreater(self.quiet(manifest.verify, paths, man, False)[0], 0)
                with self.assertRaises(ValueError):
                    self.quiet(manifest.build, paths, False)
        man["files"]["ONE.h5"] = copy.deepcopy(man["files"]["one.h5"])
        result, output = self.quiet(manifest.verify, [path], man, False)
        self.assertGreater(result, 0)
        self.assertIn("collid", output.lower())

    def test_cli_all_missing_is_a_failed_verification(self):
        path = self.archive()
        man, _ = self.quiet(manifest.build, [path], False)
        (self.root / "MANIFEST.json").write_text(json.dumps(man), encoding="utf-8")
        path.unlink()
        result, output = self.quiet(manifest.main, ["--out-dir", str(self.root), "--verify"])
        self.assertEqual(result, 1)
        self.assertIn("one.h5", output)
        self.assertIn("missing", output.lower())

    def test_cli_rejects_duplicate_json_names(self):
        path = self.archive()
        rec = json.dumps({"bytes": path.stat().st_size,
                          "sha256": manifest.file_sha256(path)})
        (self.root / "MANIFEST.json").write_text(
            '{"files":{"one.h5":' + rec + ',"one.h5":' + rec + '}}', encoding="utf-8")
        result, output = self.quiet(manifest.main, ["--out-dir", str(self.root), "--verify"])
        self.assertNotEqual(result, 0)
        self.assertIn("duplicate", output.lower())

    def test_legacy_deep_hashes_are_not_compared_as_current_encoding(self):
        path = self.archive()
        man, _ = self.quiet(manifest.build, [path], True)
        man["files"][path.name]["sha256"] = "0" * 64
        rec = man["files"][path.name]["datasets"]["values"]
        rec.pop("hash_encoding", None)
        rec["sha256"] = "legacy raw array digest"
        result, output = self.quiet(manifest.verify, [path], man, True)
        self.assertEqual(result, 1)
        self.assertIn("not compared", output.lower())
        self.assertNotIn("differs:", output)


class FingerprintTests(ManifestFixtures):
    def fingerprint(self, datasets, chunk=None):
        path = self.root / "fingerprint.h5"
        with h5py.File(path, "w") as h5:
            for name, values, dtype in datasets:
                h5.create_dataset(name, data=values, dtype=dtype)
        with h5py.File(path, "r") as h5:
            if chunk is None:
                return manifest.dataset_fingerprint(h5, True)
            with mock.patch.object(manifest, "CHUNK", chunk):
                return manifest.dataset_fingerprint(h5, True)

    def test_text_hashes_are_repeatable_across_processes_and_changed_contents_differ(self):
        values = ["", "snow 雪", "é", "ab", "c"]
        dtype = h5py.string_dtype("utf-8")
        record = self.fingerprint([("text", values, dtype)])["text"]
        script = (
            "import h5py,json,manifest,sys; "
            "f=h5py.File(sys.argv[1],'r'); "
            "print(json.dumps(manifest.dataset_fingerprint(f,True))); f.close()"
        )
        records = []
        for _ in range(2):
            completed = subprocess.run(
                [sys.executable, "-B", "-c", script, str(self.root / "fingerprint.h5")],
                cwd=Path(manifest.__file__).parent, text=True, capture_output=True, check=True,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            records.append(json.loads(completed.stdout)["text"])
        self.assertEqual(records, [record, record])
        self.assertIn("hash_encoding", record)
        values[-2:] = ["a", "bc"]
        changed = self.fingerprint([("text", values, dtype)])["text"]
        self.assertNotEqual(record["sha256"], changed["sha256"])

    def test_v2_digest_matches_independently_framed_c_order_values(self):
        records = self.fingerprint([
            ("numbers", [[1, 2], [3, 4]], "<i2"),
            ("strings", ["ab", "c", ""], h5py.string_dtype("utf-8")),
        ], chunk=2)
        cases = (
            ("numbers", b'{"dtype":{"dtype":"<i2"},"encoding":"snowex-dataset-v2","shape":[2,2]}',
             bytes([1, 0, 2, 0, 3, 0, 4, 0])),
            ("strings", b'{"dtype":{"length":null,"string":"utf-8"},"encoding":"snowex-dataset-v2","shape":[3]}',
             b"T" + bytes(7) + b"\x02abT" + bytes(7) + b"\x01cT" + bytes(8)),
        )
        for name, header, data in cases:
            with self.subTest(name=name):
                expected = hashlib.sha256(len(header).to_bytes(8, "big") + header + data).hexdigest()
                self.assertEqual(records[name]["sha256"], expected)

    def test_hash_encodes_shape_numeric_type_and_text_vs_bytes(self):
        data = [1, 2, 3, 4]
        records = self.fingerprint([
            ("flat", data, "i4"), ("matrix", [[1, 2], [3, 4]], "i4"),
            ("unsigned", data, "u4"),
            ("text", ["", "ab", "c"], h5py.string_dtype("utf-8")),
            ("bytes", [b"", b"ab", b"c"], h5py.string_dtype("ascii")),
            ("split_bytes", [b"", b"a", b"bc"], h5py.string_dtype("ascii")),
        ])
        self.assertEqual(len({rec["sha256"] for rec in records.values()}), len(records))

    def test_chunk_boundaries_and_storage_layout_do_not_change_hash(self):
        records = [("values", np.arange(105, dtype="float32").reshape(3, 5, 7), "f4"),
                   ("text", ["", "abc", "雪", "last"], h5py.string_dtype("utf-8"))]
        tiny = self.fingerprint(records, chunk=12)
        large = self.fingerprint(records, chunk=1024)
        self.assertEqual(tiny, large)
        with h5py.File(self.root / "chunked.h5", "w") as h5:
            for name, values, dtype in records:
                h5.create_dataset(name, data=values, dtype=dtype, compression="gzip", chunks=True)
            self.assertEqual(manifest.dataset_fingerprint(h5, True), large)

    def test_deep_reads_are_bounded_slices(self):
        path = self.archive()
        read = h5py.Dataset.__getitem__
        selections = []

        def bounded(dataset, selection):
            self.assertIsNot(selection, Ellipsis, "deep hashing must not read a whole raster")
            values = read(dataset, selection)
            self.assertLessEqual(values.nbytes, 16)
            selections.append(selection)
            return values

        with h5py.File(path, "r") as h5, mock.patch.object(manifest, "CHUNK", 16):
            with mock.patch.object(h5py.Dataset, "__getitem__", bounded):
                manifest.dataset_fingerprint(h5, True)
        self.assertGreater(len(selections), 1)

    def test_numeric_nan_payloads_and_signed_zero_are_bit_preserving(self):
        bits = np.array([0x7FC00001, 0x7FC00002, 0, 0x80000000], dtype="u4")
        records = self.fingerprint([
            (f"value{index}", np.array([value], dtype="u4").view("f4"), "f4")
            for index, value in enumerate(bits)
        ])
        self.assertEqual(len({rec["sha256"] for rec in records.values()}), 4)

    def test_variable_numeric_values_include_element_lengths_and_scalar_shape(self):
        dtype = h5py.vlen_dtype(np.dtype("int32"))
        with h5py.File(self.root / "ragged.h5", "w") as h5:
            for name, parts in (("first", ([1, 2], [3])), ("split", ([1], [2, 3]))):
                dataset = h5.create_dataset(name, shape=(2,), dtype=dtype)
                for index, part in enumerate(parts):
                    dataset[index] = np.array(part, dtype="int32")
            scalar = h5.create_dataset("scalar", shape=(), dtype=dtype)
            scalar[()] = np.array([1, 2, 3], dtype="int32")
            records = manifest.dataset_fingerprint(h5, True)
            self.assertEqual(records, manifest.dataset_fingerprint(h5, True))
            self.assertEqual(len({rec["sha256"] for rec in records.values()}), 3)
            scalar[()] = np.array([1, 2, 4], dtype="int32")
            self.assertNotEqual(records["scalar"]["sha256"],
                                manifest.dataset_fingerprint(h5, True)["scalar"]["sha256"])

    def test_reference_values_fail_explicitly_instead_of_hashing_memory(self):
        with h5py.File(self.root / "reference.h5", "w") as h5:
            source = h5.create_dataset("source", data=[1])
            h5.create_dataset("references", data=[source.ref], dtype=h5py.ref_dtype)
            with self.assertRaisesRegex(TypeError, "unsupported"):
                manifest.dataset_fingerprint(h5, True)

    def test_empty_scalar_fixed_bytes_and_null_datasets(self):
        with h5py.File(self.root / "empty.h5", "w") as h5:
            h5.create_dataset("scalar", data="雪", dtype=h5py.string_dtype("utf-8"))
            h5.create_dataset("fixed_bytes", data=np.array([b"", b"\xff\x00a"], dtype="S4"))
            h5.create_dataset("empty", shape=(0, 2), dtype="f4")
            h5.create_dataset("null", dtype="f4")
            first = manifest.dataset_fingerprint(h5, True)
            second = manifest.dataset_fingerprint(h5, True)
        self.assertEqual(first, second)
        self.assertIsNone(first["null"]["shape"])
        self.assertEqual(len({rec["sha256"] for rec in first.values()}), 4)


if __name__ == "__main__":
    unittest.main()
