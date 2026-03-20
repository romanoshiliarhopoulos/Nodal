from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.db import init_firebase
from app.routers import session as session_router
from app.routers import chat as chat_router
from app.routers import keys as keys_router
from app.routers import prompts as prompts_router

# Initialize Firebase Admin SDK on startup
init_firebase(settings.firebase_service_account_path)

app = FastAPI(
    title="Nodal API",
    description="Backend for the Nodal tree-based LLM chat interface",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173", 
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(session_router.router, prefix="/api/session", tags=["Session"])
app.include_router(chat_router.router, prefix="/api/chat", tags=["Chat"])
app.include_router(keys_router.router, prefix="/api/keys", tags=["Keys"])
app.include_router(prompts_router.router, prefix="/api/prompts", tags=["Prompts"])


@app.get("/")
async def root():
    return {"status": "ok", "message": "Nodal API is running!"}
