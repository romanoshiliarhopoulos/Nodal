# Nodal Backend Architecture & Integration Guide

This document outlines the design of the FastAPI backend for Nodal, focusing on multi-user isolation, secure Bring Your Own Key (BYOK) handling, LiteLLM integration, and real-time streaming with advanced model features like "thinking".

---

## 1. Project Setup & Dependency Management (Poetry)

We use Poetry to manage the Python environment and dependencies to ensure deterministic, reproducible builds.

### Initializing the Backend

```bash
cd backend
poetry init
# Add the core dependencies:
poetry add fastapi uvicorn litellm
poetry add sse-starlette pydantic
poetry add firebase-admin google-cloud-firestore google-cloud-secret-manager
poetry add cryptography  # For AES backend encryption
```

**To run the server locally:**

```bash
poetry run uvicorn app.main:app --reload
```

---

## 2. Infrastructure Prerequisites (Action Required!)

Before writing the Auth logic, you must manually set up the following cloud services:

1. **Firebase Project**:
   - Go to the Firebase Console -> Add Project.
   - Enable **Authentication** (Google OAuth and Email/Password).
   - Generate a **Service Account Private Key** (JSON) from Project Settings -> Service Accounts. Save this locally strictly for testing (do not commit it).
2. **Google Cloud Platform (GCP)**:
   - Your Firebase project is also a GCP project. Enable the **Cloud Firestore API** and **Secret Manager API**.
   - Create a Master Secret in Secret Manager called `nodal-encryption-master-key`.
   - Setup Cloud Run IAM permissions later during deployment.

---

## 3. Multi-User Authentication & API Design

FastAPI will verify JSON Web Tokens (JWT) issued by Firebase from the frontend. This ensures we safely isolate users and only access the databases (Firestore) scoped to their `uid`.

### Auth Middleware / Dependency

```python
# app/auth.py
from fastapi import Depends, HTTPException, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import firebase_admin
from firebase_admin import credentials, auth

# Initialize Firebase (Requires the service account JSON in dev, auto-detects in prod)
cred = credentials.Certificate("service-account-file.json")
firebase_admin.initialize_app(cred)

security = HTTPBearer()

def get_current_user(credentials: HTTPAuthorizationCredentials = Security(security)):
    token = credentials.credentials
    try:
        decoded_token = auth.verify_id_token(token)
        # Returns the decoded token containing the user's robust `uid`
        return decoded_token
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid auth credentials")
```

### Example Protected Endpoint

```python
from fastapi import APIRouter, Depends

router = APIRouter()

@router.get("/trees")
async def get_user_trees(user: dict = Depends(get_current_user)):
    uid = user["uid"]
    # Fetch trees ONLY belonging to this uid from Firestore
    trees = fetch_trees_for_user(uid)
    return trees
```

---

## 4. LiteLLM Integration & Model Routing

LiteLLM forces all providers into the OpenAI API format. To support BYOK, we pass the user's decrypted key at call-time.

```python
# app/llm_gateway.py
import litellm

# Provide an abstraction for the rest of your app
async def get_llm_stream(messages: list, model_name: str, api_key: str):
    """
    model_name format examples:
        - 'gpt-4o'
        - 'anthropic/claude-3-opus-20240229'
        - 'gemini/gemini-1.5-pro'
    """
    response = await litellm.acompletion(
        model=model_name,
        messages=messages,
        api_key=api_key,
        stream=True
    )
    return response
```

---

## 5. Streaming Design & "Thinking" Bytes

When users talk to a modern AI chatbot, they see the text spool out character by character. To achieve this, your backend needs to return a **Server-Sent Events (SSE)** stream.

Furthermore, newer reasoning models (like `claude-3-7-sonnet` with thinking enabled or `o1/o3-mini`) output internal monologue / reasoning tokens _before_ their final answer. LiteLLM normalizes these into a `reasoning_content` field. We want to stream both so the frontend can build a cool expanding "Thinking" UI block.

### The Chat Stream Endpoint

```python
# app/routers/chat.py
from fastapi import APIRouter, Depends
from sse_starlette.sse import EventSourceResponse
import json

router = APIRouter()

async def generate_chat_events(messages, model, api_key):
    try:
        stream = await get_llm_stream(messages, model, api_key)

        async for chunk in stream:
            # LiteLLM yields a chunk object mimicking OpenAI's structure
            delta = chunk.choices[0].delta

            # Check for AI "Thinking" or reasoning strings
            if hasattr(delta, 'reasoning_content') and delta.reasoning_content:
                yield {
                    "event": "message",
                    "data": json.dumps({"type": "reasoning", "content": delta.reasoning_content})
                }

            # Check for standard response text
            elif hasattr(delta, 'content') and delta.content:
                yield {
                    "event": "message",
                    "data": json.dumps({"type": "content", "content": delta.content})
                }

        # Send a final termination event
        yield {
            "event": "done",
            "data": json.dumps({"type": "done", "content": ""})
        }

    except Exception as e:
        yield {
            "event": "error",
            "data": json.dumps({"error": str(e)})
        }

@router.post("/chat/{node_id}")
async def chat(node_id: str, payload: dict, user: dict = Depends(get_current_user)):
    uid = user["uid"]
    model = payload.get("model")

    # 1. Decrypt keys
    keys = get_decrypted_user_keys(uid)
    provider = model.split("/")[0] if "/" in model else "openai"
    api_key = keys.get(provider)

    # 2. Rebuild the context specific to THIS node / branch trajectory
    messages = build_context_for_node(node_id, uid)

    # 3. Stream back to the frontend using SSE
    return EventSourceResponse(generate_chat_events(messages, model, api_key))
```

---

## 6. Frontend Interface Contract

With the SSE endpoint created, your React frontend will consume this byte-by-byte using the native browser `EventSource` API or libraries like `@microsoft/fetch-event-source` (which allows POST requests).

### React Pseudo-Code Integration

```javascript
import { fetchEventSource } from "@microsoft/fetch-event-source";

async function streamResponse(nodeId, model, userAuthToken) {
  let textContent = "";
  let thinkingContent = "";

  await fetchEventSource(`https://api.nodal.app/chat/${nodeId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userAuthToken}`, // Firebase Token
    },
    body: JSON.stringify({ model: model }),
    onmessage(msg) {
      if (msg.event === "done") {
        console.log("Stream finished");
        return;
      }

      const payload = JSON.parse(msg.data);
      if (payload.type === "reasoning") {
        thinkingContent += payload.content;
        updateThinkingComponent(thinkingContent);
      } else if (payload.type === "content") {
        textContent += payload.content;
        updateMessageBubble(textContent);
      }
    },
  });
}
```

### Final Next Steps for Backend

1. **Initialize Poetry** under the `backend` folder as configured above.
2. Initialize **Firebase and GCP Settings**.
3. Let me know when you've done those steps, and we can begin drafting the AES encryption layer for storing keys!
