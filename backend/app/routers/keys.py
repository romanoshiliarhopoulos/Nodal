"""
BYOK key management.

All endpoints require a valid Firebase ID token (Bearer header).
Anonymous/cookie sessions cannot store keys — keys are always tied to a real uid.

Firestore layout:
  users/{uid}.encrypted_keys.{provider} = {nonce: str, ct: str}

Keys are encrypted with AES-256-GCM before storage and never returned to the client.
"""

from fastapi import APIRouter, Depends, HTTPException
from google.cloud.firestore_v1 import DELETE_FIELD

from app.auth import get_firebase_user
from app.db import get_db
from app.encryption import encrypt_key
from app.models import KeyUpsert

router = APIRouter()


@router.get("")
async def list_keys(user: dict = Depends(get_firebase_user)):
    """Return which providers have a stored key. Never returns key material."""
    uid = user["uid"]
    doc = get_db().collection("users").document(uid).get()
    if not doc.exists:
        return {"providers": []}
    encrypted_keys = doc.to_dict().get("encrypted_keys", {})
    return {"providers": list(encrypted_keys.keys())}


@router.post("")
async def upsert_key(body: KeyUpsert, user: dict = Depends(get_firebase_user)):
    """Encrypt and store an API key for the given provider."""
    uid = user["uid"]
    blob = encrypt_key(body.api_key)
    user_ref = get_db().collection("users").document(uid)
    try:
        # update() supports dot-notation and won't clobber other providers
        user_ref.update({f"encrypted_keys.{body.provider}": blob})
    except Exception:
        # Document doesn't exist yet — create it
        user_ref.set({"encrypted_keys": {body.provider: blob}}, merge=True)
    return {"provider": body.provider, "status": "stored"}


@router.delete("/{provider}")
async def delete_key(provider: str, user: dict = Depends(get_firebase_user)):
    """Remove the stored key for a provider."""
    uid = user["uid"]
    try:
        get_db().collection("users").document(uid).update(
            {f"encrypted_keys.{provider}": DELETE_FIELD}
        )
    except Exception:
        raise HTTPException(status_code=404, detail="No key found for this provider.")
    return {"provider": provider, "status": "deleted"}
