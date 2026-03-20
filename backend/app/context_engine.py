"""
Context engine: builds the LiteLLM message list for a node given its ancestor chain.

Responsibilities:
  - Token counting per model
  - Enforcing a token budget (context window - response reserve)
  - Hierarchical summarisation when ancestors exceed the budget
  - Tree-aware system prompt injection
"""

from typing import Optional
import litellm

# Known context windows in tokens. Falls back to DEFAULT_CONTEXT_WINDOW if unknown.
CONTEXT_WINDOWS: dict[str, int] = {
    "groq/llama-3.3-70b-versatile": 128_000,
    "groq/llama-3.1-8b-instant": 128_000,
    "groq/mixtral-8x7b-32768": 32_768,
    "anthropic/claude-3-5-sonnet-20241022": 200_000,
    "anthropic/claude-3-5-haiku-20241022": 200_000,
    "anthropic/claude-3-opus-20240229": 200_000,
    "openai/gpt-4o": 128_000,
    "openai/gpt-4o-mini": 128_000,
    "openai/gpt-4-turbo": 128_000,
    "openai/o1": 200_000,
    "openai/o3-mini": 200_000,
    "gemini/gemini-3-pro-preview":                  1_048_576,
    "gemini/gemini-2.5-pro":                        1_048_576,
    "gemini/gemini-2.5-flash-preview-04-17":        1_048_576,
    "gemini/gemini-2.0-flash-lite":                 1_048_576,
    "gemini/gemini-2.0-flash-thinking-exp-01-21":   1_048_576,
    "gemini/gemini-1.5-pro":                        1_048_576,
    "gemini/gemini-1.5-flash":                      1_048_576,
}

DEFAULT_CONTEXT_WINDOW = 8_192
RESPONSE_RESERVE = 4_096   # tokens reserved for the model's response
SYSTEM_RESERVE = 512        # tokens reserved for the system prompt


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _token_budget(model: str) -> int:
    window = CONTEXT_WINDOWS.get(model, DEFAULT_CONTEXT_WINDOW)
    return window - RESPONSE_RESERVE - SYSTEM_RESERVE


def _count_tokens(messages: list[dict], model: str) -> int:
    try:
        return litellm.token_counter(model=model, messages=messages)
    except Exception:
        # Rough fallback: ~4 chars per token
        return sum(len(m.get("content", "")) for m in messages) // 4


def _system_prompt(ancestors: list[dict]) -> str:
    if not ancestors:
        return "You are a helpful AI assistant."
    depth = len(ancestors)
    root_topic = ancestors[0].get("prompt", "")[:120].rstrip()
    return (
        f"You are an AI assistant inside a branching conversation tree. "
        f"This branch is {depth} exchange(s) deep. "
        f'The root of this conversation was: "{root_topic}". '
        f"You only see the direct ancestor path — sibling branches are not visible to you. "
        f"Your ancestor context is provided below in order from oldest to most recent."
    )


def _ancestors_to_messages(ancestors: list[dict]) -> list[dict]:
    msgs: list[dict] = []
    for node in ancestors:
        msgs.append({"role": "user", "content": node["prompt"]})
        if node.get("response"):
            msgs.append({"role": "assistant", "content": node["response"]})
    return msgs


async def _summarise(
    nodes: list[dict],
    model: str,
    api_key: Optional[str],
) -> str:
    """Compress a list of nodes into a concise rolling summary."""
    text = "\n\n".join(
        f"User: {n['prompt']}\nAssistant: {n.get('response', '[no response]')}"
        for n in nodes
    )
    msgs = [
        {
            "role": "system",
            "content": (
                "Summarise the following conversation excerpt concisely. "
                "Preserve key facts, decisions, code snippets, and any context "
                "that would be needed to continue the conversation coherently. "
                "Be brief — this summary will be injected into a future context window."
            ),
        },
        {"role": "user", "content": text},
    ]
    kwargs: dict = {"model": model, "messages": msgs, "max_tokens": 512}
    if api_key:
        kwargs["api_key"] = api_key
    resp = await litellm.acompletion(**kwargs)
    return resp.choices[0].message.content.strip()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def build_context(
    ancestors: list[dict],
    new_prompt: str,
    model: str,
    api_key: Optional[str] = None,
) -> tuple[list[dict], str]:
    """
    Build (messages, system_prompt) for a LiteLLM call.

    The returned `messages` does NOT include the system prompt — caller should
    prepend {"role": "system", "content": system_prompt} before calling LiteLLM.

    If the ancestor chain fits within the model's token budget, it is included
    verbatim. If it overflows, the oldest ancestors are iteratively summarised
    until the context fits, always keeping the MIN_VERBATIM most recent
    exchanges verbatim for coherence.
    """
    system_prompt = _system_prompt(ancestors)
    budget = _token_budget(model)

    messages = _ancestors_to_messages(ancestors) + [{"role": "user", "content": new_prompt}]
    if _count_tokens(messages, model) <= budget:
        return messages, system_prompt

    # Over budget: iteratively summarise the oldest nodes until we fit.
    # Always keep the MIN_VERBATIM most recent exchanges verbatim.
    MIN_VERBATIM = 2
    summaries: list[str] = []
    remaining = list(ancestors)

    while remaining and _count_tokens(messages, model) > budget:
        # If only MIN_VERBATIM (or fewer) nodes left, we can't compress further
        if len(remaining) <= MIN_VERBATIM:
            break

        # Compress the oldest half (minus the verbatim tail)
        compressible = len(remaining) - MIN_VERBATIM
        batch_size = max(1, compressible // 2)
        batch, remaining = remaining[:batch_size], remaining[batch_size:]

        summary = await _summarise(batch, model, api_key)
        summaries.append(summary)

        # Rebuild: collapsed summary block + remaining verbatim ancestors + new prompt
        combined_summary = "\n\n---\n\n".join(summaries)
        messages = (
            [
                {
                    "role": "user",
                    "content": f"[Summary of earlier conversation]\n{combined_summary}",
                },
                {
                    "role": "assistant",
                    "content": "Understood, I have the context from the earlier part of our conversation.",
                },
            ]
            + _ancestors_to_messages(remaining)
            + [{"role": "user", "content": new_prompt}]
        )

    return messages, system_prompt
