import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Graph, GraphNode, GraphEdge, GraphData, Vehicle, VehicleType, Mission, MissionPriority,
  RouteWithETA, TrafficEntry, DEFAULT_TRAFFIC_TIME_WINDOW,
  LogEntry, findPath, findEdgeBetween, buildRouteWithETA, computeIntersections,
  haversine, calculateBearing, getRelativeDirection, NavigationDirection,
  secondsToHHMMSS,
} from '@/lib/engine';

export type AppMode = 'editor' | 'simulation';

const VEHICLE_COLORS = ['#3b82f6', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4'];
const TIME_SCALE = 3;
const PRIORITY_ORDER: Record<MissionPriority, number> = { high: 0, medium: 1, low: 2 };

export function useSimulation() {
  const graphRef = useRef(new Graph());
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [mode, setMode] = useState<AppMode>('editor');
  const [selectedNodes, setSelectedNodes] = useState<string[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [simulationRunning, setSimulationRunning] = useState(false);
  const [focusedVehicleId, setFocusedVehicleId] = useState<string | null>(null);
  const [trafficWeights, setTrafficWeights] = useState<Map<string, number>>(new Map());
  const [simTime, setSimTime] = useState(0);
  const lastRealTimeRef = useRef<number>(0);

  // Always-current refs for use inside intervals/callbacks
  const vehiclesRef = useRef<Vehicle[]>([]);
  useEffect(() => { vehiclesRef.current = vehicles; }, [vehicles]);
  const missionsRef = useRef<Mission[]>([]);
  useEffect(() => { missionsRef.current = missions; }, [missions]);
  const simTimeRef = useRef<number>(0);
  useEffect(() => { simTimeRef.current = simTime; }, [simTime]);
  const simulationRunningRef = useRef(false);
  useEffect(() => { simulationRunningRef.current = simulationRunning; }, [simulationRunning]);
  const focusedVehicleIdRef = useRef<string | null>(null);
  useEffect(() => { focusedVehicleIdRef.current = focusedVehicleId; }, [focusedVehicleId]);
  const trafficWeightsRef = useRef<Map<string, number>>(new Map());

  // Stable ref pointing to the assignment engine (avoids circular deps)
  const runAssignmentRef = useRef<() => void>(() => { });

  // Default traffic time window — persisted in localStorage
  const defaultTrafficWindowRef = useRef<number>(
    parseInt(localStorage.getItem('ponta-trafficTimeWindow') ?? String(DEFAULT_TRAFFIC_TIME_WINDOW))
  );

  // ── Clock ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    let frame: number;
    const tick = () => {
      if (simulationRunning) {
        const now = Date.now();
        if (lastRealTimeRef.current > 0) {
          const dt = (now - lastRealTimeRef.current) / 1000;
          setSimTime(prev => prev + dt * TIME_SCALE);
        }
        lastRealTimeRef.current = now;
      } else {
        lastRealTimeRef.current = 0;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [simulationRunning]);

  // ── Traffic detection + periodic recalculation (every 1 real second) ──────
  //
  // Algorithm per tick:
  //  1. Build TrafficMap from all moving vehicles' routeWithETA (future segments only).
  //  2. For each edge key, detect conflict pairs (|eta_i - eta_j| ≤ trafficTimeWindow).
  //  3. Compute exponential weight: Math.pow(1.5, vehicleCount) - 1.
  //  4. Periodic re-route: for each moving vehicle, re-run A* with weights.
  //     Accept new route only if cost differs > 2%.
  //     High-priority vehicles are never rerouted to a longer path.

  useEffect(() => {
    if (!simulationRunning) {
      trafficWeightsRef.current = new Map();
      setTrafficWeights(new Map());
      return;
    }

    const id = setInterval(() => {
      const currentVehicles = vehiclesRef.current;
      const currentMissions = missionsRef.current;
      const currentTimeMs = simTimeRef.current * 1000;

      // ─ 1. Build traffic map (future segments only) ──────────────────────
      const trafficMap = new Map<string, TrafficEntry[]>();
      for (const v of currentVehicles) {
        if (v.status !== 'moving' || !v.routeWithETA || v.routeWithETA.length < 2) continue;
        for (let i = 0; i < v.routeWithETA.length - 1; i++) {
          const step = v.routeWithETA[i];
          const next = v.routeWithETA[i + 1];
          if (next.eta < currentTimeMs) continue; // already traversed
          const key = `${step.nodeId}->${next.nodeId}`;
          if (!trafficMap.has(key)) trafficMap.set(key, []);
          trafficMap.get(key)!.push({ vehicleId: v.id, eta: step.eta });
        }
      }

      // ─ 2. Detect conflicts → exponential weights ────────────────────────
      const weights = new Map<string, number>();
      for (const [key, entries] of trafficMap) {
        if (entries.length <= 1) continue;
        const [fromId, toId] = key.split('->');
        const edge = findEdgeBetween(graphRef.current, fromId, toId);
        const timeWindow = edge?.trafficTimeWindow ?? DEFAULT_TRAFFIC_TIME_WINDOW;

        let hasConflict = false;
        outer: for (let i = 0; i < entries.length; i++) {
          for (let j = i + 1; j < entries.length; j++) {
            if (Math.abs(entries[i].eta - entries[j].eta) <= timeWindow) {
              hasConflict = true;
              break outer;
            }
          }
        }

        if (hasConflict) {
          // peso = 1.5^n − 1  (n = total vehicles predicted on this segment)
          weights.set(key, Math.pow(1.5, entries.length) - 1);
        }
      }

      trafficWeightsRef.current = weights;
      setTrafficWeights(new Map(weights));
      // Rerouting of moving vehicles is intentionally NOT done here.
      // It happens at natural node boundaries via onRecalcNeeded in MapView.
    }, 1000);

    return () => clearInterval(id);
  }, [simulationRunning]);

  // ── Logging / Speech ──────────────────────────────────────────────────────

  const addLog = useCallback((message: string, type: LogEntry['type'] = 'info') => {
    setLogs(prev => [
      { id: crypto.randomUUID(), timestamp: new Date(), message, type },
      ...prev.slice(0, 99),
    ]);
  }, []);

  const speak = useCallback((text: string, vehicleId?: string) => {
    if (focusedVehicleIdRef.current && vehicleId && focusedVehicleIdRef.current !== vehicleId) return;
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'pt-BR';
      u.rate = 1.1;
      window.speechSynthesis.speak(u);
    }
  }, []);

  const sync = useCallback(() => {
    computeIntersections(graphRef.current);
    setNodes(Array.from(graphRef.current.nodes.values()));
    setEdges(Array.from(graphRef.current.edges.values()));
  }, []);

  // ── TETRA / Navigation ────────────────────────────────────────────────────

  const generateTetraMessage = useCallback((vehicle: Vehicle, _type: string, distance: number, direction: NavigationDirection, message: string) => {
    const jsonStr = JSON.stringify({ vehicle_id: vehicle.id, type: 'navigation', distance, direction, message, timestamp: new Date().toISOString() });
    setVehicles(prev => prev.map(v => v.id === vehicle.id ? { ...v, navigationLogs: [...v.navigationLogs, jsonStr] } : v));
    addLog(`[TETRA ${vehicle.name}] ${message}`, 'navigation');
    speak(message, vehicle.id);
  }, [addLog, speak]);

  const processNavigation = useCallback((vehicleId: string, currentLat: number, currentLng: number, segmentIndex: number) => {
    const vehicle = vehiclesRef.current.find(v => v.id === vehicleId);
    if (!vehicle || !vehicle.path || vehicle.status !== 'moving') return;

    const path = vehicle.path;
    const nm = graphRef.current.nodes;
    let nextJunctionIndex = -1;
    for (let i = segmentIndex + 1; i < path.length; i++) {
      const node = nm.get(path[i]);
      if (node?.type === 'Junction' || i === path.length - 1) { nextJunctionIndex = i; break; }
    }
    if (nextJunctionIndex === -1) return;

    const targetNode = nm.get(path[nextJunctionIndex]);
    if (!targetNode) return;

    const distance = haversine(currentLat, currentLng, targetNode.lat, targetNode.lng);

    let direction: NavigationDirection = 'straight';
    if (nextJunctionIndex > 0 && nextJunctionIndex < path.length - 1) {
      const prevNode = nm.get(path[nextJunctionIndex - 1]);
      const nextNode = nm.get(path[nextJunctionIndex + 1]);
      if (prevNode && nextNode) {
        const b1 = calculateBearing(prevNode.lat, prevNode.lng, targetNode.lat, targetNode.lng);
        const b2 = calculateBearing(targetNode.lat, targetNode.lng, nextNode.lat, nextNode.lng);
        direction = getRelativeDirection(b2 - b1);
      }
    }

    const directionText = { straight: 'siga em frente', left: 'vire à esquerda', right: 'vire à direita', return: 'faça o retorno' }[direction];

    if (nextJunctionIndex !== vehicle.instructionIndex) {
      setVehicles(prev => prev.map(v => v.id === vehicleId ? { ...v, instructionIndex: nextJunctionIndex, spoken500: false, spoken100: false, spoken50: false } : v));
      return;
    }

    if (distance <= 500 && distance > 100 && !vehicle.spoken500) {
      generateTetraMessage(vehicle, 'navigation', 500, direction, `Em 500 metros, ${directionText}`);
      setVehicles(prev => prev.map(v => v.id === vehicleId ? { ...v, spoken500: true } : v));
    } else if (distance <= 100 && distance > 50 && !vehicle.spoken100) {
      generateTetraMessage(vehicle, 'navigation', 100, direction, `Em 100 metros, ${directionText}`);
      setVehicles(prev => prev.map(v => v.id === vehicleId ? { ...v, spoken100: true } : v));
    } else if (distance <= 50 && distance > 5 && !vehicle.spoken50) {
      generateTetraMessage(vehicle, 'navigation', 50, direction, direction === 'straight' ? `Siga em frente por mais alguns metros` : directionText);
      setVehicles(prev => prev.map(v => v.id === vehicleId ? { ...v, spoken50: true } : v));
    }
  }, [generateTetraMessage]);

  const exportVehicleLog = useCallback((vehicleId: string) => {
    const vehicle = vehiclesRef.current.find(v => v.id === vehicleId);
    if (!vehicle || vehicle.navigationLogs.length === 0) return;
    const blob = new Blob([vehicle.navigationLogs.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `log_${vehicle.name.replace(/\s+/g, '_')}.txt`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  // ── Graph operations ──────────────────────────────────────────────────────

  const addNode = useCallback((lat: number, lng: number, type: GraphNode['type']) => {
    const count = graphRef.current.nodes.size + 1;
    const node: GraphNode = { id: crypto.randomUUID(), name: type === 'POI' ? `POI-${count}` : `J-${count}`, lat, lng, type };
    graphRef.current.addNode(node);
    sync();
    addLog(`Nó "${node.name}" criado.`);
  }, [sync, addLog]);

  const removeNode = useCallback((id: string) => { graphRef.current.removeNode(id); sync(); }, [sync]);

  const selectNodeForEdge = useCallback((id: string) => {
    setSelectedNodes(prev => {
      if (prev.includes(id)) return prev.filter(i => i !== id);
      if (prev.length === 1) {
        graphRef.current.addEdge(prev[0], id, true, defaultTrafficWindowRef.current);
        sync();
        return [];
      }
      return [id];
    });
  }, [sync]);

  const toggleEdgeDirection = useCallback((id: string) => {
    const edge = graphRef.current.edges.get(id);
    if (edge) { edge.bidirectional = !edge.bidirectional; sync(); }
  }, [sync]);

  const toggleEdgeBlock = useCallback((id: string) => {
    const edge = graphRef.current.edges.get(id);
    if (edge) {
      edge.isBlocked = !edge.isBlocked;
      sync();
      if (simulationRunningRef.current) {
        setVehicles(prev => prev.map(v => ({ ...v, needsRecalc: true })));
        addLog(`Via ${edge.isBlocked ? 'bloqueada' : 'desbloqueada'}, recalculando rotas...`, 'block');
      }
    }
  }, [sync, addLog]);

  const updateEdgeAttribute = useCallback((id: string, field: keyof GraphEdge, value: any) => {
    const edge = graphRef.current.edges.get(id);
    if (edge) {
      (edge as any)[field] = value;
      sync();
      // Persist last used trafficTimeWindow for new edges
      if (field === 'trafficTimeWindow') {
        defaultTrafficWindowRef.current = value as number;
        localStorage.setItem('ponta-trafficTimeWindow', String(value));
      }
      if (simulationRunningRef.current) setVehicles(prev => prev.map(v => ({ ...v, needsRecalc: true })));
    }
  }, [sync]);

  const removeEdge = useCallback((id: string) => { graphRef.current.removeEdge(id); sync(); }, [sync]);

  const updateNodeName = useCallback((id: string, name: string) => {
    const node = graphRef.current.nodes.get(id);
    if (node) { node.name = name; sync(); }
  }, [sync]);

  const updateNodeType = useCallback((id: string, type: GraphNode['type']) => {
    const node = graphRef.current.nodes.get(id);
    if (node) { node.type = type; sync(); }
  }, [sync]);

  // ── MISSION ASSIGNMENT ENGINE ─────────────────────────────────────────────

  const runAssignment = useCallback(() => {
    const vehicles = vehiclesRef.current.map(v => ({ ...v }));
    const missions = missionsRef.current.map(m => ({ ...m }));

    const pending = missions
      .filter(m => m.status === 'pending')
      .sort((a, b) => {
        const pd = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
        return pd !== 0 ? pd : a.createdAt - b.createdAt;
      });

    if (pending.length === 0) return;

    let changed = false;
    const tw = trafficWeightsRef.current;

    for (const mission of pending) {
      const mIdx = missions.findIndex(m => m.id === mission.id);
      if (mIdx === -1) continue;

      // ── Forced vehicle assignment ─────────────────────────────────────────
      // If the mission specifies a particular vehicle, only that one can fulfill it.
      if (mission.forcedVehicleId) {
        const forced = vehicles.find(v => v.id === mission.forcedVehicleId);
        if (!forced) continue; // vehicle was removed — keep pending

        if (forced.status === 'idle') {
          // Assign normally
          const vIdx = vehicles.findIndex(v => v.id === forced.id);
          const origin = forced.waitingPoiId || forced.originId;
          const destName = graphRef.current.nodes.get(mission.destination)?.name ?? '?';

          // Instant completion check
          if (origin === mission.destination) {
            missions[mIdx] = { ...missions[mIdx], status: 'completed', assignedVehicleId: forced.id, completedAt: simTimeRef.current };
            vehicles[vIdx] = { ...vehicles[vIdx], currentMissionId: undefined };
            changed = true;
            addLog(`✓ ${forced.name} já estava em "${destName}" → missão concluída!`, 'route');
            continue;
          }

          const pathResult = origin
            ? findPath(graphRef.current, origin, mission.destination, forced, simTimeRef.current, tw, mission.priority)
            : { success: false, path: [] as string[], totalCost: 0 };

          const isRunning = simulationRunningRef.current;
          missions[mIdx] = {
            ...missions[mIdx],
            status: isRunning ? 'in_progress' : 'assigned',
            assignedVehicleId: forced.id,
            ...(isRunning ? { startedAt: simTimeRef.current } : {}),
          };
          vehicles[vIdx] = {
            ...vehicles[vIdx],
            currentMissionId: mission.id,
            destinationId: mission.destination,
            status: isRunning && pathResult.success ? 'moving' : 'idle',
            path: isRunning && pathResult.success ? pathResult.path : null,
            pathVersion: vehicles[vIdx].pathVersion + (isRunning && pathResult.success ? 1 : 0),
            needsRecalc: false, instructionIndex: -1,
            spoken500: false, spoken100: false, spoken50: false,
            currentTotalTime: pathResult.success ? pathResult.totalCost : undefined,
            routeWithETA: (isRunning && pathResult.success)
              ? buildRouteWithETA(graphRef.current, pathResult.path, forced, simTimeRef.current)
              : [],
            currentRouteIndex: 0,
          };
          changed = true;
          const eta = pathResult.success ? (pathResult.totalCost / 60).toFixed(1) : '?';
          addLog(`📌 ${forced.name} forçado → "${destName}" (ETA ${eta} min)`, 'route');
          continue;
        }

        // Forced vehicle is moving — only preempt if new mission is high priority
        // and the current mission is NOT also high priority
        if (
          mission.priority === 'high' &&
          forced.status === 'moving' &&
          forced.currentMissionId
        ) {
          const forcedMission = missions.find(m => m.id === forced.currentMissionId);
          if (forcedMission && forcedMission.priority !== 'high') {
            const vIdx = vehicles.findIndex(v => v.id === forced.id);
            const vmIdx = missions.findIndex(m => m.id === forced.currentMissionId);
            const oldDestName = vmIdx >= 0 ? (graphRef.current.nodes.get(missions[vmIdx].destination)?.name ?? '?') : '?';
            const destName = graphRef.current.nodes.get(mission.destination)?.name ?? '?';

            if (vmIdx >= 0) missions[vmIdx] = { ...missions[vmIdx], status: 'pending', assignedVehicleId: undefined, startedAt: undefined };

            const origin = forced.waitingPoiId || forced.originId;
            const pathResult = origin
              ? findPath(graphRef.current, origin, mission.destination, forced, simTimeRef.current, tw, 'high')
              : { success: false, path: [] as string[], totalCost: 0 };

            missions[mIdx] = { ...missions[mIdx], status: 'in_progress', assignedVehicleId: forced.id, startedAt: simTimeRef.current };
            vehicles[vIdx] = {
              ...vehicles[vIdx],
              currentMissionId: mission.id, destinationId: mission.destination, status: 'moving',
              path: pathResult.success ? pathResult.path : null,
              pathVersion: vehicles[vIdx].pathVersion + 1,
              needsRecalc: false, instructionIndex: -1,
              spoken500: false, spoken100: false, spoken50: false,
              currentTotalTime: pathResult.success ? pathResult.totalCost : undefined,
              routeWithETA: pathResult.success
                ? buildRouteWithETA(graphRef.current, pathResult.path, forced, simTimeRef.current)
                : [],
              currentRouteIndex: 0,
            };
            changed = true;
            addLog(`🚨 ${forced.name} (forçado): "${oldDestName}" → "${destName}" (urgente)`, 'warning');
            continue;
          }
        }
        // Forced vehicle is busy and can't be preempted — keep mission pending, retry next tick
        continue;
      }

      // ── Automatic vehicle selection ───────────────────────────────────────
      const idleCandidates = vehicles.filter(v => v.status === 'idle' && v.type === mission.requiredType && !v.currentMissionId);

      if (idleCandidates.length > 0) {
        let best: Vehicle | null = null;
        let bestEta = Infinity;

        for (const candidate of idleCandidates) {
          const origin = candidate.waitingPoiId || candidate.originId;
          if (!origin) continue;
          if (origin === mission.destination) { best = candidate; bestEta = 0; break; }
          const result = findPath(graphRef.current, origin, mission.destination, candidate, simTimeRef.current, tw, mission.priority);
          if (result.success && result.totalCost < bestEta) { bestEta = result.totalCost; best = candidate; }
        }

        if (!best) continue;
        const vIdx = vehicles.findIndex(v => v.id === best!.id);
        if (vIdx === -1) continue;

        const destName = graphRef.current.nodes.get(mission.destination)?.name ?? '?';

        if (bestEta === 0) {
          missions[mIdx] = { ...missions[mIdx], status: 'completed', assignedVehicleId: best.id, completedAt: simTimeRef.current };
          vehicles[vIdx] = { ...vehicles[vIdx], currentMissionId: undefined };
          changed = true;
          addLog(`✓ ${best.name} já estava em "${destName}" → missão concluída!`, 'route');
          continue;
        }

        const origin = best.waitingPoiId || best.originId;
        const pathResult = origin
          ? findPath(graphRef.current, origin, mission.destination, best, simTimeRef.current, tw, mission.priority)
          : { success: false, path: [] as string[], totalCost: 0 };

        const isRunning = simulationRunningRef.current;
        missions[mIdx] = {
          ...missions[mIdx],
          status: isRunning ? 'in_progress' : 'assigned',
          assignedVehicleId: best.id,
          ...(isRunning ? { startedAt: simTimeRef.current } : {}),
          // Capture prediction fields only on first assignment
          predictedDuration: missions[mIdx].predictedDuration ?? (pathResult.success ? pathResult.totalCost : undefined),
          originNodeId: missions[mIdx].originNodeId ?? (origin || undefined),
          assignedPath: missions[mIdx].assignedPath ?? (pathResult.success ? pathResult.path : undefined),
        };

        vehicles[vIdx] = {
          ...vehicles[vIdx],
          currentMissionId: mission.id,
          destinationId: mission.destination,
          status: isRunning && pathResult.success ? 'moving' : 'idle',
          path: isRunning && pathResult.success ? pathResult.path : null,
          pathVersion: vehicles[vIdx].pathVersion + (isRunning && pathResult.success ? 1 : 0),
          needsRecalc: false,
          instructionIndex: -1,
          spoken500: false, spoken100: false, spoken50: false,
          currentTotalTime: pathResult.success ? pathResult.totalCost : undefined,
          routeWithETA: (isRunning && pathResult.success)
            ? buildRouteWithETA(graphRef.current, pathResult.path, best, simTimeRef.current)
            : [],
          currentRouteIndex: 0,
        };

        changed = true;
        addLog(`✓ ${best.name} → "${destName}" (ETA ${(bestEta / 60).toFixed(1)} min)`, 'route');

      } else if (mission.priority === 'high') {
        // Preempt a vehicle doing a non-high mission of the correct type
        const preemptable = vehicles.filter(v => {
          if (v.status !== 'moving' || v.type !== mission.requiredType || !v.currentMissionId) return false;
          const vm = missions.find(m => m.id === v.currentMissionId);
          return vm && vm.priority !== 'high';
        });
        if (preemptable.length === 0) continue;

        let victim = preemptable[0];
        let victimEta = Infinity;
        for (const c of preemptable) {
          const origin = c.waitingPoiId || c.originId;
          if (!origin) continue;
          const r = findPath(graphRef.current, origin, mission.destination, c, simTimeRef.current, tw, 'high');
          if (r.success && r.totalCost < victimEta) { victimEta = r.totalCost; victim = c; }
        }

        const vIdx = vehicles.findIndex(v => v.id === victim.id);
        const victimMIdx = missions.findIndex(m => m.id === victim.currentMissionId);
        const destName = graphRef.current.nodes.get(mission.destination)?.name ?? '?';
        const oldDestName = victimMIdx >= 0 ? (graphRef.current.nodes.get(missions[victimMIdx].destination)?.name ?? '?') : '?';

        if (victimMIdx >= 0) {
          missions[victimMIdx] = { ...missions[victimMIdx], status: 'pending', assignedVehicleId: undefined, startedAt: undefined };
        }

        const origin = victim.waitingPoiId || victim.originId;
        const pathResult = origin
          ? findPath(graphRef.current, origin, mission.destination, victim, simTimeRef.current, tw, 'high')
          : { success: false, path: [] as string[], totalCost: 0 };

        missions[mIdx] = { ...missions[mIdx], status: 'in_progress', assignedVehicleId: victim.id, startedAt: simTimeRef.current };
        vehicles[vIdx] = {
          ...vehicles[vIdx],
          currentMissionId: mission.id,
          destinationId: mission.destination,
          status: 'moving',
          path: pathResult.success ? pathResult.path : null,
          pathVersion: vehicles[vIdx].pathVersion + 1,
          needsRecalc: false,
          instructionIndex: -1,
          spoken500: false, spoken100: false, spoken50: false,
          currentTotalTime: pathResult.success ? pathResult.totalCost : undefined,
          routeWithETA: pathResult.success
            ? buildRouteWithETA(graphRef.current, pathResult.path, victim, simTimeRef.current)
            : [],
          currentRouteIndex: 0,
        };

        changed = true;
        addLog(`🚨 ${victim.name}: "${oldDestName}" → "${destName}" (urgente)`, 'warning');
      }
    }

    if (changed) {
      vehiclesRef.current = vehicles;
      missionsRef.current = missions;
      setVehicles(vehicles);
      setMissions(missions);
    }
  }, [addLog]);

  useEffect(() => { runAssignmentRef.current = runAssignment; }, [runAssignment]);

  // Continuous polling: retry pending missions every 500 ms
  useEffect(() => {
    const id = setInterval(() => {
      if (missionsRef.current.some(m => m.status === 'pending')) runAssignmentRef.current();
    }, 500);
    return () => clearInterval(id);
  }, []);

  // ── Vehicle CRUD ──────────────────────────────────────────────────────────

  const addVehicle = useCallback((options?: { name?: string; vehicleType?: VehicleType; waitingPoiId?: string }) => {
    const newVehicle: Vehicle = {
      id: crypto.randomUUID(),
      name: options?.name?.trim() || `Veículo ${vehiclesRef.current.length + 1}`,
      color: VEHICLE_COLORS[vehiclesRef.current.length % VEHICLE_COLORS.length],
      originId: options?.waitingPoiId ?? '',
      destinationId: '',
      speed: 60,
      speedLimit: 120,
      size: 1,
      width: 2.5,
      height: 3.0,
      type: options?.vehicleType ?? 'operational',
      waitingPoiId: options?.waitingPoiId || undefined,
      currentMissionId: undefined,
      path: null,
      pathVersion: 0,
      status: 'idle',
      needsRecalc: false,
      instructionIndex: -1,
      spoken500: false, spoken100: false, spoken50: false,
      navigationLogs: [],
      routeWithETA: [],
      currentRouteIndex: 0,
    };

    const newVehicles = [...vehiclesRef.current, newVehicle];
    vehiclesRef.current = newVehicles;
    setVehicles(newVehicles);
    runAssignmentRef.current();
  }, []);

  const removeVehicle = useCallback((id: string) => {
    setVehicles(prev => prev.filter(v => v.id !== id));
    if (focusedVehicleIdRef.current === id) setFocusedVehicleId(null);
  }, []);

  const updateVehicle = useCallback((id: string, field: string, value: any) => {
    setVehicles(prev => prev.map(v => v.id === id ? { ...v, [field]: value, needsRecalc: true } : v));
  }, []);

  // ── Mission CRUD ──────────────────────────────────────────────────────────

  const addMission = useCallback((destination: string, requiredType: VehicleType, priority: MissionPriority, forcedVehicleId?: string) => {
    const newMission: Mission = {
      id: crypto.randomUUID(),
      destination,
      requiredType,
      priority,
      forcedVehicleId,
      status: 'pending',
      createdAt: simTimeRef.current,
    };
    missionsRef.current = [...missionsRef.current, newMission];
    setMissions([...missionsRef.current]);
    addLog(`📋 Nova missão criada (${priority} | ${requiredType})`, 'info');
    runAssignment();
  }, [addLog, runAssignment]);

  const removeMission = useCallback((id: string) => {
    const mission = missionsRef.current.find(m => m.id === id);
    if (mission?.assignedVehicleId) {
      const updatedVehicles = vehiclesRef.current.map(v =>
        v.id === mission.assignedVehicleId
          ? { ...v, currentMissionId: undefined, status: 'idle' as const, path: null, routeWithETA: [] as RouteWithETA }
          : v
      );
      vehiclesRef.current = updatedVehicles;
      setVehicles(updatedVehicles);
    }
    const newMissions = missionsRef.current.filter(m => m.id !== id);
    missionsRef.current = newMissions;
    setMissions(newMissions);
    runAssignmentRef.current();
  }, []);

  // ── Simulation control ────────────────────────────────────────────────────

  const startSimulation = useCallback(() => {
    const currentMissions = missionsRef.current;

    const newVehicles = vehiclesRef.current.map(v => {
      if (v.currentMissionId) {
        const mission = currentMissions.find(m => m.id === v.currentMissionId);
        if (!mission) return v;
        const origin = v.waitingPoiId || v.originId;
        if (!origin || !mission.destination) return v;
        const result = findPath(graphRef.current, origin, mission.destination, v, simTimeRef.current, trafficWeightsRef.current, mission.priority);
        if (result.success) {
          addLog(`${v.name}: iniciando missão`, 'route');
          const msg = 'Iniciando missão';
          speak(msg, v.id);
          return {
            ...v,
            destinationId: mission.destination,
            path: result.path,
            pathVersion: v.pathVersion + 1,
            status: 'moving' as const,
            needsRecalc: false,
            instructionIndex: -1,
            spoken500: false, spoken100: false, spoken50: false,
            navigationLogs: [JSON.stringify({ vehicle_id: v.id, type: 'navigation', distance: 0, direction: 'straight', message: msg, timestamp: new Date().toISOString() })],
            currentTotalTime: result.totalCost,
            routeWithETA: buildRouteWithETA(graphRef.current, result.path, v, simTimeRef.current),
            currentRouteIndex: 0,
          };
        }
        addLog(`${v.name}: sem rota para missão!`, 'warning');
        return { ...v, status: 'stuck' as const };
      }

      if (v.originId && v.destinationId) {
        const result = findPath(graphRef.current, v.originId, v.destinationId, v, simTimeRef.current);
        if (result.success) {
          addLog(`${v.name}: rota calculada (${(result.totalCost / 60).toFixed(1)} min)`, 'route');
          const msg = 'Iniciando rota';
          speak(msg, v.id);
          return {
            ...v,
            path: result.path, pathVersion: v.pathVersion + 1, status: 'moving' as const,
            needsRecalc: false, instructionIndex: -1,
            spoken500: false, spoken100: false, spoken50: false,
            navigationLogs: [JSON.stringify({ vehicle_id: v.id, type: 'navigation', distance: 0, direction: 'straight', message: msg, timestamp: new Date().toISOString() })],
            currentTotalTime: result.totalCost,
            routeWithETA: buildRouteWithETA(graphRef.current, result.path, v, simTimeRef.current),
            currentRouteIndex: 0,
          };
        }
        addLog(`${v.name}: rota não encontrada!`, 'warning');
        return { ...v, path: null, status: 'stuck' as const };
      }

      return v;
    });

    vehiclesRef.current = newVehicles;
    setVehicles(newVehicles);

    const updatedMissions = missionsRef.current.map(m =>
      m.status === 'assigned' ? { ...m, status: 'in_progress' as const, startedAt: simTimeRef.current } : m
    );
    missionsRef.current = updatedMissions;
    setMissions(updatedMissions);

    setSimulationRunning(true);
    addLog('▶ Simulação iniciada', 'info');
  }, [addLog, speak]);

  const stopSimulation = useCallback(() => {
    setSimulationRunning(false);
    setFocusedVehicleId(null);

    const resetVehicles = vehiclesRef.current.map(v => ({
      ...v,
      path: null, status: 'idle' as const, needsRecalc: false, pathVersion: 0,
      instructionIndex: -1, navigationLogs: [], routeWithETA: [] as RouteWithETA, currentRouteIndex: 0,
    }));
    vehiclesRef.current = resetVehicles;
    setVehicles(resetVehicles);

    const resetMissions = missionsRef.current.map(m =>
      (m.status === 'in_progress' || m.status === 'assigned')
        ? { ...m, status: 'pending' as const, assignedVehicleId: undefined, startedAt: undefined }
        : m
    );
    missionsRef.current = resetMissions;
    setMissions(resetMissions);

    addLog('■ Simulação parada', 'info');
  }, [addLog]);

  // ── Recalculate (called from MapView on blocked edge or segment advance) ──

  const recalculateVehicle = useCallback((vehicleId: string, fromNodeId: string) => {
    // Read directly from ref — always current, no React closure lag
    const vehicle = vehiclesRef.current.find(v => v.id === vehicleId);
    if (!vehicle || vehicle.status !== 'moving') return;

    const mission = missionsRef.current.find(m => m.id === vehicle.currentMissionId);
    const priority: MissionPriority = mission?.priority ?? 'medium';
    const result = findPath(
      graphRef.current, fromNodeId, vehicle.destinationId,
      vehicle, simTimeRef.current, trafficWeightsRef.current, priority
    );

    if (result.success) {
      // Skip if A* returned the exact same path — no need to bump pathVersion
      const sameRoute =
        vehicle.path &&
        vehicle.path.length === result.path.length &&
        result.path.every((id, i) => id === vehicle.path![i]);
      if (sameRoute) return;

      const pivotName = result.path.length > 1
        ? (graphRef.current.nodes.get(result.path[1])?.name ?? '?') : '?';
      addLog(`${vehicle.name}: rota recalculada via ${pivotName}`, 'route');

      const updated: Vehicle = {
        ...vehicle,
        path: result.path,
        pathVersion: vehicle.pathVersion + 1, // animation will reset to seg 0 of new path
        needsRecalc: false,
        status: 'moving',
        instructionIndex: -1,
        spoken500: false, spoken100: false, spoken50: false,
        currentTotalTime: result.totalCost,
        routeWithETA: buildRouteWithETA(graphRef.current, result.path, vehicle, simTimeRef.current),
        currentRouteIndex: 0,
      };
      // Sync ref IMMEDIATELY so the animation loop picks up the new pathVersion
      // on the very next rAF frame — not one React render cycle later.
      const newVehicles = vehiclesRef.current.map(v => v.id === vehicleId ? updated : v);
      vehiclesRef.current = newVehicles;
      setVehicles(newVehicles);
    } else {
      addLog(`${vehicle.name}: SEM ROTA ALTERNATIVA!`, 'block');
      const updated = { ...vehicle, status: 'stuck' as const, needsRecalc: false };
      const newVehicles = vehiclesRef.current.map(v => v.id === vehicleId ? updated : v);
      vehiclesRef.current = newVehicles;
      setVehicles(newVehicles);
    }
  }, [addLog]);

  // ── Vehicle arrival ───────────────────────────────────────────────────────

  const onVehicleArrived = useCallback((vehicleId: string) => {
    const vehicle = vehiclesRef.current.find(v => v.id === vehicleId);
    if (!vehicle || vehicle.status === 'idle' || vehicle.status === 'arrived') return;

    const destName = graphRef.current.nodes.get(vehicle.destinationId)?.name ?? 'destino';
    const msg = `Chegou em ${destName}`;
    addLog(`✓ ${vehicle.name}: ${msg}`, 'route');
    speak(msg, vehicleId);

    const tetra = JSON.stringify({ vehicle_id: vehicleId, type: 'navigation', distance: 0, direction: 'straight', message: msg, timestamp: new Date().toISOString() });

    if (vehicle.currentMissionId) {
      const completedAt = simTimeRef.current;
      const updatedMissions = missionsRef.current.map(m =>
        m.id === vehicle.currentMissionId
          ? { ...m, status: 'completed' as const, completedAt }
          : m
      );
      missionsRef.current = updatedMissions;
      setMissions(updatedMissions);
      addLog(`✓ Missão concluída por ${vehicle.name}`, 'route');

      // ── Generate and auto-download mission report ────────────────────────
      const mission = updatedMissions.find(m => m.id === vehicle.currentMissionId);
      if (mission) {
        const graph = graphRef.current;
        const fmt = (secs?: number) => secs != null ? secondsToHHMMSS(secs) : '--:--:--';

        // Build readable route: origin → intersections → destination
        const routeNodeIds = mission.assignedPath ?? (vehicle.path ?? []);
        const routeSteps = routeNodeIds.map((id, idx) => {
          const node = graph.nodes.get(id);
          return {
            step: idx + 1,
            nodeId: id,
            name: node?.name ?? id,
            tipo: node?.type ?? 'Junction',
            isIntersection: node?.isIntersection ?? false,
          };
        });

        const originNode = graph.nodes.get(mission.originNodeId ?? vehicle.originId);
        const destNode   = graph.nodes.get(mission.destination);

        const actualDuration   = mission.startedAt != null ? completedAt - mission.startedAt : undefined;
        const predictedEnd     = mission.startedAt != null && mission.predictedDuration != null
          ? mission.startedAt + mission.predictedDuration : undefined;

        const report = {
          relatorio_missao: {
            // Identificação
            missao_id:          mission.id,
            veiculo_id:         vehicle.id,
            veiculo_nome:       vehicle.name,
            tipo_veiculo:       vehicle.type,
            prioridade:         mission.priority,

            // Localização
            local_inicio:       originNode?.name ?? mission.originNodeId ?? vehicle.originId ?? '?',
            local_inicio_id:    mission.originNodeId ?? vehicle.originId,
            destino:            destNode?.name ?? mission.destination,
            destino_id:         mission.destination,

            // Horários (HH:MM:SS de tempo simulado)
            horario_criacao:    fmt(mission.createdAt),
            horario_inicio:     fmt(mission.startedAt),
            horario_fim:        fmt(completedAt),
            horario_previsto_fim: fmt(predictedEnd),

            // Durações em segundos
            duracao_real_s:     actualDuration != null ? Math.round(actualDuration) : null,
            duracao_prevista_s: mission.predictedDuration != null ? Math.round(mission.predictedDuration) : null,
            desvio_s:           actualDuration != null && mission.predictedDuration != null
              ? Math.round(actualDuration - mission.predictedDuration) : null,

            // Rota completa
            rota_completa:      routeSteps,
            total_nos:          routeSteps.length,

            // Metadados
            gerado_em:          new Date().toISOString(),
          },
        };

        const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `missao_${vehicle.name.replace(/\s+/g, '_')}_${mission.id.slice(0, 8)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        addLog(`📄 Relatório exportado: ${a.download}`, 'info');
      }
    }

    const updatedVehicles = vehiclesRef.current.map(v =>
      v.id === vehicleId
        ? {
          ...v,
          status: 'idle' as const,
          path: null,
          currentMissionId: undefined,
          waitingPoiId: v.destinationId || v.waitingPoiId,
          originId: v.destinationId || v.originId,
          navigationLogs: [...v.navigationLogs, tetra],
          routeWithETA: [] as RouteWithETA,
          currentRouteIndex: 0,
        }
        : v
    );
    vehiclesRef.current = updatedVehicles;
    setVehicles(updatedVehicles);

    runAssignmentRef.current();
  }, [addLog, speak]);

  const changeVehicleDestination = useCallback((vehicleId: string, newDestId: string, fromNodeId: string) => {
    setVehicles(prev => prev.map(v => {
      if (v.id !== vehicleId) return v;
      const result = findPath(graphRef.current, fromNodeId, newDestId, v, simTimeRef.current, trafficWeightsRef.current);
      if (result.success) {
        addLog(`${v.name}: destino alterado`, 'route');
        return {
          ...v, destinationId: newDestId, path: result.path, pathVersion: v.pathVersion + 1,
          needsRecalc: false, status: 'moving' as const, instructionIndex: -1,
          spoken500: false, spoken100: false, spoken50: false, currentTotalTime: result.totalCost,
          routeWithETA: buildRouteWithETA(graphRef.current, result.path, v, simTimeRef.current),
          currentRouteIndex: 0,
        };
      }
      addLog(`${v.name}: sem rota para novo destino!`, 'warning');
      return { ...v, destinationId: newDestId, status: 'stuck' as const };
    }));
  }, [addLog]);

  // ── Import / Export ───────────────────────────────────────────────────────

  const exportMap = useCallback(() => {
    const data = graphRef.current.exportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ponta_route_grid.json';
    a.click();
    URL.revokeObjectURL(url);
    addLog('Malha exportada');
  }, [addLog]);

  const importMap = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data: GraphData = JSON.parse(e.target?.result as string);
        graphRef.current.importData(data);
        sync();
        addLog(`Malha importada`);
      } catch {
        addLog('Erro ao importar', 'warning');
      }
    };
    reader.readAsText(file);
  }, [sync, addLog]);

  // ─────────────────────────────────────────────────────────────────────────

  return {
    nodes, edges, mode, setMode, selectedNodes, logs,
    vehicles, simulationRunning, focusedVehicleId, setFocusedVehicleId,
    missions, trafficWeights,
    simTime,
    addNode, removeNode, selectNodeForEdge,
    toggleEdgeDirection, toggleEdgeBlock, updateEdgeAttribute, removeEdge,
    updateNodeName, updateNodeType,
    addVehicle, removeVehicle, updateVehicle,
    addMission, removeMission,
    startSimulation, stopSimulation,
    recalculateVehicle, onVehicleArrived, changeVehicleDestination,
    exportMap, importMap,
    exportVehicleLog, processNavigation,
    graphRef,
    setSimTime,
  };
}
