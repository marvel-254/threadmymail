from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.accounts import router as accounts_router
from backend.ai_service import router as ai_router
from backend.auth import router as auth_router
from backend.database import init_db
from backend.emails import router as emails_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await init_db()
    print("ThreadMyMail backend starting up...")
    yield
    
    # Shutdown
    print("ThreadMyMail backend shutting down...")

app = FastAPI(
    title="ThreadMyMail API",
    description="AI-powered email management platform",
    version="0.1.0",
    lifespan=lifespan
)

# CORS - Render provides the frontend URL
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Will tighten after Render deployment
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(auth_router)
app.include_router(accounts_router)
app.include_router(emails_router)
app.include_router(ai_router)

if __name__ == "__main__":
    uvicorn.run("backend.app:app", host="0.0.0.0", port=8000, reload=True)