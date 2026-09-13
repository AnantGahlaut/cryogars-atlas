"""Shared metadata bookkeeping; these helpers never modify raster values."""

import json
import math


def statistics_attrs(data, finite, *, percentiles=False):
    """Describe the supplied stored array, without inheriting input statistics."""
    import numpy as np

    attrs = {
        "value_stats_stage": "stored_array",
        "value_stats_note": (
            "Descriptive statistics of the stored array at this write. "
            "They do not imply that source values were unfiltered or unaltered. "
            "See processing_history for recorded processing stages."
        ),
    }
    if data.dtype.kind == "c":
        attrs["value_stats_status"] = "not_applicable_complex"
    elif not finite.any():
        attrs["value_stats_status"] = "no_valid_values"
    elif data.dtype.kind == "f":
        values = data[finite]
        attrs.update(value_min=float(values.min()), value_max=float(values.max()))
        if percentiles:
            p1, p50, p99 = (float(v) for v in np.percentile(values, [1, 50, 99]))
            attrs.update(value_p1=p1, value_median=p50, value_p99=p99)
        else:
            attrs["value_median"] = float(np.median(values))
        attrs["value_stats_status"] = "computed"
    elif data.dtype.kind in "ui":
        values = data[finite]
        attrs.update(value_min=int(values.min()), value_max=int(values.max()),
                     value_stats_status="computed")
    else:
        attrs["value_stats_status"] = "not_applicable_dtype"
    return attrs


def _json_value(value):
    """Convert HDF5 attribute scalars/arrays to strict JSON, including NaN."""
    if hasattr(value, "tolist"):
        return _json_value(value.tolist())
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    if isinstance(value, dict):
        return {str(k): _json_value(v) for k, v in value.items()}
    if isinstance(value, (tuple, list)):
        return [_json_value(v) for v in value]
    if isinstance(value, float) and not math.isfinite(value):
        return str(value)
    return value


def processing_snapshot(attrs):
    prefixes = ("cleaning_", "value_", "negatives_", "speckle_", "swath_",
                "unw_zero_", "range_", "enrichment_")
    names = {"valid_pixel_count", "valid_fraction", "negative_handling",
             "negative_noise_floor_m", "plausible_range",
             "out_of_range_set_to_nodata"}
    return {k: _json_value(v) for k, v in attrs.items()
            if k.startswith(prefixes) or k in names}


def record_processing_history(attrs, stage, before_attrs=None):
    """Append a pass, retaining recorded input metadata without certifying it.

    Missing historical counters/settings stay absent. An unparseable prior
    history is retained verbatim, so rewriting cannot silently discard it.
    """
    before = before_attrs if before_attrs is not None else {}
    raw = _json_value(before.get("processing_history", "[]"))
    try:
        history = json.loads(raw)
        if not isinstance(history, list):
            raise ValueError("history must be a list")
    except (TypeError, ValueError):
        history = [{"stage": "unparsed_prior_history", "recorded_value": raw}]
    history.append({
        "stage": stage,
        "input_metadata_scope": "recorded_input; older passes and settings may be unknown",
        "input_processing_metadata": processing_snapshot(before),
        "output_processing_metadata": processing_snapshot(attrs),
    })
    attrs["processing_history"] = json.dumps(history, allow_nan=False, sort_keys=True)
    attrs["processing_metadata_version"] = "1.0"
