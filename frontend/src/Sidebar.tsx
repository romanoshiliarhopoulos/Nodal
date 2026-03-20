import { useState, useRef, useEffect } from "react";
import type { User } from "firebase/auth";
import type { Conversation } from "./types";

type Panel = "chat" | "search" | "prompts";

interface SidebarProps {
  user: User | null;
  conversations: Conversation[];
  currentConvId: string | null;
  activePanel: Panel;
  hasActivePrompt: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onSignIn: () => void;
  onSignOut: () => void;
  onAccount: () => void;
  onOpenSearch: () => void;
  onOpenPrompts: () => void;
}

export default function Sidebar({
  user,
  conversations,
  currentConvId,
  activePanel,
  hasActivePrompt,
  onSelect,
  onNew,
  onDelete,
  onSignIn,
  onSignOut,
  onAccount,
  onOpenSearch,
  onOpenPrompts,
}: SidebarProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  return (
    <div className="flex flex-col w-full h-full border-r border-gray-800 bg-gray-950">
      {/* Header */}
      <div className="px-4 py-4 border-b border-gray-800">
        <button
          onClick={onNew}
          className="text-base font-semibold text-gray-100 tracking-tight hover:text-white transition-colors"
        >
          Nodal
        </button>
      </div>

      {/* Nav actions */}
      <div className="px-2 py-2 space-y-0.5 border-b border-gray-800">
        {/* New Tree */}
        <button
          onClick={onNew}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
        >
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" className="shrink-0 text-gray-500">
            <path d="M7.5 2v11M2 7.5h11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span className="text-sm">New Tree</span>
        </button>

        {/* Search */}
        <button
          onClick={onOpenSearch}
          className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
            activePanel === "search"
              ? "bg-indigo-500/10 text-indigo-300"
              : "text-gray-400 hover:bg-gray-900 hover:text-gray-200"
          }`}
        >
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" className="shrink-0">
            <circle cx="6.5" cy="6.5" r="4" stroke="currentColor" strokeWidth="1.3" />
            <path d="M9.5 9.5l3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          <span className="text-sm">Search</span>
        </button>

        {/* System Prompts */}
        <button
          onClick={onOpenPrompts}
          className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
            activePanel === "prompts"
              ? "bg-indigo-500/10 text-indigo-300"
              : "text-gray-400 hover:bg-gray-900 hover:text-gray-200"
          }`}
        >
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" className="shrink-0">
            <path d="M2 2h11v2.5l-5 4v5l-2-1V8.5L2 4.5V2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
          <span className="text-sm flex-1 text-left">System Prompts</span>
          {hasActivePrompt && (
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0" />
          )}
        </button>
      </div>

      {/* Previous Trees */}
      <div className="flex-1 overflow-y-auto py-3">
        <p className="px-4 pb-2 text-[10px] font-medium text-gray-600 uppercase tracking-wider">
          Previous Trees
        </p>
        {conversations.length === 0 ? (
          <p className="px-4 py-2 text-xs text-gray-700">No conversations yet</p>
        ) : (
          conversations.map((conv) => (
            <div
              key={conv.id}
              className={`group relative flex items-center gap-2 px-3 py-2 mx-2 rounded-lg cursor-pointer transition-colors ${
                conv.id === currentConvId
                  ? "bg-gray-800 text-gray-100"
                  : "text-gray-400 hover:bg-gray-900 hover:text-gray-200"
              }`}
              onClick={() => onSelect(conv.id)}
              onMouseEnter={() => setHoveredId(conv.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none" className="shrink-0 opacity-40">
                <path d="M1.5 1.5h10a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H3.5l-3 2V2.5a1 1 0 0 1 1-1z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
              </svg>
              <span className="flex-1 truncate text-sm">{conv.title || "New Conversation"}</span>
              {(hoveredId === conv.id || conv.id === currentConvId) && (
                <button
                  className="shrink-0 p-0.5 rounded text-gray-600 hover:text-red-400 hover:bg-gray-700 transition-colors opacity-0 group-hover:opacity-100"
                  onClick={(e) => { e.stopPropagation(); onDelete(conv.id); }}
                  title="Delete"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M2 3h8M4.5 3V2h3v1M4 3l.5 7h3L8 3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-gray-800 px-3 py-3">
        {user ? (
          <div ref={menuRef} className="relative">
            {menuOpen && (
              <div className="absolute bottom-full mb-2 left-0 right-0 rounded-xl border border-gray-700 bg-gray-900 shadow-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-800">
                  <p className="text-xs font-medium text-gray-200 truncate">{user.displayName ?? "User"}</p>
                  <p className="text-xs text-gray-500 truncate">{user.email}</p>
                </div>
                <div className="py-1">
                  <button
                    onClick={() => { setMenuOpen(false); onAccount(); }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-300 hover:bg-gray-800 hover:text-gray-100 transition-colors text-left"
                  >
                    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" className="text-gray-500 shrink-0">
                      <circle cx="7.5" cy="4.5" r="2.5" stroke="currentColor" strokeWidth="1.2" />
                      <path d="M1.5 13c0-3.038 2.686-5.5 6-5.5s6 2.462 6 5.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                    </svg>
                    My account
                  </button>
                  <button
                    onClick={() => { setMenuOpen(false); onAccount(); }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-300 hover:bg-gray-800 hover:text-gray-100 transition-colors text-left"
                  >
                    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" className="text-gray-500 shrink-0">
                      <rect x="2" y="5" width="11" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
                      <path d="M5 5V4a2.5 2.5 0 0 1 5 0v1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                    </svg>
                    API keys
                  </button>
                  <div className="border-t border-gray-800 my-1" />
                  <button
                    onClick={() => { setMenuOpen(false); onSignOut(); }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-400 hover:bg-gray-800 hover:text-red-400 transition-colors text-left"
                  >
                    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" className="text-gray-500 shrink-0">
                      <path d="M5.5 2H3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h2.5M10 4.5 13 7.5l-3 3M13 7.5H6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Sign out
                  </button>
                </div>
              </div>
            )}
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-gray-800 transition-colors"
            >
              {user.photoURL ? (
                <img src={user.photoURL} className="w-7 h-7 rounded-full shrink-0" alt="" />
              ) : (
                <div className="w-7 h-7 rounded-full bg-gray-700 flex items-center justify-center text-xs text-gray-300 shrink-0">
                  {user.displayName?.[0] ?? "?"}
                </div>
              )}
              <p className="flex-1 text-xs text-gray-300 truncate min-w-0 text-left">
                {user.displayName ?? user.email}
              </p>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className={`text-gray-600 shrink-0 transition-transform ${menuOpen ? "rotate-180" : ""}`}>
                <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        ) : (
          <button
            onClick={onSignIn}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-gray-300 hover:text-gray-100 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="4.5" r="2.5" stroke="currentColor" strokeWidth="1.2" />
              <path d="M1.5 12.5c0-2.485 2.462-4.5 5.5-4.5s5.5 2.015 5.5 4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            Sign in with Google
          </button>
        )}
      </div>
    </div>
  );
}
