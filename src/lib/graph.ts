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
  distance: number; // meters
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export class Graph {
  nodes: Map<string, GraphNode> = new Map();
  edges: Map<string, GraphEdge> = new Map();

  addNode(node: GraphNode) {
    this.nodes.set(node.id, node);
  }

  removeNode(id: string) {
    this.nodes.delete(id);
    // Remove connected edges
    for (const [eid, edge] of this.edges) {
      if (edge.from === id || edge.to === id) {
        this.edges.delete(eid);
      }
    }
  }

  addEdge(fromId: string, toId: string, bidirectional: boolean): GraphEdge | null {
    const from = this.nodes.get(fromId);
    const to = this.nodes.get(toId);
    if (!from || !to) return null;

    const id = crypto.randomUUID();
    const distance = haversine(from.lat, from.lng, to.lat, to.lng);
    const edge: GraphEdge = { id, from: fromId, to: toId, bidirectional, isBlocked: false, distance };
    this.edges.set(id, edge);
    return edge;
  }

  removeEdge(id: string) {
    this.edges.delete(id);
  }

  getNeighbors(nodeId: string): { node: GraphNode; edge: GraphEdge; cost: number }[] {
    const results: { node: GraphNode; edge: GraphEdge; cost: number }[] = [];
    for (const edge of this.edges.values()) {
      if (edge.isBlocked) continue;

      let neighborId: string | null = null;
      if (edge.from === nodeId) neighborId = edge.to;
      else if (edge.bidirectional && edge.to === nodeId) neighborId = edge.from;

      if (neighborId) {
        const neighbor = this.nodes.get(neighborId);
        if (neighbor) {
          results.push({ node: neighbor, edge, cost: edge.distance });
        }
      }
    }
    return results;
  }

  getPOIs(): GraphNode[] {
    return Array.from(this.nodes.values()).filter((n) => n.type === 'POI');
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

  static haversine = haversine;
}
