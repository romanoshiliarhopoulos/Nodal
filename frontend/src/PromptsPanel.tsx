import { useState, useEffect } from "react";
import type { User } from "firebase/auth";

const API = import.meta.env.DEV ? "http://localhost:8001" : "";

export interface SystemPrompt {
  id: string;
  name: string;
  content: string;
}

async function apiHeaders(user: User): Promise<Record<string, string>> {
  const token = await user.getIdToken();
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

interface PromptsPanelProps {
  user: User | null;
  onSelectPrompt: (content: string | null) => void;
  onClose: () => void;
}

export default function PromptsPanel({
  user,
  onSelectPrompt,
  onClose,
}: PromptsPanelProps) {
  const [prompts, setPrompts] = useState<SystemPrompt[]>([]);
  const [activePromptId, setActivePromptId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    loadPrompts();
  }, [user]);

  async function loadPrompts() {
    if (!user) return;
    setLoading(true);
    try {
      const headers = await apiHeaders(user);
      const res = await fetch(`${API}/api/prompts`, {
        credentials: "include",
        headers,
      });
      if (res.ok) {
        const data = await res.json();
        setPrompts(data.prompts ?? []);
        const aid = data.active_prompt_id ?? null;
        setActivePromptId(aid);
        if (aid) {
          const active = (data.prompts ?? []).find(
            (p: SystemPrompt) => p.id === aid,
          );
          if (active) onSelectPrompt(active.content);
        }
      }
    } catch {}
    setLoading(false);
  }

  async function createPrompt(name: string, content: string) {
    if (!user) return;
    const headers = await apiHeaders(user);
    const res = await fetch(`${API}/api/prompts`, {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify({ name, content }),
    });
    if (res.ok) {
      const p: SystemPrompt = await res.json();
      setPrompts((prev) => [...prev, p]);
      setCreating(false);
    }
  }

  async function updatePrompt(id: string, name: string, content: string) {
    if (!user) return;
    const headers = await apiHeaders(user);
    const res = await fetch(`${API}/api/prompts/${id}`, {
      method: "PUT",
      credentials: "include",
      headers,
      body: JSON.stringify({ name, content }),
    });
    if (res.ok) {
      setPrompts((prev) =>
        prev.map((p) => (p.id === id ? { ...p, name, content } : p)),
      );
      setEditingId(null);
      if (activePromptId === id) onSelectPrompt(content);
    }
  }

  async function deletePrompt(id: string) {
    if (!user) return;
    const headers = await apiHeaders(user);
    const res = await fetch(`${API}/api/prompts/${id}`, {
      method: "DELETE",
      credentials: "include",
      headers,
    });
    if (res.ok) {
      setPrompts((prev) => prev.filter((p) => p.id !== id));
      if (activePromptId === id) {
        setActivePromptId(null);
        onSelectPrompt(null);
      }
    }
  }

  async function selectPrompt(id: string) {
    if (!user) return;
    const headers = await apiHeaders(user);
    if (activePromptId === id) {
      await fetch(`${API}/api/prompts/active`, {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify({ prompt_id: null }),
      });
      setActivePromptId(null);
      onSelectPrompt(null);
    } else {
      const p = prompts.find((p) => p.id === id);
      if (!p) return;
      await fetch(`${API}/api/prompts/active`, {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify({ prompt_id: id }),
      });
      setActivePromptId(id);
      onSelectPrompt(p.content);
    }
  }

  if (!user) {
    return (
      <div className="flex flex-col flex-1 h-full bg-gray-950 items-center justify-center">
        <p className="text-gray-500 text-sm">
          Sign in to save and manage system prompts.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 h-full bg-gray-950">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-5">
        <svg
          width="18"
          height="18"
          viewBox="0 0 18 18"
          fill="none"
          className="text-gray-500 shrink-0"
        >
          <path
            d="M2 3h14v3l-7 5.5V17l-3-1.5V11.5L2 6V3z"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
        <h1 className="text-lg font-semibold text-gray-100">System Prompts</h1>
        {activePromptId && (
          <span className="w-2 h-2 rounded-full bg-indigo-400 shrink-0" />
        )}
        <div className="flex-1" />
        <button
          onClick={() => {
            setCreating(true);
            setEditingId(null);
          }}
          className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors px-3 py-1.5 rounded-lg hover:bg-indigo-500/10"
        >
          + New
        </button>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-gray-500 hover:text-gray-200 hover:bg-gray-800 transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M3 3l10 10M13 3L3 13"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              className="text-gray-700 animate-spin"
            >
              <circle
                cx="10"
                cy="10"
                r="8"
                stroke="currentColor"
                strokeWidth="2"
                strokeDasharray="30 20"
              />
            </svg>
          </div>
        ) : (
          <>
            {creating && (
              <PromptEditForm
                initialName=""
                initialContent=""
                onSave={createPrompt}
                onCancel={() => setCreating(false)}
              />
            )}

            {prompts.length === 0 && !creating && (
              <div className="flex flex-col items-center justify-center h-64 text-center">
                <p className="text-gray-600 text-sm mb-3">
                  No system prompts yet.
                </p>
                <button
                  onClick={() => setCreating(true)}
                  className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
                >
                  Create your first prompt
                </button>
              </div>
            )}

            <div className="space-y-2">
              {prompts.map((p) =>
                editingId === p.id ? (
                  <PromptEditForm
                    key={p.id}
                    initialName={p.name}
                    initialContent={p.content}
                    onSave={(name, content) =>
                      updatePrompt(p.id, name, content)
                    }
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <div
                    key={p.id}
                    className={`group rounded-xl px-4 py-3.5 cursor-pointer transition-colors ${
                      activePromptId === p.id
                        ? "bg-indigo-500/10 border border-indigo-500/30"
                        : "bg-gray-900/50 border border-gray-800 hover:border-gray-700"
                    }`}
                    onClick={() => selectPrompt(p.id)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-sm font-medium ${activePromptId === p.id ? "text-indigo-300" : "text-gray-200"}`}
                          >
                            {p.name}
                          </span>
                          {activePromptId === p.id && (
                            <span className="text-[10px] text-indigo-400 bg-indigo-500/15 px-1.5 py-0.5 rounded-full">
                              Active
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 mt-1.5 line-clamp-3 leading-relaxed">
                          {p.content}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingId(p.id);
                            setCreating(false);
                          }}
                          className="p-1.5 rounded-lg text-gray-600 hover:text-gray-300 hover:bg-gray-800 transition-colors"
                          title="Edit"
                        >
                          <svg
                            width="13"
                            height="13"
                            viewBox="0 0 13 13"
                            fill="none"
                          >
                            <path
                              d="M9 1.5l2.5 2.5L4 11.5H1.5V9L9 1.5z"
                              stroke="currentColor"
                              strokeWidth="1.1"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deletePrompt(p.id);
                          }}
                          className="p-1.5 rounded-lg text-gray-600 hover:text-red-400 hover:bg-gray-800 transition-colors"
                          title="Delete"
                        >
                          <svg
                            width="13"
                            height="13"
                            viewBox="0 0 13 13"
                            fill="none"
                          >
                            <path
                              d="M2 3.5h9M5 3.5V3h3v.5M4.5 3.5l.5 7h3l.5-7"
                              stroke="currentColor"
                              strokeWidth="1.1"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                ),
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PromptEditForm({
  initialName,
  initialContent,
  onSave,
  onCancel,
}: {
  initialName: string;
  initialContent: string;
  onSave: (name: string, content: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [content, setContent] = useState(initialContent);

  return (
    <div className="mb-4 rounded-xl border border-gray-700 bg-gray-900 p-4 space-y-3">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Prompt name…"
        autoFocus
        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-500 transition-colors"
      />
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="You are a helpful assistant that…"
        rows={5}
        className="w-full resize-none bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-500 transition-colors leading-relaxed"
      />
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={onCancel}
          className="text-sm text-gray-600 hover:text-gray-400 transition-colors px-3 py-1.5"
        >
          Cancel
        </button>
        <button
          onClick={() => onSave(name, content)}
          disabled={!name.trim() || !content.trim()}
          className="text-sm px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-800 disabled:text-gray-600 text-white transition-colors"
        >
          Save
        </button>
      </div>
    </div>
  );
}
