import { useState, useCallback, useRef, useEffect } from 'react';
import { Graph, GraphNode, GraphEdge, GraphData, Vehicle, LogEntry, findPath, VoiceInstruction, getDirectionFromAngles } from '@/lib/engine';

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
  const [isGlobalMuted, setIsGlobalMuted] = useState(false);

  const lastInstructionRef = useRef<Record<string, VoiceInstruction>>({});

  const addLog = useCallback((message: string, type: LogEntry['type'] = 'info', instruction?: LogEntry['instruction']) => {
    setLogs((prev) => [
      { id: crypto.randomUUID(), timestamp: new Date(), message, type, instruction },
      ...prev.slice(0, 99),
    ]);
  }, []);

  const sendVoiceInstruction = useCallback((vehicleId: string, instruction: VoiceInstruction) => {
    const vehicle = vehicles.find(v => v.id === vehicleId);
    const logMsg = `[VOICE ${vehicle?.name || vehicleId}] ${instruction.message}`;
    addLog(logMsg, 'voice', { vehicle_id: vehicleId, instruction });

    // Atualiza a última instrução para controle de repetição
    lastInstructionRef.current[vehicleId] = instruction;

    if (!isGlobalMuted && vehicle && !vehicle.isMuted) {
      if ('speechSynthesis' in window) {
        const speak = (text: string) => {
          const u = new SpeechSynthesisUtterance(text);
          u.lang = 'pt-BR';
          u.rate = 1.0;
          window.speechSynthesis.speak(u);
        };

        speak(instruction.message);
        
        // Repetição inteligente após 3 segundos
        setTimeout(() => {
          const currentVehicle = vehicles.find(v => v.id === vehicleId);
          const currentLast = lastInstructionRef.current[vehicleId];
          // Só repete se for a mesma instrução (não houve uma nova mais importante)
          if (!isGlobalMuted && currentVehicle && !currentVehicle.isMuted && currentLast?.timestamp === instruction.timestamp) {
            speak(instruction.message);
          }
        }, 3000);
      }
    }
  }, [addLog, isGlobalMuted, vehicles]);

  const sync = useCallback(() => {
    setNodes(Array.from(graphRef.current.nodes.values()));
    setEdges(Array.from(graphRef.current.edges.values()));
  }, []);

  // === Graph editing ===
  const addNode = useCallback((lat: number, lng: number, type: GraphNode['type']) => {
    const count = graphRef.current.nodes.size + 1;
    const node: GraphNode = {
      id: crypto.randomUUID(),
      name: type === 'POI' ? `POI-${count}` : (type === 'Crossroad' ? `CR-${count}` : `J-${count}`),
      lat, lng, type,
      connections: type === 'Crossroad' ? [] : undefined,
    };
    graphRef.current.addNode(node); sync();
    addLog(`Nó "${node.name}" criado.`);
  }, [sync, addLog]);

  const removeNode = useCallback((id: string) => { graphRef.current.removeNode(id); sync(); }, [sync]);

  const selectNodeForEdge = useCallback((id: string) => {
    setSelectedNodes((prev) => {
      if (prev.includes(id)) return prev.filter((i) => i !== id);
      if (prev.length === 1) { graphRef.current.addEdge(prev[0], id, true); sync(); return []; }
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
      edge.isBlocked = !edge.isBlocked; sync();
      if (simulationRunning) {
        setVehicles((prev) => prev.map((v) => ({ ...v, needsRecalc: true })));
        addLog(`Via bloqueada, recalculando rotas...`, 'block');
      }
    }
  }, [sync, simulationRunning, addLog]);

  const updateEdgeAttribute = useCallback((id: string, field: keyof GraphEdge, value: any) => {
    const edge = graphRef.current.edges.get(id);
    if (edge) { (edge as any)[field] = value; sync(); if (simulationRunning) setVehicles((prev) => prev.map((v) => ({ ...v, needsRecalc: true }))); }
  }, [sync, simulationRunning]);

  const updateNodeAttribute = useCallback((id: string, field: string, value: any) => {
    const node = graphRef.current.nodes.get(id);
    if (node) { (node as any)[field] = value; sync(); }
  }, [sync]);

  const removeEdge = useCallback((id: string) => { graphRef.current.removeEdge(id); sync(); }, [sync]);
  const updateNodeName = useCallback((id: string, name: string) => { const node = graphRef.current.nodes.get(id); if (node) { node.name = name; sync(); } }, [sync]);
  const updateNodeType = useCallback((id: string, type: GraphNode['type']) => {
    const node = graphRef.current.nodes.get(id);
    if (node) { node.type = type; if (type === 'Crossroad' && !node.connections) node.connections = []; sync(); }
  }, [sync]);

  // === Vehicles ===
  const addVehicle = useCallback(() => {
    setVehicles((prev) => {
      const count = prev.length + 1;
      return [...prev, {
        id: crypto.randomUUID(), name: `Veículo ${count}`, color: VEHICLE_COLORS[prev.length % VEHICLE_COLORS.length],
        originId: '', destinationId: '', speed: 60, width: 2.5, height: 3.0, type: 'Caminhão',
        path: null, pathVersion: 0, status: 'idle', needsRecalc: false, isMuted: false,
      }];
    });
  }, []);

  const removeVehicle = useCallback((id: string) => {
    setVehicles((prev) => prev.filter((v) => v.id !== id));
    if (focusedVehicleId === id) setFocusedVehicleId(null);
  }, [focusedVehicleId]);

  const updateVehicle = useCallback((id: string, field: string, value: any) => {
    setVehicles((prev) => prev.map((v) => (v.id === id ? { ...v, [field]: value, needsRecalc: field !== 'isMuted' } : v)));
  }, []);

  // === Simulation ===
  const startSimulation = useCallback(() => {
    setVehicles((prev) =>
      prev.map((v) => {
        if (!v.originId || !v.destinationId) return v;
        const result = findPath(graphRef.current, v.originId, v.destinationId, v);
        if (result.success) {
          sendVoiceInstruction(v.id, { type: 'start', message: `Iniciando rota para ${graphRef.current.nodes.get(v.destinationId)?.name}. Siga pelo caminho indicado.`, timestamp: Date.now() });
          return { ...v, path: result.path, pathVersion: v.pathVersion + 1, status: 'moving' as const, needsRecalc: false };
        } else {
          addLog(`${v.name}: rota não encontrada!`, 'warning');
          return { ...v, path: null, status: 'stuck' as const };
        }
      })
    );
    setSimulationRunning(true);
    addLog('▶ Simulação iniciada', 'info');
  }, [addLog, sendVoiceInstruction]);

  const stopSimulation = useCallback(() => {
    setSimulationRunning(false); setFocusedVehicleId(null);
    setVehicles((prev) => prev.map((v) => ({ ...v, path: null, status: 'idle' as const, needsRecalc: false, pathVersion: 0 })));
    addLog('■ Simulação parada', 'info');
  }, [addLog]);

  const recalculateVehicle = useCallback((vehicleId: string, fromNodeId: string) => {
    setVehicles((prev) =>
      prev.map((v) => {
        if (v.id !== vehicleId) return v;
        const result = findPath(graphRef.current, fromNodeId, v.destinationId, v);
        if (result.success) {
          sendVoiceInstruction(v.id, { type: 'recalculation', message: "Recalculando rota. Aguarde novas instruções.", timestamp: Date.now() });
          return { ...v, path: result.path, pathVersion: v.pathVersion + 1, needsRecalc: false, status: 'moving' as const };
        } else {
          sendVoiceInstruction(v.id, { type: 'recalculation', message: "Atenção, sem rota alternativa disponível.", timestamp: Date.now() });
          return { ...v, status: 'stuck' as const, needsRecalc: false };
        }
      })
    );
  }, [sendVoiceInstruction]);

  const onVehicleArrived = useCallback((vehicleId: string) => {
    setVehicles((prev) =>
      prev.map((v) => {
        if (v.id !== vehicleId || v.status === 'arrived') return v;
        sendVoiceInstruction(v.id, { type: 'arrival', message: "Você chegou ao seu destino.", timestamp: Date.now() });
        return { ...v, status: 'arrived' as const };
      })
    );
  }, [sendVoiceInstruction]);

  const changeVehicleDestination = useCallback((vehicleId: string, newDestId: string, fromNodeId: string) => {
    setVehicles((prev) =>
      prev.map((v) => {
        if (v.id !== vehicleId) return v;
        const result = findPath(graphRef.current, fromNodeId, newDestId, v);
        if (result.success) {
          sendVoiceInstruction(v.id, { type: 'recalculation', message: "Destino alterado. Nova rota calculada.", timestamp: Date.now() });
          return { ...v, destinationId: newDestId, path: result.path, pathVersion: v.pathVersion + 1, needsRecalc: false, status: 'moving' as const };
        } else {
          addLog(`${v.name}: sem rota para novo destino!`, 'warning');
          return { ...v, destinationId: newDestId, status: 'stuck' as const };
        }
      })
    );
  }, [addLog, sendVoiceInstruction]);

  const handleVoiceTrigger = useCallback((vehicleId: string, nodeId: string, inNodeId: string, outNodeId: string, distance: number, isArrival?: boolean) => {
    if (isArrival) {
      sendVoiceInstruction(vehicleId, { type: 'arrival', message: "Você chegou ao seu destino.", timestamp: Date.now() });
      return;
    }

    const node = graphRef.current.nodes.get(nodeId);
    if (!node || node.type !== 'Crossroad' || !node.connections) return;
    const inConn = node.connections.find(c => c.to === inNodeId);
    const outConn = node.connections.find(c => c.to === outNodeId);
    if (inConn && outConn) {
      const { direction, message } = getDirectionFromAngles(inConn.angle, outConn.angle, node.connections.length);
      let finalMsg = '';
      if (distance >= 1000) finalMsg = `A um quilômetro, ${message.toLowerCase()}.`;
      else if (distance >= 500) finalMsg = `A quinhentos metros, ${message.toLowerCase()}.`;
      else if (distance >= 100) finalMsg = `Em cem metros, ${message.toLowerCase()}.`;
      else finalMsg = `${message}!`;
      sendVoiceInstruction(vehicleId, { type: 'turn', direction, distance, message: finalMsg, timestamp: Date.now() });
    }
  }, [sendVoiceInstruction]);

  // Auto-recálculo a cada 5 segundos para veículos parados
  useEffect(() => {
    if (!simulationRunning) return;
    const interval = setInterval(() => {
      setVehicles(prev => {
        let changed = false;
        const next = prev.map(v => {
          if (v.status === 'stuck' && v.path && v.path.length > 0) {
            const result = findPath(graphRef.current, v.path[0], v.destinationId, v);
            if (result.success) {
              changed = true;
              sendVoiceInstruction(v.id, { type: 'recalculation', message: "Via liberada. Retomando rota.", timestamp: Date.now() });
              return { ...v, status: 'moving' as const, path: result.path, pathVersion: v.pathVersion + 1 };
            }
          }
          return v;
        });
        return changed ? next : prev;
      });
    }, 5000);
    return () => clearInterval(interval);
  }, [simulationRunning, sendVoiceInstruction]);

  // === Import/Export ===
  const exportMap = useCallback(() => {
    const data = graphRef.current.exportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'ponta_route_gps.json'; a.click();
    URL.revokeObjectURL(url); addLog('Malha exportada.');
  }, [addLog]);

  const importMap = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data: GraphData = JSON.parse(e.target?.result as string);
        graphRef.current.importData(data); sync();
        addLog(`Malha importada: ${data.nodes.length} nós.`);
      } catch { addLog('Erro ao importar arquivo', 'warning'); }
    };
    reader.readAsText(file);
  }, [sync, addLog]);

  return {
    nodes, edges, mode, setMode, selectedNodes, logs,
    vehicles, simulationRunning, focusedVehicleId, setFocusedVehicleId,
    isGlobalMuted, setIsGlobalMuted,
    addNode, removeNode, selectNodeForEdge,
    toggleEdgeDirection, toggleEdgeBlock, updateEdgeAttribute, updateNodeAttribute, removeEdge,
    updateNodeName, updateNodeType,
    addVehicle, removeVehicle, updateVehicle,
    startSimulation, stopSimulation,
    recalculateVehicle, onVehicleArrived, changeVehicleDestination,
    handleVoiceTrigger,
    exportMap, importMap,
    graphRef,
  };
}
