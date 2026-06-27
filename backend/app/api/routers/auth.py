"""Auth routes — two-step login.

Flow:
  1. POST /auth/password  {username, password}
        → if correct: returns { challenge, captcha:{captcha_id, image} }
        → if wrong:    401 (no captcha is ever issued)
  2. POST /auth/login     {challenge, captcha_id, captcha_text}
        → verifies the captcha against the password-verified challenge → JWT
  GET /auth/captcha  — refresh the captcha image during step 2.
"""
import jwt
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.core.config import settings
from app.core.rate_limit import limiter
from app.core.security import (create_challenge_token, create_token, decode_token,
                              verify_password)
from app.db import database as db
from app.schemas.auth import LoginBody, PasswordBody
from app.services import captcha as captcha_mod

router = APIRouter()


@router.get("/captcha")
@limiter.limit(settings.RATE_LIMIT_CAPTCHA)
async def get_captcha(request: Request):
    """Issue a fresh captcha (used to refresh during the captcha step)."""
    return captcha_mod.generate()


@router.post("/password")
@limiter.limit(settings.RATE_LIMIT_LOGIN)
async def verify_credentials(request: Request, body: PasswordBody):
    """Step 1 — verify username + password. Only on success is a captcha shown."""
    username = (body.username or "").strip()
    password = body.password or ""
    if not username or not password:
        return JSONResponse(status_code=400, content={"error": "Username and password required"})

    user = db.query_one(
        "SELECT id, username, password_hash FROM users WHERE username = %s", [username])
    if not user or not verify_password(password, user["password_hash"]):
        return JSONResponse(status_code=401, content={"error": "Invalid credentials"})

    return {"challenge": create_challenge_token(user["username"]), "captcha": captcha_mod.generate()}


@router.post("/login")
@limiter.limit(settings.RATE_LIMIT_LOGIN)
async def login(request: Request, body: LoginBody):
    """Step 2 — verify the captcha against the password-verified challenge."""
    try:
        claims = decode_token(body.challenge)
    except jwt.PyJWTError:
        return JSONResponse(status_code=401,
                            content={"error": "Session expired — please re-enter your password"})
    if claims.get("stage") != "captcha" or not claims.get("sub"):
        return JSONResponse(status_code=401,
                            content={"error": "Invalid login session — start again"})

    if not captcha_mod.verify(body.captcha_id, body.captcha_text):
        return JSONResponse(status_code=400, content={"error": "Captcha incorrect or expired"})

    user = db.query_one(
        "SELECT id, username, role FROM users WHERE username = %s", [claims["sub"]])
    if not user:
        return JSONResponse(status_code=401, content={"error": "Invalid credentials"})

    token = create_token({
        "id": str(user["id"]),
        "username": user["username"],
        "role": user["role"],
    })
    return {"token": token, "username": user["username"], "role": user["role"]}
