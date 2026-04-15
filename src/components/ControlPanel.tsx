import { useRef, useState } from 'react';
import { GraphNode, Vehicle, VehicleType, Mission, MissionPriority } from '@/lib/engine';
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
  onAddVehicle: (opts?: { name?: string; vehicleType?: VehicleType; waitingPoiId?: string }) => void;
  onRemoveVehicle: (id: string) => void;
  onUpdateVehicle: (id: string, field: string, value: any) => void;
  onStartSimulation: () => void;
  onStopSimulation: () => void;
  onExportVehicleLog: (id: string) => void;
  // Missions
  missions: Mission[];
  onAddMission: (destination: string, requiredType: VehicleType, priority: MissionPriority, forcedVehicleId?: string) => void;
  onRemoveMission: (id: string) => void;
}

const selectClass = 'w-full bg-secondary text-foreground text-xs rounded px-2 py-1.5 border border-border focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50';
const inputClass = 'w-full bg-secondary text-foreground text-[11px] rounded px-2 py-1 border border-border focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50';
const labelClass = 'text-[9px] text-muted-foreground uppercase tracking-wide';

const VEHICLE_TYPE_LABELS: Record<VehicleType, string> = {
  operational: 'Operacional',
  maintenance: 'Manutenção',
  other: 'Outro',
};

const PRIORITY_LABELS: Record<MissionPriority, string> = {
  low: '🟢 Baixa',
  medium: '🟡 Média',
  high: '🔴 Alta',
};

const STATUS_LABELS: Record<Mission['status'], string> = {
  pending: 'Pendente',
  assigned: 'Atribuída',
  in_progress: 'Em andamento',
  completed: 'Concluída',
};

const STATUS_COLORS: Record<Mission['status'], string> = {
  pending: '#94a3b8',
  assigned: '#f59e0b',
  in_progress: '#3b82f6',
  completed: '#22c55e',
};

export default function ControlPanel({
  mode, setMode, pois, nodeType, setNodeType,
  onExport, onImport,
  vehicles, simulationRunning,
  onAddVehicle, onRemoveVehicle, onUpdateVehicle,
  onStartSimulation, onStopSimulation,
  onExportVehicleLog,
  missions, onAddMission, onRemoveMission,
}: ControlPanelProps) {
  const fileRef = useRef<HTMLInputElement>(null);

  // New vehicle form state
  const [newVehicleName, setNewVehicleName] = useState('');
  const [newVehicleType, setNewVehicleType] = useState<VehicleType>('operational');
  const [newVehiclePoiId, setNewVehiclePoiId] = useState('');

  // New mission form state
  const [newMissionDest, setNewMissionDest] = useState('');
  const [newMissionType, setNewMissionType] = useState<VehicleType>('operational');
  const [newMissionPriority, setNewMissionPriority] = useState<MissionPriority>('medium');
  const [newMissionForcedVehicle, setNewMissionForcedVehicle] = useState<string>('');
  const [showMissionForm, setShowMissionForm] = useState(false);

  const handleAddVehicle = () => {
    onAddVehicle({
      name: newVehicleName,
      vehicleType: newVehicleType,
      waitingPoiId: newVehiclePoiId || undefined,
    });
    setNewVehicleName('');
    setNewVehiclePoiId('');
  };

  const handleAddMission = () => {
    if (!newMissionDest) return;
    onAddMission(newMissionDest, newMissionType, newMissionPriority, newMissionForcedVehicle || undefined);
    setShowMissionForm(false);
    setNewMissionDest('');
    setNewMissionForcedVehicle('');
  };

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
          {/* ── VEHICLES ────────────────────────────────── */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Veículos</label>
            </div>

            {/* New vehicle form (only before simulation) */}
            {!simulationRunning && vehicles.length < 10 && (
              <div className="space-y-1.5 p-2 rounded-lg border border-dashed border-border bg-secondary/20">
                <div className="text-[9px] text-primary uppercase font-semibold tracking-wide mb-1">Novo Veículo</div>
                <div className="space-y-1">
                  <label className={labelClass}>Nome</label>
                  <input
                    type="text"
                    placeholder="Ex: V-01"
                    value={newVehicleName}
                    onChange={(e) => setNewVehicleName(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div className="space-y-1">
                  <label className={labelClass}>Tipo</label>
                  <select value={newVehicleType} onChange={(e) => setNewVehicleType(e.target.value as VehicleType)} className={selectClass}>
                    <option value="operational">Operacional</option>
                    <option value="maintenance">Manutenção</option>
                    <option value="other">Outro</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className={labelClass}>POI de Espera</label>
                  <select value={newVehiclePoiId} onChange={(e) => setNewVehiclePoiId(e.target.value)} className={selectClass}>
                    <option value="">— Nenhum —</option>
                    {pois.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <Button size="sm" className="w-full text-xs mt-1" onClick={handleAddVehicle}>
                  + Adicionar Veículo
                </Button>
              </div>
            )}

            {vehicles.length === 0 && (
              <p className="text-[10px] text-muted-foreground italic">Nenhum veículo. Adicione acima.</p>
            )}

            {vehicles.map((v) => (
              <div key={v.id} className="space-y-1.5 p-2 rounded-lg bg-secondary/50 border border-border">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: v.color }} />
                  <span className="text-xs font-medium flex-1">{v.name}</span>
                  <span className="text-[9px] text-muted-foreground">{VEHICLE_TYPE_LABELS[v.type] ?? v.type}</span>
                  {v.status === 'arrived' && <span className="text-[9px] text-primary">✓ Chegou</span>}
                  {v.status === 'stuck' && <span className="text-[9px] text-destructive">✗ Sem rota</span>}
                  {v.status === 'moving' && <span className="text-[9px] text-blue-400">▶ Em rota</span>}
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

                {!simulationRunning && (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className={labelClass}>Partida</label>
                        <select disabled={simulationRunning} value={v.originId} onChange={(e) => onUpdateVehicle(v.id, 'originId', e.target.value)} className={selectClass}>
                          <option value="">...</option>
                          {pois.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className={labelClass}>Destino</label>
                        <select disabled={simulationRunning} value={v.destinationId} onChange={(e) => onUpdateVehicle(v.id, 'destinationId', e.target.value)} className={selectClass}>
                          <option value="">...</option>
                          {pois.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className={labelClass}>Largura (m)</label>
                        <input type="number" step="0.1" disabled={simulationRunning} value={v.width} onChange={(e) => onUpdateVehicle(v.id, 'width', parseFloat(e.target.value))} className={inputClass} />
                      </div>
                      <div className="space-y-1">
                        <label className={labelClass}>Altura (m)</label>
                        <input type="number" step="0.1" disabled={simulationRunning} value={v.height} onChange={(e) => onUpdateVehicle(v.id, 'height', parseFloat(e.target.value))} className={inputClass} />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] text-muted-foreground">Velocidade Máx: {v.speed} km/h</label>
                      <Slider min={5} max={120} step={5} value={[v.speed]}
                        onValueChange={([val]) => onUpdateVehicle(v.id, 'speed', val)}
                        disabled={simulationRunning} />
                    </div>
                  </>
                )}

                {/* Show current mission when simulation running */}
                {simulationRunning && v.currentMissionId && (
                  <div className="text-[9px] text-blue-400">
                    📋 Missão ativa
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* ── MISSIONS ────────────────────────────────── */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Missões</label>
              <Button size="sm" variant="ghost" className="text-xs h-6 px-2" onClick={() => setShowMissionForm((v) => !v)}>
                {showMissionForm ? '−' : '+ Nova'}
              </Button>
            </div>

            {showMissionForm && (
              <div className="space-y-1.5 p-2 rounded-lg border border-dashed border-primary/40 bg-primary/5">
                <div className="text-[9px] text-primary uppercase font-semibold tracking-wide mb-1">Nova Missão</div>
                <div className="space-y-1">
                  <label className={labelClass}>Destino (POI)</label>
                  <select value={newMissionDest} onChange={(e) => setNewMissionDest(e.target.value)} className={selectClass}>
                    <option value="">— Selecione —</option>
                    {pois.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className={labelClass}>Tipo de Veículo Requerido</label>
                  <select value={newMissionType} onChange={(e) => setNewMissionType(e.target.value as VehicleType)} className={selectClass}>
                    <option value="operational">Operacional</option>
                    <option value="maintenance">Manutenção</option>
                    <option value="other">Outro</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className={labelClass}>Prioridade</label>
                  <select value={newMissionPriority} onChange={(e) => setNewMissionPriority(e.target.value as MissionPriority)} className={selectClass}>
                    <option value="low">🟢 Baixa</option>
                    <option value="medium">🟡 Média</option>
                    <option value="high">🔴 Alta</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className={labelClass}>Veículo Específico (Opcional)</label>
                  <select value={newMissionForcedVehicle} onChange={(e) => setNewMissionForcedVehicle(e.target.value)} className={selectClass}>
                    <option value="">— Automático —</option>
                    {vehicles.filter(v => v.type === newMissionType).map(v => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                  </select>
                </div>
                <Button size="sm" className="w-full text-xs mt-1" onClick={handleAddMission} disabled={!newMissionDest}>
                  Criar Missão
                </Button>
              </div>
            )}

            {missions.length === 0 && (
              <p className="text-[10px] text-muted-foreground italic">Nenhuma missão criada.</p>
            )}

            {missions.map((m) => {
              const destNode = pois.find((p) => p.id === m.destination);
              const assignedVehicle = vehicles.find((v) => v.id === m.assignedVehicleId);
              return (
                <div key={m.id} className="p-2 rounded-lg bg-secondary/40 border border-border space-y-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[10px] font-medium text-foreground truncate">
                      {destNode?.name ?? m.destination.slice(0, 8)}
                    </span>
                    <span className="text-[9px] shrink-0" style={{ color: STATUS_COLORS[m.status] }}>
                      {STATUS_LABELS[m.status]}
                    </span>
                    {m.status !== 'completed' && (
                      <button
                        className="text-muted-foreground hover:text-destructive text-sm leading-none shrink-0"
                        onClick={() => onRemoveMission(m.id)}
                      >×</button>
                    )}
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <span className="text-[9px] text-muted-foreground">{PRIORITY_LABELS[m.priority]}</span>
                    <span className="text-[9px] text-muted-foreground">{VEHICLE_TYPE_LABELS[m.requiredType]}</span>
                  </div>
                  {assignedVehicle && (
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: assignedVehicle.color }} />
                      <span className="text-[9px] text-muted-foreground">{assignedVehicle.name}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {!simulationRunning ? (
            <Button size="sm" className="w-full text-xs" onClick={onStartSimulation}
              disabled={vehicles.length === 0 && missions.length === 0}>
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
              : 'Configure veículos e missões, depois inicie a simulação.'}
          </p>
        </>
      )}
    </div>
  );
}
