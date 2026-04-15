import { useRef } from 'react';
import { GraphNode, Vehicle } from '@/lib/engine';
import { AppMode } from '@/hooks/useSimulation';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';

interface ControlPanelProps {
  mode: AppMode;
  setMode: (m: AppMode) => void;
  pois: GraphNode[];
  nodeType: GraphNode['type'];
  setNodeType: (t: GraphNode['type']) => void;
  onExport: () => void;
  onImport: (file: File) => void;
  // Vehicles
  vehicles: Vehicle[];
  simulationRunning: boolean;
  onAddVehicle: () => void;
  onRemoveVehicle: (id: string) => void;
  onUpdateVehicle: (id: string, field: string, value: any) => void;
  onStartSimulation: () => void;
  onStopSimulation: () => void;
  onExportVehicleLog: (id: string) => void;
}

const selectClass = 'w-full bg-secondary text-foreground text-xs rounded px-2 py-1.5 border border-border focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50';
const inputClass = 'w-full bg-secondary text-foreground text-[11px] rounded px-2 py-1 border border-border focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50';

export default function ControlPanel({
  mode, setMode, pois, nodeType, setNodeType,
  onExport, onImport,
  vehicles, simulationRunning,
  onAddVehicle, onRemoveVehicle, onUpdateVehicle,
  onStartSimulation, onStopSimulation,
  onExportVehicleLog,
}: ControlPanelProps) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="absolute top-4 right-4 z-30 w-72 glass-panel rounded-xl p-4 space-y-4 max-h-[calc(100vh-2rem)] overflow-y-auto">
      <div>
        <h1 className="text-sm font-bold text-primary tracking-wider uppercase">RouteMind</h1>
        <p className="text-[10px] text-muted-foreground">Porto Ponta da Madeira</p>
      </div>

      <div className="flex gap-1">
        <Button size="sm" variant={mode === 'editor' ? 'default' : 'secondary'} className="flex-1 text-xs"
          onClick={() => setMode('editor')} disabled={simulationRunning}>
          Editor
        </Button>
        <Button size="sm" variant={mode === 'simulation' ? 'default' : 'secondary'} className="flex-1 text-xs"
          onClick={() => setMode('simulation')} disabled={simulationRunning}>
          Simulação
        </Button>
      </div>

      {mode === 'editor' && (
        <>
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Tipo de Nó</label>
            <div className="flex gap-1">
              <Button size="sm" variant={nodeType === 'POI' ? 'default' : 'secondary'} className="flex-1 text-xs" onClick={() => setNodeType('POI')}>POI</Button>
              <Button size="sm" variant={nodeType === 'Junction' ? 'default' : 'secondary'} className="flex-1 text-xs" onClick={() => setNodeType('Junction')}>Junção</Button>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground">Clique no mapa para criar nós. Clique em 2 nós para conectar. Clique direito para opções.</p>
          <div className="flex gap-1">
            <Button size="sm" variant="secondary" className="flex-1 text-xs" onClick={onExport}>Exportar</Button>
            <Button size="sm" variant="secondary" className="flex-1 text-xs" onClick={() => fileRef.current?.click()}>Importar</Button>
            <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onImport(f); }} />
          </div>
        </>
      )}

      {mode === 'simulation' && (
        <>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Veículos</label>
              {!simulationRunning && vehicles.length < 10 && (
                <Button size="sm" variant="ghost" className="text-xs h-6 px-2" onClick={onAddVehicle}>+ Adicionar</Button>
              )}
            </div>

            {vehicles.length === 0 && (
              <p className="text-[10px] text-muted-foreground italic">Nenhum veículo. Adicione até 10.</p>
            )}

            {vehicles.map((v) => (
              <div key={v.id} className="space-y-1.5 p-2 rounded-lg bg-secondary/50 border border-border">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: v.color }} />
                  <span className="text-xs font-medium flex-1">{v.name}</span>
                  {v.status === 'arrived' && <span className="text-[9px] text-primary">✓ Chegou</span>}
                  {v.status === 'stuck' && <span className="text-[9px] text-destructive">✗ Sem rota</span>}
                  <div className="flex gap-1">
                    {v.navigationLogs.length > 0 && (
                      <button 
                        title="Exportar Log TETRA (JSON)" 
                        className="text-primary hover:text-primary/80 text-[14px] leading-none" 
                        onClick={() => onExportVehicleLog(v.id)}
                      >
                        💾
                      </button>
                    )}
                    {!simulationRunning && (
                      <button className="text-muted-foreground hover:text-destructive text-sm leading-none" onClick={() => onRemoveVehicle(v.id)}>×</button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[9px] text-muted-foreground">Partida</label>
                    <select disabled={simulationRunning} value={v.originId} onChange={(e) => onUpdateVehicle(v.id, 'originId', e.target.value)} className={selectClass}>
                      <option value="">...</option>
                      {pois.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] text-muted-foreground">Destino</label>
                    <select disabled={simulationRunning} value={v.destinationId} onChange={(e) => onUpdateVehicle(v.id, 'destinationId', e.target.value)} className={selectClass}>
                      <option value="">...</option>
                      {pois.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[9px] text-muted-foreground">Largura (m)</label>
                    <input type="number" step="0.1" disabled={simulationRunning} value={v.width} onChange={(e) => onUpdateVehicle(v.id, 'width', parseFloat(e.target.value))} className={inputClass} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] text-muted-foreground">Altura (m)</label>
                    <input type="number" step="0.1" disabled={simulationRunning} value={v.height} onChange={(e) => onUpdateVehicle(v.id, 'height', parseFloat(e.target.value))} className={inputClass} />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-muted-foreground">Velocidade Máx: {v.speed} km/h</label>
                  <Slider min={5} max={120} step={5} value={[v.speed]}
                    onValueChange={([val]) => onUpdateVehicle(v.id, 'speed', val)}
                    disabled={simulationRunning} />
                </div>
              </div>
            ))}
          </div>

          {!simulationRunning ? (
            <Button size="sm" className="w-full text-xs" onClick={onStartSimulation}
              disabled={vehicles.length === 0 || vehicles.every((v) => !v.originId || !v.destinationId)}>
              ▶ Iniciar Simulação
            </Button>
          ) : (
            <Button size="sm" variant="destructive" className="w-full text-xs" onClick={onStopSimulation}>
              ■ Parar Simulação
            </Button>
          )}

          <p className="text-[10px] text-muted-foreground">
            {simulationRunning
              ? 'Clique em uma via para bloqueá-la. Clique em um veículo para focar.'
              : 'Configure os veículos e inicie a simulação.'}
          </p>
        </>
      )}
    </div>
  );
}
