import { useState, useEffect } from "react";
import type { User } from "firebase/auth";

const API = import.meta.env.DEV ? "http://localhost:8001" : "";

const PROVIDERS = [
  { id: "groq", label: "Groq", placeholder: "gsk_..." },
  { id: "openai", label: "OpenAI", placeholder: "sk-..." },
  { id: "anthropic", label: "Anthropic", placeholder: "sk-ant-..." },
  { id: "gemini", label: "Google Gemini", placeholder: "AIza..." },
];

interface AccountPageProps {
  user: User;
  onClose: () => void;
}

export default function AccountPage({ user, onClose }: AccountPageProps) {
  const [storedProviders, setStoredProviders] = useState<string[]>([]);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState<Record<string, boolean>>({});

  async function getHeaders() {
    const token = await user.getIdToken();
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };
  }

  async function loadKeys() {
    try {
      const res = await fetch(`${API}/api/keys`, {
        credentials: "include",
        headers: await getHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setStoredProviders(data.providers ?? []);
      }
    } catch {}
  }

  useEffect(() => {
    loadKeys();
  }, []);

  async function saveKey(providerId: string) {
    const key = inputs[providerId]?.trim();
    if (!key) return;
    setSaving(providerId);
    setErrors((prev) => ({ ...prev, [providerId]: "" }));
    try {
      const res = await fetch(`${API}/api/keys`, {
        method: "POST",
        credentials: "include",
        headers: await getHeaders(),
        body: JSON.stringify({ provider: providerId, api_key: key }),
      });
      if (res.ok) {
        setStoredProviders((prev) =>
          prev.includes(providerId) ? prev : [...prev, providerId],
        );
        setInputs((prev) => ({ ...prev, [providerId]: "" }));
        setSuccess((prev) => ({ ...prev, [providerId]: true }));
        setTimeout(
          () => setSuccess((prev) => ({ ...prev, [providerId]: false })),
          2000,
        );
      } else {
        setErrors((prev) => ({ ...prev, [providerId]: "Failed to save key" }));
      }
    } catch {
      setErrors((prev) => ({ ...prev, [providerId]: "Network error" }));
    }
    setSaving(null);
  }

  async function deleteKey(providerId: string) {
    setDeleting(providerId);
    try {
      const res = await fetch(`${API}/api/keys/${providerId}`, {
        method: "DELETE",
        credentials: "include",
        headers: await getHeaders(),
      });
      if (res.ok) {
        setStoredProviders((prev) => prev.filter((p) => p !== providerId));
      }
    } catch {}
    setDeleting(null);
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/50" onClick={onClose} />

      {/* Slide-in panel */}
      <div className="w-[400px] bg-gray-950 border-l border-gray-800 flex flex-col overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h2 className="text-sm font-semibold text-gray-100">Account</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-gray-500 hover:text-gray-200 hover:bg-gray-800 transition-colors"
          >
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
              <path
                d="M2 2l11 11M13 2L2 13"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* Profile */}
        <div className="px-5 py-4 border-b border-gray-800 flex items-center gap-3">
          {user.photoURL ? (
            <img src={user.photoURL} className="w-9 h-9 rounded-full" alt="" />
          ) : (
            <div className="w-9 h-9 rounded-full bg-gray-700 flex items-center justify-center text-sm text-gray-300">
              {user.displayName?.[0] ?? "?"}
            </div>
          )}
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-200 truncate">
              {user.displayName}
            </p>
            <p className="text-xs text-gray-500 truncate">{user.email}</p>
          </div>
        </div>

        {/* BYOK */}
        <div className="px-5 py-5 flex-1">
          <div className="mb-5">
            <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wider mb-1">
              API Keys
            </h3>
            <p className="text-xs text-gray-600 leading-relaxed">
              Bring your own keys to use any supported model. Keys are AES-256
              encrypted before storage.
            </p>
          </div>

          <div className="space-y-3">
            {PROVIDERS.map((provider) => {
              const stored = storedProviders.includes(provider.id);
              return (
                <div
                  key={provider.id}
                  className="rounded-lg border border-gray-800 bg-gray-900 p-3"
                >
                  <div className="flex items-center justify-between mb-2.5">
                    <span className="text-xs font-medium text-gray-300">
                      {provider.label}
                    </span>
                    {stored && (
                      <div className="flex items-center gap-2.5">
                        <span className="flex items-center gap-1 text-xs text-emerald-500">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          stored
                        </span>
                        <button
                          onClick={() => deleteKey(provider.id)}
                          disabled={deleting === provider.id}
                          className="text-xs text-gray-600 hover:text-red-400 transition-colors disabled:opacity-50"
                        >
                          {deleting === provider.id ? "removing…" : "remove"}
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={inputs[provider.id] ?? ""}
                      onChange={(e) =>
                        setInputs((prev) => ({
                          ...prev,
                          [provider.id]: e.target.value,
                        }))
                      }
                      placeholder={
                        stored ? "Replace key…" : provider.placeholder
                      }
                      className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded-md px-2.5 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-500 transition-colors"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveKey(provider.id);
                      }}
                    />
                    <button
                      onClick={() => saveKey(provider.id)}
                      disabled={
                        saving === provider.id || !inputs[provider.id]?.trim()
                      }
                      className="shrink-0 px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-800 disabled:text-gray-600 text-xs text-white transition-colors"
                    >
                      {success[provider.id]
                        ? "Saved ✓"
                        : saving === provider.id
                          ? "Saving…"
                          : "Save"}
                    </button>
                  </div>
                  {errors[provider.id] && (
                    <p className="text-xs text-red-400 mt-1.5">
                      {errors[provider.id]}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
