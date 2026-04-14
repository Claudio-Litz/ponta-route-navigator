import { useState, useCallback, useRef } from 'react';
import { Graph, GraphNode, GraphEdge, GraphData } from '@/lib/graph';
import { AStar, AStarResult } from '@/lib/astar';

export type AppMode = 'editor' | 'simulation';

export interface LogEntry {
  id: string;
  timestamp: Date;
  message: string;
  type: 'info' | 'warning' | 'route' | 'block';
}

export function useGraph() {
  const graphRef = useRef(new Graph());
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [mode, setMode] = useState<AppMode>('editor');
  const [selectedNodes, setSelectedNodes] = useState<string[]>([]);
  const [routeResult, setRouteResult] = useState<AStarResult | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [origin, setOrigin] = useState<string>('');
  const [destination, setDestination] = useState<string>('');

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
    return node;
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
      const fromName = graphRef.current.nodes.get(edge.from)?.name;
      const toName = graphRef.current.nodes.get(edge.to)?.name;
      addLog(`Via ${fromName} → ${toName}: ${edge.bidirectional ? 'Bidirecional' : 'Mão Única'}`);
    }
  }, [sync, addLog]);

  const toggleEdgeBlock = useCallback((edgeId: string) => {
    const edge = graphRef.current.edges.get(edgeId);
    if (edge) {
      edge.isBlocked = !edge.isBlocked;
      sync();
      const fromName = graphRef.current.nodes.get(edge.from)?.name;
      const toName = graphRef.current.nodes.get(edge.to)?.name;
      addLog(
        `Via ${fromName} → ${toName}: ${edge.isBlocked ? 'BLOQUEADA' : 'Livre'}`,
        edge.isBlocked ? 'block' : 'info'
      );
    }
  }, [sync, addLog]);

  const removeEdge = useCallback((id: string) => {
    graphRef.current.removeEdge(id);
    sync();
    addLog('Via removida', 'warning');
  }, [sync, addLog]);

  const findRoute = useCallback(() => {
    if (!origin || !destination) {
      addLog('Selecione origem e destino', 'warning');
      return;
    }
    const router = new AStar(graphRef.current);
    const result = router.findPath(origin, destination);
    setRouteResult(result);
    if (result.success) {
      const names = result.path.map((id) => graphRef.current.nodes.get(id)?.name).join(' → ');
      addLog(`Rota calculada: ${names} (${result.totalCost.toFixed(0)}m)`, 'route');
    } else {
      addLog('Rota não encontrada! Verifique bloqueios e direções.', 'warning');
      speak('Atenção, rota não disponível. Verifique bloqueios na malha.');
    }
  }, [origin, destination, addLog, speak]);

  const randomBlock = useCallback(() => {
    if (!routeResult?.success || routeResult.path.length < 2) {
      addLog('Nenhuma rota ativa para bloquear', 'warning');
      return;
    }
    // Find edges in current route
    const routeEdges: GraphEdge[] = [];
    for (let i = 0; i < routeResult.path.length - 1; i++) {
      const a = routeResult.path[i];
      const b = routeResult.path[i + 1];
      for (const edge of graphRef.current.edges.values()) {
        if (
          (edge.from === a && edge.to === b) ||
          (edge.bidirectional && edge.from === b && edge.to === a)
        ) {
          if (!edge.isBlocked) routeEdges.push(edge);
        }
      }
    }
    if (routeEdges.length === 0) {
      addLog('Todas as vias da rota já estão bloqueadas', 'warning');
      return;
    }
    const target = routeEdges[Math.floor(Math.random() * routeEdges.length)];
    target.isBlocked = true;
    sync();

    const fromName = graphRef.current.nodes.get(target.from)?.name;
    const toName = graphRef.current.nodes.get(target.to)?.name;
    addLog(`⚠ BLOQUEIO: Via ${fromName} → ${toName}`, 'block');

    // Recalculate
    const router = new AStar(graphRef.current);
    const newResult = router.findPath(origin, destination);
    setRouteResult(newResult);

    if (newResult.success) {
      const pivotNode = graphRef.current.nodes.get(newResult.path[1])?.name ?? '?';
      const msg = `Atenção Veículo Alpha, obstrução detectada. Nova rota via ${pivotNode}.`;
      addLog(`Rota recalculada via ${pivotNode}`, 'route');
      speak(msg);
    } else {
      addLog('ALERTA: Nenhuma rota alternativa disponível!', 'block');
      speak('Atenção, nenhuma rota alternativa disponível. Solicite suporte.');
    }
  }, [routeResult, origin, destination, sync, addLog, speak]);

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
    nodes,
    edges,
    mode,
    setMode,
    selectedNodes,
    routeResult,
    logs,
    origin,
    destination,
    setOrigin,
    setDestination,
    addNode,
    removeNode,
    selectNodeForEdge,
    toggleEdgeDirection,
    toggleEdgeBlock,
    removeEdge,
    findRoute,
    randomBlock,
    updateNodeName,
    updateNodeType,
    exportMap,
    importMap,
    addLog,
    graphRef,
  };
}
