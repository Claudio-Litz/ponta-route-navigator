import { useState, useCallback } from 'react';
import MapView from '@/components/MapView';
import ControlPanel from '@/components/ControlPanel';
import RadioConsole from '@/components/RadioConsole';
import { useSimulation } from '@/hooks/useSimulation';
import { GraphNode, GraphEdge } from '@/lib/engine';

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

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

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
        processNavigation={sim.processNavigation}
        simTime={sim.simTime}
      />

      <div className="absolute top-4 left-4 z-30 flex flex-col gap-2">
        <div className="glass-panel px-4 py-2 rounded-lg border border-primary/30">
           <div className="text-[10px] text-primary uppercase tracking-tighter font-bold">Relógio da Simulação</div>
           <div className="text-2xl font-mono text-foreground tabular-nums">{formatTime(sim.simTime)}</div>
        </div>
      </div>

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
        onExportVehicleLog={sim.exportVehicleLog}
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
          <div className="fixed z-50 glass-panel rounded-lg p-3 min-w-[240px] text-xs shadow-xl space-y-3 max-h-[400px] overflow-y-auto" style={{ left: contextMenu.x, top: contextMenu.y }}>
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

            <div className="space-y-2 border-b border-border pb-2">
              <div className="flex items-center justify-between gap-2">
                <label className="text-[10px] text-muted-foreground uppercase font-bold text-primary">Passagem de Nível</label>
                <input type="checkbox" checked={contextEdge.railwayCrossing?.enabled} 
                  onChange={(e) => sim.updateEdgeAttribute(contextMenu.id, 'railwayCrossing', { ...contextEdge.railwayCrossing, enabled: e.target.checked })} />
              </div>
              
              {contextEdge.railwayCrossing?.enabled && (
                <div className="space-y-2 pt-1">
                  <div className="text-[9px] text-muted-foreground uppercase font-semibold">Agendamentos (Início | Duração)</div>
                  {contextEdge.railwayCrossing.schedules.map((s, idx) => (
                    <div key={idx} className="flex gap-1 items-center">
                      <input type="number" className={inputClass} value={s.start} 
                        onChange={(e) => {
                          const newSchedules = [...contextEdge.railwayCrossing!.schedules];
                          newSchedules[idx] = { ...s, start: parseInt(e.target.value) || 0 };
                          sim.updateEdgeAttribute(contextMenu.id, 'railwayCrossing', { ...contextEdge.railwayCrossing, schedules: newSchedules });
                        }} />
                      <input type="number" className={inputClass} value={s.duration} 
                        onChange={(e) => {
                          const newSchedules = [...contextEdge.railwayCrossing!.schedules];
                          newSchedules[idx] = { ...s, duration: parseInt(e.target.value) || 0 };
                          sim.updateEdgeAttribute(contextMenu.id, 'railwayCrossing', { ...contextEdge.railwayCrossing, schedules: newSchedules });
                        }} />
                      <button className="text-destructive px-1" onClick={() => {
                        const newSchedules = contextEdge.railwayCrossing!.schedules.filter((_, i) => i !== idx);
                        sim.updateEdgeAttribute(contextMenu.id, 'railwayCrossing', { ...contextEdge.railwayCrossing, schedules: newSchedules });
                      }}>×</button>
                    </div>
                  ))}
                  <button className="w-full py-1 bg-primary/10 hover:bg-primary/20 text-primary rounded text-[10px]"
                    onClick={() => {
                      const newSchedules = [...(contextEdge.railwayCrossing?.schedules || []), { start: 0, duration: 60 }];
                      sim.updateEdgeAttribute(contextMenu.id, 'railwayCrossing', { ...contextEdge.railwayCrossing, schedules: newSchedules });
                    }}>+ Adicionar Bloqueio</button>
                </div>
              )}
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
