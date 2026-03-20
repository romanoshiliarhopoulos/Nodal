import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  useImperativeHandle,
  forwardRef,
} from "react";
import type { Node, BranchTarget } from "./types";
import { MODELS } from "./ChatView";
import ReactMarkdown from "react-markdown";

/* ─── layout constants ─── */
const NODE_W_MIN = 280;
const NODE_W_MAX = 520;
const NODE_H_BASE = 140;
const H_GAP = 50;
const V_GAP = 80;
const COLLAPSE_PROMPT_THRESHOLD = 200;
const COLLAPSE_RESPONSE_THRESHOLD = 400;

/** Choose a width based on total content length. Short nodes stay narrow; long ones grow wider. */
function computeNodeWidth(node: Node): number {
  const totalLen = node.prompt.length + (node.response?.length ?? 0);
  if (totalLen < 150) return NODE_W_MIN;
  if (totalLen > 800) return NODE_W_MAX;
  // Linear interpolation between min and max
  const t = (totalLen - 150) / (800 - 150);
  return Math.round(NODE_W_MIN + t * (NODE_W_MAX - NODE_W_MIN));
}

/* ─── tree layout ─── */

interface LayoutNode {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  children: LayoutNode[];
  parentId: string | null;
}

function estimateNodeHeight(node: Node, w: number): number {
  const charsPerLine = Math.floor(w / 7.5);
  const promptLines = Math.ceil(node.prompt.length / charsPerLine);
  const responseLines = Math.ceil((node.response?.length ?? 0) / charsPerLine);
  const lines = Math.min(promptLines, 12) + Math.min(responseLines, 20);
  return Math.max(NODE_H_BASE, 80 + lines * 16);
}

function buildLayout(
  nodes: Record<string, Node>,
  rootId: string | null,
  measuredHeights: Record<string, number>,
): LayoutNode | null {
  if (!rootId || !nodes[rootId]) return null;

  function build(id: string): LayoutNode {
    const node = nodes[id];
    const w = computeNodeWidth(node);
    const h = measuredHeights[id] ?? estimateNodeHeight(node, w);
    const children = (node.children_ids ?? [])
      .filter((cid) => nodes[cid])
      .map((cid) => build(cid));
    return { id, x: 0, y: 0, w, h, children, parentId: node.parent_id };
  }

  const tree = build(rootId);
  assignY(tree, 0);
  assignX(tree);
  return tree;
}

function assignY(node: LayoutNode, y: number) {
  node.y = y;
  for (const child of node.children) {
    assignY(child, y + node.h + V_GAP);
  }
}

/** Assign x positions bottom-up. Each subtree occupies a contiguous horizontal span. */
function assignX(root: LayoutNode) {
  // First pass: compute the width of each subtree
  function subtreeWidth(node: LayoutNode): number {
    if (node.children.length === 0) return node.w;
    let total = 0;
    for (let i = 0; i < node.children.length; i++) {
      if (i > 0) total += H_GAP;
      total += subtreeWidth(node.children[i]);
    }
    return Math.max(node.w, total);
  }

  // Second pass: position nodes within their allocated span
  function position(node: LayoutNode, left: number) {
    const sw = subtreeWidth(node);
    if (node.children.length === 0) {
      // Center the leaf in its span
      node.x = left + (sw - node.w) / 2;
      return;
    }
    // Lay out children within the span
    let childLeft = left;
    const totalChildWidth = node.children.reduce(
      (acc, c, i) => acc + subtreeWidth(c) + (i > 0 ? H_GAP : 0),
      0,
    );
    // Center children block within the span
    childLeft = left + (sw - totalChildWidth) / 2;
    for (const child of node.children) {
      const cw = subtreeWidth(child);
      position(child, childLeft);
      childLeft += cw + H_GAP;
    }
    // Center this node over its children
    const firstChild = node.children[0];
    const lastChild = node.children[node.children.length - 1];
    const childrenCenter =
      (firstChild.x + firstChild.w / 2 + lastChild.x + lastChild.w / 2) / 2;
    node.x = childrenCenter - node.w / 2;
  }

  position(root, 0);
}

function flattenLayout(node: LayoutNode): LayoutNode[] {
  const result: LayoutNode[] = [node];
  for (const child of node.children) {
    result.push(...flattenLayout(child));
  }
  return result;
}

interface Edge {
  from: LayoutNode;
  to: LayoutNode;
}

function collectEdges(node: LayoutNode): Edge[] {
  const edges: Edge[] = [];
  for (const child of node.children) {
    edges.push({ from: node, to: child });
    edges.push(...collectEdges(child));
  }
  return edges;
}

/* ─── collapsible tree node card ─── */

function TreeNodeCard({
  node,
  layout,
  isSelected,
  streaming,
  onClick,
  onMeasure,
  onDelete,
}: {
  node: Node;
  layout: LayoutNode;
  isSelected: boolean;
  streaming: boolean;
  onClick: () => void;
  onMeasure: (id: string, h: number) => void;
  onDelete: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const isLongPrompt = node.prompt.length > COLLAPSE_PROMPT_THRESHOLD;
  const isLongResponse = (node.response?.length ?? 0) > COLLAPSE_RESPONSE_THRESHOLD;
  const [promptCollapsed, setPromptCollapsed] = useState(isLongPrompt);
  const [responseCollapsed, setResponseCollapsed] = useState(false);

  useEffect(() => {
    if (!cardRef.current) return;
    const ro = new ResizeObserver(() => {
      if (cardRef.current) {
        onMeasure(node.id, cardRef.current.offsetHeight);
      }
    });
    ro.observe(cardRef.current);
    return () => ro.disconnect();
  }, [node.id, onMeasure]);

  const modelLabel =
    MODELS.find((m) => m.id === node.model)?.label ??
    node.model?.split("/")[1] ??
    "";

  const displayedPrompt =
    isLongPrompt && promptCollapsed
      ? node.prompt.slice(0, COLLAPSE_PROMPT_THRESHOLD) + "..."
      : node.prompt;

  const displayedResponse =
    isLongResponse && responseCollapsed
      ? (node.response?.slice(0, COLLAPSE_RESPONSE_THRESHOLD) ?? "") + "..."
      : node.response;

  return (
    <div
      className={`absolute group cursor-pointer transition-all duration-150 ${isSelected ? "z-10" : ""}`}
      style={{
        left: layout.x,
        top: layout.y,
        width: layout.w,
      }}
      onClick={onClick}
    >
      <div
        ref={cardRef}
        className={`rounded-xl border-2 transition-colors ${
          isSelected
            ? "border-indigo-500 bg-gray-900 shadow-lg shadow-indigo-500/10"
            : "border-gray-800 bg-gray-900 hover:border-gray-700"
        }`}
      >
        {/* Prompt */}
        <div className="px-3 pt-2.5 pb-1.5">
          <div className="flex items-start gap-1.5">
            <span className="text-[10px] font-medium text-indigo-400 mt-0.5 shrink-0">
              You
            </span>
            <p className="text-xs text-gray-300 leading-relaxed whitespace-pre-wrap flex-1 min-w-0">
              {displayedPrompt}
            </p>
          </div>
          {isLongPrompt && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setPromptCollapsed((v) => !v);
              }}
              className="mt-0.5 text-[10px] text-gray-600 hover:text-gray-400 transition-colors"
            >
              {promptCollapsed ? "Show more" : "Show less"}
            </button>
          )}
        </div>

        <div className="border-t border-gray-800/60 mx-2" />

        {/* Response */}
        <div className="px-3 pt-1.5 pb-1.5">
          <div className="text-xs text-gray-400 leading-relaxed prose prose-sm prose-invert max-w-none">
            {displayedResponse ? (
              <ReactMarkdown>{displayedResponse}</ReactMarkdown>
            ) : node.is_streaming ? (
              <span className="text-gray-600 italic text-[10px]">
                Thinking...
              </span>
            ) : (
              <span className="text-gray-700 italic text-[10px]">
                No response
              </span>
            )}
          </div>
          {isLongResponse && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setResponseCollapsed((v) => !v);
              }}
              className="mt-0.5 text-[10px] text-gray-600 hover:text-gray-400 transition-colors"
            >
              {responseCollapsed ? "Show more" : "Show less"}
            </button>
          )}
        </div>

        {/* Bottom bar */}
        <div className="flex items-center justify-between px-3 pb-2 pt-0.5">
          <span className="text-[10px] text-gray-700">{modelLabel}</span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (!streaming) onDelete();
            }}
            disabled={streaming || node.is_streaming}
            title="Delete node"
            className="opacity-0 group-hover:opacity-100 text-[10px] text-gray-600 hover:text-red-400 px-1.5 py-0.5 rounded hover:bg-gray-800 transition-all disabled:cursor-not-allowed"
          >
            delete
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── SVG edge ─── */

function EdgeLine({ from, to }: { from: LayoutNode; to: LayoutNode }) {
  const x1 = from.x + from.w / 2;
  const y1 = from.y + from.h;
  const x2 = to.x + to.w / 2;
  const y2 = to.y;

  const dy = y2 - y1;
  const cp = Math.max(20, dy * 0.45);

  return (
    <path
      d={`M ${x1} ${y1} C ${x1} ${y1 + cp}, ${x2} ${y2 - cp}, ${x2} ${y2}`}
      fill="none"
      stroke="#374151"
      strokeWidth="1.5"
    />
  );
}

/* ─── main tree view ─── */

export interface TreeViewProps {
  nodes: Record<string, Node>;
  rootNodeId: string | null;
  activeChildIndex: Record<string, number>;
  streaming: boolean;
  branchTarget: BranchTarget | null;
  onSetBranchTarget: (t: BranchTarget | null) => void;
  onNavigateSibling: (parentId: string, idx: number) => void;
  onDeleteNode: (nodeId: string) => void;
  zoom: number;
  onZoomChange: (z: number) => void;
}

export interface TreeViewHandle {
  zoomTo: (newZoom: number) => void;
}

const TreeView = forwardRef<TreeViewHandle, TreeViewProps>(function TreeView(
  {
    nodes,
    rootNodeId,
    streaming,
    branchTarget,
    onSetBranchTarget,
    onDeleteNode,
    zoom,
    onZoomChange,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 60, y: 40 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const [measuredHeights, setMeasuredHeights] = useState<Record<string, number>>({});

  const handleMeasure = useCallback((id: string, h: number) => {
    setMeasuredHeights((prev) => {
      if (prev[id] === h) return prev;
      return { ...prev, [id]: h };
    });
  }, []);

  const layoutRoot = useMemo(
    () => buildLayout(nodes, rootNodeId, measuredHeights),
    [nodes, rootNodeId, measuredHeights],
  );
  const flatNodes = useMemo(
    () => (layoutRoot ? flattenLayout(layoutRoot) : []),
    [layoutRoot],
  );
  const edges = useMemo(
    () => (layoutRoot ? collectEdges(layoutRoot) : []),
    [layoutRoot],
  );

  const bounds = useMemo(() => {
    if (flatNodes.length === 0) return { minX: 0, minY: 0, maxX: 800, maxY: 600 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of flatNodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.w);
      maxY = Math.max(maxY, n.y + n.h);
    }
    return { minX: minX - 40, minY: minY - 40, maxX: maxX + 40, maxY: maxY + 40 };
  }, [flatNodes]);

  // Center the tree on initial load
  const hasInitialized = useRef(false);
  useEffect(() => {
    if (!containerRef.current || flatNodes.length === 0) return;
    if (hasInitialized.current) return;
    hasInitialized.current = true;
    const rect = containerRef.current.getBoundingClientRect();
    const treeW = bounds.maxX - bounds.minX;
    const treeH = bounds.maxY - bounds.minY;
    const scale = Math.min(1, rect.width / treeW * 0.9, rect.height / treeH * 0.9);
    const z = Math.max(0.3, Math.min(1, scale));
    onZoomChange(z);
    setPan({
      x: (rect.width - treeW * z) / 2 - bounds.minX * z,
      y: 40,
    });
  }, [flatNodes, bounds, onZoomChange]);

  useEffect(() => {
    hasInitialized.current = false;
  }, [rootNodeId]);

  // Zoom toward the center of the viewport
  const zoomTo = useCallback(
    (newZoom: number) => {
      const clamped = Math.max(0.15, Math.min(2.5, newZoom));
      if (!containerRef.current) {
        onZoomChange(clamped);
        return;
      }
      const rect = containerRef.current.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      setPan((p) => ({
        x: cx - ((cx - p.x) / zoom) * clamped,
        y: cy - ((cy - p.y) / zoom) * clamped,
      }));
      onZoomChange(clamped);
    },
    [zoom, onZoomChange],
  );

  useImperativeHandle(ref, () => ({ zoomTo }), [zoomTo]);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const factor = e.deltaY > 0 ? 0.9 : 1.1;

        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        // Zoom toward the mouse pointer position
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const newZoom = Math.max(0.15, Math.min(2.5, zoom * factor));

        setPan((p) => ({
          x: mx - ((mx - p.x) / zoom) * newZoom,
          y: my - ((my - p.y) / zoom) * newZoom,
        }));
        onZoomChange(newZoom);
      } else {
        setPan((p) => ({
          x: p.x - e.deltaX,
          y: p.y - e.deltaY,
        }));
      }
    },
    [zoom, onZoomChange],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest("[data-tree-node]")) return;
      setDragging(true);
      dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    },
    [pan],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dragging) return;
      setPan({
        x: dragStart.current.panX + (e.clientX - dragStart.current.x),
        y: dragStart.current.panY + (e.clientY - dragStart.current.y),
      });
    },
    [dragging],
  );

  const handleMouseUp = useCallback(() => {
    setDragging(false);
  }, []);

  // Derive which node is "selected" from the branchTarget
  const selectedNodeId =
    branchTarget?.mode === "child" ? branchTarget.nodeId : null;

  function handleNodeClick(nodeId: string) {
    if (streaming) return;
    if (selectedNodeId === nodeId) {
      // Deselect
      onSetBranchTarget(null);
    } else {
      // Select — set as branch-from target
      onSetBranchTarget({ nodeId, mode: "child" });
    }
  }

  if (!layoutRoot) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">
        No nodes to display
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`flex-1 overflow-hidden relative ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: "0 0",
          position: "absolute",
          top: 0,
          left: 0,
        }}
      >
        {/* Edges */}
        <svg
          className="absolute pointer-events-none"
          style={{
            left: 0,
            top: 0,
            width: 1,
            height: 1,
            overflow: "visible",
          }}
        >
          {edges.map((e, i) => (
            <EdgeLine key={i} from={e.from} to={e.to} />
          ))}
        </svg>

        {/* Nodes */}
        {flatNodes.map((ln) => {
          const node = nodes[ln.id];
          if (!node) return null;
          return (
            <div key={ln.id} data-tree-node>
              <TreeNodeCard
                node={node}
                layout={ln}
                isSelected={selectedNodeId === ln.id}
                streaming={streaming}
                onClick={() => handleNodeClick(ln.id)}
                onMeasure={handleMeasure}
                onDelete={() => onDeleteNode(ln.id)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
});

export default TreeView;
