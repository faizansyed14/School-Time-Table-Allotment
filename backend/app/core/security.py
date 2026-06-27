"""Authentication & RBAC helpers — JWT issue/verify, bcrypt hashing, role guards."""
import datetime as dt

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import settings

_bearer = HTTPBearer(auto_error=False)


# ── Password hashing ────────────────────────────────────────────
def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt(rounds=10)).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


# ── JWT ─────────────────────────────────────────────────────────
def create_token(payload: dict, expires_minutes: int | None = None) -> str:
    now = dt.datetime.now(dt.timezone.utc)
    delta = (dt.timedelta(minutes=expires_minutes) if expires_minutes is not None
             else dt.timedelta(hours=settings.JWT_EXPIRES_HOURS))
    body = {**payload, "iat": now, "exp": now + delta}
    return jwt.encode(body, settings.JWT_SECRET, algorithm="HS256")


def create_challenge_token(username: str) -> str:
    """Short-lived token proving the password step succeeded (login stage 1)."""
    return create_token({"sub": username, "stage": "captcha"}, expires_minutes=5)


def decode_token(token: str) -> dict:
    return jwt.decode(token, settings.JWT_SECRET, algorithms=["HS256"])


# ── FastAPI dependencies ────────────────────────────────────────
def require_auth(creds: HTTPAuthorizationCredentials = Depends(_bearer)) -> dict:
    if creds is None or not creds.credentials:
        raise HTTPException(status_code=401, detail="Unauthorised")
    try:
        return decode_token(creds.credentials)
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


def require_role(*roles: str):
    """Dependency factory — only allow users whose role is in `roles`."""
    allowed = set(roles)

    def _guard(user: dict = Depends(require_auth)) -> dict:
        if user.get("role") not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Forbidden — admin access required",
            )
        return user

    return _guard


require_admin = require_role("admin")
