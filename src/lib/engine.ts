// === Types ===
export type GroundType = 'asfalto' | 'terra' | 'brita';

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
  // Novos atributos
  groundType: GroundType;
  hasMud: boolean;
  speedLimit: number; // km/h
  maxWidth: number;   // metros
  maxHeight: number;  // metros
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
  speed: number; // Velocidade máxima do veículo em km/h
  width: number; // metros
  height: number; // metros
  type: string;
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

// === Constants ===
const GROUND_FACTORS: Record<GroundType, number> = {
  asfalto: 1.0,
  terra: 0.7,
  brita: 0.5,
};

const MUD_SPEED_LIMIT = 30; // km/h

// === Helpers ===
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

/**
 * Calcula a velocidade real de um veículo em uma via específica.
 */
export function calculateRealSpeed(vehicle: Vehicle, edge: GraphEdge): number {
  const groundFactor = GROUND_FACTORS[edge.groundType] || 1.0;
  let effectiveEdgeLimit = edge.speedLimit * groundFactor;
  
  if (edge.hasMud) {
    effectiveEdgeLimit = Math.min(effectiveEdgeLimit, MUD_SPEED_LIMIT);
  }

  return Math.min(vehicle.speed, effectiveEdgeLimit);
}

/**
 * Verifica se o veículo pode passar pela via devido a restrições físicas.
 */
export function canPass(vehicle: Vehicle, edge: GraphEdge): boolean {
  if (edge.isBlocked) return false;
  if (vehicle.width > edge.maxWidth) return false;
  if (vehicle.height > edge.maxHeight) return false;
  return true;
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
      groundType: 'asfalto',
      hasMud: false,
      speedLimit: 60,
      maxWidth: 5,
      maxHeight: 5,
    };
    this.edges.set(edge.id, edge);
    return edge;
  }

  removeEdge(id: string) {
    this.edges.delete(id);
  }

  getNeighbors(nodeId: string, vehicle?: Vehicle): { node: GraphNode; cost: number; edge: GraphEdge }[] {
    const results: { node: GraphNode; cost: number; edge: GraphEdge }[] = [];
    for (const edge of this.edges.values()) {
      if (edge.from !== nodeId && !(edge.bidirectional && edge.to === nodeId)) continue;
      
      // Se um veículo for passado, aplicamos as restrições físicas e de bloqueio
      if (vehicle) {
        if (!canPass(vehicle, edge)) continue;
      } else if (edge.isBlocked) {
        continue;
      }

      let neighborId: string | null = null;
      if (edge.from === nodeId) neighborId = edge.to;
      else if (edge.bidirectional && edge.to === nodeId) neighborId = edge.from;

      if (neighborId) {
        const n = this.nodes.get(neighborId);
        if (n) {
          let cost = edge.distance;
          if (vehicle) {
            const speedKmh = calculateRealSpeed(vehicle, edge);
            const speedMs = speedKmh / 3.6;
            // Custo = tempo em segundos (Distância / Velocidade)
            cost = edge.distance / Math.max(speedMs, 0.1);
          }
          results.push({ node: n, cost, edge });
        }
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
    data.edges.forEach((e) => {
      // Garante retrocompatibilidade se os novos campos não existirem no JSON
      this.edges.set(e.id, {
        groundType: 'asfalto',
        hasMud: false,
        speedLimit: 60,
        maxWidth: 5,
        maxHeight: 5,
        ...e
      });
    });
  }
}

// === A* Pathfinding ===
function heuristic(graph: Graph, aId: string, bId: string, vehicle?: Vehicle): number {
  const a = graph.nodes.get(aId);
  const b = graph.nodes.get(bId);
  if (!a || !b) return Infinity;
  const dist = haversine(a.lat, a.lng, b.lat, b.lng);
  
  if (vehicle) {
    // Heurística baseada em tempo: Distância mínima / Velocidade máxima possível
    return dist / (vehicle.speed / 3.6);
  }
  return dist;
}

export function findPath(
  graph: Graph,
  startId: string,
  goalId: string,
  vehicle?: Vehicle
): { path: string[]; totalCost: number; success: boolean } {
  if (!graph.nodes.has(startId) || !graph.nodes.has(goalId)) {
    return { path: [], totalCost: 0, success: false };
  }

  const openSet = new Set([startId]);
  const cameFrom = new Map<string, string>();
  const gScore = new Map<string, number>([[startId, 0]]);
  const fScore = new Map<string, number>([[startId, heuristic(graph, startId, goalId, vehicle)]]);

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
    for (const { node: neighbor, cost } of graph.getNeighbors(current, vehicle)) {
      const tentativeG = (gScore.get(current) ?? Infinity) + cost;
      if (tentativeG < (gScore.get(neighbor.id) ?? Infinity)) {
        cameFrom.set(neighbor.id, current);
        gScore.set(neighbor.id, tentativeG);
        fScore.set(neighbor.id, tentativeG + heuristic(graph, neighbor.id, goalId, vehicle));
        openSet.add(neighbor.id);
      }
    }
  }

  return { path: [], totalCost: 0, success: false };
}
