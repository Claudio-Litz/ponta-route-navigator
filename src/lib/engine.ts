// === Types ===
export type GroundType = 'asfalto' | 'terra' | 'brita';

export interface GraphNode {
  id: string;
  name: string;
  lat: number;
  lng: number;
  type: 'POI' | 'Junction';
  // Intersection detection
  isIntersection?: boolean;
  intersectionId?: string;
}

export interface RailwayCrossing {
  enabled: boolean;
  schedules: {
    start: number; // global simulated time (seconds)
    end: number;   // global simulated time (seconds)
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
  // Predictive traffic: time window (ms) within which two vehicles are considered conflicting
  trafficTimeWindow: number;
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

export type VehicleType = 'operational' | 'maintenance' | 'other';

// === Traffic types ===

export interface RouteStep {
  nodeId: string;
  eta: number; // absolute simulation time in ms (simTime * 1000)
}

export type RouteWithETA = RouteStep[];

export interface TrafficEntry {
  vehicleId: string;
  eta: number; // ms
}

export type TrafficMap = Map<string, TrafficEntry[]>;

/** Default conflict-detection window — 20 simulated seconds */
export const DEFAULT_TRAFFIC_TIME_WINDOW = 20_000; // ms

// === Vehicle ===
export interface Vehicle {
  id: string;
  name: string;
  color: string;
  originId: string;
  destinationId: string;
  speed: number;       // Velocidade máxima do veículo em km/h
  speedLimit: number;  // Limite de velocidade próprio do veículo em km/h
  size: number;        // Tamanho do veículo (genérico)
  width: number;       // metros
  height: number;      // metros
  type: VehicleType;
  waitingPoiId?: string;
  currentMissionId?: string;
  path: string[] | null;
  pathVersion: number;
  status: 'idle' | 'moving' | 'arrived' | 'stuck';
  needsRecalc: boolean;
  // Navigation
  instructionIndex: number;
  spoken500: boolean;
  spoken100: boolean;
  spoken50: boolean;
  navigationLogs: string[];
  currentTotalTime?: number;
  // Predictive traffic / ETA
  routeWithETA: RouteWithETA;
  currentRouteIndex: number;
}

// === Mission ===
export type MissionStatus = 'pending' | 'assigned' | 'in_progress' | 'completed';
export type MissionPriority = 'low' | 'medium' | 'high';

export interface Mission {
  id: string;
  destination: string;
  requiredType: VehicleType;
  priority: MissionPriority;
  assignedVehicleId?: string;
  /** When set, only this vehicle may be assigned — ignores proximity ranking */
  forcedVehicleId?: string;
  status: MissionStatus;
  createdAt: number;          // simTime (seconds) when mission was created
  startedAt?: number;         // simTime (seconds) when vehicle departed
  completedAt?: number;       // simTime (seconds) when vehicle arrived
  /** Estimated travel time in seconds from A* at the moment of first assignment */
  predictedDuration?: number;
  /** Origin node ID captured at assignment (vehicle may move before being assigned) */
  originNodeId?: string;
  /** Full path (node IDs) at assignment time, for the report */
  assignedPath?: string[];
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
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
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
  if (edge.hasMud) effectiveEdgeLimit = Math.min(effectiveEdgeLimit, MUD_SPEED_LIMIT);
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
  for (const s of edge.railwayCrossing.schedules) {
    if (arrivalTime >= s.start && arrivalTime < s.end) return s.end - arrivalTime;
  }
  return 0;
}

// ── Traffic / ETA helpers ──────────────────────────────────────────────────

/** Find the graph edge connecting fromId → toId (respecting directionality). */
export function findEdgeBetween(graph: Graph, fromId: string, toId: string): GraphEdge | undefined {
  for (const edge of graph.edges.values()) {
    if (edge.from === fromId && edge.to === toId) return edge;
    if (edge.bidirectional && edge.to === fromId && edge.from === toId) return edge;
  }
  return undefined;
}

/**
 * Build an ETA-annotated route from a resolved path.
 * startTimeSeconds = simTime at the moment routing begins.
 * ETAs are in simulated milliseconds.
 */
export function buildRouteWithETA(
  graph: Graph,
  path: string[],
  vehicle: Vehicle,
  startTimeSeconds: number
): RouteWithETA {
  if (path.length === 0) return [];
  const steps: RouteStep[] = [{ nodeId: path[0], eta: startTimeSeconds * 1000 }];

  for (let i = 0; i < path.length - 1; i++) {
    const edge = findEdgeBetween(graph, path[i], path[i + 1]);
    let travelTimeMs = 5_000; // 5 s fallback
    if (edge) {
      const speedKmh = calculateRealSpeed(vehicle, edge);
      const speedMs = speedKmh / 3.6;
      travelTimeMs = (edge.distance / Math.max(speedMs, 0.1)) * 1000;
    }
    steps.push({ nodeId: path[i + 1], eta: steps[steps.length - 1].eta + travelTimeMs });
  }
  return steps;
}

/**
 * Recompute isIntersection / intersectionId for every node in the graph.
 * A node is an intersection when it connects to more than 2 distinct neighbour nodes.
 */
export function computeIntersections(graph: Graph): void {
  for (const node of graph.nodes.values()) {
    const neighbours = new Set<string>();
    for (const edge of graph.edges.values()) {
      if (edge.from === node.id) neighbours.add(edge.to);
      if (edge.to === node.id) neighbours.add(edge.from);
    }
    node.isIntersection = neighbours.size > 2;
    if (node.isIntersection) {
      if (!node.intersectionId) node.intersectionId = `INT-${node.id.slice(0, 6)}`;
    } else {
      node.intersectionId = undefined;
    }
  }
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

  addEdge(fromId: string, toId: string, bidirectional: boolean, trafficTimeWindow?: number): GraphEdge | null {
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
      trafficTimeWindow: trafficTimeWindow ?? DEFAULT_TRAFFIC_TIME_WINDOW,
      railwayCrossing: { enabled: false, schedules: [] },
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
            const waitTime = currentTime !== undefined ? getRailwayWaitTime(edge, currentTime) : 0;
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
        trafficTimeWindow: DEFAULT_TRAFFIC_TIME_WINDOW,
        ...e,
        railwayCrossing,
      });
    });
    computeIntersections(this);
  }
}

// === A* Pathfinding with optional traffic weights ===
function heuristic(graph: Graph, aId: string, bId: string, vehicle?: Vehicle): number {
  const a = graph.nodes.get(aId);
  const b = graph.nodes.get(bId);
  if (!a || !b) return Infinity;
  const dist = haversine(a.lat, a.lng, b.lat, b.lng);
  if (vehicle) return dist / (vehicle.speed / 3.6);
  return dist;
}

/**
 * A* pathfinding extended with predictive traffic support.
 *
 * @param trafficWeights  Map<"nodeA->nodeB", exponentialPenalty> — from the traffic engine
 * @param vehiclePriority Controls how strongly traffic weight is applied:
 *   high   → 5%  (almost ignores traffic, keeps optimal path unless blocked)
 *   medium → 50% (moderately avoids congested edges)
 *   low    → 100% (fully respects traffic weight)
 */
export function findPath(
  graph: Graph,
  startId: string,
  goalId: string,
  vehicle?: Vehicle,
  startTime: number = 0,
  trafficWeights?: Map<string, number>,
  vehiclePriority: MissionPriority = 'medium'
): { path: string[]; totalCost: number; success: boolean } {
  if (!graph.nodes.has(startId) || !graph.nodes.has(goalId)) {
    return { path: [], totalCost: 0, success: false };
  }

  // How much this vehicle cares about traffic penalties
  const trafficFactor =
    vehiclePriority === 'high'   ? 0.05 :
    vehiclePriority === 'medium' ? 0.50 : 1.0;

  const openSet = new Set([startId]);
  const cameFrom = new Map<string, string>();
  const gScore = new Map<string, number>([[startId, 0]]);
  const fScore = new Map<string, number>([[startId, heuristic(graph, startId, goalId, vehicle)]]);

  while (openSet.size > 0) {
    let current = '';
    let lowestF = Infinity;
    for (const id of openSet) {
      const f = fScore.get(id) ?? Infinity;
      if (f < lowestF) { lowestF = f; current = id; }
    }

    if (current === goalId) {
      const path: string[] = [current];
      let c = current;
      while (cameFrom.has(c)) { c = cameFrom.get(c)!; path.unshift(c); }
      return { path, totalCost: gScore.get(goalId) ?? 0, success: true };
    }

    openSet.delete(current);
    const currentG = gScore.get(current) ?? Infinity;
    const currentTime = startTime + currentG;

    for (const { node: neighbor, cost } of graph.getNeighbors(current, vehicle, currentTime)) {
      // ── Apply traffic penalty (additive, proportional to edge cost) ────
      let finalCost = cost;
      if (trafficWeights && cost > 0) {
        const penalty = trafficWeights.get(`${current}->${neighbor.id}`) ?? 0;
        if (penalty > 0) {
          // custoFinal = custoBase + (custoBase × peso × fatorPrioridade)
          finalCost += cost * penalty * trafficFactor;
        }
      }

      const tentativeG = currentG + finalCost;
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
