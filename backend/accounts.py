"""Email account management routes"""

from fastapi import APIRouter

router = APIRouter(prefix="/accounts", tags=["accounts"])


@router.get("/")
async def get_accounts():
    return {"message": "Accounts endpoint placeholder"}
