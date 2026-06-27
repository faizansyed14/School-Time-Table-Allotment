"""Small serialization helpers."""
import datetime as dt
import uuid


def to_jsonable(obj):
    """Recursively convert UUIDs, datetimes and sets into JSON-safe values.

    Handles dict *keys* too (UUID/int keys become strings), which matters for the
    class_id-keyed grids we both return to the client and store in JSONB.
    """
    if isinstance(obj, dict):
        return {_key(k): to_jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [to_jsonable(v) for v in obj]
    if isinstance(obj, set):
        return [to_jsonable(v) for v in sorted(obj, key=str)]
    if isinstance(obj, uuid.UUID):
        return str(obj)
    if isinstance(obj, (dt.datetime, dt.date)):
        return obj.isoformat()
    return obj


def _key(k):
    if isinstance(k, uuid.UUID):
        return str(k)
    if isinstance(k, str):
        return k
    return str(k)
