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

  const inputClass = "bg-secondary border border-border text-foreground text-[11px] rounded px-1.5 py-0.5 w-full outline-none focus:ring-1 focus:ring-primary";

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
        onVoiceTrigger={sim.handleVoiceTrigger}
        setFocusedVehicleId={sim.setFocusedVehicleId}
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
        isGlobalMuted={sim.isGlobalMuted}
        setIsGlobalMuted={sim.setIsGlobalMuted}
      />

      <RadioConsole logs={sim.logs} />

      {/* Inline Context Menus */}
      {contextMenu && contextNode && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} />
          <div className="fixed z-50 glass-panel rounded-lg py-1 min-w-[220px] text-xs shadow-xl" style={{ left: contextMenu.x, top: contextMenu.y }}>
            <div className="px-3 py-1.5 border-b border-border">
              <input type="text" defaultValue={contextNode.name}
                className="bg-transparent border-b border-primary text-foreground text-xs w-full outline-none"
                onBlur={(e) => sim.updateNodeName(contextMenu.id, e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { sim.updateNodeName(contextMenu.id, (e.target as HTMLInputElement).value); setContextMenu(null); } }}
                autoFocus />
            </div>
            
            <div className="px-3 py-2 space-y-2">
              <label className="text-[10px] text-muted-foreground uppercase">Tipo de Nó</label>
              <select className={inputClass} value={contextNode.type} onChange={(e) => sim.updateNodeType(contextMenu.id, e.target.value as any)}>
                <option value="POI">POI</option>
                <option value="Junction">Junção</option>
                <option value="Crossroad">Cruzamento</option>
              </select>
            </div>

            {contextNode.type === 'Crossroad' && (
              <div className="px-3 py-2 border-t border-border space-y-2 max-h-48 overflow-y-auto">
                <label className="text-[10px] text-muted-foreground uppercase">Ângulos de Conexão</label>
                {sim.edges.filter(e => e.from === contextNode.id || (e.bidirectional && e.to === contextNode.id)).map(e => {
                  const targetId = e.from === contextNode.id ? e.to : e.from;
                  const targetNode = sim.nodes.find(n => n.id === targetId);
                  const conn = contextNode.connections?.find(c => c.to === targetId);
                  return (
                    <div key={e.id} className="flex items-center justify-between gap-2">
                      <span className="text-[10px] truncate w-20">{targetNode?.name}</span>
                      <input type="number" className={inputClass + " w-16"} value={conn?.angle || 0}
                        onChange={(ev) => {
                          const newConns = [...(contextNode.connections || [])];
                          const idx = newConns.findIndex(c => c.to === targetId);
                          if (idx >= 0) newConns[idx].angle = parseInt(ev.target.value);
                          else newConns.push({ to: targetId, angle: parseInt(ev.target.value) });
                          sim.updateNodeAttribute(contextNode.id, 'connections', newConns);
                        }} />
                    </div>
                  );
                })}
              </div>
            )}

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
          <div className="fixed z-50 glass-panel rounded-lg p-3 min-w-[220px] text-xs shadow-xl space-y-3" style={{ left: contextMenu.x, top: contextMenu.y }}>
            <div className="space-y-2 border-b border-border pb-2">
              <div className="flex items-center justify-between gap-2">
                <label className="text-[10px] text-muted-foreground uppercase">Limite (km/h)</label>
                <input type="number" className={inputClass + " w-16"} value={contextEdge.speedLimit} 
                  onChange={(e) => sim.updateEdgeAttribute(contextMenu.id, 'speedLimit', parseInt(e.target.value))} />
              </div>
              <div className="flex items-center justify-between gap-2">
                <label className="text-[10px] text-muted-foreground uppercase">Solo</label>
                <select className={inputClass + " w-24"} value={contextEdge.groundType} 
                  onChange={(e) => sim.updateEdgeAttribute(contextMenu.id, 'groundType', e.target.value)}>
                  <option value="asfalto">Asfalto</option>
                  <option value="terra">Terra</option>
                  <option value="brita">Brita</option>
                </select>
              </div>
              <div className="flex items-center justify-between gap-2">
                <label className="text-[10px] text-muted-foreground uppercase">Lama</label>
                <input type="checkbox" checked={contextEdge.hasMud} 
                  onChange={(e) => sim.updateEdgeAttribute(contextMenu.id, 'hasMud', e.target.checked)} />
              </div>
            </div>

            <div className="space-y-1">
              <button className="w-full px-2 py-1 text-left text-foreground hover:bg-secondary rounded"
                onClick={() => { sim.toggleEdgeDirection(contextMenu.id); }}>
                {contextEdge.bidirectional ? '→ Mão Única' : '↔ Bidirecional'}
              </button>
              <button className="w-full px-2 py-1 text-left text-foreground hover:bg-secondary rounded"
                onClick={() => { sim.toggleEdgeBlock(contextMenu.id); }}>
                {contextEdge.isBlocked ? '🟢 Desbloquear' : '🔴 Bloquear'}
              </button>
              <button className="w-full px-2 py-1 text-left text-destructive hover:bg-secondary rounded"
                onClick={() => { sim.removeEdge(contextMenu.id); setContextMenu(null); }}>
                🗑 Remover Via
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
