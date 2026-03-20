# Nodal

A branching conversation interface for AI. Every reply can fork into new directions — explore every idea without losing context.

## Try it

Go to [nodal-4e6a0.web.app](https://nodal-4e6a0.web.app) and start a tree.

## What it does

Nodal treats conversations as trees, not threads. Ask a question, get a response, then branch off in multiple directions from any point. Two ways to navigate:

- **Chat view** -- a familiar linear thread with arrows to switch between branches
- **Tree view** -- a pannable, zoomable map of your entire conversation tree

Select any node, type a message, and a new branch grows from there. Delete a node and its children get re-parented. Collapse long prompts and responses to keep the map clean.

## Why trees beat threads

- **Cleaner context** -- Each branch carries only the context that led to it. No unrelated tangents polluting the conversation window, so the model gives sharper answers.
- **Explore without commitment** -- Wonder "what if I asked this differently?" Just branch. The original thread is still there, untouched. Compare approaches side by side.
- **Parallel research** -- Investigate multiple angles of a problem simultaneously. One branch digs into implementation, another into tradeoffs, a third into alternatives -- all from the same starting point.
- **No more copy-paste restarts** -- In a normal chat, changing direction means starting over or scrolling past irrelevant messages. Branching lets you pivot from any point without losing prior work.
- **Natural thought structure** -- Ideas don't flow in straight lines. A tree matches how you actually think -- diverge, explore, converge -- instead of forcing everything into a single scroll.
- **Reusable context anchors** -- Found a response that nails the setup for your problem? Branch from it ten different ways. That shared context becomes a launchpad, not a one-time message buried in history.

## Stack

- **Frontend** -- React + Tailwind, deployed to Firebase Hosting
- **Backend** -- FastAPI + LiteLLM, deployed to Cloud Run
- **Database** -- Firestore
- **Auth** -- Firebase Auth (Google sign-in)
- **Models** -- Groq, Google, OpenAI, Anthropic (server keys or bring your own)

## Run locally

```bash
# backend
cd backend
poetry install
poetry run uvicorn app.main:app --port 8001

# frontend
cd frontend
pnpm install
pnpm dev
```
