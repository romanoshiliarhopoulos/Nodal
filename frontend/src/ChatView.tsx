import { useState, useEffect, useRef } from "react";
import type { User } from "firebase/auth";
import type { Node, BranchTarget } from "./types";
import ReactMarkdown from "react-markdown";
import TreeView, { type TreeViewHandle } from "./TreeView";

export const MODEL_GROUPS = [
  {
    provider: "Groq",
    models: [
      { id: "groq/llama-3.3-70b-versatile", label: "Llama 3.3 70B" },
      { id: "groq/llama-3.1-8b-instant", label: "Llama 3.1 8B" },
    ],
  },
  {
    provider: "Google",
    models: [
      { id: "gemini/gemini-3-pro-preview", label: "Gemini 3 Pro" },
      { id: "gemini/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
      {
        id: "gemini/gemini-2.5-flash-preview-04-17",
        label: "Gemini 2.5 Flash",
      },
      { id: "gemini/gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite" },
      {
        id: "gemini/gemini-2.0-flash-thinking-exp-01-21",
        label: "Gemini 2.0 Flash Thinking",
      },
    ],
  },
  {
    provider: "OpenAI",
    models: [
      { id: "openai/gpt-4o", label: "GPT-4o" },
      { id: "openai/gpt-4o-mini", label: "GPT-4o mini" },
    ],
  },
  {
    provider: "Anthropic",
    models: [
      {
        id: "anthropic/claude-3-5-sonnet-20241022",
        label: "Claude 3.5 Sonnet",
      },
      { id: "anthropic/claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku" },
    ],
  },
];

// Flat list kept for label lookups in NodeCard
export const MODELS = MODEL_GROUPS.flatMap((g) =>
  g.models.map((m) => ({ ...m, provider: g.provider })),
);

const PHRASES = [
  "Let's build.",
  "Branch out.",
  "Your thought tree.",
  "Think in trees.",
  "Explore every path.",
];

const PHRASE_KEYFRAMES = `
  @keyframes phraseIn {
    from { opacity: 0; transform: translateY(14px); filter: blur(8px); }
    to   { opacity: 1; transform: translateY(0);    filter: blur(0);   }
  }
`;

interface ChatViewProps {
  nodes: Record<string, Node>;
  rootNodeId: string | null;
  activeChildIndex: Record<string, number>;
  streaming: boolean;
  branchTarget: BranchTarget | null;
  model: string;
  user: User | null;
  availableProviders: string[];
  onModelChange: (m: string) => void;
  onNavigateSibling: (parentId: string, idx: number) => void;
  onSetBranchTarget: (t: BranchTarget | null) => void;
  onSend: (prompt: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onSignIn: () => void;
}

function computePath(
  nodes: Record<string, Node>,
  rootNodeId: string | null,
  activeChildIndex: Record<string, number>,
): Node[] {
  if (!rootNodeId || !nodes[rootNodeId]) return [];
  const path: Node[] = [];
  const visited = new Set<string>();
  let current = rootNodeId;
  while (current) {
    if (visited.has(current)) break;
    visited.add(current);
    const node = nodes[current];
    if (!node) break;
    path.push(node);
    if (!node.children_ids?.length) break;
    const idx = activeChildIndex[current] ?? 0;
    current = node.children_ids[Math.min(idx, node.children_ids.length - 1)];
  }
  return path;
}

function StreamingCursor() {
  return (
    <span className="inline-block w-2 h-4 bg-gray-400 animate-pulse ml-0.5 align-middle" />
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  function handle() {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button
      onClick={handle}
      title="Copy response"
      className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-xs text-gray-600 hover:text-gray-300 px-1.5 py-0.5 rounded hover:bg-gray-800"
    >
      {copied ? (
        <span className="text-emerald-500">Copied</span>
      ) : (
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
          <rect
            x="4"
            y="4"
            width="7.5"
            height="7.5"
            rx="1.2"
            stroke="currentColor"
            strokeWidth="1.1"
          />
          <path
            d="M2.5 9H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v.5"
            stroke="currentColor"
            strokeWidth="1.1"
            strokeLinecap="round"
          />
        </svg>
      )}
    </button>
  );
}

const PROVIDER_KEY_ID: Record<string, string> = {
  Groq: "groq",
  Google: "gemini",
  OpenAI: "openai",
  Anthropic: "anthropic",
};

function ModelSelector({
  model,
  onChange,
  availableProviders,
}: {
  model: string;
  onChange: (m: string) => void;
  availableProviders: string[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = MODELS.find((m2) => m2.id === model) ?? MODELS[0];
  const currentGroup =
    MODEL_GROUPS.find((g) => g.models.some((m2) => m2.id === model)) ??
    MODEL_GROUPS[0];
  const [activeProvider, setActiveProvider] = useState(currentGroup.provider);

  // Sync active provider tab when the selected model changes externally
  useEffect(() => {
    setActiveProvider(currentGroup.provider);
  }, [model]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as globalThis.Node))
        setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const visibleModels =
    MODEL_GROUPS.find((g) => g.provider === activeProvider)?.models ?? [];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors py-1 px-1.5 rounded hover:bg-gray-800"
      >
        <span>
          {current.provider} · {current.label}
        </span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path
            d="M2 3.5l3 3 3-3"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full mt-1 left-0 z-20 w-56 rounded-xl border border-gray-700 bg-gray-900 shadow-xl overflow-hidden flex flex-col" style={{ maxHeight: "220px" }}>
          {/* Provider tabs */}
          <div className="flex border-b border-gray-800 shrink-0">
            {MODEL_GROUPS.map((g) => {
              const keyId = PROVIDER_KEY_ID[g.provider];
              const disabled = !availableProviders.includes(keyId);
              return (
                <button
                  key={g.provider}
                  type="button"
                  onClick={() => !disabled && setActiveProvider(g.provider)}
                  disabled={disabled}
                  className={`flex-1 py-2 text-[10px] font-medium transition-colors ${
                    disabled
                      ? "text-gray-700 cursor-not-allowed"
                      : activeProvider === g.provider
                        ? "text-indigo-400 border-b-2 border-indigo-500 bg-indigo-500/5"
                        : "text-gray-500 hover:text-gray-300"
                  }`}
                >
                  {g.provider}
                </button>
              );
            })}
          </div>
          {/* Model list */}
          <div className="py-1 overflow-y-auto">
            {visibleModels.map((m2) => {
              const keyId = PROVIDER_KEY_ID[activeProvider];
              const disabled = !availableProviders.includes(keyId);
              return (
                <button
                  key={m2.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    if (!disabled) { onChange(m2.id); setOpen(false); }
                  }}
                  className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                    disabled
                      ? "text-gray-700 cursor-not-allowed"
                      : m2.id === model
                        ? "text-indigo-400 bg-indigo-500/10"
                        : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
                  }`}
                >
                  {m2.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function InputRow({
  value,
  onChange,
  onSubmit,
  onKeyDown,
  disabled,
  placeholder,
  model,
  onModelChange,
  streaming,
  availableProviders,
  large = false,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onSubmit: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  disabled: boolean;
  placeholder: string;
  model: string;
  onModelChange: (m: string) => void;
  streaming: boolean;
  availableProviders: string[];
  large?: boolean;
}) {
  return (
    <div className="relative">
      <textarea
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        rows={large ? 3 : 2}
        className="w-full resize-none rounded-xl border border-gray-700 bg-gray-900 px-4 pt-3 pb-8 pr-12 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-gray-600 disabled:opacity-50 transition-colors leading-relaxed"
        style={{ minHeight: large ? "150px" : "52px" }}
      />
      <div className="absolute bottom-2 left-3">
        <ModelSelector model={model} onChange={onModelChange} availableProviders={availableProviders} />
      </div>
      <button
        type="button"
        onClick={onSubmit}
        disabled={streaming || !value.trim()}
        className="absolute right-2 bottom-2 w-8 h-8 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-800 disabled:text-gray-600 text-white flex items-center justify-center transition-colors"
      >
        {streaming ? (
          <span className="w-3 h-3 border-2 border-gray-500 border-t-gray-300 rounded-full animate-spin" />
        ) : (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path
              d="M7 11.5V2.5M3 6.5l4-4 4 4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>
    </div>
  );
}

function SignInButton({ onSignIn }: { onSignIn: () => void }) {
  return (
    <button
      onClick={onSignIn}
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-700 bg-gray-900 hover:bg-gray-800 hover:border-gray-600 text-xs text-gray-300 hover:text-gray-100 transition-colors"
    >
      <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
        <circle
          cx="6.5"
          cy="4"
          r="2.2"
          stroke="currentColor"
          strokeWidth="1.1"
        />
        <path
          d="M1 12c0-2.485 2.462-4.5 5.5-4.5S12 9.515 12 12"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinecap="round"
        />
      </svg>
      Sign in
    </button>
  );
}

function WelcomeScreen({
  model,
  onModelChange,
  onSend,
  streaming,
  user,
  onSignIn,
  availableProviders,
}: {
  model: string;
  onModelChange: (m: string) => void;
  onSend: (prompt: string) => void;
  streaming: boolean;
  user: User | null;
  onSignIn: () => void;
  availableProviders: string[];
}) {
  const [phraseIdx, setPhraseIdx] = useState(0);
  const [phraseKey, setPhraseKey] = useState(0);
  const [input, setInput] = useState("");

  useEffect(() => {
    const id = setInterval(() => {
      setPhraseIdx((i) => (i + 1) % PHRASES.length);
      setPhraseKey((k) => k + 1);
    }, 7000);
    return () => clearInterval(id);
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 300)}px`;
  }

  function handleSubmit() {
    if (!input.trim() || streaming) return;
    onSend(input.trim());
    setInput("");
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div className="flex flex-col flex-1 relative">
      <style>{PHRASE_KEYFRAMES}</style>

      {/* Top-right actions */}
      <div className="absolute top-4 right-5 flex items-center gap-3 z-10">
        {!user && <SignInButton onSignIn={onSignIn} />}
      </div>

      {/* Centered content */}
      <div className="flex flex-col flex-1 items-center justify-center px-6">
        <div className="w-full max-w-xl">
          <div className="mb-3 text-center">
            <span
              key={phraseKey}
              className="text-4xl font-light text-gray-300 select-none tracking-tight"
              style={{
                animation:
                  "phraseIn 1.1s cubic-bezier(0.4, 0, 0.2, 1) forwards",
                display: "inline-block",
              }}
            >
              {PHRASES[phraseIdx]}
            </span>
          </div>
          <p className="text-center text-sm text-gray-600 mb-8 select-none">
            A branching conversation interface — explore every idea in every
            direction.
          </p>
          <InputRow
            value={input}
            onChange={handleChange}
            onSubmit={handleSubmit}
            onKeyDown={handleKeyDown}
            disabled={streaming}
            placeholder="Start your tree…"
            model={model}
            onModelChange={onModelChange}
            streaming={streaming}
            availableProviders={availableProviders}
            large
          />
        </div>
      </div>
    </div>
  );
}

interface NodeCardProps {
  node: Node;
  nodes: Record<string, Node>;
  branchTarget: BranchTarget | null;
  streaming: boolean;
  onNavigateSibling: (parentId: string, idx: number) => void;
  onSetBranchTarget: (t: BranchTarget | null) => void;
  onDeleteNode: (nodeId: string) => void;
}

const PROMPT_COLLAPSE_THRESHOLD = 300;

function NodeCard({
  node,
  nodes,
  branchTarget,
  streaming,
  onNavigateSibling,
  onSetBranchTarget,
  onDeleteNode,
}: NodeCardProps) {
  const isLongPrompt = node.prompt.length > PROMPT_COLLAPSE_THRESHOLD;
  const [promptExpanded, setPromptExpanded] = useState(false);

  const isChildTarget =
    branchTarget?.nodeId === node.id && branchTarget.mode === "child";
  const isSiblingTarget =
    branchTarget?.nodeId === node.id && branchTarget.mode === "sibling";

  const parent = node.parent_id ? nodes[node.parent_id] : null;
  const siblings = parent?.children_ids ?? [];
  const myIndexInParent = siblings.indexOf(node.id);
  const showSiblingNav = siblings.length > 1;

  const modelLabel =
    MODELS.find((m) => m.id === node.model)?.label ??
    node.model?.split("/")[1] ??
    "";

  return (
    <div className="relative group">
      {showSiblingNav && (
        <div className="flex items-center justify-center gap-2 mb-2 text-xs text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            disabled={myIndexInParent === 0}
            onClick={() =>
              onNavigateSibling(node.parent_id!, myIndexInParent - 1)
            }
            className="p-1 rounded hover:bg-gray-800 hover:text-gray-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            ←
          </button>
          <span className="select-none tabular-nums">
            {myIndexInParent + 1}/{siblings.length}
          </span>
          <button
            disabled={myIndexInParent === siblings.length - 1}
            onClick={() =>
              onNavigateSibling(node.parent_id!, myIndexInParent + 1)
            }
            className="p-1 rounded hover:bg-gray-800 hover:text-gray-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            →
          </button>
        </div>
      )}

      <div
        className={`rounded-xl border transition-colors ${isChildTarget || isSiblingTarget ? "border-indigo-500/60 bg-gray-900" : "border-gray-800 bg-gray-900"}`}
      >
        {/* Fork ↗ */}
        <button
          onClick={() => {
            if (!streaming)
              onSetBranchTarget(
                isSiblingTarget ? null : { nodeId: node.id, mode: "sibling" },
              );
          }}
          disabled={streaming}
          title="Fork — explore an alternative at this level"
          className={`absolute -top-2 -right-2 z-10 w-6 h-6 rounded-full border flex items-center justify-center text-xs transition-all opacity-0 group-hover:opacity-100 disabled:cursor-not-allowed ${
            isSiblingTarget
              ? "bg-indigo-600 border-indigo-500 text-white opacity-100!"
              : "bg-gray-900 border-gray-700 text-gray-600 hover:bg-gray-700 hover:text-gray-300"
          }`}
        >
          ↗
        </button>

        {/* Prompt */}
        <div className="px-4 pt-3 pb-2">
          <div className="flex items-start gap-2">
            <span className="text-xs font-medium text-indigo-400 mt-0.5 shrink-0">
              You
            </span>
            <p className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed flex-1 min-w-0">
              {isLongPrompt && !promptExpanded
                ? node.prompt.slice(0, PROMPT_COLLAPSE_THRESHOLD) + "..."
                : node.prompt}
            </p>
          </div>
          {isLongPrompt && (
            <button
              onClick={() => setPromptExpanded((v) => !v)}
              className="mt-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              {promptExpanded ? "Show less" : "Show more"}
            </button>
          )}
        </div>

        <div className="border-t border-gray-800" />

        {/* Response */}
        <div className="px-4 pt-2 pb-1">
          <div className="text-sm text-gray-300 leading-relaxed prose prose-sm prose-invert max-w-none">
            {node.response ? (
              <>
                <ReactMarkdown>{node.response}</ReactMarkdown>
                {node.is_streaming && <StreamingCursor />}
              </>
            ) : node.is_streaming ? (
              <span className="inline-flex items-center gap-1.5 text-gray-500 italic text-xs">
                <span className="flex gap-0.5">
                  <span
                    className="w-1 h-1 rounded-full bg-gray-500 animate-bounce"
                    style={{ animationDelay: "0ms" }}
                  />
                  <span
                    className="w-1 h-1 rounded-full bg-gray-500 animate-bounce"
                    style={{ animationDelay: "150ms" }}
                  />
                  <span
                    className="w-1 h-1 rounded-full bg-gray-500 animate-bounce"
                    style={{ animationDelay: "300ms" }}
                  />
                </span>
                Thinking
              </span>
            ) : (
              <span className="text-gray-600 italic">No response</span>
            )}
          </div>
        </div>

        {/* Bottom bar: model label + copy + branch */}
        <div className="flex items-center justify-between px-4 pb-2 pt-1">
          <span className="text-xs text-gray-700 select-none">
            {modelLabel}
          </span>
          <div className="flex items-center gap-1">
            {node.response && !node.is_streaming && (
              <CopyButton text={node.response} />
            )}
            <button
              onClick={() => {
                if (!streaming) onDeleteNode(node.id);
              }}
              disabled={streaming || node.is_streaming}
              title="Delete node"
              className="opacity-0 group-hover:opacity-100 flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-all disabled:cursor-not-allowed text-gray-600 hover:text-red-400 hover:bg-gray-800"
            >
              delete
            </button>
            <button
              onClick={() => {
                if (!streaming)
                  onSetBranchTarget(
                    isChildTarget ? null : { nodeId: node.id, mode: "child" },
                  );
              }}
              disabled={streaming || node.is_streaming}
              title="Branch — continue this thread"
              className={`opacity-0 group-hover:opacity-100 flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-all disabled:cursor-not-allowed ${
                isChildTarget
                  ? "bg-indigo-600 text-white opacity-100!"
                  : "text-gray-600 hover:text-gray-300 hover:bg-gray-800"
              }`}
            >
              ↙ branch
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

type ViewMode = "chat" | "tree";

function ViewToggle({
  mode,
  onChange,
}: {
  mode: ViewMode;
  onChange: (m: ViewMode) => void;
}) {
  return (
    <div className="flex items-center bg-gray-900/80 backdrop-blur border border-gray-800 rounded-lg p-0.5">
      <button
        onClick={() => onChange("chat")}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-colors ${
          mode === "chat"
            ? "bg-gray-800 text-gray-200"
            : "text-gray-500 hover:text-gray-300"
        }`}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <rect x="1" y="1" width="10" height="2.5" rx="1" stroke="currentColor" strokeWidth="0.9" />
          <rect x="1" y="4.75" width="10" height="2.5" rx="1" stroke="currentColor" strokeWidth="0.9" />
          <rect x="1" y="8.5" width="10" height="2.5" rx="1" stroke="currentColor" strokeWidth="0.9" />
        </svg>
        Chat
      </button>
      <button
        onClick={() => onChange("tree")}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-colors ${
          mode === "tree"
            ? "bg-gray-800 text-gray-200"
            : "text-gray-500 hover:text-gray-300"
        }`}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <circle cx="6" cy="1.5" r="1.2" stroke="currentColor" strokeWidth="0.9" />
          <circle cx="2.5" cy="6" r="1.2" stroke="currentColor" strokeWidth="0.9" />
          <circle cx="9.5" cy="6" r="1.2" stroke="currentColor" strokeWidth="0.9" />
          <circle cx="2.5" cy="10.5" r="1.2" stroke="currentColor" strokeWidth="0.9" />
          <circle cx="9.5" cy="10.5" r="1.2" stroke="currentColor" strokeWidth="0.9" />
          <line x1="6" y1="2.7" x2="2.5" y2="4.8" stroke="currentColor" strokeWidth="0.9" />
          <line x1="6" y1="2.7" x2="9.5" y2="4.8" stroke="currentColor" strokeWidth="0.9" />
          <line x1="2.5" y1="7.2" x2="2.5" y2="9.3" stroke="currentColor" strokeWidth="0.9" />
          <line x1="9.5" y1="7.2" x2="9.5" y2="9.3" stroke="currentColor" strokeWidth="0.9" />
        </svg>
        Tree
      </button>
    </div>
  );
}

function ZoomControls({
  zoom,
  zoomTo,
}: {
  zoom: number;
  zoomTo: (z: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  function commitEdit() {
    const parsed = parseInt(editValue, 10);
    if (!isNaN(parsed) && parsed >= 10 && parsed <= 300) {
      zoomTo(parsed / 100);
    }
    setEditing(false);
  }

  return (
    <div className="flex items-center gap-0.5 bg-gray-900/80 backdrop-blur border border-gray-800 rounded-lg px-1 py-0.5">
      <button
        onClick={() => zoomTo(Math.max(0.15, zoom * 0.8))}
        className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-200 rounded hover:bg-gray-800 transition-colors text-xs"
      >
        -
      </button>
      {editing ? (
        <input
          ref={inputRef}
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitEdit();
            if (e.key === "Escape") setEditing(false);
          }}
          className="w-10 text-center text-[10px] text-gray-300 bg-gray-800 rounded px-0.5 py-0.5 outline-none border border-gray-600"
        />
      ) : (
        <button
          onClick={() => {
            setEditValue(String(Math.round(zoom * 100)));
            setEditing(true);
          }}
          className="text-[10px] text-gray-500 hover:text-gray-300 w-10 text-center select-none py-0.5 rounded hover:bg-gray-800 transition-colors"
          title="Click to enter custom zoom"
        >
          {Math.round(zoom * 100)}%
        </button>
      )}
      <button
        onClick={() => zoomTo(Math.min(2.5, zoom * 1.2))}
        className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-200 rounded hover:bg-gray-800 transition-colors text-xs"
      >
        +
      </button>
      <button
        onClick={() => zoomTo(1)}
        className={`w-6 h-6 flex items-center justify-center rounded transition-colors text-[9px] font-medium ${
          Math.abs(zoom - 1) < 0.01
            ? "text-gray-700 cursor-default"
            : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
        }`}
        title="Reset to 100%"
      >
        1:1
      </button>
    </div>
  );
}

export default function ChatView({
  nodes,
  rootNodeId,
  activeChildIndex,
  streaming,
  branchTarget,
  model,
  user,
  availableProviders,
  onModelChange,
  onNavigateSibling,
  onSetBranchTarget,
  onSend,
  onDeleteNode,
  onSignIn,
}: ChatViewProps) {
  const [input, setInput] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("chat");
  const [treeZoom, setTreeZoom] = useState(1);
  const bottomRef = useRef<HTMLDivElement>(null);
  const treeRef = useRef<TreeViewHandle>(null);

  // When switching tree→chat with a selected node, update activeChildIndex
  // so the chat path follows root → selected node
  function handleViewModeChange(newMode: ViewMode) {
    if (newMode === "chat" && viewMode === "tree" && branchTarget?.mode === "child") {
      const targetId = branchTarget.nodeId;
      let childId = targetId;
      let current = nodes[targetId];
      while (current?.parent_id) {
        const parent = nodes[current.parent_id];
        if (!parent) break;
        const idx = parent.children_ids.indexOf(childId);
        if (idx >= 0) {
          onNavigateSibling(parent.id, idx);
        }
        childId = parent.id;
        current = parent;
      }
    }
    setViewMode(newMode);
  }

  const path = computePath(nodes, rootNodeId, activeChildIndex);
  const isEmpty = path.length === 0 && !streaming;

  useEffect(() => {
    if (viewMode === "chat") {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [path.length, streaming, viewMode]);

  function handleSubmit() {
    if (!input.trim() || streaming) return;
    onSend(input.trim());
    setInput("");
    onSetBranchTarget(null);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }

  const branchLabel = (() => {
    if (!branchTarget) return null;
    const targetNode = nodes[branchTarget.nodeId];
    if (!targetNode) return null;
    const snippet =
      targetNode.prompt.slice(0, 40) +
      (targetNode.prompt.length > 40 ? "…" : "");
    return branchTarget.mode === "child"
      ? `Branching from: "${snippet}"`
      : `Forking from: "${snippet}"`;
  })();

  if (isEmpty) {
    return (
      <WelcomeScreen
        model={model}
        onModelChange={onModelChange}
        onSend={onSend}
        streaming={streaming}
        user={user}
        onSignIn={onSignIn}
        availableProviders={availableProviders}
      />
    );
  }

  return (
    <div className="flex flex-col flex-1 min-w-0 h-full">
      {/* Top bar */}
      <div className="flex items-center justify-end gap-3 px-5 py-2.5">
        {!user && <SignInButton onSignIn={onSignIn} />}
      </div>

      {/* Content area — chat or tree */}
      {viewMode === "chat" ? (
        <div className="flex-1 overflow-y-auto px-4 py-6">
          <div className="max-w-2xl mx-auto space-y-4">
            {path.map((node) => (
              <NodeCard
                key={node.id}
                node={node}
                nodes={nodes}
                branchTarget={branchTarget}
                streaming={streaming}
                onNavigateSibling={onNavigateSibling}
                onSetBranchTarget={onSetBranchTarget}
                onDeleteNode={onDeleteNode}
              />
            ))}
            <div ref={bottomRef} />
          </div>
        </div>
      ) : (
        <TreeView
          ref={treeRef}
          nodes={nodes}
          rootNodeId={rootNodeId}
          activeChildIndex={activeChildIndex}
          streaming={streaming}
          branchTarget={branchTarget}
          onSetBranchTarget={onSetBranchTarget}
          onNavigateSibling={onNavigateSibling}
          onDeleteNode={onDeleteNode}
          zoom={treeZoom}
          onZoomChange={setTreeZoom}
        />
      )}

      {/* Input + controls */}
      <div className="border-gray-800 px-4 py-5">
        <div className="flex items-end gap-3">
          {/* Zoom controls — pinned left, only visible in tree mode */}
          <div className={`shrink-0 pb-1 ${viewMode === "tree" ? "" : "invisible"}`}>
            <ZoomControls zoom={treeZoom} zoomTo={(z) => treeRef.current?.zoomTo(z)} />
          </div>

          {/* Input area — centered, capped width */}
          <div className="flex-1 min-w-0 max-w-2xl mx-auto">
            {branchLabel && (
              <div className="flex items-center justify-between mb-2 px-1">
                <span className="text-xs text-indigo-400">{branchLabel}</span>
                <button
                  onClick={() => onSetBranchTarget(null)}
                  className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
                >
                  cancel
                </button>
              </div>
            )}
            <InputRow
              value={input}
              onChange={handleChange}
              onSubmit={handleSubmit}
              onKeyDown={handleKeyDown}
              disabled={streaming}
              placeholder={streaming ? "Waiting for response..." : "Message"}
              model={model}
              onModelChange={onModelChange}
              streaming={streaming}
              availableProviders={availableProviders}
            />
          </div>

          {/* View toggle — pinned right */}
          <div className="shrink-0 pb-1">
            <ViewToggle mode={viewMode} onChange={handleViewModeChange} />
          </div>
        </div>
      </div>
    </div>
  );
}
