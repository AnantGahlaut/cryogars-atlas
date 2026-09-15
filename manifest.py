#!/usr/bin/env python3
"""
manifest.py -- checksum the built archives so a transfer can be proven intact.

`build_hdf5.py` already verifies every *download* against the checksum the DAAC
published (`verify_download`, with `zip_crc_ok` as the fallback for ASF's stale
md5s). That proves the right bytes arrived from NASA. It says nothing about the
files this pipeline then wrote, and those are what move to Borah.

This writes a manifest over the outputs:

  * SHA-256 and size for every `.h5`, so a copy can be proven byte-identical
  * a per-dataset fingerprint -- shape, dtype, valid-pixel count and value
    range -- so a mismatch can be *localised* to a layer instead of merely
    detected somewhere in 112 GB

    python manifest.py --out-dir C:/SnowEx/out               # write
    python manifest.py --out-dir C:/SnowEx/out --verify      # re-check
    python manifest.py --out-dir C:/SnowEx/out --deep        # + hash each dataset

Writes `MANIFEST.json` and `MANIFEST.sha256`. The latter is the standard format
`sha256sum -c` understands, so verification on the cluster needs no Python:

    sha256sum -c MANIFEST.sha256

`--deep` hashes every dataset's decompressed values. It is much slower -- it
decompresses the whole archive -- and is only worth it when you need to know
*which layer* changed, not merely that something did.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
import time
from pathlib import Path
from build_provenance import read_lineage

CHUNK = 8 << 20          # 8 MB; large enough that syscall overhead vanishes
DEEP_HASH_ENCODING = "snowex-dataset-v2"

C = {"red": "\033[31m", "yel": "\033[33m", "grn": "\033[32m",
     "dim": "\033[2m", "bold": "\033[1m", "off": "\033[0m"}
if os.name == "nt" and sys.stdout.isatty():
    os.system("")


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        while chunk := fh.read(CHUNK):
            h.update(chunk)
    return h.hexdigest()


def _check_names(names, source):
    """A basename manifest must remain unambiguous on Windows and Linux."""
    seen = {}
    for name in names:
        key = name.casefold()
        if key in seen:
            raise ValueError(f"{source}: duplicate/colliding names "
                             f"{seen[key]!r} and {name!r}")
        seen[key] = name


def _unique_json_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key {key!r}")
        result[key] = value
    return result


def _dataset_sha256(obj):
    """Hash v2: framed JSON type/shape header, then values in C order.

    Numeric bytes retain the declared dtype/endian, NaN payload/sign bits and
    signed zeros; this is bit identity, not approximate numeric equality.
    UTF-8 strings are text; ASCII/fixed byte strings are bytes. Each string is
    tagged and prefixed with its byte length (unsigned 64-bit big endian).
    Fixed strings retain all declared bytes, including NUL padding. Compound
    and reference dtypes are rejected instead of hashing object pointers.

    Fixed-width slices use at most CHUNK bytes (or one element if larger).
    Variable-length values are read individually: h5py must materialize one
    value, so peak memory also depends on the largest single string/array.
    HDF5 storage chunks/compression and our slice boundaries are not hashed.
    """
    import h5py
    import numpy as np

    def type_info(dtype):
        enum = h5py.check_enum_dtype(dtype)
        if enum is not None:
            return {"dtype": dtype.str, "enum": sorted((name, int(value)) for name, value in enum.items())}
        string = h5py.check_string_dtype(dtype)
        if string:
            return {"string": string.encoding, "length": string.length}
        variable = h5py.check_vlen_dtype(dtype)
        if variable is not None:
            return {"vlen": type_info(np.dtype(variable))}
        if dtype.hasobject or dtype.fields or dtype.subdtype:
            raise TypeError(f"unsupported deep fingerprint dtype: {dtype}")
        return {"dtype": dtype.str}

    def frame(payload):
        h.update(len(payload).to_bytes(8, "big"))
        h.update(payload)

    def values(array, dtype):
        string = h5py.check_string_dtype(dtype)
        if string:
            for value in np.asarray(array).flat:
                if string.length is not None:
                    payload = np.asarray(value, dtype=dtype).tobytes()
                elif string.encoding == "utf-8":
                    # h5py normally returns bytes even for UTF-8 text.
                    text = value if isinstance(value, str) else value.decode("utf-8")
                    payload = text.encode("utf-8")
                else:
                    payload = bytes(value)
                h.update(b"T" if string.encoding == "utf-8" else b"B")
                frame(payload)
        else:
            variable = h5py.check_vlen_dtype(dtype)
            if variable is not None:
                for value in np.asarray(array, dtype=object).flat:
                    item = np.asarray(value, dtype=variable)
                    frame(json.dumps(list(item.shape), separators=(",", ":")).encode("ascii"))
                    values(item, np.dtype(variable))
            else:
                h.update(np.ascontiguousarray(array, dtype=dtype).tobytes())

    h = hashlib.sha256()
    header = {"encoding": DEEP_HASH_ENCODING, "dtype": type_info(obj.dtype),
              "shape": obj.shape}
    frame(json.dumps(header, sort_keys=True, separators=(",", ":")).encode("utf-8"))
    if obj.shape is None or 0 in obj.shape:
        return h.hexdigest()
    if not obj.shape:
        values(obj[()], obj.dtype)
        return h.hexdigest()

    max_items = 1 if obj.dtype.hasobject else max(1, CHUNK // obj.dtype.itemsize)
    axis, trailing = len(obj.shape) - 1, 1
    while axis > 0 and trailing * obj.shape[axis] <= max_items:
        trailing *= obj.shape[axis]
        axis -= 1
    step = max(1, max_items // trailing)
    # NumPy 2.4 ndindex also uses itertools.product, which caches range pools.
    # Convert one flat prefix index at a time instead of allocating those pools.
    for flat_prefix in range(math.prod(obj.shape[:axis])):
        prefix = np.unravel_index(flat_prefix, obj.shape[:axis]) if axis else ()
        for start in range(0, obj.shape[axis], step):
            selection = prefix + (slice(start, min(start + step, obj.shape[axis])),)
            selection += (slice(None),) * (len(obj.shape) - axis - 1)
            values(obj[selection], obj.dtype)
    return h.hexdigest()


def dataset_fingerprint(f, deep: bool) -> dict:
    """Per-dataset identity, cheap by default.

    The cheap form reads only attributes, which `write_grid` already populated
    with valid-pixel count and value range. That is enough to localise a
    corrupted layer without decompressing 112 GB. `deep` additionally hashes
    the decompressed values, which catches corruption that preserves the
    summary statistics -- rare, but the only thing that proves equality.
    """
    import h5py

    out: dict[str, dict] = {}

    def visit(name, obj):
        if not isinstance(obj, h5py.Dataset):
            return
        a = obj.attrs
        rec = {
            "shape": list(obj.shape) if obj.shape is not None else None,
            "dtype": str(obj.dtype),
            "valid": int(a["valid_pixel_count"]) if "valid_pixel_count" in a
            else None,
        }
        for k in ("value_min", "value_max"):
            if k in a:
                try:
                    rec[k] = round(float(a[k]), 6)
                except (TypeError, ValueError):
                    pass
        rec["build_provenance"] = read_lineage(a)
        if 'provenance_artifact_id' in a:
            rec['provenance_artifact_id'] = str(a['provenance_artifact_id'])
        if deep:
            rec["sha256"] = _dataset_sha256(obj)
            rec["hash_encoding"] = DEEP_HASH_ENCODING
        out[name] = rec

    f.visititems(visit)
    return out


def build(paths: list[Path], deep: bool) -> dict:
    import h5py

    _check_names((p.name for p in paths), "supplied files")
    man = {"generated": time.strftime("%Y-%m-%dT%H:%M:%S"),
           "algorithm": "sha256", "deep": deep, "files": {}}
    if deep:
        man["dataset_hash_encoding"] = DEEP_HASH_ENCODING
    for p in paths:
        t0 = time.time()
        size = p.stat().st_size
        digest = file_sha256(p)
        rec = {"bytes": size, "sha256": digest,
               "modified": time.strftime("%Y-%m-%dT%H:%M:%S",
                                         time.localtime(p.stat().st_mtime))}
        try:
            with h5py.File(p, "r") as f:
                rec["datasets"] = dataset_fingerprint(f, deep)
                rec['group_build_provenance'] = {}
                def group_lineage(name, obj):
                    if isinstance(obj, h5py.Group) and name != 'identification' and 'build_provenance_json' in obj.attrs:
                        rec['group_build_provenance'][name] = read_lineage(obj.attrs)
                f.visititems(group_lineage)
                ident = f["identification"].attrs
                rec['build_provenance'] = read_lineage(ident)
                if 'artifact_id' in ident:
                    rec['artifact_id'] = str(ident['artifact_id'])
                for k in ("common_grid_shape", "common_crs_epsg",
                          "enrichment_version"):
                    if k in ident:
                        v = ident[k]
                        rec[k] = (v.tolist() if hasattr(v, "tolist")
                                  else (v.decode() if isinstance(v, bytes)
                                        else str(v)))
        except Exception as exc:                                # noqa: BLE001
            rec["error"] = str(exc)
        man["files"][p.name] = rec
        dt = time.time() - t0
        print(f"  {p.name:<34} {size / 2 ** 30:>7.2f} GB  "
              f"{len(rec.get('datasets', {})):>4} datasets  "
              f"{dt:>5.1f}s  {digest[:16]}...")
    man['complete'] = not any('error' in rec for rec in man['files'].values())
    return man


def verify(paths: list[Path], man: dict, deep: bool) -> int:
    import h5py

    try:
        _check_names(man["files"], "manifest")
        _check_names((p.name for p in paths), "supplied files")
    except ValueError as exc:
        print(f"  {C['red']}x{C['off']} {exc}")
        return 1
    bad = 0
    if man.get('complete') is False:
        print(f"  {C['red']}x{C['off']} manifest generation was incomplete")
        bad += 1
    actual = {p.name for p in paths if p.is_file()}
    expected = set(man["files"])
    for name in sorted(expected - actual):
        print(f"  {C['red']}x{C['off']} {name}: missing expected file")
        bad += 1
    for name in sorted(actual - expected):
        print(f"  {C['red']}x{C['off']} {name}: not in manifest")
        bad += 1
    for p in paths:
        if p.name not in actual & expected:
            continue
        rec = man["files"][p.name]
        if "error" in rec:
            print(f"  {C['red']}x{C['off']} {p.name}: incomplete manifest record: {rec['error']}")
            bad += 1
            continue
        size = p.stat().st_size
        if size != rec["bytes"]:
            print(f"  {C['red']}x{C['off']} {p.name}: {size:,} bytes, "
                  f"manifest says {rec['bytes']:,}")
            bad += 1
            continue
        got = file_sha256(p)
        if got != rec["sha256"]:
            print(f"  {C['red']}x{C['off']} {p.name}: sha256 mismatch")
            print(f"      manifest {rec['sha256']}")
            print(f"      actual   {got}")
            bad += 1
            # localise it
            try:
                with h5py.File(p, "r") as f:
                    now = dataset_fingerprint(f, deep)
                was = rec.get("datasets", {})
                diff = []
                skipped_hashes = False
                for k in sorted(set(now) | set(was)):
                    current, previous = now.get(k), was.get(k)
                    if current is not None and previous is not None:
                        current, previous = dict(current), dict(previous)
                        comparable = (current.get("hash_encoding") == DEEP_HASH_ENCODING
                                      and previous.get("hash_encoding") == DEEP_HASH_ENCODING
                                      and "sha256" in current and "sha256" in previous)
                        if not comparable:
                            skipped_hashes |= "sha256" in current or "sha256" in previous
                            for item in (current, previous):
                                item.pop("sha256", None)
                                item.pop("hash_encoding", None)
                    if current != previous:
                        diff.append(k)
                if skipped_hashes:
                    print("      deep value hashes not compared where absent or "
                          "legacy/different encoding; comparable metadata checked")
                for k in diff[:10]:
                    print(f"      {C['dim']}differs:{C['off']} {k}")
                if len(diff) > 10:
                    print(f"      {C['dim']}... {len(diff) - 10} more{C['off']}")
                if not diff:
                    print(f"      {C['dim']}no difference in compared dataset "
                          f"fingerprints{C['off']}")
            except Exception as exc:                            # noqa: BLE001
                print(f"      could not localise: {exc}")
            continue
        print(f"  {C['grn']}ok{C['off']} {p.name}")
    return bad


def main(argv=None) -> int:
    here = Path(__file__).resolve().parent
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out-dir", type=Path,
                    default=Path(os.environ.get("SNOWEX_OUT_DIR", here / "out")))
    ap.add_argument("--manifest", type=Path, default=None,
                    help="default: <out-dir>/MANIFEST.json")
    ap.add_argument("--verify", action="store_true")
    ap.add_argument("--deep", action="store_true",
                    help="also hash every dataset's decompressed values")
    ap.add_argument("--pattern", default="*.h5",
                    help="which files to cover (default: every .h5)")
    args = ap.parse_args(argv)

    mpath = args.manifest or (args.out_dir / "MANIFEST.json")
    paths = sorted(p for p in args.out_dir.glob(args.pattern) if p.is_file())
    if not paths and not args.verify:
        print(f"no files matching {args.pattern} in {args.out_dir}",
              file=sys.stderr)
        return 2

    if args.verify:
        if not mpath.exists():
            print(f"no manifest at {mpath}", file=sys.stderr)
            return 2
        try:
            man = json.loads(mpath.read_text(encoding="utf-8"),
                             object_pairs_hook=_unique_json_object)
        except ValueError as exc:
            print(f"invalid manifest: {exc}", file=sys.stderr)
            return 2
        print(f"{C['bold']}verifying {len(paths)} file(s) against "
              f"{mpath.name}{C['off']}  "
              f"{C['dim']}(written {man.get('generated')}){C['off']}")
        bad = verify(paths, man, args.deep and man.get("deep", False))
        print()
        if bad:
            print(f"{C['red']}{bad} file(s) do not match{C['off']}")
            return 1
        print(f"{C['grn']}all files match the manifest{C['off']}")
        return 0

    print(f"{C['bold']}hashing {len(paths)} file(s)"
          f"{' (deep)' if args.deep else ''}{C['off']}")
    try:
        man = build(paths, args.deep)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    mpath.write_text(json.dumps(man, indent=1), encoding="utf-8")

    # Companion in the format `sha256sum -c` reads, so the cluster side needs
    # no Python at all.
    sums = args.out_dir / "MANIFEST.sha256"
    sums.write_text(
        "".join(f"{r['sha256']}  {n}\n"
                for n, r in sorted(man["files"].items()) if "sha256" in r),
        encoding="utf-8")

    total = sum(r["bytes"] for r in man["files"].values())
    nds = sum(len(r.get("datasets", {})) for r in man["files"].values())
    print(f"\n{C['bold']}{len(man['files'])} files  {total / 2 ** 30:.2f} GB  "
          f"{nds:,} datasets{C['off']}")
    print(f"  -> {mpath}")
    print(f"  -> {sums}   ({C['dim']}sha256sum -c MANIFEST.sha256{C['off']})")
    if not man['complete']:
        print('Manifest generation incomplete; inspect per-file errors.', file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
