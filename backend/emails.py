"""Email sync and message routes"""
from fastapi import APIRouter

router = APIRouter(prefix="/emails", tags=["emails"])

@router.get("/")
async def get_emails():
    return {"message": "Emails endpoint placeholder"}