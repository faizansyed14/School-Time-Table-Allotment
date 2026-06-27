"""User management — admin-only CRUD over the `users` table (RBAC).

Admins can create users with username, password and role, and perform full CRUD.
"""
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from app.core.security import hash_password, require_admin
from app.db import database as db
from app.schemas.users import UserCreate, UserUpdate

router = APIRouter(dependencies=[Depends(require_admin)])

VALID_ROLES = {"admin", "user"}
USER_SELECT = "id, username, role, created_at"


@router.get("")
async def list_users():
    return db.query(f"SELECT {USER_SELECT} FROM users ORDER BY username")


@router.post("")
async def create_user(body: UserCreate):
    username = (body.username or "").strip()
    password = body.password or ""
    role = (body.role or "user").strip()
    if not username or not password:
        return JSONResponse(status_code=400, content={"error": "username and password required"})
    if role not in VALID_ROLES:
        return JSONResponse(status_code=400, content={"error": f"role must be one of {sorted(VALID_ROLES)}"})

    exists = db.query_one("SELECT id FROM users WHERE username = %s", [username])
    if exists:
        return JSONResponse(status_code=400, content={"error": "Username already exists"})

    row = db.execute_returning(
        f"""INSERT INTO users (username, password_hash, role)
            VALUES (%s, %s, %s) RETURNING {USER_SELECT}""",
        [username, hash_password(password), role],
    )
    return JSONResponse(status_code=201, content=_serialize(row))


@router.put("/{user_id}")
async def update_user(user_id: str, body: UserUpdate, current=Depends(require_admin)):
    target = db.query_one("SELECT id, username, role FROM users WHERE id = %s", [user_id])
    if not target:
        return JSONResponse(status_code=404, content={"error": "User not found"})

    sets, params = [], []
    if body.username is not None and body.username.strip():
        sets.append("username = %s")
        params.append(body.username.strip())
    if body.role is not None:
        if body.role not in VALID_ROLES:
            return JSONResponse(status_code=400, content={"error": f"role must be one of {sorted(VALID_ROLES)}"})
        # Don't let an admin demote themselves and lose admin access by accident.
        if str(target["id"]) == str(current["id"]) and body.role != "admin":
            return JSONResponse(status_code=400, content={"error": "You cannot change your own role"})
        sets.append("role = %s")
        params.append(body.role)
    if body.password is not None and body.password:
        sets.append("password_hash = %s")
        params.append(hash_password(body.password))

    if not sets:
        return JSONResponse(status_code=400, content={"error": "Nothing to update"})

    params.append(user_id)
    row = db.execute_returning(
        f"UPDATE users SET {', '.join(sets)} WHERE id = %s RETURNING {USER_SELECT}",
        params,
    )
    return _serialize(row)


@router.delete("/{user_id}")
async def delete_user(user_id: str, current=Depends(require_admin)):
    if str(user_id) == str(current["id"]):
        return JSONResponse(status_code=400, content={"error": "You cannot delete your own account"})
    target = db.query_one("SELECT id FROM users WHERE id = %s", [user_id])
    if not target:
        return JSONResponse(status_code=404, content={"error": "User not found"})
    db.execute("DELETE FROM users WHERE id = %s", [user_id])
    return {"success": True}


def _serialize(row):
    if row and row.get("created_at") is not None:
        row = {**row, "created_at": row["created_at"].isoformat()}
    if row and row.get("id") is not None:
        row = {**row, "id": str(row["id"])}
    return row
