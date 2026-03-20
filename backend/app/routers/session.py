import uuid
from fastapi import APIRouter, Request, Response
from firebase_admin import firestore as fs
from app.db import get_db
from app.config import settings

router = APIRouter()


@router.get("")
async def get_or_create_session(request: Request, response: Response):
    """
    Initialize or retrieve the current session.
    Call this on page load — it sets the session cookie for anonymous users.
    """
    session_id = request.cookies.get(settings.session_cookie_name)
    is_new = False

    if not session_id:
        session_id = str(uuid.uuid4())
        is_new = True

        get_db().collection("users").document(session_id).set({
            "id": session_id,
            "is_anonymous": True,
            "email": None,
            "default_model": settings.default_model,
            "api_keys": {},
            "created_at": fs.SERVER_TIMESTAMP,
        })

        response.set_cookie(
            key=settings.session_cookie_name,
            value=session_id,
            httponly=True,
            samesite="lax",
            max_age=settings.session_max_age,
        )

    return {
        "session_id": session_id,
        "is_new": is_new,
        "default_model": settings.default_model,
    }
