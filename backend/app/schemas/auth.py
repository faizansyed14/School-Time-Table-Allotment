"""Auth request/response schemas."""
from pydantic import BaseModel


class PasswordBody(BaseModel):
    """Step 1 — verify username + password (no captcha yet)."""
    username: str = ""
    password: str = ""


class LoginBody(BaseModel):
    """Step 2 — verify captcha against the challenge from step 1."""
    challenge: str = ""
    captcha_id: str = ""
    captcha_text: str = ""
