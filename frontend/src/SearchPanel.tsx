import { useState, useRef, useEffect } from "react";
import type { User } from "firebase/auth";
import type { Conversation } from "./types";

const API = import.meta.env.DEV ? "http://localhost:8001" : "";

interface SearchResult {
  conversation_id: string;
  node_id: string;
  field: "prompt" | "response";
  text: string;
}

interface SearchPanelProps {
  user: User | null;
  conversations: Conversation[];
  onSelect: (id: string) => void;
  onClose: () => void;
}

function getSnippet(text: string, query: string): string {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text.slice(0, 140) + (text.length > 140 ? "…" : "");
  const start = Math.max(0, idx - 50);
  const end = Math.min(text.length, idx + query.length + 90);
  return (
    (start > 0 ? "…" : "") +
    text.slice(start, end) +
    (end < text.length ? "…" : "")
  );
}

function HighlightedSnippet({ text, query }: { text: string; query: string }) {
  const snippet = getSnippet(text, query);
  const idx = snippet.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <span className="text-gray-500">{snippet}</span>;
  return (
    <span className="text-gray-500">
      {snippet.slice(0, idx)}
      <mark className="bg-indigo-500/25 text-indigo-300 rounded px-0.5">
        {snippet.slice(idx, idx + query.length)}
      </mark>
      {snippet.slice(idx + query.length)}
    </span>
  );
}

export default function SearchPanel({
  user,
  conversations,
  onSelect,
  onClose,
}: SearchPanelProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const token = user ? await user.getIdToken() : null;
        const headers: Record<string, string> = {};
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const res = await fetch(
          `${API}/api/chat/search?q=${encodeURIComponent(query.trim())}`,
          {
            credentials: "include",
            headers,
          },
        );
        if (res.ok) setResults(await res.json());
      } catch {}
      setLoading(false);
    }, 300);
  }, [query, user]);

  const convMap = Object.fromEntries(conversations.map((c) => [c.id, c]));

  // Group results by conversation_id
  const grouped = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    (acc[r.conversation_id] ??= []).push(r);
    return acc;
  }, {});

  // Title-only matches (conversations with no message hits but title matches)
  const titleMatches =
    query.trim().length >= 2
      ? conversations.filter(
          (c) =>
            (c.title ?? "").toLowerCase().includes(query.toLowerCase()) &&
            !grouped[c.id],
        )
      : [];

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
          <circle
            cx="7.5"
            cy="7.5"
            r="5"
            stroke="currentColor"
            strokeWidth="1.4"
          />
          <path
            d="M11.5 11.5l4 4"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
        <h1 className="text-lg font-semibold text-gray-100">Search</h1>
        <div className="flex-1" />
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

      {/* Search input */}
      <div className="px-6 py-4">
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-900 border border-gray-800 focus-within:border-gray-600 transition-colors">
          <svg
            width="15"
            height="15"
            viewBox="0 0 15 15"
            fill="none"
            className="text-gray-600 shrink-0"
          >
            <circle
              cx="6.5"
              cy="6.5"
              r="4"
              stroke="currentColor"
              strokeWidth="1.3"
            />
            <path
              d="M9.5 9.5l3 3"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
            />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search messages, prompts, responses…"
            className="flex-1 bg-transparent text-sm text-gray-200 placeholder-gray-600 outline-none"
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
            }}
          />
          {loading && (
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              className="text-gray-600 animate-spin shrink-0"
            >
              <circle
                cx="7"
                cy="7"
                r="5.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeDasharray="20 15"
              />
            </svg>
          )}
          {query && !loading && (
            <button
              onClick={() => setQuery("")}
              className="text-gray-600 hover:text-gray-400 transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path
                  d="M1 1l10 10M11 1L1 11"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {query.trim().length < 2 ? (
          <p className="px-2 py-2 text-xs text-gray-600">
            Type at least 2 characters to search…
          </p>
        ) : !loading && results.length === 0 && titleMatches.length === 0 ? (
          <p className="px-2 py-2 text-sm text-gray-600">
            No results for "{query}"
          </p>
        ) : (
          <div className="space-y-4">
            {/* Message content matches */}
            {Object.entries(grouped).map(([convId, hits]) => {
              const conv = convMap[convId];
              return (
                <div key={convId}>
                  <button
                    onClick={() => {
                      onSelect(convId);
                      onClose();
                    }}
                    className="flex items-center gap-2 px-1 mb-2 w-full text-left group"
                  >
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 13 13"
                      fill="none"
                      className="shrink-0 text-gray-600"
                    >
                      <path
                        d="M1.5 1.5h10a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H3.5l-3 2V2.5a1 1 0 0 1 1-1z"
                        stroke="currentColor"
                        strokeWidth="1.1"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span className="text-xs font-medium text-gray-400 group-hover:text-gray-200 transition-colors truncate">
                      {conv?.title || "Untitled tree"}
                    </span>
                    <span className="text-[10px] text-gray-700 shrink-0">
                      {hits.length} match{hits.length !== 1 ? "es" : ""}
                    </span>
                  </button>
                  <div className="space-y-1.5 pl-1">
                    {hits.map((hit, i) => (
                      <button
                        key={i}
                        onClick={() => {
                          onSelect(convId);
                          onClose();
                        }}
                        className="w-full text-left px-3 py-2.5 rounded-lg bg-gray-900/60 hover:bg-gray-900 border border-gray-800 hover:border-gray-700 transition-colors"
                      >
                        <span
                          className={`text-[10px] font-medium uppercase tracking-wider mr-2 ${hit.field === "prompt" ? "text-blue-400/70" : "text-emerald-400/70"}`}
                        >
                          {hit.field === "prompt" ? "You" : "AI"}
                        </span>
                        <span className="text-xs leading-relaxed">
                          <HighlightedSnippet text={hit.text} query={query} />
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}

            {/* Title-only matches */}
            {titleMatches.length > 0 && (
              <div>
                {Object.keys(grouped).length > 0 && (
                  <p className="px-1 pb-2 text-[10px] text-gray-700 uppercase tracking-wider font-medium">
                    Title matches
                  </p>
                )}
                <div className="space-y-0.5">
                  {titleMatches.map((conv) => (
                    <button
                      key={conv.id}
                      onClick={() => {
                        onSelect(conv.id);
                        onClose();
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-gray-400 hover:bg-gray-900 hover:text-gray-200 transition-colors"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 14 14"
                        fill="none"
                        className="shrink-0 opacity-40"
                      >
                        <path
                          d="M1.5 1.5h11a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H4l-3.5 2.5V2.5a1 1 0 0 1 1-1z"
                          stroke="currentColor"
                          strokeWidth="1.1"
                          strokeLinejoin="round"
                        />
                      </svg>
                      <HighlightedSnippet
                        text={conv.title || "Untitled tree"}
                        query={query}
                      />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
