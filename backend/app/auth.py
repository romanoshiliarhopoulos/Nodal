"""
Two identity models run in parallel:

  Anonymous — httpOnly session cookie (UUID). Created via GET /api/session.
              Used for chat without an account.

  Firebase  — Bearer token (Firebase ID JWT). Required for BYOK key management
              and will become the primary identity model once auth UI is built.

get_user_id  — used by chat endpoints. Accepts either.
get_firebase_user — used by /api/keys. Requires a valid Firebase token.
"""

from typing import Optional

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from firebase_admin import auth as firebase_auth

from app.config import settings

security = HTTPBearer(auto_error=False)


def get_session_id(request: Request) -> str:
    """Cookie-only. Raises 401 if no session cookie."""
    if settings.skip_auth:
        return "development_dummy_session_id"
    
    session_id = request.cookies.get(settings.session_cookie_name)
    if not session_id:
        raise HTTPException(
            status_code=401,
            detail="No session found. Call GET /api/session to initialize.",
        )
    return session_id


async def get_firebase_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> dict:
    """Strict Firebase auth. Used for endpoints that require a real account (BYOK keys)."""
    if settings.skip_auth:
        return {"uid": "development_dummy_user_id", "email": "dev@local.host"}
        
    if not credentials:
        raise HTTPException(status_code=401, detail="Firebase ID token required.")
    try:
        return firebase_auth.verify_id_token(credentials.credentials)
    except firebase_auth.InvalidIdTokenError:
        raise HTTPException(status_code=401, detail="Invalid Firebase ID token.")
    except firebase_auth.ExpiredIdTokenError:
        raise HTTPException(status_code=401, detail="Firebase ID token expired.")
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Auth error: {e}")


async def get_user_id(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> str:
    """
    Resolves user identity for chat endpoints.
    Priority: Firebase uid (Bearer token) > anonymous session cookie.
    """
    if settings.skip_auth:
        return "development_dummy_user_id"
        
    if credentials:
        try:
            decoded = firebase_auth.verify_id_token(credentials.credentials)
            return decoded["uid"]
        except Exception:
            raise HTTPException(status_code=401, detail="Invalid Firebase ID token.")

    session_id = request.cookies.get(settings.session_cookie_name)
    if not session_id:
        raise HTTPException(
            status_code=401,
            detail="No session found. Call GET /api/session to initialize.",
        )
    return session_id
