export interface Node {
  id: string;
  parent_id: string | null;
  children_ids: string[];
  prompt: string;
  response: string;
  model: string;
  is_streaming: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  model: string;
  root_node_id: string | null;
  user_id: string;
  updated_at: unknown;
}

export interface BranchTarget {
  nodeId: string;
  // child  → new message is a child of this node (↙ branch deeper)
  // sibling → new message is a child of this node's parent (↗ fork at same level)
  mode: "child" | "sibling";
}
