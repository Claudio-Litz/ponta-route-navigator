// === Types ===

export interface GraphNode {
  id: string;
  name: string;
  lat: number;
  lng: number;
  type: 'POI' | 'Junction';
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  bidirectional: boolean;
  isBlocked: boolean;
  distance: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface Vehicle {
  id: string;
  name: string;
  color: string;
  originId: string;
  destinationId: string;
  speed: number; // km/h
  path: string[] | null;
  pathVersion: number;
  status: 'idle' | 'moving' | 'arrived' | 'stuck';
  needsRecalc: boolean;
}

export interface LogEntry {
  id: string;
  timestamp: Date;
  message: string;
  type: 'info' | 'warning' | 'route' | 'block';
}

// === Haversine ===

export function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// === Graph ===

export class Graph {
  nodes: Map<string, GraphNode> = new Map();
  edges: Map<string, GraphEdge> = new Map();

  addNode(node: GraphNode) {
    this.nodes.set(node.id, node);
  }

  removeNode(id: string) {
    this.nodes.delete(id);
    for (const [eid, edge] of this.edges) {
      if (edge.from === id || edge.to === id) this.edges.delete(eid);
    }
  }

  addEdge(fromId: string, toId: string, bidirectional: boolean): GraphEdge | null {
    const from = this.nodes.get(fromId);
    const to = this.nodes.get(toId);
    if (!from || !to) return null;
    const edge: GraphEdge = {
      id: crypto.randomUUID(),
      from: fromId,
      to: toId,
      bidirectional,
      isBlocked: false,
      distance: haversine(from.lat, from.lng, to.lat, to.lng),
    };
    this.edges.set(edge.id, edge);
    return edge;
  }

  removeEdge(id: string) {
    this.edges.delete(id);
  }

  getNeighbors(nodeId: string): { node: GraphNode; cost: number }[] {
    const results: { node: GraphNode; cost: number }[] = [];
    for (const edge of this.edges.values()) {
      if (edge.isBlocked) continue;
      let neighborId: string | null = null;
      if (edge.from === nodeId) neighborId = edge.to;
      else if (edge.bidirectional && edge.to === nodeId) neighborId = edge.from;
      if (neighborId) {
        const n = this.nodes.get(neighborId);
        if (n) results.push({ node: n, cost: edge.distance });
      }
    }
    return results;
  }

  exportData(): GraphData {
    return {
      nodes: Array.from(this.nodes.values()),
      edges: Array.from(this.edges.values()),
    };
  }

  importData(data: GraphData) {
    this.nodes.clear();
    this.edges.clear();
    data.nodes.forEach((n) => this.nodes.set(n.id, n));
    data.edges.forEach((e) => this.edges.set(e.id, e));
  }
}

// === A* Pathfinding ===

function heuristic(graph: Graph, aId: string, bId: string): number {
  const a = graph.nodes.get(aId);
  const b = graph.nodes.get(bId);
  if (!a || !b) return Infinity;
  return haversine(a.lat, a.lng, b.lat, b.lng);
}

export function findPath(
  graph: Graph,
  startId: string,
  goalId: string
): { path: string[]; totalCost: number; success: boolean } {
  if (!graph.nodes.has(startId) || !graph.nodes.has(goalId)) {
    return { path: [], totalCost: 0, success: false };
  }

  const openSet = new Set([startId]);
  const cameFrom = new Map<string, string>();
  const gScore = new Map<string, number>([[startId, 0]]);
  const fScore = new Map<string, number>([[startId, heuristic(graph, startId, goalId)]]);

  while (openSet.size > 0) {
    let current = '';
    let lowestF = Infinity;
    for (const id of openSet) {
      const f = fScore.get(id) ?? Infinity;
      if (f < lowestF) {
        lowestF = f;
        current = id;
      }
    }

    if (current === goalId) {
      const path: string[] = [current];
      let c = current;
      while (cameFrom.has(c)) {
        c = cameFrom.get(c)!;
        path.unshift(c);
      }
      return { path, totalCost: gScore.get(goalId) ?? 0, success: true };
    }

    openSet.delete(current);

    for (const { node: neighbor, cost } of graph.getNeighbors(current)) {
      const tentativeG = (gScore.get(current) ?? Infinity) + cost;
      if (tentativeG < (gScore.get(neighbor.id) ?? Infinity)) {
        cameFrom.set(neighbor.id, current);
        gScore.set(neighbor.id, tentativeG);
        fScore.set(neighbor.id, tentativeG + heuristic(graph, neighbor.id, goalId));
        openSet.add(neighbor.id);
      }
    }
  }

  return { path: [], totalCost: 0, success: false };
}
