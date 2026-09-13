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

`--deep` hashes every dataset's decompressed bytes. It is much slower -- it
decompresses the whole archive -- and is only worth it when you need to know
*which layer* changed, not merely that something did.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
from pathlib import Path

CHUNK = 8 << 20          # 8 MB; large enough that syscall overhead vanishes

C = {"red": "\033[31m", "yel": "\033[33m", "grn": "\033[32m",
     "dim": "\033[2m", "bold": "\033[1m", "off": "\033[0m"}
if os.name == "nt":
    os.system("")


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        while chunk := fh.read(CHUNK):
            h.update(chunk)
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
    import numpy as np

    out: dict[str, dict] = {}

    def visit(name, obj):
        if not isinstance(obj, h5py.Dataset):
            return
        a = obj.attrs
        rec = {
            "shape": list(obj.shape),
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
        if deep:
            h = hashlib.sha256()
            arr = obj[...]
            # NaN never equals itself, so a raw byte hash of float data is
            # stable only because the nodata pattern is stable too. That is
            # exactly what we want to detect a change in.
            h.update(np.ascontiguousarray(arr).tobytes())
            rec["sha256"] = h.hexdigest()
        out[name] = rec

    f.visititems(visit)
    return out


def build(paths: list[Path], deep: bool) -> dict:
    import h5py

    man = {"generated": time.strftime("%Y-%m-%dT%H:%M:%S"),
           "algorithm": "sha256", "deep": deep, "files": {}}
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
                ident = f["identification"].attrs
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
    return man


def verify(paths: list[Path], man: dict, deep: bool) -> int:
    import h5py

    bad = 0
    for p in paths:
        rec = man["files"].get(p.name)
        if rec is None:
            print(f"  {C['yel']}?{C['off']} {p.name}: not in manifest")
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
                diff = [k for k in sorted(set(now) | set(was))
                        if now.get(k) != was.get(k)]
                for k in diff[:10]:
                    print(f"      {C['dim']}differs:{C['off']} {k}")
                if len(diff) > 10:
                    print(f"      {C['dim']}... {len(diff) - 10} more{C['off']}")
                if not diff:
                    print(f"      {C['dim']}no dataset differs -- change is in "
                          f"file structure or attributes{C['off']}")
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
    if not paths:
        print(f"no files matching {args.pattern} in {args.out_dir}",
              file=sys.stderr)
        return 2

    if args.verify:
        if not mpath.exists():
            print(f"no manifest at {mpath}", file=sys.stderr)
            return 2
        man = json.loads(mpath.read_text(encoding="utf-8"))
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
    man = build(paths, args.deep)
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
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
