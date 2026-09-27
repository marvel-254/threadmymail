"""AI integration with OpenRouter"""

from fastapi import APIRouter

router = APIRouter(prefix="/ai", tags=["ai"])


@router.get("/")
async def ai_root():
    return {"message": "AI endpoints placeholder - OpenRouter configured"}
