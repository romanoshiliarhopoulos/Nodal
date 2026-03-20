from pydantic import BaseModel
from typing import Optional


class ConversationCreate(BaseModel):
    title: Optional[str] = "New Conversation"
    model: Optional[str] = None


class ConversationUpdate(BaseModel):
    title: str


class SendMessageRequest(BaseModel):
    prompt: str
    parent_node_id: Optional[str] = None  # None = root; set to branch from a node
    model: Optional[str] = None
    system_prompt: Optional[str] = None   # Override the auto-generated system prompt


class KeyUpsert(BaseModel):
    provider: str   # "openai" | "anthropic" | "groq" | "google" | etc.
    api_key: str


class SystemPromptCreate(BaseModel):
    name: str
    content: str


class SystemPromptUpdate(BaseModel):
    name: str
    content: str


class SetActivePrompt(BaseModel):
    prompt_id: Optional[str] = None  # None = deactivate
