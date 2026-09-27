"""Authentication routes (magic link JWT)"""

from fastapi import APIRouter

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/")
async def auth_root():
    return {
        "message": "Auth endpoints placeholder - JWT + Google OAuth (see docs/GOOGLE_OAUTH.md)"
    }
