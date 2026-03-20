# Nodal — Full Project Context & Architecture Brief

> This document captures the complete vision, design decisions, technical architecture, and reasoning for the Nodal project. It is intended to give any developer or AI agent working in this repo full context on what we are building and why.

---

## What is Nodal?

Nodal is a tree-based LLM chat interface. Instead of the standard linear chat model, every conversation is a **branching tree of nodes**. Users can branch off any node to start an independent line of thinking, explore alternatives, or run isolated sub-conversations — all while maintaining clear context inheritance from parent to child.

It is a serious thinking tool for power users, researchers, prompt engineers, writers, and developers — not a cozy AI assistant. The aesthetic and UX should reflect that: precise, technical, spatial.

---

## Core Concept

```
Root Node
    │
    ├── Branch A (exploring PostgreSQL)
    │       └── Branch A1 (optimising queries)
    │
    └── Branch B (exploring NoSQL)
            └── Branch B1 (Redis use case)
```

- Every node is a single exchange (user message + assistant response)
- Any node can spawn one or more child branches
- Context flows **down the ancestor path only** — siblings never share context
- A branch at node X receives context from X → its parent → root, nothing else
- This enables multiple independent lines of thought in one session without pollution

---

## Why This Is Interesting

The closest things to Nodal are janky prompt-tree tools buried in AI researcher GitHub repos. Nobody has built this well as a polished product. The core insight — **context should flow down a path, not across siblings** — is correct and commercially underexplored.

Target audience: power users doing complex multi-angle research, developers debugging branching problem spaces, writers doing worldbuilding, prompt engineers A/B testing responses.

---

## Business Model — Bring Your Own Key (BYOK)

Users provide their own API keys for the providers they want to use (Anthropic, OpenAI, Google, etc.). All model usage costs are billed directly to the user's accounts — not to Nodal. This means:

- Platform owner incurs **zero LLM API costs**
- Users get access to top-tier models (`claude-3-5-sonnet`, `gpt-4o`, `gemini-1.5-pro`, etc.)
- Users create their keys at the respective provider consoles and paste them into Nodal once
- Nodal stores the keys securely and uses them dynamically based on the model selected for each branch

---

## Key Features (Full Vision)

### Core (MVP)

- **Tree canvas** — spatial, pannable, zoomable node graph (React Flow)
- **Node branching** — any node can spawn a new child branch
- **Context inheritance** — only the ancestor path is passed as context, never siblings
- **Streaming responses** — per-node streaming, multiple nodes can stream simultaneously
- **Firebase Auth** — Google OAuth + Email/Password login

### High Value (Post-MVP)

- **Diff / Compare view** — select any two nodes, view side-by-side with highlighted semantic differences. Huge for prompt A/B testing
- **Auto-variant on regenerate** — hold Shift to regenerate into a sibling branch instead of overwriting. Collect multiple attempts without manual management
- **Multi-model branches** — send the same fork to Claude vs GPT-4o vs Gemini, compare in diff view. Killer research tool
- **Branch Synthesis / Merge nodes** — two branches collapse into one synthesising node that draws from both. Explored "monolith" in one branch, "microservices" in another? Get a nuanced synthesis
- **Execution nodes** — when the assistant returns code, one click turns it into a runnable node whose output becomes the next node. Code → test → debug as a tree
- **Auto-summarisation for deep trees** — compresses long ancestor chains before passing context, defeating context window limits gracefully
- **Branch Templates** — save any subtree as a reusable workflow (e.g. "debate template": pro branch → con branch → synthesis)
- **Semantic search** — find any node by meaning, not just text matching
- **Branch-scoped RAG** — attach a document corpus to a specific subtree. That branch gets retrieval access to those docs only

### Ambitious / Long-term

- **Branch export** — export any path as a clean linear markdown conversation
- **Public tree sharing** — share a read-only link to any subtree

---

## Technical Architecture

### System Overview

```
React Frontend (Firebase Hosting)
        │
        │  Firebase Auth SDK
        │  → Login via Google OAuth or Email/Password
        │  → Issues Firebase ID Token per session
        │
        ▼
FastAPI Backend (Cloud Run)
        │
        ├── Middleware: Verify Firebase ID Token (firebase-admin)
        │
        ├── POST  /keys          → Encrypt + store user's API keys (Anthropic, OpenAI, etc.)
        ├── DELETE /keys         → Remove stored key
        ├── POST  /chat          → Build context → call LiteLLM → stream response
        ├── POST  /branch        → Create a new child node
        └── GET   /tree/{id}     → Fetch full tree structure
                │
                ▼
        LiteLLM Interface
                │
                ├── Anthropic API
                ├── OpenAI API
                └── Google Gemini API
                (billed to user's own stored keys)

Firestore
  ├── trees/{tree_id}                ← tree metadata
  ├── nodes/{node_id}               ← individual node content
  └── users/{uid}/encrypted_keys    ← encrypted blob mapping provider to key

pgvector (via Supabase)
  └── embeddings per node/branch    ← for semantic search + RAG

Google Secret Manager
  └── nodal-encryption-master-key   ← AES master key, never in code or DB
```

---

## The Context Engine (Core Technical Differentiator)

This is the most important and original engineering in the project. Naive context building — just concatenating all ancestors — breaks fast on deep trees. The context engine handles this intelligently.

### Context Building Strategy

On every generation request, the backend:

1. **Walks the ancestor path** from the target node back to root
2. **Calculates token budget** — split across: system prompt, ancestor path, retrieved docs
3. **Scores each ancestor** for relevance to the current node using embeddings
4. **Truncates or summarises** older nodes if budget is exceeded
5. **Injects branch metadata** into the system prompt so the model is aware of its position in the tree

### Hierarchical Summarisation

When a branch exceeds N tokens:

- The oldest nodes are compressed into a rolling summary node
- The compression prompt is carefully written to preserve the most decision-relevant content
- The summary node replaces the raw content in context but the raw content is preserved in Firestore

### Selective Context Injection

Rather than injecting every ancestor regardless of relevance:

- Each ancestor node is embedded
- Top-K most semantically relevant ancestors to the current prompt are selected
- This is smarter than recency-based truncation for deeply branched trees

### Tree-Aware Prompt Construction

The system prompt tells the model about its position in the tree:

```
You are continuing a conversation that branched from a parent discussion about [topic].
The sibling branch explored [X]. This branch focuses on [Y].
Your ancestor context is provided below in order from root to current node.
```

This gives the model genuine self-awareness about the tree structure, which improves coherence.

---

## Security Architecture

### Why Backend-Only Key Handling

- Keys in `localStorage` are vulnerable to XSS
- Keys in client-side code are trivially extractable
- The backend is the only layer that ever touches plaintext keys

### Encryption: AES-256-GCM

1. User submits Anthropic API key via frontend settings UI
2. Frontend sends it over HTTPS to `POST /keys`
3. Backend fetches master encryption secret from **Google Cloud Secret Manager**
4. Backend encrypts with **AES-256-GCM** (authenticated encryption)
5. Encrypted blob stored in Firestore under user's Firebase UID
6. Plaintext key is never logged, persisted, or returned to client

On each chat request:

- Backend decrypts the key in memory
- Makes the Anthropic API call
- Discards plaintext from memory after the request

### What Gets Stored Where

| Data                  | Location                    | Format                                              |
| --------------------- | --------------------------- | --------------------------------------------------- |
| User identity         | Firebase Auth               | Managed by Firebase                                 |
| Encrypted API keys    | Firestore                   | AES-256-GCM encrypted blob (JSON of providers/keys) |
| Master encryption key | Google Cloud Secret Manager | Raw secret, never in code                           |
| Plaintext API keys    | Nowhere persisted           | In memory only, per-request                         |
| Tree + node content   | Firestore                   | Plaintext (user owns their content)                 |
| Node embeddings       | pgvector / Supabase         | Float vectors                                       |

### Additional Security Practices

- Never log `Authorization` headers or any header containing the key
- Never return the key or any portion of it to the client
- Rate limit `/chat` per user
- Users can rotate or delete their key at any time
- All traffic is HTTPS only — key never passed via URL params
- GCP automatically audit-logs all Secret Manager accesses

---

## Tech Stack

| Layer            | Technology                                    | Reason                                                                         |
| ---------------- | --------------------------------------------- | ------------------------------------------------------------------------------ |
| Frontend         | React + TypeScript                            | Familiar, type-safe, component-driven                                          |
| Tree canvas      | React Flow                                    | Handles node/edge graph rendering, highly extensible                           |
| LLM Gateway      | LiteLLM (Python)                              | Unified OpenAI-compatible interface for calling Anthropic, GPT-4, Gemini, etc. |
| Frontend hosting | Firebase Hosting                              | Natural fit with Firebase Auth                                                 |
| Backend          | Python + FastAPI                              | Familiar, async, fast                                                          |
| Backend hosting  | Google Cloud Run                              | Serverless containers, scales to zero, GCP-native                              |
| Auth             | Firebase Auth (Email/Password + Google OAuth) | Both auth methods, stateless token verification                                |
| Primary database | Firestore                                     | GCP-native, real-time capable, schemaless                                      |
| Vector database  | pgvector via Supabase                         | Keeps vectors in Postgres — no separate service needed at this scale           |
| Secret storage   | Google Cloud Secret Manager                   | Audit logs, rotation, native Cloud Run IAM integration                         |
| Encryption       | AES-256-GCM                                   | Industry standard authenticated symmetric encryption                           |

---

## Auth Flow

### Login

1. User signs in via Firebase Auth SDK (Google OAuth or Email/Password)
2. Firebase issues a short-lived ID token (JWT, 1hr expiry, auto-refreshed)
3. Frontend attaches token to every backend request:
   ```
   Authorization: Bearer <firebase_id_token>
   ```

### Backend Verification

Every protected route:

1. Extracts the `Authorization` header
2. Calls `firebase_admin.auth.verify_id_token(token)`
3. Extracts `uid` — the user's stable identifier
4. Uses `uid` as the Firestore key — users can only ever access their own data
5. Returns `401` if token is invalid or expired

---

## API Endpoints

| Method   | Path                      | Description                                                           |
| -------- | ------------------------- | --------------------------------------------------------------------- |
| `POST`   | `/keys`                   | Encrypt + store user's API keys (JSON payload for multiple providers) |
| `DELETE` | `/keys`                   | Remove user's stored keys                                             |
| `POST`   | `/chat`                   | Build context for node → call LiteLLM router → stream response        |
| `POST`   | `/trees`                  | Create a new tree                                                     |
| `GET`    | `/trees/{tree_id}`        | Fetch full tree with all nodes                                        |
| `POST`   | `/nodes/{node_id}/branch` | Create a new child branch from a node                                 |
| `GET`    | `/search`                 | Semantic search across user's nodes                                   |

---

## AI Backend — Learning Opportunities (Priority Order)

These are the technically interesting problems unique to this project, in the order they should be tackled:

1. **Context window management + summarisation** — the core differentiator, no Stack Overflow answer for tree-shaped conversations
2. **Streaming multi-node state** — multiple nodes streaming simultaneously without clobbering each other, using SSE or WebSockets keyed per-node
3. **pgvector + basic RAG** — stay in Postgres, use Supabase, avoid a separate vector DB until necessary
4. **Semantic diffing** — embedding-based meaning-level diffs between two branches for the compare view
5. **Branch-scoped RAG with reranking** — namespaced vector retrieval per subtree, Cohere reranker to re-score retrieved chunks before injecting into context
6. **Synthesis prompting** — reliably getting the model to synthesise two conflicting branch perspectives without collapsing to one side
7. **CRDT collaboration (Yjs)** — for real-time multi-user editing, ambitious but valuable distributed systems education

---

## Branding & Design Direction

- **Name:** Nodal
- **Aesthetic:** Precise, technical, spatial. Monospace accents, node/graph visual motifs, dark mode default. Not a cozy assistant — a serious thinking tool.
- **Logo concept:** Three nodes in a branching pattern, clean weight, no gradients
- **Domain targets:** nodal.app, nodal.chat, trynodal.com

---

## Pricing Model (Planned)

| Tier | Price          | Limits                                                     |
| ---- | -------------- | ---------------------------------------------------------- |
| Free | $0             | Limited trees + nodes, bring your own key                  |
| Pro  | $X/mo          | Unlimited trees + nodes, branch templates, semantic search |
| Team | $X/mo per seat | Shared trees, collaboration, admin controls                |

_Exact limits TBD based on infrastructure cost modelling._

---

## Deployment

| Layer    | Service                                                          |
| -------- | ---------------------------------------------------------------- |
| Frontend | Firebase Hosting (`firebase deploy --only hosting`)              |
| Backend  | Cloud Run (`gcloud run deploy nodal-backend --source ./backend`) |
| Secrets  | Google Cloud Secret Manager                                      |
| Database | Firestore (managed)                                              |
| Vectors  | Supabase with pgvector (managed)                                 |

**IAM requirements for Cloud Run service account:**

- `Secret Manager Secret Accessor` — to read encryption key
- `Cloud Datastore User` — to read/write Firestore
- `Service Account Token Creator` — to verify Firebase tokens

---

## Local Development

```bash
# Frontend
cd frontend
npm install
npm run dev          # http://localhost:5173

# Backend
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload   # http://localhost:8001
```

**frontend/.env.local**

```
VITE_API_BASE_URL=http://localhost:8001
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
```

**backend/.env**

```
GOOGLE_CLOUD_PROJECT=your-gcp-project-id
SECRET_MANAGER_KEY_NAME=nodal-encryption-master-key
FIREBASE_SERVICE_ACCOUNT_PATH=./service-account.json
SUPABASE_DB_URL=...
```

---

## Build Order (Suggested)

### Phase 1 — Foundation (Weeks 1–2)

- [ ] Firebase project: enable Auth (Google + Email), create Firestore DB
- [ ] GCP project: enable Secret Manager + Cloud Run APIs, create service account
- [ ] FastAPI scaffold with Firebase token middleware
- [ ] Encryption service (AES-256-GCM via Secret Manager)
- [ ] `POST /keys` and `DELETE /keys` routes
- [ ] Basic React app with Firebase Auth (login/logout)
- [ ] Key input settings page

### Phase 2 — Core Product (Weeks 3–5)

- [ ] Firestore tree + node data model
- [ ] `POST /trees`, `GET /trees/{id}`, `POST /nodes/{id}/branch`
- [ ] Context engine (`context_engine.py`) — ancestor traversal + token budget
- [ ] `POST /chat` with streaming, per-node SSE
- [ ] React Flow canvas — render tree, pan/zoom, add nodes
- [ ] Node component — display message, trigger branch, show streaming state

### Phase 3 — Intelligence (Weeks 6–8)

- [ ] Hierarchical summarisation for deep trees
- [ ] pgvector embeddings per node (Supabase)
- [ ] Semantic search (`GET /search`)
- [ ] Diff / compare view for two selected nodes
- [ ] Branch-scoped RAG + Cohere reranking

### Phase 4 — Product Polish (Weeks 9–10)

- [ ] Branch synthesis / merge node
- [ ] Branch templates
- [ ] Multi-model branch support
- [ ] Auto-variant on regenerate (Shift+Regen → sibling branch)
- [ ] Execution nodes for code responses

### Phase 5 — Launch (Weeks 11–12)

- [ ] Stripe integration + pricing tiers
- [ ] Landing page
- [ ] Cloud Run production deployment
- [ ] Firebase Hosting production deployment
- [ ] Product Hunt launch prep

---

## Key Decisions Log

| Decision           | Chosen Approach                                  | Reason                                              |
| ------------------ | ------------------------------------------------ | --------------------------------------------------- |
| Core UX paradigm   | Tree-based branching chat                        | Solves context pollution in multi-angle exploration |
| Cost model         | BYOK — user's own Anthropic key                  | Platform owner incurs zero LLM costs                |
| Key handling       | Backend only, never frontend                     | XSS safety, full control                            |
| Encryption         | AES-256-GCM                                      | Industry standard authenticated encryption          |
| Master key storage | Google Cloud Secret Manager                      | GCP-native, auditable, no plaintext in code         |
| Auth               | Firebase Auth (Google + Email/Password)          | Both methods, stateless token verification          |
| Backend hosting    | Cloud Run                                        | Serverless, scales to zero, GCP-native              |
| Vector DB          | pgvector via Supabase                            | No separate service until scale requires it         |
| Canvas library     | React Flow                                       | Best-in-class node/edge graph for React             |
| Repo structure     | Monorepo                                         | Easier to manage, shared context                    |
| Context strategy   | Hierarchical summarisation + selective injection | Defeats context limits without naive truncation     |

---

_Last updated: March 2026 — reflects full product vision, architecture, and planning discussions for Nodal v1._
