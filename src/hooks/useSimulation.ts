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
    addLog(`Nó "${node.name}" criado em [${lat.toFixed(4)}, ${lng.toFixed(4)}]`);
  }, [sync, addLog]);

  const removeNode = useCallback((id: string) => {
    const node = graphRef.current.nodes.get(id);
    graphRef.current.removeNode(id);
    sync();
    if (node) addLog(`Nó "${node.name}" removido`, 'warning');
  }, [sync, addLog]);

  const selectNodeForEdge = useCallback((id: string) => {
    setSelectedNodes((prev) => {
      if (prev.includes(id)) return prev.filter((n) => n !== id);
      const next = [...prev, id];
      if (next.length === 2) {
        const edge = graphRef.current.addEdge(next[0], next[1], true);
        if (edge) {
          sync();
          addLog(`Via criada: ${graphRef.current.nodes.get(next[0])?.name} ↔ ${graphRef.current.nodes.get(next[1])?.name}`);
        }
        return [];
      }
      return next;
    });
  }, [sync, addLog]);

  const toggleEdgeDirection = useCallback((edgeId: string) => {
    const edge = graphRef.current.edges.get(edgeId);
    if (edge) {
      edge.bidirectional = !edge.bidirectional;
      sync();
      addLog(`Via ${graphRef.current.nodes.get(edge.from)?.name} → ${graphRef.current.nodes.get(edge.to)?.name}: ${edge.bidirectional ? 'Bidirecional' : 'Mão Única'}`);
    }
  }, [sync, addLog]);

  const toggleEdgeBlock = useCallback((edgeId: string) => {
    const edge = graphRef.current.edges.get(edgeId);
    if (!edge) return;
    edge.isBlocked = !edge.isBlocked;
    sync();

    const fromName = graphRef.current.nodes.get(edge.from)?.name;
    const toName = graphRef.current.nodes.get(edge.to)?.name;
    addLog(`Via ${fromName} → ${toName}: ${edge.isBlocked ? 'BLOQUEADA' : 'Livre'}`, edge.isBlocked ? 'block' : 'info');

    // During simulation, mark affected vehicles for recalc
    if (edge.isBlocked) {
      setVehicles((prev) =>
        prev.map((v) => {
          if (v.status !== 'moving' || !v.path) return v;
          for (let i = 0; i < v.path.length - 1; i++) {
            const a = v.path[i], b = v.path[i + 1];
            if (
              (edge.from === a && edge.to === b) ||
              (edge.bidirectional && edge.from === b && edge.to === a)
            ) {
              addLog(`⚠ Veículo ${v.name} será redirecionado no próximo cruzamento`, 'warning');
              speak(`Atenção veículo ${v.name}, obstrução detectada. Recalculando rota.`);
              return { ...v, needsRecalc: true };
            }
          }
          return v;
        })
      );
    }
  }, [sync, addLog, speak]);

  const removeEdge = useCallback((id: string) => {
    graphRef.current.removeEdge(id);
    sync();
    addLog('Via removida', 'warning');
  }, [sync, addLog]);

  const updateNodeName = useCallback((id: string, name: string) => {
    const node = graphRef.current.nodes.get(id);
    if (node) { node.name = name; sync(); }
  }, [sync]);

  const updateNodeType = useCallback((id: string, type: GraphNode['type']) => {
    const node = graphRef.current.nodes.get(id);
    if (node) { node.type = type; sync(); }
  }, [sync]);

  // === Vehicles ===

  const addVehicle = useCallback(() => {
    setVehicles((prev) => {
      if (prev.length >= 5) return prev;
      return [...prev, {
        id: crypto.randomUUID(),
        name: `Veículo ${prev.length + 1}`,
        color: VEHICLE_COLORS[prev.length],
        originId: '',
        destinationId: '',
        speed: 30,
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

  const updateVehicle = useCallback((id: string, field: string, value: string | number) => {
    setVehicles((prev) =>
      prev.map((v) => (v.id === id ? { ...v, [field]: value } : v))
    );
  }, []);

  // === Simulation ===

  const startSimulation = useCallback(() => {
    setVehicles((prev) =>
      prev.map((v) => {
        if (!v.originId || !v.destinationId) return v;
        const result = findPath(graphRef.current, v.originId, v.destinationId);
        if (result.success) {
          addLog(`${v.name}: rota calculada (${result.totalCost.toFixed(0)}m)`, 'route');
          return { ...v, path: result.path, pathVersion: v.pathVersion + 1, status: 'moving' as const, needsRecalc: false };
        } else {
          addLog(`${v.name}: rota não encontrada!`, 'warning');
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
    for (const edge of graphRef.current.edges.values()) {
      edge.isBlocked = false;
    }
    sync();
    addLog('■ Simulação parada — sistema resetado', 'info');
  }, [sync, addLog]);

  const recalculateVehicle = useCallback((vehicleId: string, fromNodeId: string) => {
    setVehicles((prev) =>
      prev.map((v) => {
        if (v.id !== vehicleId) return v;
        const result = findPath(graphRef.current, fromNodeId, v.destinationId);
        if (result.success) {
          const pivotName = graphRef.current.nodes.get(result.path[1])?.name ?? '?';
          addLog(`${v.name}: rota recalculada via ${pivotName}`, 'route');
          speak(`Veículo ${v.name}, nova rota via ${pivotName}.`);
          return { ...v, path: result.path, pathVersion: v.pathVersion + 1, needsRecalc: false, status: 'moving' as const };
        } else {
          addLog(`${v.name}: SEM ROTA ALTERNATIVA!`, 'block');
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
    const result = findPath(graphRef.current, fromNodeId, newDestId);
    setVehicles((prev) =>
      prev.map((v) => {
        if (v.id !== vehicleId) return v;
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
    a.download = 'valeroute_grid.json';
    a.click();
    URL.revokeObjectURL(url);
    addLog('Malha exportada: valeroute_grid.json');
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
    toggleEdgeDirection, toggleEdgeBlock, removeEdge,
    updateNodeName, updateNodeType,
    addVehicle, removeVehicle, updateVehicle,
    startSimulation, stopSimulation,
    recalculateVehicle, onVehicleArrived, changeVehicleDestination,
    exportMap, importMap,
    graphRef,
  };
}
