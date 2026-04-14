import { useState, useCallback } from 'react';
import MapView from '@/components/MapView';
import ControlPanel from '@/components/ControlPanel';
import RadioConsole from '@/components/RadioConsole';
import { useSimulation } from '@/hooks/useSimulation';
import { GraphNode } from '@/lib/engine';

export default function Index() {
  const sim = useSimulation();
  const [nodeType, setNodeType] = useState<GraphNode['type']>('POI');
  const [contextMenu, setContextMenu] = useState<
    | { type: 'node'; id: string; x: number; y: number }
    | { type: 'edge'; id: string; x: number; y: number }
    | null
  >(null);

  const pois = sim.nodes.filter((n) => n.type === 'POI');

  const handleMapClick = useCallback((lat: number, lng: number) => {
    sim.addNode(lat, lng, nodeType);
  }, [sim, nodeType]);

  const handleNodeClick = useCallback((id: string) => {
    if (sim.mode === 'editor') sim.selectNodeForEdge(id);
  }, [sim]);

  const handleNodeRightClick = useCallback((id: string) => {
    const ev = window.event as MouseEvent | undefined;
    setContextMenu({ type: 'node', id, x: ev?.clientX ?? 200, y: ev?.clientY ?? 200 });
  }, []);

  const handleEdgeClick = useCallback((id: string) => {
    if (sim.mode === 'editor') {
      const ev = window.event as MouseEvent | undefined;
      setContextMenu({ type: 'edge', id, x: ev?.clientX ?? 200, y: ev?.clientY ?? 200 });
    } else if (sim.simulationRunning) {
      sim.toggleEdgeBlock(id);
    }
  }, [sim]);

  const handleVehicleClick = useCallback((id: string) => {
    sim.setFocusedVehicleId((prev: string | null) => (prev === id ? null : id));
  }, [sim]);

  const contextNode = contextMenu?.type === 'node' ? sim.nodes.find((n) => n.id === contextMenu.id) : null;
  const contextEdge = contextMenu?.type === 'edge' ? sim.edges.find((e) => e.id === contextMenu.id) : null;

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-background">
      <MapView
        nodes={sim.nodes}
        edges={sim.edges}
        mode={sim.mode}
        selectedNodes={sim.selectedNodes}
        vehicles={sim.vehicles}
        simulationRunning={sim.simulationRunning}
        focusedVehicleId={sim.focusedVehicleId}
        pois={pois}
        onMapClick={handleMapClick}
        onNodeClick={handleNodeClick}
        onNodeRightClick={handleNodeRightClick}
        onEdgeClick={handleEdgeClick}
        onVehicleClick={handleVehicleClick}
        onVehicleArrived={sim.onVehicleArrived}
        onRecalcNeeded={sim.recalculateVehicle}
        onChangeDestination={sim.changeVehicleDestination}
      />

      <ControlPanel
        mode={sim.mode}
        setMode={sim.setMode}
        pois={pois}
        nodeType={nodeType}
        setNodeType={setNodeType}
        onExport={sim.exportMap}
        onImport={sim.importMap}
        vehicles={sim.vehicles}
        simulationRunning={sim.simulationRunning}
        onAddVehicle={sim.addVehicle}
        onRemoveVehicle={sim.removeVehicle}
        onUpdateVehicle={sim.updateVehicle}
        onStartSimulation={sim.startSimulation}
        onStopSimulation={sim.stopSimulation}
      />

      <RadioConsole logs={sim.logs} />

      {/* Inline Context Menus */}
      {contextMenu && contextNode && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} />
          <div className="fixed z-50 glass-panel rounded-lg py-1 min-w-[180px] text-xs shadow-xl" style={{ left: contextMenu.x, top: contextMenu.y }}>
            <div className="px-3 py-1.5 border-b border-border">
              <input type="text" defaultValue={contextNode.name}
                className="bg-transparent border-b border-primary text-foreground text-xs w-full outline-none"
                onBlur={(e) => sim.updateNodeName(contextMenu.id, e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { sim.updateNodeName(contextMenu.id, (e.target as HTMLInputElement).value); setContextMenu(null); } }}
                autoFocus />
            </div>
            <button className="w-full px-3 py-1.5 text-left text-foreground hover:bg-secondary"
              onClick={() => { sim.updateNodeType(contextMenu.id, contextNode.type === 'POI' ? 'Junction' : 'POI'); setContextMenu(null); }}>
              Alternar para {contextNode.type === 'POI' ? 'Junção' : 'POI'}
            </button>
            <div className="border-t border-border my-1" />
            <button className="w-full px-3 py-1.5 text-left text-destructive hover:bg-secondary"
              onClick={() => { sim.removeNode(contextMenu.id); setContextMenu(null); }}>
              🗑 Remover Nó
            </button>
          </div>
        </>
      )}

      {contextMenu && contextEdge && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} />
          <div className="fixed z-50 glass-panel rounded-lg py-1 min-w-[180px] text-xs shadow-xl" style={{ left: contextMenu.x, top: contextMenu.y }}>
            <button className="w-full px-3 py-1.5 text-left text-foreground hover:bg-secondary"
              onClick={() => { sim.toggleEdgeDirection(contextMenu.id); setContextMenu(null); }}>
              {contextEdge.bidirectional ? '→ Definir Mão Única' : '↔ Definir Bidirecional'}
            </button>
            <button className="w-full px-3 py-1.5 text-left text-foreground hover:bg-secondary"
              onClick={() => { sim.toggleEdgeBlock(contextMenu.id); setContextMenu(null); }}>
              {contextEdge.isBlocked ? '🟢 Desbloquear Via' : '🔴 Bloquear Via'}
            </button>
            <div className="border-t border-border my-1" />
            <button className="w-full px-3 py-1.5 text-left text-destructive hover:bg-secondary"
              onClick={() => { sim.removeEdge(contextMenu.id); setContextMenu(null); }}>
              🗑 Remover Via
            </button>
          </div>
        </>
      )}
    </div>
  );
}
