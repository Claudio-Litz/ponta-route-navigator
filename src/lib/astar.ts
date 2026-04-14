import { Graph } from './graph';

export interface AStarResult {
  path: string[]; // node IDs
  totalCost: number;
  success: boolean;
}

export class AStar {
  private graph: Graph;

  constructor(graph: Graph) {
    this.graph = graph;
  }

  private heuristic(aId: string, bId: string): number {
    const a = this.graph.nodes.get(aId);
    const b = this.graph.nodes.get(bId);
    if (!a || !b) return Infinity;
    return Graph.haversine(a.lat, a.lng, b.lat, b.lng);
  }

  findPath(startId: string, goalId: string): AStarResult {
    if (!this.graph.nodes.has(startId) || !this.graph.nodes.has(goalId)) {
      return { path: [], totalCost: 0, success: false };
    }

    const openSet = new Set<string>([startId]);
    const cameFrom = new Map<string, string>();
    const gScore = new Map<string, number>();
    const fScore = new Map<string, number>();

    gScore.set(startId, 0);
    fScore.set(startId, this.heuristic(startId, goalId));

    while (openSet.size > 0) {
      // Get node with lowest fScore
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
        // Reconstruct path
        const path: string[] = [current];
        let c = current;
        while (cameFrom.has(c)) {
          c = cameFrom.get(c)!;
          path.unshift(c);
        }
        return { path, totalCost: gScore.get(goalId) ?? 0, success: true };
      }

      openSet.delete(current);

      for (const { node: neighbor, cost } of this.graph.getNeighbors(current)) {
        const tentativeG = (gScore.get(current) ?? Infinity) + cost;
        if (tentativeG < (gScore.get(neighbor.id) ?? Infinity)) {
          cameFrom.set(neighbor.id, current);
          gScore.set(neighbor.id, tentativeG);
          fScore.set(neighbor.id, tentativeG + this.heuristic(neighbor.id, goalId));
          openSet.add(neighbor.id);
        }
      }
    }

    return { path: [], totalCost: 0, success: false };
  }
}
