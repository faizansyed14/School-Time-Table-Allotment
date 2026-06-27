"""User management schemas."""
from pydantic import BaseModel


class UserCreate(BaseModel):
    username: str = ""
    password: str = ""
    role: str = "user"


class UserUpdate(BaseModel):
    username: str | None = None
    password: str | None = None
    role: str | None = None
