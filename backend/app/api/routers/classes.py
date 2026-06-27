"""Classes CRUD."""
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from app.db import database as db
from app.core.security import require_auth

router = APIRouter(dependencies=[Depends(require_auth)])

CLASS_SELECT = "id, name, class_level, section, display_order, class_teacher_id"
CLASS_FIELDS = ["name", "class_level", "section", "display_order", "class_teacher_id"]


@router.get("")
async def list_classes():
    return db.query(f"SELECT {CLASS_SELECT} FROM classes ORDER BY display_order")


@router.post("")
async def create_class(request: Request):
    body = await request.json()
    if not body.get("name") or not body.get("class_level"):
        return JSONResponse(status_code=400, content={"error": "name and class_level required"})
    try:
        row = db.execute_returning(
            f"""INSERT INTO classes (name, class_level, section, display_order, class_teacher_id)
                VALUES (%s, %s, %s, %s, %s) RETURNING {CLASS_SELECT}""",
            [
                body["name"], body["class_level"], body.get("section"),
                body.get("display_order") or 0, body.get("class_teacher_id"),
            ],
        )
    except Exception as e:
        return JSONResponse(status_code=400, content={"error": str(e)})
    return JSONResponse(status_code=201, content=_jsonify(row))


@router.put("/{class_id}")
async def update_class(class_id: str, request: Request):
    body = await request.json()
    sets, params = [], []
    for k in CLASS_FIELDS:
        if k in body:
            sets.append(f"{k} = %s")
            params.append(body[k])
    if not sets:
        return JSONResponse(status_code=400, content={"error": "Nothing to update"})
    params.append(class_id)
    try:
        row = db.execute_returning(
            f"UPDATE classes SET {', '.join(sets)} WHERE id = %s RETURNING {CLASS_SELECT}",
            params,
        )
    except Exception as e:
        return JSONResponse(status_code=400, content={"error": str(e)})
    if not row:
        return JSONResponse(status_code=400, content={"error": "Class not found"})
    return _jsonify(row)


@router.delete("/{class_id}")
async def delete_class(class_id: str):
    try:
        db.execute("DELETE FROM classes WHERE id = %s", [class_id])
    except Exception as e:
        return JSONResponse(status_code=400, content={"error": str(e)})
    return {"success": True}


def _jsonify(row):
    if row:
        row = dict(row)
        if row.get("id") is not None:
            row["id"] = str(row["id"])
        if row.get("class_teacher_id") is not None:
            row["class_teacher_id"] = str(row["class_teacher_id"])
    return row
