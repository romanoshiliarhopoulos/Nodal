import json
import os
import uuid

import litellm
litellm._turn_on_debug()
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from firebase_admin import firestore as fs
from google.cloud.firestore_v1 import ArrayRemove, ArrayUnion

from app.auth import get_user_id
from app.config import settings
from app.context_engine import build_context
from app.db import get_db
from app.encryption import decrypt_key
from app.models import ConversationCreate, ConversationUpdate, SendMessageRequest

router = APIRouter()

# Server-level fallback keys — used when a user has no BYOK key for a provider
if settings.groq_api_key:
    os.environ["GROQ_API_KEY"] = settings.groq_api_key
if settings.openai_api_key:
    os.environ["OPENAI_API_KEY"] = settings.openai_api_key
if settings.anthropic_api_key:
    os.environ["ANTHROPIC_API_KEY"] = settings.anthropic_api_key


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _node_path(db, conv_id: str, node_id: str) -> list[dict]:
    """Walk parent_id chain from node_id up to root. Returns [root, ..., node]."""
    path: list[dict] = []
    current_id: str | None = node_id
    while current_id:
        doc = (
            db.collection("conversations")
            .document(conv_id)
            .collection("nodes")
            .document(current_id)
            .get()
        )
        if not doc.exists:
            break
        node = doc.to_dict()
        path.append(node)
        current_id = node.get("parent_id")
    path.reverse()
    return path


def _resolve_api_key(db, user_id: str, model: str) -> str | None:
    """
    Try to decrypt the user's stored API key for the model's provider.
    Returns None if not found — LiteLLM will then fall back to the env key.
    """
    provider = model.split("/")[0] if "/" in model else "openai"
    try:
        doc = get_db().collection("users").document(user_id).get()
        if doc.exists:
            blob = doc.to_dict().get("encrypted_keys", {}).get(provider)
            if blob:
                return decrypt_key(blob)
    except Exception:
        pass
    return None


async def _auto_title(
    prompt: str,
    response: str,
    model: str,
    api_key: str | None,
    conv_ref,
) -> str | None:
    """Generate a short title from the first exchange and persist it. Returns the title."""
    try:
        msgs = [
            {
                "role": "user",
                "content": (
                    "Generate a concise 4-6 word title for this conversation. "
                    "Reply with the title only — no quotes, no punctuation at the end.\n\n"
                    f"User: {prompt[:300]}\nAssistant: {response[:300]}"
                ),
            }
        ]
        kwargs: dict = {"model": model, "messages": msgs, "max_tokens": 20}
        if api_key:
            kwargs["api_key"] = api_key
        resp = await litellm.acompletion(**kwargs)
        title = resp.choices[0].message.content.strip()
        conv_ref.update({"title": title})
        return title
    except Exception:
        return None


def _verify_ownership(conv_doc, user_id: str):
    if not conv_doc.exists:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if conv_doc.to_dict().get("user_id") != user_id:
        raise HTTPException(status_code=403, detail="Access denied")


# ---------------------------------------------------------------------------
# Conversations
# ---------------------------------------------------------------------------

@router.post("/conversations")
async def create_conversation(
    body: ConversationCreate,
    user_id: str = Depends(get_user_id),
):
    db = get_db()
    conv_id = str(uuid.uuid4())
    model = body.model or settings.default_model

    db.collection("conversations").document(conv_id).set({
        "id": conv_id,
        "user_id": user_id,
        "title": body.title,
        "model": model,
        "root_node_id": None,
        "created_at": fs.SERVER_TIMESTAMP,
        "updated_at": fs.SERVER_TIMESTAMP,
    })

    return {"id": conv_id, "title": body.title, "model": model}


@router.get("/conversations")
async def list_conversations(user_id: str = Depends(get_user_id)):
    db = get_db()
    docs = db.collection("conversations").where("user_id", "==", user_id).stream()
    convs = [doc.to_dict() for doc in docs]
    convs.sort(key=lambda c: c.get("updated_at") or 0, reverse=True)
    return convs


@router.get("/conversations/{conv_id}")
async def get_conversation(conv_id: str, user_id: str = Depends(get_user_id)):
    db = get_db()
    conv_doc = db.collection("conversations").document(conv_id).get()
    _verify_ownership(conv_doc, user_id)

    nodes = {
        doc.id: doc.to_dict()
        for doc in db.collection("conversations")
        .document(conv_id)
        .collection("nodes")
        .stream()
    }
    return {"conversation": conv_doc.to_dict(), "nodes": nodes}


@router.patch("/conversations/{conv_id}")
async def rename_conversation(
    conv_id: str,
    body: ConversationUpdate,
    user_id: str = Depends(get_user_id),
):
    db = get_db()
    conv_doc = db.collection("conversations").document(conv_id).get()
    _verify_ownership(conv_doc, user_id)
    db.collection("conversations").document(conv_id).update({"title": body.title})
    return {"id": conv_id, "title": body.title}


@router.delete("/conversations/{conv_id}")
async def delete_conversation(conv_id: str, user_id: str = Depends(get_user_id)):
    db = get_db()
    conv_doc = db.collection("conversations").document(conv_id).get()
    _verify_ownership(conv_doc, user_id)

    # Firestore doesn't cascade-delete subcollections
    for node in (
        db.collection("conversations").document(conv_id).collection("nodes").stream()
    ):
        node.reference.delete()

    for msg in db.collection("messages").where("conversation_id", "==", conv_id).stream():
        msg.reference.delete()

    db.collection("conversations").document(conv_id).delete()
    return {"id": conv_id, "status": "deleted"}


@router.delete("/conversations/{conv_id}/nodes/{node_id}")
async def delete_node(conv_id: str, node_id: str, user_id: str = Depends(get_user_id)):
    """
    Delete a single node and re-parent its children to the deleted node's parent.
    If the deleted node is the root, the first child becomes the new root.
    """
    db = get_db()
    conv_doc = db.collection("conversations").document(conv_id).get()
    _verify_ownership(conv_doc, user_id)

    nodes_col = db.collection("conversations").document(conv_id).collection("nodes")
    node_doc = nodes_col.document(node_id).get()
    if not node_doc.exists:
        raise HTTPException(status_code=404, detail="Node not found")

    node = node_doc.to_dict()
    parent_id = node.get("parent_id")
    children_ids = node.get("children_ids", [])

    # Re-parent each child to point to the deleted node's parent
    for child_id in children_ids:
        nodes_col.document(child_id).update({"parent_id": parent_id})

    if parent_id:
        # Remove deleted node from parent's children, add its children instead
        parent_ref = nodes_col.document(parent_id)
        parent_ref.update({"children_ids": ArrayRemove([node_id])})
        if children_ids:
            parent_ref.update({"children_ids": ArrayUnion(children_ids)})
    else:
        # Deleted node was root — promote first child as new root
        conv_ref = db.collection("conversations").document(conv_id)
        if children_ids:
            conv_ref.update({"root_node_id": children_ids[0]})
        else:
            conv_ref.update({"root_node_id": None})

    # Delete the node document itself
    nodes_col.document(node_id).delete()

    # Clean up the corresponding search entry
    for msg in db.collection("messages").where("node_id", "==", node_id).stream():
        msg.reference.delete()

    return {
        "id": node_id,
        "status": "deleted",
        "parent_id": parent_id,
        "children_ids": children_ids,
    }


# ---------------------------------------------------------------------------
# Nodes (messages + streaming)
# ---------------------------------------------------------------------------

@router.get("/search")
async def search_messages(q: str, user_id: str = Depends(get_user_id)):
    """Full-text search across all message prompts and responses for the user."""
    if len(q.strip()) < 2:
        return []
    db = get_db()
    q_lower = q.strip().lower()
    results = []
    for msg in db.collection("messages").where("user_id", "==", user_id).stream():
        d = msg.to_dict()
        prompt = d.get("prompt") or ""
        response = d.get("response") or ""
        matched_in = []
        if q_lower in prompt.lower():
            matched_in.append({"field": "prompt", "text": prompt})
        if q_lower in response.lower():
            matched_in.append({"field": "response", "text": response})
        for m in matched_in:
            results.append({
                "conversation_id": d.get("conversation_id"),
                "node_id": d.get("node_id"),
                "field": m["field"],
                "text": m["text"],
            })
    return results


@router.post("/conversations/{conv_id}/nodes")
async def send_message(
    conv_id: str,
    body: SendMessageRequest,
    user_id: str = Depends(get_user_id),
):
    db = get_db()
    conv_doc = db.collection("conversations").document(conv_id).get()
    _verify_ownership(conv_doc, user_id)
    conv = conv_doc.to_dict()

    model = body.model or conv.get("model") or settings.default_model
    node_id = str(uuid.uuid4())
    parent_id = body.parent_node_id
    is_root = not conv.get("root_node_id")

    # BYOK: try user's own decrypted key; fall back to server env key via LiteLLM
    api_key = _resolve_api_key(db, user_id, model)

    # Build context using the context engine (token budget + summarisation)
    ancestors = _node_path(db, conv_id, parent_id) if parent_id else []
    messages, auto_system_prompt = await build_context(ancestors, body.prompt, model, api_key)
    system_prompt = body.system_prompt if body.system_prompt else auto_system_prompt
    full_messages = [{"role": "system", "content": system_prompt}] + messages

    # Create node immediately so the frontend can reference it
    node_ref = (
        db.collection("conversations")
        .document(conv_id)
        .collection("nodes")
        .document(node_id)
    )
    node_ref.set({
        "id": node_id,
        "parent_id": parent_id,
        "children_ids": [],
        "prompt": body.prompt,
        "response": "",
        "model": model,
        "is_streaming": True,
        "created_at": fs.SERVER_TIMESTAMP,
    })

    if parent_id:
        (
            db.collection("conversations")
            .document(conv_id)
            .collection("nodes")
            .document(parent_id)
        ).update({"children_ids": ArrayUnion([node_id])})

    conv_ref = db.collection("conversations").document(conv_id)
    if is_root:
        conv_ref.update({"root_node_id": node_id, "updated_at": fs.SERVER_TIMESTAMP})
    else:
        conv_ref.update({"updated_at": fs.SERVER_TIMESTAMP})

    async def stream():
        full_response = ""
        try:
            kwargs: dict = {"model": model, "messages": full_messages, "stream": True}
            if api_key:
                kwargs["api_key"] = api_key
            response = await litellm.acompletion(**kwargs)
            async for chunk in response:
                content = chunk.choices[0].delta.content or ""
                if content:
                    full_response += content
                    yield f"data: {json.dumps({'type': 'chunk', 'content': content})}\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
            node_ref.update({"is_streaming": False, "response": f"[Error] {e}"})
            return

        # Persist completed node
        node_ref.update({"response": full_response, "is_streaming": False})

        # Flat copy for search
        db.collection("messages").document(str(uuid.uuid4())).set({
            "user_id": user_id,
            "conversation_id": conv_id,
            "node_id": node_id,
            "prompt": body.prompt,
            "response": full_response,
            "model": model,
            "created_at": fs.SERVER_TIMESTAMP,
        })

        yield f"data: {json.dumps({'type': 'done', 'node_id': node_id})}\n\n"

        # Auto-title: run inline after done so we can emit the result as an event
        if is_root:
            title = await _auto_title(body.prompt, full_response, model, api_key, conv_ref)
            if title:
                yield f"data: {json.dumps({'type': 'title', 'title': title})}\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
