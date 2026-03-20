"""
System prompt management.

Firestore layout:
  users/{uid}/prompts/{prompt_id}  — prompt documents
  users/{uid}.active_prompt_id     — currently selected prompt id (or absent)
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from firebase_admin import firestore as fs
from google.cloud.firestore_v1 import DELETE_FIELD

from app.auth import get_firebase_user
from app.db import get_db
from app.models import SetActivePrompt, SystemPromptCreate, SystemPromptUpdate

router = APIRouter()


def _prompts_ref(uid: str):
    return get_db().collection("users").document(uid).collection("prompts")


def _user_ref(uid: str):
    return get_db().collection("users").document(uid)


@router.get("")
async def list_prompts(user: dict = Depends(get_firebase_user)):
    uid = user["uid"]
    prompts = [doc.to_dict() for doc in _prompts_ref(uid).stream()]
    # Strip server timestamps so they serialise cleanly
    for p in prompts:
        p.pop("created_at", None)
    user_doc = _user_ref(uid).get()
    active_prompt_id = user_doc.to_dict().get("active_prompt_id") if user_doc.exists else None
    return {"prompts": prompts, "active_prompt_id": active_prompt_id}


@router.post("")
async def create_prompt(body: SystemPromptCreate, user: dict = Depends(get_firebase_user)):
    uid = user["uid"]
    prompt_id = str(uuid.uuid4())
    _prompts_ref(uid).document(prompt_id).set({
        "id": prompt_id,
        "name": body.name,
        "content": body.content,
        "created_at": fs.SERVER_TIMESTAMP,
    })
    return {"id": prompt_id, "name": body.name, "content": body.content}


@router.put("/{prompt_id}")
async def update_prompt(
    prompt_id: str,
    body: SystemPromptUpdate,
    user: dict = Depends(get_firebase_user),
):
    uid = user["uid"]
    ref = _prompts_ref(uid).document(prompt_id)
    if not ref.get().exists:
        raise HTTPException(status_code=404, detail="Prompt not found")
    ref.update({"name": body.name, "content": body.content})
    return {"id": prompt_id, "name": body.name, "content": body.content}


@router.delete("/{prompt_id}")
async def delete_prompt(prompt_id: str, user: dict = Depends(get_firebase_user)):
    uid = user["uid"]
    ref = _prompts_ref(uid).document(prompt_id)
    if not ref.get().exists:
        raise HTTPException(status_code=404, detail="Prompt not found")
    ref.delete()
    # Clear active_prompt_id if it pointed to this prompt
    user_ref = _user_ref(uid)
    user_doc = user_ref.get()
    if user_doc.exists and user_doc.to_dict().get("active_prompt_id") == prompt_id:
        user_ref.update({"active_prompt_id": DELETE_FIELD})
    return {"id": prompt_id, "status": "deleted"}


@router.post("/active")
async def set_active_prompt(body: SetActivePrompt, user: dict = Depends(get_firebase_user)):
    uid = user["uid"]
    user_ref = _user_ref(uid)
    if body.prompt_id is None:
        try:
            user_ref.update({"active_prompt_id": DELETE_FIELD})
        except Exception:
            pass
    else:
        try:
            user_ref.update({"active_prompt_id": body.prompt_id})
        except Exception:
            user_ref.set({"active_prompt_id": body.prompt_id}, merge=True)
    return {"active_prompt_id": body.prompt_id}
