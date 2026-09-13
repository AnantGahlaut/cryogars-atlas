#!/usr/bin/env python3
"""
audit_archive.py -- independent end-to-end audit of the finished archive.

Deliberately does NOT import the grid-derivation code from build_hdf5.py. The
builder and `--mode verify` share that code by design, so they agree with each
other by construction; this reads the files cold and re-derives everything from
what is actually stored, then checks it against the preflight inventory and the
site areas published in the project README.

    python audit_archive.py
    python audit_archive.py --out-dir C:\\SnowEx\\out --json report.json

Exit code is 0 only if every check passes.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")

#: Surveyed area per site in km^2, measured independently and recorded in the
#: project README. The archive is expected to reproduce these from its own
#: valid-pixel counts; agreement is the strongest correctness signal available,
#: because the two numbers are produced by completely different routes.
README_AREA_KM2 = {
    "banner_summit": 167.1, "grand_mesa": 136.4, "reynolds_creek": 81.5,
    "dry_creek": 37.8, "fraser": 35.8, "mores_creek": 34.7,
    "little_cottonwood": 28.1, "cameron_pass": 21.9,
}

#: Attributes every science array must carry for the archive to stand alone.
REQUIRED_ARRAY_ATTRS = (
    "description", "crs_wkt", "transform", "shape", "nodata", "dtype",
    "resolution_m", "resampling_method", "source_dataset",
)
REQUIRED_IDENT_ATTRS = (
    "site_name", "common_crs_wkt", "common_crs_epsg", "common_grid_transform",
    "common_grid_shape", "uavsar_native_resolution_m", "resampling_note",
    "product_version", "created_date", "citation_note",
)

#: Physically implausible values are present in NASA's published lidar and are
#: preserved deliberately. They are reported, never treated as failures.
PLAUSIBLE = {
    "snow_depth": (-15.0, 20.0),
    "veg_height": (-1.0, 100.0),
    "elevation": (-500.0, 9000.0),
    "cor": (0.0, 1.0),
}


class Audit:
    def __init__(self) -> None:
        self.fail: list[str] = []
        self.warn: list[str] = []
        self.note: list[str] = []

    def check(self, ok: bool, msg: str) -> bool:
        if not ok:
            self.fail.append(msg)
        return ok

    def caution(self, ok: bool, msg: str) -> None:
        if not ok:
            self.warn.append(msg)


def audit_site(path: Path, a: Audit, inventory: dict | None) -> dict:
    import h5py
    import numpy as np

    key = path.stem
    out: dict = {"site": key}
    try:
        handle = h5py.File(path, "r")
    except OSError as exc:
        # A build writing this file holds an exclusive lock. That is not a
        # defect in the archive, but the audit cannot speak for a file it
        # could not read, so it must fail loudly rather than pass silently.
        a.fail.append(f"{key}: could not be opened for audit ({exc.__class__.__name__}). "
                      "A build may still be writing it; re-run when it finishes.")
        out["unreadable"] = True
        return out
    with handle as f:
        # ---- identification ----------------------------------------------
        if "identification" not in f:
            a.fail.append(f"{key}: no identification group")
            return out
        ident = f["identification"].attrs
        for k in REQUIRED_IDENT_ATTRS:
            a.check(k in ident, f"{key}: identification missing {k!r}")

        shape = tuple(int(v) for v in ident["common_grid_shape"])
        transform = tuple(float(v) for v in ident["common_grid_transform"])
        res = float(ident["common_grid_resolution_m"])
        epsg = int(ident["common_crs_epsg"])
        out.update(shape=shape, epsg=epsg, res=res,
                   name=str(ident["site_name"]))

        a.check(res == 3.0, f"{key}: resolution is {res} m, expected 3.0")
        a.check(epsg > 0, f"{key}: no EPSG recorded (common_crs_epsg={epsg})")
        # Pixel size in the transform must agree with the declared resolution.
        a.check(abs(abs(transform[0]) - res) < 1e-6,
                f"{key}: transform pixel width {transform[0]} != {res}")
        a.check(abs(abs(transform[4]) - res) < 1e-6,
                f"{key}: transform pixel height {transform[4]} != {res}")
        a.check(transform[4] < 0, f"{key}: transform is not north-up")

        # ---- every array on the common grid ------------------------------
        arrays: list[str] = []
        stats: dict[str, dict] = {}

        def visit(name, obj):
            if not isinstance(obj, h5py.Dataset):
                return
            arrays.append(name)
            if obj.shape != shape:
                a.fail.append(f"{key}: {name} shape {obj.shape} != grid {shape}")
            for k in REQUIRED_ARRAY_ATTRS:
                if k not in obj.attrs:
                    a.fail.append(f"{key}: {name} missing attribute {k!r}")
            if "transform" in obj.attrs:
                got = tuple(float(v) for v in obj.attrs["transform"])
                if not all(abs(x - y) < 1e-6 for x, y in zip(got, transform)):
                    a.fail.append(f"{key}: {name} transform differs from grid")
            if "crs_wkt" in obj.attrs and \
               str(obj.attrs["crs_wkt"]) != str(ident["common_crs_wkt"]):
                a.fail.append(f"{key}: {name} CRS differs from grid")

            data = obj[...]
            if np.iscomplexobj(data):
                finite = np.isfinite(data.real) & np.isfinite(data.imag)
            else:
                finite = np.isfinite(data)
            n = int(finite.sum())
            if n == 0:
                a.fail.append(f"{key}: {name} is entirely nodata")
                return
            vals = data[finite]
            if not np.iscomplexobj(data):
                stats[name] = {"valid": n,
                               "frac": n / data.size,
                               "min": float(vals.min()),
                               "max": float(vals.max()),
                               "median": float(np.median(vals))}
                leaf = name.rsplit("/", 1)[-1]
                lim = PLAUSIBLE.get(leaf)
                if lim and (vals.min() < lim[0] or vals.max() > lim[1]):
                    a.note.append(
                        f"{key}: {name} spans {vals.min():.2f}..{vals.max():.2f}, "
                        f"outside the plausible {lim[0]}..{lim[1]} "
                        "(present in the source, preserved deliberately)")
            else:
                mag = np.abs(vals)
                stats[name] = {"valid": n, "frac": n / data.size,
                               "min": float(mag.min()), "max": float(mag.max()),
                               "median": float(np.median(mag))}

        f["science"].visititems(visit)
        out["arrays"] = len(arrays)
        a.check(len(arrays) > 0, f"{key}: no science arrays")

        # ---- hollow acquisition groups -----------------------------------
        hollow = []
        uav = f.get("science/UAVSAR")
        if uav is not None:
            for level in uav:
                for name in uav[level]:
                    node = uav[level][name]
                    cnt = [0]
                    node.visititems(lambda _n, o: cnt.__setitem__(0, cnt[0] + 1)
                                    if isinstance(o, h5py.Dataset) else None)
                    if cnt[0] == 0:
                        hollow.append(f"{level}/{name}")
            out["uavsar_groups"] = sum(len(uav[l]) for l in uav)
        else:
            out["uavsar_groups"] = 0
        out["hollow"] = hollow
        for h in hollow:
            a.fail.append(f"{key}: {h} contains no arrays")

        # ---- area reconstruction ----------------------------------------
        target = README_AREA_KM2.get(key)
        if target:
            best, best_name = None, None
            for name, st in stats.items():
                if not name.startswith("LIDAR"):
                    continue
                km2 = st["valid"] * res * res / 1e6
                if best is None or abs(km2 - target) < abs(best - target):
                    best, best_name = km2, name
            if best is not None:
                err = 100 * (best - target) / target
                out.update(area_km2=best, area_ref=target, area_err_pct=err,
                           area_layer=best_name)
                a.check(abs(err) < 1.0,
                        f"{key}: best-matching area {best:.1f} km2 differs from "
                        f"README {target:.1f} km2 by {err:+.2f}%")

        # ---- match table -------------------------------------------------
        if "matches" in f:
            lens = {k: f["matches"][k].shape[0] for k in f["matches"]}
            a.check(len(set(lens.values())) <= 1,
                    f"{key}: matches columns unequal: {lens}")
            out["match_rows"] = max(lens.values()) if lens else 0
        else:
            a.warn.append(f"{key}: no matches table")

        # ---- inventory agreement ----------------------------------------
        if inventory and key in inventory.get("sites", {}):
            entry = inventory["sites"][key]
            expected_lidar = len(entry["lidar"])
            got_lidar = sum(1 for n in arrays if n.startswith("LIDAR"))
            a.check(got_lidar == expected_lidar,
                    f"{key}: {got_lidar} lidar arrays, inventory expects "
                    f"{expected_lidar}")
            out["lidar_arrays"] = got_lidar
            out["lidar_expected"] = expected_lidar
            out["uavsar_expected"] = len(entry["uavsar_needed"])
    out["stats"] = stats
    return out


def main(argv=None) -> int:
    here = Path(__file__).resolve().parent
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out-dir", type=Path,
                    default=Path(os.environ.get("SNOWEX_OUT_DIR", here / "out")))
    ap.add_argument("--inventory", type=Path, default=here / "inventory.json")
    ap.add_argument("--json", type=Path, default=None,
                    help="also write the full report as JSON")
    args = ap.parse_args(argv)

    inventory = None
    if args.inventory.exists():
        inventory = json.loads(args.inventory.read_text(encoding="utf-8"))

    files = sorted(args.out_dir.glob("*.h5"))
    if not files:
        print(f"no .h5 files in {args.out_dir}", file=sys.stderr)
        return 2

    a = Audit()
    rows = []
    print(f"auditing {len(files)} file(s) in {args.out_dir}\n")
    for p in files:
        rows.append(audit_site(p, a, inventory))

    hdr = ("site", "grid", "epsg", "arrays", "uavsar", "hollow",
           "area km2", "README", "err")
    print(f"{hdr[0]:<20}{hdr[1]:>14}{hdr[2]:>7}{hdr[3]:>8}{hdr[4]:>8}"
          f"{hdr[5]:>8}{hdr[6]:>10}{hdr[7]:>9}{hdr[8]:>9}")
    print("-" * 94)
    tot_area = tot_ref = 0.0
    for r in rows:
        if "shape" not in r:
            print(f"{r['site']:<20}  UNREADABLE")
            continue
        area = r.get("area_km2")
        ref = r.get("area_ref")
        if area and ref:
            tot_area += area
            tot_ref += ref
        print(f"{r['site']:<20}{f'{r['shape'][0]}x{r['shape'][1]}':>14}"
              f"{r['epsg']:>7}{r['arrays']:>8}{r.get('uavsar_groups',0):>8}"
              f"{len(r.get('hollow',[])):>8}"
              f"{(f'{area:.1f}' if area else '-'):>10}"
              f"{(f'{ref:.1f}' if ref else '-'):>9}"
              f"{(f'{r['area_err_pct']:+.2f}%' if area else '-'):>9}")
    print("-" * 94)
    if tot_ref:
        err = 100 * (tot_area - tot_ref) / tot_ref
        print(f"{'TOTAL':<20}{'':>37}{tot_area:>18.1f}{tot_ref:>9.1f}{err:>+8.2f}%")
        a.check(abs(err) < 0.5,
                f"total area {tot_area:.1f} km2 differs from README "
                f"{tot_ref:.1f} km2 by {err:+.2f}%")

    for label, items in (("FAIL", a.fail), ("WARN", a.warn), ("NOTE", a.note)):
        if items:
            print(f"\n{label} ({len(items)})")
            for m in items:
                print(f"  {m}")

    if args.json:
        args.json.write_text(json.dumps(
            {"sites": rows, "fail": a.fail, "warn": a.warn, "note": a.note},
            indent=2, default=str), encoding="utf-8")
        print(f"\nreport written to {args.json}")

    print(f"\n{'PASS' if not a.fail else 'FAIL'}: "
          f"{len(a.fail)} failure(s), {len(a.warn)} warning(s), "
          f"{len(a.note)} note(s)")
    return 0 if not a.fail else 1


if __name__ == "__main__":
    raise SystemExit(main())
