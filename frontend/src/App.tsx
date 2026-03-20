import { useState, useEffect, useRef } from "react";
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import { auth, googleProvider } from "./firebase";
import { type Node, type Conversation, type BranchTarget } from "./types";
import Sidebar from "./Sidebar";
import ChatView from "./ChatView";
import AccountPage from "./AccountPage";
import SearchPanel from "./SearchPanel";
import PromptsPanel from "./PromptsPanel";

const API = import.meta.env.DEV ? "http://localhost:8001" : "";

async function authHeaders(user: User | null): Promise<Record<string, string>> {
  if (!user) return {};
  const token = await user.getIdToken();
  return { Authorization: `Bearer ${token}` };
}

async function apiFetch(
  path: string,
  user: User | null,
  opts: RequestInit = {},
) {
  const ah = await authHeaders(user);
  return fetch(`${API}${path}`, {
    credentials: "include",
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...ah,
      ...((opts.headers as Record<string, string>) ?? {}),
    },
  });
}

function getLastPathNode(
  nodes: Record<string, Node>,
  rootNodeId: string | null,
  activeChildIndex: Record<string, number>,
): string | null {
  if (!rootNodeId || !nodes[rootNodeId]) return null;
  let current = rootNodeId;
  const visited = new Set<string>();
  while (true) {
    visited.add(current);
    const node = nodes[current];
    if (!node?.children_ids?.length) return current;
    const idx = activeChildIndex[current] ?? 0;
    const next = node.children_ids[Math.min(idx, node.children_ids.length - 1)];
    if (!next || visited.has(next)) return current;
    current = next;
  }
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [sessionReady, setSessionReady] = useState(false);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConvId, setCurrentConvId] = useState<string | null>(null);
  const [currentConvModel, setCurrentConvModel] = useState(
    "groq/llama-3.3-70b-versatile",
  );

  const [nodes, setNodes] = useState<Record<string, Node>>({});
  const [rootNodeId, setRootNodeId] = useState<string | null>(null);
  const [activeChildIndex, setActiveChildIndex] = useState<
    Record<string, number>
  >({});

  const [streaming, setStreaming] = useState(false);
  const [branchTarget, setBranchTarget] = useState<BranchTarget | null>(null);

  // Sidebar resize
  const [sidebarWidth, setSidebarWidth] = useState(256);
  const resizing = useRef(false);

  // Account panel
  const [showAccount, setShowAccount] = useState(false);

  // Active panel in main content area
  const [panel, setPanel] = useState<"chat" | "search" | "prompts">("chat");

  // Active system prompt
  const [activeSystemPrompt, setActiveSystemPrompt] = useState<string | null>(
    null,
  );

  // Providers with a usable key (server env or BYOK)
  const [availableProviders, setAvailableProviders] = useState<string[]>([]);

  // Restore active system prompt from Firestore when user logs in
  useEffect(() => {
    if (!user) return;
    user
      .getIdToken()
      .then((token) =>
        fetch(`${API}/api/prompts`, {
          credentials: "include",
          headers: { Authorization: `Bearer ${token}` },
        }),
      )
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data?.active_prompt_id) return;
        const active = (data.prompts ?? []).find(
          (p: { id: string; content: string }) =>
            p.id === data.active_prompt_id,
        );
        if (active) setActiveSystemPrompt(active.content);
      })
      .catch(() => {});
  }, [user]);

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    fetch(`${API}/api/session`, { credentials: "include" }).then(() =>
      setSessionReady(true),
    );
  }, []);

  // Refresh available providers whenever auth state changes
  useEffect(() => {
    async function fetchAvailable() {
      try {
        const res = await apiFetch("/api/keys/available", user);
        if (res.ok) {
          const data = await res.json();
          setAvailableProviders(data.available ?? []);
        }
      } catch {}
    }
    fetchAvailable();
  }, [user]);

  useEffect(() => {
    if (sessionReady) loadConversations();
  }, [sessionReady, user]);

  // Sidebar drag-to-resize
  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!resizing.current) return;
      setSidebarWidth(Math.min(480, Math.max(180, e.clientX)));
    }
    function onMouseUp() {
      resizing.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  async function loadConversations() {
    try {
      const res = await apiFetch("/api/chat/conversations", user);
      if (res.ok) setConversations(await res.json());
    } catch {}
  }

  async function selectConversation(convId: string) {
    try {
      const res = await apiFetch(`/api/chat/conversations/${convId}`, user);
      if (!res.ok) return;
      const { conversation, nodes: nodesMap } = await res.json();
      setCurrentConvId(convId);
      setCurrentConvModel(conversation.model ?? "groq/llama-3.3-70b-versatile");
      setNodes(nodesMap ?? {});
      setRootNodeId(conversation.root_node_id ?? null);
      setActiveChildIndex({});
      setBranchTarget(null);
    } catch {}
  }

  function newConversation() {
    setCurrentConvId(null);
    setNodes({});
    setRootNodeId(null);
    setActiveChildIndex({});
    setBranchTarget(null);
  }

  async function deleteConversation(convId: string) {
    try {
      await apiFetch(`/api/chat/conversations/${convId}`, user, {
        method: "DELETE",
      });
      setConversations((prev) => prev.filter((c) => c.id !== convId));
      if (currentConvId === convId) {
        setCurrentConvId(null);
        setNodes({});
        setRootNodeId(null);
      }
    } catch {}
  }

  async function sendMessage(
    prompt: string,
    parentNodeId: string | null,
    convId: string,
  ) {
    if (!convId || streaming || !prompt.trim()) return;
    setStreaming(true);
    setBranchTarget(null);

    const tempId = `temp_${Date.now()}`;
    const parentChildCount = parentNodeId
      ? (nodes[parentNodeId]?.children_ids?.length ?? 0)
      : 0;

    setNodes((prev) => {
      const next = { ...prev };
      next[tempId] = {
        id: tempId,
        parent_id: parentNodeId,
        children_ids: [],
        prompt,
        response: "",
        model: currentConvModel,
        is_streaming: true,
      };
      if (parentNodeId && next[parentNodeId]) {
        next[parentNodeId] = {
          ...next[parentNodeId],
          children_ids: [...next[parentNodeId].children_ids, tempId],
        };
      }
      return next;
    });

    if (parentNodeId) {
      setActiveChildIndex((prev) => ({
        ...prev,
        [parentNodeId]: parentChildCount,
      }));
    }
    if (!rootNodeId) setRootNodeId(tempId);

    let realNodeId: string | undefined;

    try {
      const ah = await authHeaders(user);
      const res = await fetch(`${API}/api/chat/conversations/${convId}/nodes`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...ah },
        body: JSON.stringify({
          prompt,
          parent_node_id: parentNodeId,
          model: currentConvModel,
          system_prompt: activeSystemPrompt ?? undefined,
        }),
      });

      if (!res.body) throw new Error("No response body");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === "chunk") {
              setNodes((prev) => {
                if (!prev[tempId]) return prev;
                return {
                  ...prev,
                  [tempId]: {
                    ...prev[tempId],
                    response: prev[tempId].response + event.content,
                  },
                };
              });
            } else if (event.type === "done") {
              realNodeId = event.node_id;
            } else if (event.type === "title") {
              setConversations((prev) =>
                prev.map((c) =>
                  c.id === convId ? { ...c, title: event.title } : c,
                ),
              );
            } else if (event.type === "error") {
              setNodes((prev) => {
                if (!prev[tempId]) return prev;
                return {
                  ...prev,
                  [tempId]: {
                    ...prev[tempId],
                    is_streaming: false,
                    response: `Error: ${event.message}`,
                  },
                };
              });
              setStreaming(false);
              return;
            }
          } catch {}
        }
      }
    } catch (e) {
      setNodes((prev) => {
        if (!prev[tempId]) return prev;
        return {
          ...prev,
          [tempId]: {
            ...prev[tempId],
            is_streaming: false,
            response: `Error: ${e}`,
          },
        };
      });
      setStreaming(false);
      return;
    }

    if (realNodeId) {
      const finalId = realNodeId;
      setNodes((prev) => {
        const temp = prev[tempId];
        if (!temp) return prev;
        const next = { ...prev };
        delete next[tempId];
        next[finalId] = { ...temp, id: finalId, is_streaming: false };
        if (parentNodeId && next[parentNodeId]) {
          next[parentNodeId] = {
            ...next[parentNodeId],
            children_ids: next[parentNodeId].children_ids.map((id) =>
              id === tempId ? finalId : id,
            ),
          };
        }
        return next;
      });
      if (!parentNodeId) setRootNodeId(finalId);
      setBranchTarget({ nodeId: finalId, mode: "child" });
    }

    setStreaming(false);
    loadConversations();
    setTimeout(() => loadConversations(), 2500);
  }

  async function handleSend(prompt: string) {
    let convId = currentConvId;
    if (!convId) {
      try {
        const res = await apiFetch("/api/chat/conversations", user, {
          method: "POST",
          body: JSON.stringify({
            title: "New Conversation",
            model: currentConvModel,
          }),
        });
        if (!res.ok) return;
        const conv = await res.json();
        convId = conv.id;
        setCurrentConvId(conv.id);
        setCurrentConvModel(conv.model);
        setNodes({});
        setRootNodeId(null);
        setActiveChildIndex({});
        setBranchTarget(null);
        setConversations((prev) => [
          {
            id: conv.id,
            title: prompt.slice(0, 50) + (prompt.length > 50 ? "…" : ""),
            model: currentConvModel,
            root_node_id: null,
            user_id: "",
            updated_at: null,
          },
          ...prev,
        ]);
      } catch {
        return;
      }
    }
    let parentId: string | null = null;
    if (branchTarget) {
      parentId =
        branchTarget.mode === "child"
          ? branchTarget.nodeId
          : (nodes[branchTarget.nodeId]?.parent_id ?? null);
    } else {
      parentId = getLastPathNode(nodes, rootNodeId, activeChildIndex);
    }
    if (convId) sendMessage(prompt, parentId, convId);
  }

  async function handleDeleteNode(nodeId: string) {
    if (!currentConvId) return;
    const node = nodes[nodeId];
    if (!node) return;

    try {
      const res = await apiFetch(
        `/api/chat/conversations/${currentConvId}/nodes/${nodeId}`,
        user,
        { method: "DELETE" },
      );
      if (!res.ok) return;
    } catch {
      return;
    }

    const parentId = node.parent_id;
    const childrenIds = node.children_ids ?? [];

    setNodes((prev) => {
      const next = { ...prev };
      delete next[nodeId];
      // Re-parent children
      for (const cid of childrenIds) {
        if (next[cid]) {
          next[cid] = { ...next[cid], parent_id: parentId };
        }
      }
      // Update parent's children_ids: replace deleted node with its children
      if (parentId && next[parentId]) {
        const oldChildren = next[parentId].children_ids;
        const idx = oldChildren.indexOf(nodeId);
        const newChildren = [...oldChildren];
        if (idx >= 0) {
          newChildren.splice(idx, 1, ...childrenIds);
        } else {
          newChildren.push(...childrenIds);
        }
        next[parentId] = { ...next[parentId], children_ids: newChildren };
      }
      return next;
    });

    // If deleted node was root, promote first child
    if (rootNodeId === nodeId) {
      setRootNodeId(childrenIds.length > 0 ? childrenIds[0] : null);
    }

    // Clear branch target if it pointed to the deleted node
    if (branchTarget?.nodeId === nodeId) {
      setBranchTarget(parentId ? { nodeId: parentId, mode: "child" } : null);
    }
  }

  function handleSignIn() {
    signInWithPopup(auth, googleProvider).catch(console.error);
  }

  function handleSignOut() {
    signOut(auth);
    setConversations([]);
    setCurrentConvId(null);
    setNodes({});
    setRootNodeId(null);
    setShowAccount(false);
    loadConversations();
  }

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100 overflow-hidden">
      {/* Sidebar with resizable width */}
      <div
        style={{ width: sidebarWidth, flexShrink: 0 }}
        className="relative flex"
      >
        <Sidebar
          user={user}
          conversations={conversations}
          currentConvId={currentConvId}
          activePanel={panel}
          hasActivePrompt={activeSystemPrompt !== null}
          onSelect={(id) => {
            selectConversation(id);
            setPanel("chat");
          }}
          onNew={() => {
            newConversation();
            setPanel("chat");
          }}
          onDelete={deleteConversation}
          onSignIn={handleSignIn}
          onSignOut={handleSignOut}
          onAccount={() => setShowAccount(true)}
          onOpenSearch={() =>
            setPanel((p) => (p === "search" ? "chat" : "search"))
          }
          onOpenPrompts={() =>
            setPanel((p) => (p === "prompts" ? "chat" : "prompts"))
          }
        />
        {/* Drag handle */}
        <div
          className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-indigo-500/30 transition-colors z-10"
          onMouseDown={() => {
            resizing.current = true;
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
          }}
        />
      </div>

      {panel === "search" && (
        <SearchPanel
          user={user}
          conversations={conversations}
          onSelect={(id) => {
            selectConversation(id);
            setPanel("chat");
          }}
          onClose={() => setPanel("chat")}
        />
      )}
      {panel === "prompts" && (
        <PromptsPanel
          user={user}
          onSelectPrompt={setActiveSystemPrompt}
          onClose={() => setPanel("chat")}
        />
      )}
      {panel === "chat" && (
        <ChatView
          nodes={nodes}
          rootNodeId={rootNodeId}
          activeChildIndex={activeChildIndex}
          streaming={streaming}
          branchTarget={branchTarget}
          model={currentConvModel}
          user={user}
          availableProviders={availableProviders}
          onModelChange={setCurrentConvModel}
          onNavigateSibling={(parentId: string, idx: number) =>
            setActiveChildIndex((prev) => ({ ...prev, [parentId]: idx }))
          }
          onSetBranchTarget={setBranchTarget}
          onSend={handleSend}
          onDeleteNode={handleDeleteNode}
          onSignIn={handleSignIn}
        />
      )}

      {/* Account panel */}
      {showAccount && user && (
        <AccountPage user={user} onClose={() => setShowAccount(false)} />
      )}
    </div>
  );
}
