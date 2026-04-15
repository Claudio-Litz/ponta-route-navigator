// === Types ===
export type GroundType = 'asfalto' | 'terra' | 'brita';

export interface GraphNode {
  id: string;
  name: string;
  lat: number;
  lng: number;
  type: 'POI' | 'Junction';
}

export interface RailwayCrossing {
  enabled: boolean;
  schedules: {
    start: number;    // global simulated time (seconds)
    end: number;      // global simulated time (seconds)
  }[];
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  bidirectional: boolean;
  isBlocked: boolean;
  distance: number;
  groundType: GroundType;
  hasMud: boolean;
  speedLimit: number; // km/h
  maxWidth: number;   // metros
  maxHeight: number;  // metros
  railwayCrossing?: RailwayCrossing;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export type NavigationDirection = 'straight' | 'left' | 'right' | 'return';

export interface NavigationInstruction {
  type: 'start' | 'turn' | 'arrival';
  distanceToJunction: number;
  direction: NavigationDirection;
  message: string;
  targetNodeId: string;
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
  // Navigation State
  instructionIndex: number;
  spoken500: boolean;
  spoken100: boolean;
  spoken50: boolean;
  navigationLogs: string[]; // Array de JSON strings
  currentTotalTime?: number; // Tempo total da rota atual em segundos
}

export interface LogEntry {
  id: string;
  timestamp: Date;
  message: string;
  type: 'info' | 'warning' | 'route' | 'block' | 'navigation';
}

// === Constants ===
const GROUND_FACTORS: Record<GroundType, number> = {
  asfalto: 1.0,
  terra: 0.7,
  brita: 0.5,
};

const MUD_SPEED_LIMIT = 30; // km/h

// === Helpers ===
export function secondsToHHMMSS(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export function hhmmssToSeconds(hhmmss: string): number {
  const parts = hhmmss.split(':').map(Number);
  if (parts.length !== 3) return 0;
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

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

export function calculateBearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  
  const y = Math.sin(toRad(lng2 - lng1)) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
            Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lng2 - lng1));
  const brng = toDeg(Math.atan2(y, x));
  return (brng + 360) % 360;
}

export function getRelativeDirection(angle: number): NavigationDirection {
  let normalized = angle;
  while (normalized > 180) normalized -= 360;
  while (normalized < -180) normalized += 360;

  if (normalized >= -30 && normalized <= 30) return 'straight';
  if (normalized > 30 && normalized <= 150) return 'right';
  if (normalized < -30 && normalized >= -150) return 'left';
  return 'return';
}

export function calculateRealSpeed(vehicle: Vehicle, edge: GraphEdge): number {
  const groundFactor = GROUND_FACTORS[edge.groundType] || 1.0;
  let effectiveEdgeLimit = edge.speedLimit * groundFactor;
  
  if (edge.hasMud) {
    effectiveEdgeLimit = Math.min(effectiveEdgeLimit, MUD_SPEED_LIMIT);
  }

  return Math.min(vehicle.speed, effectiveEdgeLimit);
}

export function canPass(vehicle: Vehicle, edge: GraphEdge): boolean {
  if (edge.isBlocked) return false;
  if (vehicle.width > edge.maxWidth) return false;
  if (vehicle.height > edge.maxHeight) return false;
  return true;
}

export function isRailwayBlocked(edge: GraphEdge, timeSeconds: number): boolean {
  if (!edge.railwayCrossing?.enabled) return false;
  return edge.railwayCrossing.schedules.some(s => 
    timeSeconds >= s.start && timeSeconds < s.end
  );
}

export function getRailwayWaitTime(edge: GraphEdge, arrivalTime: number): number {
  if (!edge.railwayCrossing?.enabled) return 0;
  
  let waitTime = 0;
  for (const s of edge.railwayCrossing.schedules) {
    if (arrivalTime >= s.start && arrivalTime < s.end) {
      waitTime = s.end - arrivalTime;
      break;
    }
  }
  return waitTime;
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
      railwayCrossing: { enabled: false, schedules: [] }
    };
    this.edges.set(edge.id, edge);
    return edge;
  }

  removeEdge(id: string) {
    this.edges.delete(id);
  }

  getNeighbors(nodeId: string, vehicle?: Vehicle, currentTime?: number): { node: GraphNode; cost: number; edge: GraphEdge }[] {
    const results: { node: GraphNode; cost: number; edge: GraphEdge }[] = [];
    for (const edge of this.edges.values()) {
      if (edge.from !== nodeId && !(edge.bidirectional && edge.to === nodeId)) continue;
      
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
            const travelTime = edge.distance / Math.max(speedMs, 0.1);
            
            let waitTime = 0;
            if (currentTime !== undefined) {
              waitTime = getRailwayWaitTime(edge, currentTime);
            }
            cost = travelTime + waitTime;
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
      // Migração de dados legados (duration para end)
      const railwayCrossing = e.railwayCrossing ? {
        ...e.railwayCrossing,
        schedules: e.railwayCrossing.schedules?.map((s: any) => ({
          start: s.start,
          end: s.end ?? (s.start + (s.duration || 0))
        })) || []
      } : { enabled: false, schedules: [] };

      this.edges.set(e.id, {
        groundType: 'asfalto',
        hasMud: false,
        speedLimit: 60,
        maxWidth: 5,
        maxHeight: 5,
        ...e,
        railwayCrossing
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
    return dist / (vehicle.speed / 3.6);
  }
  return dist;
}

export function findPath(
  graph: Graph,
  startId: string,
  goalId: string,
  vehicle?: Vehicle,
  startTime: number = 0
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
    const currentG = gScore.get(current) ?? Infinity;
    const currentTime = startTime + currentG;

    for (const { node: neighbor, cost } of graph.getNeighbors(current, vehicle, currentTime)) {
      const tentativeG = currentG + cost;
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
