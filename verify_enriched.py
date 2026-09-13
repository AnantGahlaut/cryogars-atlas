#!/usr/bin/env python3
"""
verify_enriched.py -- prove the enriched archives carry only real measurements.

`audit_archive.py` checks the raw build against the download inventory. This
checks the *enriched* files against the invariants enrichment is supposed to
establish, by reading the values rather than trusting the log that wrote them:

  * every stored value is a measurement -- no exact-0.0 radar fill, no
    unwrapper zeros, nothing outside a physically possible range
  * dtypes survived the rewrite: complex phase is still complex, the coherence
    mask is still uint8
  * every layer of an acquisition shares one nodata footprint, which is what
    "pixel-aligned" has to mean if a model is going to stack them
  * the geometry needed to invert phase is present and physical

Reads one array at a time, so peak memory is one grid regardless of site size.

    python verify_enriched.py --out-dir C:/SnowEx/out
    python verify_enriched.py --out-dir C:/SnowEx/out --site grand_mesa
    python verify_enriched.py --out-dir C:/SnowEx/out --quick   # lidar only
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

C = {"red": "\033[31m", "yel": "\033[33m", "grn": "\033[32m",
     "dim": "\033[2m", "bold": "\033[1m", "off": "\033[0m"}
if os.name == "nt":
    os.system("")

#: Ranges enrichment claims to enforce. Kept independent of enrich_hdf5.py on
#: purpose: a checker that imports the thing it checks agrees with it by
#: construction and proves nothing.
RANGE = {
    "snow_depth": (0.0, 15.0),
    "elevation": (-500.0, 9000.0),
    "veg_height": (0.0, 120.0),
    "cor": (0.0, 1.0),
    "slope": (0.0, 90.0),
    "aspect": (0.0, 360.0),
    "local_incidence_angle": (0.0, 180.0),
    "incidence_angle_flat": (0.0, 90.0),
}

#: Leaves that must not contain exact zero among finite values. Amplitude and
#: coherence zeros are off-swath fill; unwrapped-phase zeros are regions the
#: unwrapper could not resolve. Real measurements do not land on exact 0.0.
NO_EXACT_ZERO = ("amp1", "amp2", "cor", "unw")

DTYPE = {"int": "complex64", "coherence_mask": "uint8"}


class Report:
    def __init__(self) -> None:
        self.fail: list[str] = []
        self.warn: list[str] = []
        self.n = 0

    def check(self, ok: bool, msg: str) -> bool:
        self.n += 1
        if not ok:
            self.fail.append(msg)
        return ok

    def caution(self, ok: bool, msg: str) -> None:
        self.n += 1
        if not ok:
            self.warn.append(msg)


def verify(path: Path, r: Report, quick: bool = False) -> dict:
    import h5py
    import numpy as np

    out = {"layers": 0, "cells": 0, "acq": 0}
    with h5py.File(path, "r") as f:
        site = path.stem.replace(".enriched", "")
        ident = f["identification"].attrs
        gh, gw = (int(v) for v in ident["common_grid_shape"])
        res = float(ident["common_grid_resolution_m"])
        r.check(res == 3.0, f"{site}: resolution {res} != 3.0")
        r.check("insitu" not in f, f"{site}: insitu present (should be v1-omitted)")
        r.check(str(ident.get("enrichment_version", "")).startswith("3."),
                f"{site}: enrichment_version is "
                f"{ident.get('enrichment_version')!r}, expected 3.x")

        # ---------------- lidar ----------------
        for p in _walk(f, "science/LIDAR"):
            leaf = p.rsplit("/", 1)[-1]
            d = f[p]
            if d.shape != (gh, gw):
                r.check(False, f"{site}/{p}: shape {d.shape} != grid ({gh},{gw})")
                continue
            a = d[...]
            out["layers"] += 1
            out["cells"] += a.size
            fin = np.isfinite(a)
            if leaf in RANGE:
                lo, hi = RANGE[leaf]
                bad = int((fin & ((a < lo) | (a > hi))).sum())
                r.check(bad == 0,
                        f"{site}/{p}: {bad:,} values outside [{lo}, {hi}] "
                        f"(min {np.nanmin(a):.3f} max {np.nanmax(a):.3f})")
            if not fin.any():
                r.check(False, f"{site}/{p}: every pixel is nodata")

        if quick:
            return out

        # ---------------- radar ----------------
        if "science" not in f or "UAVSAR" not in f["science"]:
            return out
        U = f["science/UAVSAR"]
        for dp in U:
            for line in U[dp]:
                grp = U[dp][line]
                out["acq"] += 1
                tag = f"{site}/{dp}/{line}"

                for k in ("radar_wavelength_cm", "peg_latitude_deg",
                          "peg_heading_deg", "platform_altitude_m"):
                    r.caution(k in grp.attrs, f"{tag}: missing attr {k}")
                wl = grp.attrs.get("radar_wavelength_cm")
                if wl is not None:
                    r.check(23.0 < float(wl) < 25.0,
                            f"{tag}: wavelength {float(wl)} cm is not L-band")

                if "GEOMETRY" in grp:
                    for leaf in ("local_incidence_angle", "incidence_angle_flat"):
                        if leaf not in grp["GEOMETRY"]:
                            continue
                        a = grp["GEOMETRY"][leaf][...]
                        out["layers"] += 1
                        out["cells"] += a.size
                        fin = np.isfinite(a)
                        lo, hi = RANGE[leaf]
                        bad = int((fin & ((a < lo) | (a > hi))).sum())
                        r.check(bad == 0, f"{tag}/{leaf}: {bad:,} outside "
                                          f"[{lo}, {hi}]")

                for pol in grp:
                    if pol == "GEOMETRY":
                        continue
                    pg = grp[pol]
                    footprint = None
                    for leaf in pg:
                        d = pg[leaf]
                        if not hasattr(d, "shape") or d.shape != (gh, gw):
                            continue
                        a = d[...]
                        out["layers"] += 1
                        out["cells"] += a.size

                        want = DTYPE.get(leaf)
                        if want:
                            r.check(str(a.dtype) == want,
                                    f"{tag}/{pol}/{leaf}: dtype {a.dtype}, "
                                    f"expected {want}")

                        if leaf == "coherence_mask":
                            vals = set(np.unique(a).tolist())
                            r.check(vals <= {0, 1, 255},
                                    f"{tag}/{pol}/coherence_mask: unexpected "
                                    f"values {sorted(vals)[:6]}")
                            continue

                        fin = (np.isfinite(a.real) if a.dtype.kind == "c"
                               else np.isfinite(a))
                        if leaf in NO_EXACT_ZERO:
                            z = int((fin & (a == 0)).sum())
                            r.check(z == 0,
                                    f"{tag}/{pol}/{leaf}: {z:,} exact zeros "
                                    f"survived masking")
                        if leaf in RANGE:
                            lo, hi = RANGE[leaf]
                            bad = int((fin & ((a < lo) | (a > hi))).sum())
                            r.check(bad == 0,
                                    f"{tag}/{pol}/{leaf}: {bad:,} outside "
                                    f"[{lo}, {hi}]")

                        # Valid data in any layer must be a SUBSET of the
                        # swath. unw legitimately has more nodata than the
                        # rest -- the unwrapper-zero rule removes cells the
                        # swath mask keeps -- so a larger hole is expected.
                        # A cell valid in unw but not in amplitude would mean
                        # the mask was not applied, and that is a real fault.
                        if leaf in ("amp1", "amp2", "cor", "unw", "int"):
                            if footprint is None and leaf == "amp1":
                                footprint = (fin, leaf)
                            elif footprint is not None:
                                ref, refleaf = footprint
                                orphan = int((fin & ~ref).sum())
                                r.check(orphan == 0,
                                        f"{tag}/{pol}/{leaf}: {orphan:,} cells "
                                        f"valid here but nodata in {refleaf} "
                                        f"-- swath mask not applied")
                                extra = int((ref & ~fin).sum())
                                if extra and leaf != "unw":
                                    r.caution(False,
                                              f"{tag}/{pol}/{leaf}: {extra:,} "
                                              f"more nodata than {refleaf}")
    return out


def _walk(f, root: str) -> list[str]:
    import h5py

    got: list[str] = []
    if root not in f:
        return got
    f[root].visititems(
        lambda n, o: got.append(f"{root}/{n}")
        if isinstance(o, h5py.Dataset) else None)
    return got


def main(argv=None) -> int:
    here = Path(__file__).resolve().parent
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out-dir", type=Path,
                    default=Path(os.environ.get("SNOWEX_OUT_DIR", here / "out")))
    ap.add_argument("--site")
    ap.add_argument("--quick", action="store_true",
                    help="lidar layers only; skip the radar sweep")
    args = ap.parse_args(argv)

    files = ([args.out_dir / f"{args.site}.enriched.h5"] if args.site
             else sorted(args.out_dir.glob("*.enriched.h5")))
    files = [p for p in files if p.exists()]
    if not files:
        print(f"no enriched files in {args.out_dir}", file=sys.stderr)
        return 2

    total = {"layers": 0, "cells": 0, "acq": 0}
    rc = 0
    for p in files:
        r = Report()
        try:
            got = verify(p, r, args.quick)
        except Exception as exc:                                # noqa: BLE001
            print(f"{C['red']}{p.stem}: unreadable -- {exc}{C['off']}")
            rc = 1
            continue
        for k in total:
            total[k] += got[k]
        mark = (f"{C['grn']}PASS{C['off']}" if not r.fail
                else f"{C['red']}FAIL{C['off']}")
        print(f"{mark}  {p.stem:<30} {r.n:>5} checks  "
              f"{got['layers']:>4} layers  {got['acq']:>3} acq"
              + (f"  {C['yel']}{len(r.warn)} warn{C['off']}" if r.warn else ""))
        for m in r.fail[:12]:
            print(f"      {C['red']}x{C['off']} {m}")
        if len(r.fail) > 12:
            print(f"      {C['dim']}... {len(r.fail) - 12} more{C['off']}")
        for m in r.warn[:6]:
            print(f"      {C['yel']}!{C['off']} {m}")
        if len(r.warn) > 6:
            print(f"      {C['dim']}... {len(r.warn) - 6} more warnings{C['off']}")
        if r.fail:
            rc = 1

    print(f"\n{C['bold']}{total['layers']:,} layers  {total['cells']:,} cells  "
          f"{total['acq']:,} acquisitions{C['off']}")
    print("all invariants hold" if rc == 0 else "problems found")
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
