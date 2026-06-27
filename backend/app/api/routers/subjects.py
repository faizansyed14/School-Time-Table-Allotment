"""Subjects CRUD — per-class weekly period requirements stored as columns."""
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from app.db import database as db
from app.core.security import require_auth

router = APIRouter(dependencies=[Depends(require_auth)])

CLASS_COLS = ["1a", "1b", "2a", "2b", "3a", "3b", "4a", "4b",
              "5", "6a", "6b", "7", "8", "9", "10"]


def _to_int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


@router.get("")
async def list_subjects():
    return db.query("SELECT * FROM subjects ORDER BY name")


@router.post("")
async def create_subject(request: Request):
    body = await request.json()
    if not body.get("name"):
        return JSONResponse(status_code=400, content={"error": "name required"})
    cols = ["name"] + [f"periods_{c}" for c in CLASS_COLS]
    vals = [body["name"]] + [_to_int(body.get(f"periods_{c}")) for c in CLASS_COLS]
    placeholders = ", ".join(["%s"] * len(cols))
    try:
        row = db.execute_returning(
            f"INSERT INTO subjects ({', '.join(cols)}) VALUES ({placeholders}) RETURNING *",
            vals,
        )
    except Exception as e:
        return JSONResponse(status_code=400, content={"error": str(e)})
    return JSONResponse(status_code=201, content=_jsonify(row))


@router.put("/{subject_id}")
async def update_subject(subject_id: str, request: Request):
    body = await request.json()
    sets, params = [], []
    if "name" in body:
        sets.append("name = %s")
        params.append(body["name"])
    for c in CLASS_COLS:
        key = f"periods_{c}"
        if key in body:
            sets.append(f"{key} = %s")
            params.append(_to_int(body[key]))
    if not sets:
        return JSONResponse(status_code=400, content={"error": "Nothing to update"})
    params.append(subject_id)
    try:
        row = db.execute_returning(
            f"UPDATE subjects SET {', '.join(sets)} WHERE id = %s RETURNING *",
            params,
        )
    except Exception as e:
        return JSONResponse(status_code=400, content={"error": str(e)})
    if not row:
        return JSONResponse(status_code=400, content={"error": "Subject not found"})
    return _jsonify(row)


@router.delete("/{subject_id}")
async def delete_subject(subject_id: str):
    try:
        db.execute("DELETE FROM subjects WHERE id = %s", [subject_id])
    except Exception as e:
        return JSONResponse(status_code=400, content={"error": str(e)})
    return {"success": True}


def _jsonify(row):
    if row:
        row = dict(row)
        if row.get("id") is not None:
            row["id"] = str(row["id"])
        if row.get("created_at") is not None and hasattr(row["created_at"], "isoformat"):
            row["created_at"] = row["created_at"].isoformat()
    return row
