import { useState, useCallback, useRef } from 'react';
import { 
  Graph, GraphNode, GraphEdge, GraphData, Vehicle, LogEntry, findPath, 
  haversine, calculateBearing, getRelativeDirection, NavigationDirection 
} from '@/lib/engine';

export type AppMode = 'editor' | 'simulation';

const VEHICLE_COLORS = ['#3b82f6', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4'];

export function useSimulation() {
  const graphRef = useRef(new Graph());
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [mode, setMode] = useState<AppMode>('editor');
  const [selectedNodes, setSelectedNodes] = useState<string[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [simulationRunning, setSimulationRunning] = useState(false);
  const [focusedVehicleId, setFocusedVehicleId] = useState<string | null>(null);

  const addLog = useCallback((message: string, type: LogEntry['type'] = 'info') => {
    setLogs((prev) => [
      { id: crypto.randomUUID(), timestamp: new Date(), message, type },
      ...prev.slice(0, 99),
    ]);
  }, []);

  const speak = useCallback((text: string, vehicleId?: string) => {
    // Only speak if it's the focused vehicle or no vehicle is focused (system alerts)
    if (focusedVehicleId && vehicleId && focusedVehicleId !== vehicleId) return;
    
    if ('speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'pt-BR';
      u.rate = 1.1;
      window.speechSynthesis.speak(u);
    }
  }, [focusedVehicleId]);

  const sync = useCallback(() => {
    setNodes(Array.from(graphRef.current.nodes.values()));
    setEdges(Array.from(graphRef.current.edges.values()));
  }, []);

  const generateTetraMessage = useCallback((vehicle: Vehicle, type: string, distance: number, direction: NavigationDirection, message: string) => {
    const tetra = {
      vehicle_id: vehicle.id,
      type: 'navigation',
      distance,
      direction,
      message,
      timestamp: new Date().toISOString()
    };
    const jsonStr = JSON.stringify(tetra);
    
    setVehicles(prev => prev.map(v => 
      v.id === vehicle.id 
        ? { ...v, navigationLogs: [...v.navigationLogs, jsonStr] } 
        : v
    ));

    addLog(`[TETRA ${vehicle.name}] ${message}`, 'navigation');
    speak(message, vehicle.id);
  }, [addLog, speak]);

  const processNavigation = useCallback((vehicleId: string, currentLat: number, currentLng: number, segmentIndex: number) => {
    const vehicle = vehicles.find(v => v.id === vehicleId);
    if (!vehicle || !vehicle.path || vehicle.status !== 'moving') return;

    const path = vehicle.path;
    const nm = graphRef.current.nodes;

    // Find next "Junction" node in path after current segment
    let nextJunctionIndex = -1;
    for (let i = segmentIndex + 1; i < path.length; i++) {
      const node = nm.get(path[i]);
      if (node?.type === 'Junction' || i === path.length - 1) {
        nextJunctionIndex = i;
        break;
      }
    }

    if (nextJunctionIndex === -1) return;

    const targetNode = nm.get(path[nextJunctionIndex]);
    if (!targetNode) return;

    const distance = haversine(currentLat, currentLng, targetNode.lat, targetNode.lng);
    
    // Determine direction at this junction
    let direction: NavigationDirection = 'straight';
    if (nextJunctionIndex > 0 && nextJunctionIndex < path.length - 1) {
      const prevNode = nm.get(path[nextJunctionIndex - 1]);
      const nextNode = nm.get(path[nextJunctionIndex + 1]);
      if (prevNode && nextNode) {
        const b1 = calculateBearing(prevNode.lat, prevNode.lng, targetNode.lat, targetNode.lng);
        const b2 = calculateBearing(targetNode.lat, targetNode.lng, nextNode.lat, nextNode.lng);
        direction = getRelativeDirection(b2 - b1);
      }
    } else if (nextJunctionIndex === path.length - 1) {
      direction = 'straight'; // Arrival
    }

    const directionText = {
      straight: 'siga em frente',
      left: 'vire à esquerda',
      right: 'vire à direita',
      return: 'faça o retorno'
    }[direction];

    // Trigger logic
    if (nextJunctionIndex !== vehicle.instructionIndex) {
      // New junction target, reset flags
      setVehicles(prev => prev.map(v => v.id === vehicleId ? {
        ...v,
        instructionIndex: nextJunctionIndex,
        spoken500: false,
        spoken100: false,
        spoken50: false
      } : v));
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
  }, [vehicles, generateTetraMessage]);

  const exportVehicleLog = useCallback((vehicleId: string) => {
    const vehicle = vehicles.find(v => v.id === vehicleId);
    if (!vehicle) return;
    const content = vehicle.navigationLogs.join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `log_${vehicle.name.replace(/\s+/g, '_')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [vehicles]);

  // === Graph editing ===
  const addNode = useCallback((lat: number, lng: number, type: GraphNode['type']) => {
    const count = graphRef.current.nodes.size + 1;
    const node: GraphNode = {
      id: crypto.randomUUID(),
      name: type === 'POI' ? `POI-${count}` : `J-${count}`,
      lat,
      lng,
      type,
    };
    graphRef.current.addNode(node);
    sync();
    addLog(`Nó "${node.name}" criado.`);
  }, [sync, addLog]);

  const removeNode = useCallback((id: string) => {
    graphRef.current.removeNode(id);
    sync();
  }, [sync]);

  const selectNodeForEdge = useCallback((id: string) => {
    setSelectedNodes((prev) => {
      if (prev.includes(id)) return prev.filter((i) => i !== id);
      if (prev.length === 1) {
        graphRef.current.addEdge(prev[0], id, true);
        sync();
        return [];
      }
      return [id];
    });
  }, [sync]);

  const toggleEdgeDirection = useCallback((id: string) => {
    const edge = graphRef.current.edges.get(id);
    if (edge) {
      edge.bidirectional = !edge.bidirectional;
      sync();
    }
  }, [sync]);

  const toggleEdgeBlock = useCallback((id: string) => {
    const edge = graphRef.current.edges.get(id);
    if (edge) {
      edge.isBlocked = !edge.isBlocked;
      sync();
      if (simulationRunning) {
        setVehicles((prev) => prev.map((v) => ({ ...v, needsRecalc: true })));
        addLog(`Via ${edge.isBlocked ? 'bloqueada' : 'desbloqueada'}, recalculando rotas...`, 'block');
      }
    }
  }, [sync, simulationRunning, addLog]);

  const updateEdgeAttribute = useCallback((id: string, field: keyof GraphEdge, value: any) => {
    const edge = graphRef.current.edges.get(id);
    if (edge) {
      (edge as any)[field] = value;
      sync();
      if (simulationRunning) {
        setVehicles((prev) => prev.map((v) => ({ ...v, needsRecalc: true })));
      }
    }
  }, [sync, simulationRunning]);

  const removeEdge = useCallback((id: string) => {
    graphRef.current.removeEdge(id);
    sync();
  }, [sync]);

  const updateNodeName = useCallback((id: string, name: string) => {
    const node = graphRef.current.nodes.get(id);
    if (node) {
      node.name = name;
      sync();
    }
  }, [sync]);

  const updateNodeType = useCallback((id: string, type: GraphNode['type']) => {
    const node = graphRef.current.nodes.get(id);
    if (node) {
      node.type = type;
      sync();
    }
  }, [sync]);

  // === Vehicles ===
  const addVehicle = useCallback(() => {
    setVehicles((prev) => {
      const count = prev.length + 1;
      return [...prev, {
        id: crypto.randomUUID(),
        name: `Veículo ${count}`,
        color: VEHICLE_COLORS[prev.length % VEHICLE_COLORS.length],
        originId: '',
        destinationId: '',
        speed: 60,
        width: 2.5,
        height: 3.0,
        type: 'Caminhão',
        path: null,
        pathVersion: 0,
        status: 'idle',
        needsRecalc: false,
        instructionIndex: -1,
        spoken500: false,
        spoken100: false,
        spoken50: false,
        navigationLogs: []
      }];
    });
  }, []);

  const removeVehicle = useCallback((id: string) => {
    setVehicles((prev) => prev.filter((v) => v.id !== id));
    if (focusedVehicleId === id) setFocusedVehicleId(null);
  }, [focusedVehicleId]);

  const updateVehicle = useCallback((id: string, field: string, value: any) => {
    setVehicles((prev) =>
      prev.map((v) => (v.id === id ? { ...v, [field]: value, needsRecalc: true } : v))
    );
  }, []);

  // === Simulation ===
  const startSimulation = useCallback(() => {
    setVehicles((prev) =>
      prev.map((v) => {
        if (!v.originId || !v.destinationId) return v;
        const result = findPath(graphRef.current, v.originId, v.destinationId, v);
        if (result.success) {
          addLog(`${v.name}: rota calculada (${(result.totalCost / 60).toFixed(1)} min)`, 'route');
          
          const vehicleWithRoute = { 
            ...v, 
            path: result.path, 
            pathVersion: v.pathVersion + 1, 
            status: 'moving' as const, 
            needsRecalc: false,
            instructionIndex: -1,
            spoken500: false,
            spoken100: false,
            spoken50: false,
            navigationLogs: []
          };
          
          // Initial instruction
          const initialMsg = `Iniciando rota. Tempo estimado: ${(result.totalCost / 60).toFixed(1)} minutos`;
          const tetra = {
            vehicle_id: v.id,
            type: 'navigation',
            distance: 0,
            direction: 'straight',
            message: initialMsg,
            timestamp: new Date().toISOString()
          };
          vehicleWithRoute.navigationLogs.push(JSON.stringify(tetra));
          speak(initialMsg, v.id);

          return vehicleWithRoute;
        } else {
          addLog(`${v.name}: rota não encontrada (restrições físicas ou bloqueio)!`, 'warning');
          return { ...v, path: null, status: 'stuck' as const };
        }
      })
    );
    setSimulationRunning(true);
    addLog('▶ Simulação iniciada', 'info');
  }, [addLog, speak]);

  const stopSimulation = useCallback(() => {
    setSimulationRunning(false);
    setFocusedVehicleId(null);
    setVehicles((prev) =>
      prev.map((v) => ({ 
        ...v, 
        path: null, 
        status: 'idle' as const, 
        needsRecalc: false, 
        pathVersion: 0,
        instructionIndex: -1,
        navigationLogs: []
      }))
    );
    addLog('■ Simulação parada — sistema resetado', 'info');
  }, [addLog]);

  const recalculateVehicle = useCallback((vehicleId: string, fromNodeId: string) => {
    setVehicles((prev) =>
      prev.map((v) => {
        if (v.id !== vehicleId) return v;
        const result = findPath(graphRef.current, fromNodeId, v.destinationId, v);
        if (result.success) {
          const pivotName = graphRef.current.nodes.get(result.path[1])?.name ?? '?';
          addLog(`${v.name}: rota recalculada via ${pivotName} (${(result.totalCost / 60).toFixed(1)} min)`, 'route');
          speak(`Veículo ${v.name}, nova rota via ${pivotName}.`, v.id);
          return { 
            ...v, 
            path: result.path, 
            pathVersion: v.pathVersion + 1, 
            needsRecalc: false, 
            status: 'moving' as const,
            instructionIndex: -1,
            spoken500: false,
            spoken100: false,
            spoken50: false
          };
        } else {
          addLog(`${v.name}: SEM ROTA ALTERNATIVA DISPONÍVEL!`, 'block');
          speak(`Atenção, veículo ${v.name}, sem rota alternativa disponível.`, v.id);
          return { ...v, status: 'stuck' as const, needsRecalc: false };
        }
      })
    );
  }, [addLog, speak]);

  const onVehicleArrived = useCallback((vehicleId: string) => {
    setVehicles((prev) =>
      prev.map((v) => {
        if (v.id !== vehicleId || v.status === 'arrived') return v;
        const msg = `Você chegou ao seu destino`;
        addLog(`✓ ${v.name}: ${msg}`, 'route');
        
        const tetra = {
          vehicle_id: v.id,
          type: 'navigation',
          distance: 0,
          direction: 'straight',
          message: msg,
          timestamp: new Date().toISOString()
        };
        
        speak(msg, v.id);
        return { 
          ...v, 
          status: 'arrived' as const,
          navigationLogs: [...v.navigationLogs, JSON.stringify(tetra)]
        };
      })
    );
  }, [addLog, speak]);

  const changeVehicleDestination = useCallback((vehicleId: string, newDestId: string, fromNodeId: string) => {
    setVehicles((prev) =>
      prev.map((v) => {
        if (v.id !== vehicleId) return v;
        const result = findPath(graphRef.current, fromNodeId, newDestId, v);
        if (result.success) {
          addLog(`${v.name}: destino alterado, nova rota calculada`, 'route');
          speak(`Veículo ${v.name}, destino atualizado.`, v.id);
          return { 
            ...v, 
            destinationId: newDestId, 
            path: result.path, 
            pathVersion: v.pathVersion + 1, 
            needsRecalc: false, 
            status: 'moving' as const,
            instructionIndex: -1,
            spoken500: false,
            spoken100: false,
            spoken50: false
          };
        } else {
          addLog(`${v.name}: sem rota para novo destino!`, 'warning');
          return { ...v, destinationId: newDestId, status: 'stuck' as const };
        }
      })
    );
  }, [addLog, speak]);

  // === Import/Export ===
  const exportMap = useCallback(() => {
    const data = graphRef.current.exportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ponta_route_grid.json';
    a.click();
    URL.revokeObjectURL(url);
    addLog('Malha exportada: ponta_route_grid.json');
  }, [addLog]);

  const importMap = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data: GraphData = JSON.parse(e.target?.result as string);
        graphRef.current.importData(data);
        sync();
        addLog(`Malha importada: ${data.nodes.length} nós, ${data.edges.length} vias`);
      } catch {
        addLog('Erro ao importar arquivo', 'warning');
      }
    };
    reader.readAsText(file);
  }, [sync, addLog]);

  return {
    nodes, edges, mode, setMode, selectedNodes, logs,
    vehicles, simulationRunning, focusedVehicleId, setFocusedVehicleId,
    addNode, removeNode, selectNodeForEdge,
    toggleEdgeDirection, toggleEdgeBlock, updateEdgeAttribute, removeEdge,
    updateNodeName, updateNodeType,
    addVehicle, removeVehicle, updateVehicle,
    startSimulation, stopSimulation,
    recalculateVehicle, onVehicleArrived, changeVehicleDestination,
    exportMap, importMap,
    exportVehicleLog, processNavigation,
    graphRef,
  };
}
