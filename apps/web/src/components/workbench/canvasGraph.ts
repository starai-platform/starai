import type { CanvasNode, CanvasEdge, CanvasDocument } from "./canvasTypes";

export function indexedCanvasEdges(edges: CanvasEdge[], direction: "source" | "target") {
  const index = new Map<string, string[]>();
  for (const edge of edges) {
    const key = edge[direction];
    const connected = edge[direction === "source" ? "target" : "source"];
    const items = index.get(key);
    if (items) items.push(connected);
    else index.set(key, [connected]);
  }
  return index;
}

export function createsCycle(source: string, target: string, edges: CanvasEdge[]) {
  const outgoing = indexedCanvasEdges(edges, "source");
  const pending = [target];
  const visited = new Set<string>();
  while (pending.length) {
    const current = pending.pop();
    if (!current || visited.has(current)) continue;
    if (current === source) return true;
    visited.add(current);
    pending.push(...(outgoing.get(current) || []));
  }
  return false;
}

export function hasGraphCycle(nodes: CanvasNode[], edges: CanvasEdge[]) {
  const nodeIDs = new Set(nodes.map((node) => node.id));
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map<string, string[]>();
  edges.forEach((edge) => {
    if (!nodeIDs.has(edge.source) || !nodeIDs.has(edge.target)) return;
    indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) || []), edge.target]);
  });
  const queue = nodes.filter((node) => (indegree.get(node.id) || 0) === 0).map((node) => node.id);
  let visited = 0;
  while (queue.length) {
    const id = queue.shift();
    if (!id) continue;
    visited += 1;
    (outgoing.get(id) || []).forEach((target) => {
      const next = (indegree.get(target) || 0) - 1;
      indegree.set(target, next);
      if (next === 0) queue.push(target);
    });
  }
  return visited !== nodes.length;
}

export function validCanvasDocument(value: unknown): value is CanvasDocument {
  if (!value || typeof value !== "object") return false;
  const document = value as CanvasDocument;
  if (!Array.isArray(document.nodes) || !Array.isArray(document.edges)
    || document.nodes.length > 500 || document.edges.length > 1000) return false;
  const ids = new Set<string>();
  for (const node of document.nodes) {
    if (!node || typeof node.id !== "string" || !node.id.trim() || ids.has(node.id)
      || !["textInput", "framePairInput", "imageInput", "generator", "compositor", "contentResult"].includes(String(node.type))
      || !node.data || typeof node.data !== "object" || Array.isArray(node.data)
      || !Number.isFinite(node.position?.x) || !Number.isFinite(node.position?.y)) return false;
    ids.add(node.id);
  }
  const edgeIDs = new Set<string>();
  for (const edge of document.edges) {
    if (!edge || typeof edge.id !== "string" || !edge.id.trim() || edgeIDs.has(edge.id)
      || !ids.has(edge.source) || !ids.has(edge.target)) return false;
    edgeIDs.add(edge.id);
  }
  if (document.viewport && (!Number.isFinite(document.viewport.x) || !Number.isFinite(document.viewport.y)
    || !Number.isFinite(document.viewport.zoom) || document.viewport.zoom <= 0)) return false;
  return !hasGraphCycle(document.nodes, document.edges);
}

export function orderedGeneratorNodes(nodes: CanvasNode[], edges: CanvasEdge[]) {
  const byID = new Map(nodes.map((node) => [node.id, node]));
  const outgoing = indexedCanvasEdges(edges, "source");
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  edges.forEach((edge) => {
    if (byID.has(edge.source) && byID.has(edge.target)) {
      indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1);
    }
  });
  const queue = nodes.filter((node) => (indegree.get(node.id) || 0) === 0).map((node) => node.id);
  const ordered: CanvasNode[] = [];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const id = queue[cursor];
    if (!id) continue;
    const node = byID.get(id);
    if (node) ordered.push(node);
    for (const target of outgoing.get(id) || []) {
      if (!byID.has(target)) continue;
      const next = (indegree.get(target) || 0) - 1;
      indegree.set(target, next);
      if (next === 0) queue.push(target);
    }
  }
  return (ordered.length === nodes.length ? ordered : nodes).filter((node) => node.type === "generator" || node.type === "compositor");
}

export function collectUpstreamNodes(targetID: string, nodes: CanvasNode[], edges: CanvasEdge[]) {
  const byID = new Map(nodes.map((node) => [node.id, node]));
  const incoming = indexedCanvasEdges(edges, "target");
  const visited = new Set<string>([targetID]);
  const pending = [...(incoming.get(targetID) || [])];
  const upstream: CanvasNode[] = [];
  for (let cursor = 0; cursor < pending.length; cursor++) {
    const id = pending[cursor];
    if (!id || visited.has(id)) continue;
    visited.add(id);
    const node = byID.get(id);
    if (node) upstream.push(node);
    for (const source of incoming.get(id) || []) {
      if (!visited.has(source)) pending.push(source);
    }
  }
  return upstream;
}

export function collectDownstreamIDs(sourceID: string, edges: CanvasEdge[]) {
  const outgoing = indexedCanvasEdges(edges, "source");
  const visited = new Set<string>();
  const pending = [...(outgoing.get(sourceID) || [])];
  for (let cursor = 0; cursor < pending.length; cursor++) {
    const id = pending[cursor];
    if (!id || visited.has(id)) continue;
    visited.add(id);
    for (const target of outgoing.get(id) || []) {
      if (!visited.has(target)) pending.push(target);
    }
  }
  return visited;
}
