"""Captcha — random A–Z string rendered to a PNG, validated by a short-lived token.

Flow:
  1. Client calls GET /api/auth/captcha (typically after entering the password).
  2. We generate a random A–Z code, store it server-side keyed by an opaque id,
     and return { captcha_id, image } where image is a base64 PNG data URL.
  3. Client submits captcha_id + captcha_text with the login request.
"""
import base64
import io
import random
import secrets
import string
import time

from PIL import Image, ImageDraw, ImageFont

from app.core.config import settings

# In-memory store: captcha_id -> (code, expires_at). Fine for a single API
# instance; swap for Redis if you scale horizontally.
_store: dict[str, tuple[str, float]] = {}

ALPHABET = string.ascii_uppercase  # A–Z only, per requirement


def _purge_expired():
    now = time.time()
    for key in [k for k, (_, exp) in _store.items() if exp < now]:
        _store.pop(key, None)


def _random_code(length: int) -> str:
    return "".join(random.choice(ALPHABET) for _ in range(length))


def _load_font(size: int):
    for path in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    ):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def _render(code: str) -> str:
    width, height = 30 * len(code) + 30, 70
    img = Image.new("RGB", (width, height), (245, 246, 250))
    draw = ImageDraw.Draw(img)

    # Noise lines
    for _ in range(6):
        draw.line(
            [
                (random.randint(0, width), random.randint(0, height)),
                (random.randint(0, width), random.randint(0, height)),
            ],
            fill=(random.randint(150, 210),) * 3,
            width=1,
        )

    font = _load_font(38)
    x = 18
    for ch in code:
        y = random.randint(8, 20)
        colour = (random.randint(20, 90), random.randint(20, 90), random.randint(60, 140))
        draw.text((x, y), ch, font=font, fill=colour)
        x += 30

    # Noise dots
    for _ in range(220):
        draw.point((random.randint(0, width), random.randint(0, height)),
                   fill=(random.randint(120, 200),) * 3)

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def generate() -> dict:
    _purge_expired()
    code = _random_code(settings.CAPTCHA_LENGTH)
    captcha_id = secrets.token_urlsafe(18)
    _store[captcha_id] = (code, time.time() + settings.CAPTCHA_TTL_SECONDS)
    return {"captcha_id": captcha_id, "image": _render(code)}


def verify(captcha_id: str, text: str) -> bool:
    _purge_expired()
    if not captcha_id or not text:
        return False
    entry = _store.pop(captcha_id, None)  # single-use
    if not entry:
        return False
    code, expires_at = entry
    if expires_at < time.time():
        return False
    return text.strip().upper() == code
