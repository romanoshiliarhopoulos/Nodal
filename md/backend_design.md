# Nodal Backend — Structure & DB Schema

## File Structure

```
backend/app/
  main.py             # FastAPI app, CORS, Firebase Admin init
  config.py           # Settings (pydantic-settings, reads .env)
  auth.py             # Identity dependencies (Firebase + anonymous session)
  db.py               # init_firebase() + get_db() → Firestore client
  encryption.py       # AES-256-GCM encrypt/decrypt + Secret Manager key fetch
  context_engine.py   # Token budget, hierarchical summarisation, system prompt
  models.py           # Pydantic request models
  routers/
    session.py        # GET /api/session
    chat.py           # Conversations + nodes + streaming
    keys.py           # BYOK key management
```

Run: `poetry run uvicorn app.main:app --reload --port 8001`

---

## Auth / Identity

Two identity models run in parallel.

**Anonymous (cookie)**
- `GET /api/session` — called on page load. If no cookie: generates UUID, creates `users` doc, sets `nodal_session` httpOnly cookie (1yr).
- Dependency `get_session_id` — reads cookie or raises 401.

**Firebase (Bearer token)**
- Frontend sends `Authorization: Bearer <firebase_id_token>`.
- Dependency `get_firebase_user` — verifies token via `firebase_admin.auth.verify_id_token()`, returns decoded token dict. Used by keys endpoints (requires a real uid).
- Dependency `get_user_id` — tries Bearer first, falls back to cookie. Used by all chat endpoints.

Keys endpoints always require Firebase auth. Chat endpoints accept either.

---

## Firestore Schema

### `users/{user_id}`

`user_id` is either the anonymous session UUID or the Firebase uid.

```
id:             string
is_anonymous:   bool
email:          string|null
default_model:  string              — e.g. "groq/llama-3.3-70b-versatile"
encrypted_keys: map                 — provider → {nonce: str, ct: str} (AES-256-GCM)
created_at:     timestamp
```

---

### `conversations/{conv_id}`

One document per conversation (= one tree).

```
id:           string
user_id:      string        — owner's uid or session_id
title:        string        — auto-generated from first exchange, or user-set
model:        string        — default model for this conversation
root_node_id: string|null   — null until first message is sent
created_at:   timestamp
updated_at:   timestamp     — bumped on every new node
```

---

### `conversations/{conv_id}/nodes/{node_id}`

Subcollection. Each node = one exchange: one user prompt + one assistant response.

```
id:           string
parent_id:    string|null   — null = root node
children_ids: string[]      — IDs of direct child nodes (branches)
prompt:       string        — user message
response:     string        — assistant response (empty while streaming)
model:        string        — model used for this specific node
is_streaming: bool          — true while response is being generated
created_at:   timestamp
```

**Tree rules:**
- `root_node_id` on the conversation is the only entry pointer needed
- Any node can have multiple children → each is an independent branch
- Siblings never share context; only the direct ancestor chain is passed to the model
- To branch: send a message with `parent_node_id` set to any existing node

---

### `messages/{message_id}`

Flat denormalized copy of every completed exchange. For search and analytics only — not used for rendering.

```
user_id:         string
conversation_id: string
node_id:         string
prompt:          string
response:        string
model:           string
created_at:      timestamp
```

---

## API Endpoints

### Session

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/session` | none | Init or retrieve session; sets cookie on first call |

### Chat

| Method | Path | Auth | Body | Description |
|--------|------|------|------|-------------|
| `POST` | `/api/chat/conversations` | cookie or Bearer | `{title?, model?}` | Create conversation |
| `GET` | `/api/chat/conversations` | cookie or Bearer | — | List user's conversations |
| `GET` | `/api/chat/conversations/{id}` | cookie or Bearer | — | Conversation doc + all nodes as `{id: node}` map |
| `PATCH` | `/api/chat/conversations/{id}` | cookie or Bearer | `{title}` | Rename conversation |
| `DELETE` | `/api/chat/conversations/{id}` | cookie or Bearer | — | Delete conversation, all nodes, all messages |
| `POST` | `/api/chat/conversations/{id}/nodes` | cookie or Bearer | `{prompt, parent_node_id?, model?}` | Send message, stream SSE response |

### Keys (BYOK)

| Method | Path | Auth | Body | Description |
|--------|------|------|------|-------------|
| `GET` | `/api/keys` | Firebase Bearer | — | List providers with stored keys (names only, no key material) |
| `POST` | `/api/keys` | Firebase Bearer | `{provider, api_key}` | Encrypt and store a key |
| `DELETE` | `/api/keys/{provider}` | Firebase Bearer | — | Remove a provider's key |

---

## Tree Traversal

The conversation document only stores `root_node_id`. The nodes form a complete bidirectional graph:

- **Down (render):** follow `children_ids` from root
- **Up (context):** follow `parent_id` from any node to root

`GET /conversations/{id}` returns all nodes as a flat `{node_id: node}` map. The frontend builds the visual tree from that.

---

## Context Management (`context_engine.py`)

On every `POST .../nodes`, the backend walks the ancestor chain and passes it through the context engine before calling LiteLLM.

### Token budget

```
budget = context_window[model] - 4096 (response reserve) - 512 (system prompt reserve)
```

Known context windows are defined in `CONTEXT_WINDOWS` dict. Unknown models fall back to 8192.

### Flow

```
_node_path(db, conv_id, parent_node_id)
  → follows parent_id upward to root, reverses → [root, ..., parent]

build_context(ancestors, new_prompt, model, api_key)
  → converts ancestors to [user, assistant, ...] messages
  → counts tokens via litellm.token_counter() (char-based fallback if unavailable)
  → if fits in budget: returns verbatim
  → if over budget: iteratively summarises oldest half of ancestors via a secondary
    LiteLLM call, keeping the 2 most recent exchanges verbatim
  → returns (messages, system_prompt)
```

### System prompt

Injected on every request. Tells the model its position in the tree:

```
"You are an AI assistant inside a branching conversation tree.
This branch is N exchange(s) deep. The root of this conversation was: "...".
You only see the direct ancestor path — sibling branches are not visible to you."
```

### Summarisation

When ancestors exceed the budget, the oldest nodes are compressed via:
```
model=same model, max_tokens=512
prompt: "Summarise the following conversation excerpt concisely..."
```
The summary replaces the raw nodes in context. Raw content is always preserved in Firestore.

**Phase 3 addition (planned):** embed each ancestor; rank by cosine similarity to current prompt; include top-K instead of recency-based truncation.

---

## Send Message Flow

1. Verify `conv.user_id == user_id` (ownership check)
2. Resolve API key: try to decrypt user's BYOK key for the model's provider → fall back to server env key if none stored
3. Walk `parent_node_id → root` via `_node_path()`
4. Call `build_context(ancestors, prompt, model, api_key)` → `(messages, system_prompt)`
5. Prepend `{role: system, content: system_prompt}` to messages
6. Write new node to Firestore immediately: `response: ""`, `is_streaming: true`
7. Attach `node_id` to `parent.children_ids` (ArrayUnion)
8. Set `conv.root_node_id` if first node; bump `conv.updated_at`
9. Stream via `litellm.acompletion(stream=True, api_key=user_key_or_none)`:
   - `{"type": "chunk", "content": "..."}` — each token
   - `{"type": "done", "node_id": "..."}` — stream complete
   - `{"type": "error", "message": "..."}` — on failure
10. On done: persist `node.response`, set `is_streaming: false`
11. Write to `messages` collection (flat copy)
12. Fire-and-forget `_auto_title()` if this was the root node

---

## BYOK Encryption (`encryption.py`)

Master key source (priority order):
1. **Google Cloud Secret Manager** — `GCP_PROJECT` + `SECRET_MANAGER_KEY_NAME` in `.env`
2. **`MASTER_KEY_DEV`** — base64-encoded 32 random bytes, local dev only

```
Generate local dev key:
  python -c "import os,base64; print(base64.urlsafe_b64encode(os.urandom(32)).decode())"
```

Each provider key is encrypted independently using **AES-256-GCM**:
- Random 12-byte nonce per encryption
- 16-byte authentication tag appended to ciphertext by GCM automatically
- Stored in Firestore as `{nonce: base64, ct: base64}`
- Plaintext key only exists in memory during the request; never logged or returned

The master key is cached in memory after first fetch (module-level singleton).

---

## LiteLLM

Model strings use `provider/model` format:

- `groq/llama-3.3-70b-versatile`
- `anthropic/claude-3-5-sonnet-20241022`
- `openai/gpt-4o`

Server-level env keys (`GROQ_API_KEY` etc.) are loaded into `os.environ` at startup as fallbacks. When a user has a BYOK key for the provider, it is passed directly as `api_key=` to `litellm.acompletion()` and takes priority.
