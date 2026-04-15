import { useState, useCallback, useRef } from 'react';
import { Graph, GraphNode, GraphEdge, GraphData, Vehicle, LogEntry, findPath } from '@/lib/engine';

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

  const speak = useCallback((text: string) => {
    if ('speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'pt-BR';
      u.rate = 1.1;
      window.speechSynthesis.speak(u);
    }
  }, []);

  const sync = useCallback(() => {
    setNodes(Array.from(graphRef.current.nodes.values()));
    setEdges(Array.from(graphRef.current.edges.values()));
  }, []);

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
          return { ...v, path: result.path, pathVersion: v.pathVersion + 1, status: 'moving' as const, needsRecalc: false };
        } else {
          addLog(`${v.name}: rota não encontrada (restrições físicas ou bloqueio)!`, 'warning');
          return { ...v, path: null, status: 'stuck' as const };
        }
      })
    );
    setSimulationRunning(true);
    addLog('▶ Simulação iniciada', 'info');
  }, [addLog]);

  const stopSimulation = useCallback(() => {
    setSimulationRunning(false);
    setFocusedVehicleId(null);
    setVehicles((prev) =>
      prev.map((v) => ({ ...v, path: null, status: 'idle' as const, needsRecalc: false, pathVersion: 0 }))
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
          speak(`Veículo ${v.name}, nova rota via ${pivotName}.`);
          return { ...v, path: result.path, pathVersion: v.pathVersion + 1, needsRecalc: false, status: 'moving' as const };
        } else {
          addLog(`${v.name}: SEM ROTA ALTERNATIVA DISPONÍVEL!`, 'block');
          speak(`Atenção, veículo ${v.name}, sem rota alternativa disponível.`);
          return { ...v, status: 'stuck' as const, needsRecalc: false };
        }
      })
    );
  }, [addLog, speak]);

  const onVehicleArrived = useCallback((vehicleId: string) => {
    setVehicles((prev) =>
      prev.map((v) => {
        if (v.id !== vehicleId || v.status === 'arrived') return v;
        addLog(`✓ ${v.name}: chegou ao destino!`, 'route');
        return { ...v, status: 'arrived' as const };
      })
    );
  }, [addLog]);

  const changeVehicleDestination = useCallback((vehicleId: string, newDestId: string, fromNodeId: string) => {
    setVehicles((prev) =>
      prev.map((v) => {
        if (v.id !== vehicleId) return v;
        const result = findPath(graphRef.current, fromNodeId, newDestId, v);
        if (result.success) {
          addLog(`${v.name}: destino alterado, nova rota calculada`, 'route');
          speak(`Veículo ${v.name}, destino atualizado.`);
          return { ...v, destinationId: newDestId, path: result.path, pathVersion: v.pathVersion + 1, needsRecalc: false, status: 'moving' as const };
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
    graphRef,
  };
}
