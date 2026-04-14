import { useRef } from 'react';
import { GraphNode } from '@/lib/graph';
import { AppMode } from '@/hooks/useGraph';
import { Button } from '@/components/ui/button';

interface ControlPanelProps {
  mode: AppMode;
  setMode: (m: AppMode) => void;
  pois: GraphNode[];
  origin: string;
  destination: string;
  setOrigin: (id: string) => void;
  setDestination: (id: string) => void;
  onFindRoute: () => void;
  onRandomBlock: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
  nodeType: GraphNode['type'];
  setNodeType: (t: GraphNode['type']) => void;
}

export default function ControlPanel({
  mode,
  setMode,
  pois,
  origin,
  destination,
  setOrigin,
  setDestination,
  onFindRoute,
  onRandomBlock,
  onExport,
  onImport,
  nodeType,
  setNodeType,
}: ControlPanelProps) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="absolute top-4 right-4 z-30 w-72 glass-panel rounded-xl p-4 space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-sm font-bold text-primary tracking-wider uppercase">
          ValeRoute
        </h1>
        <p className="text-[10px] text-muted-foreground">Porto Ponta da Madeira</p>
      </div>

      {/* Mode toggle */}
      <div className="flex gap-1">
        <Button
          size="sm"
          variant={mode === 'editor' ? 'default' : 'secondary'}
          className="flex-1 text-xs"
          onClick={() => setMode('editor')}
        >
          Editor
        </Button>
        <Button
          size="sm"
          variant={mode === 'simulation' ? 'default' : 'secondary'}
          className="flex-1 text-xs"
          onClick={() => setMode('simulation')}
        >
          Simulação
        </Button>
      </div>

      {mode === 'editor' && (
        <>
          {/* Node type selector */}
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider">
              Tipo de Nó
            </label>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant={nodeType === 'POI' ? 'default' : 'secondary'}
                className="flex-1 text-xs"
                onClick={() => setNodeType('POI')}
              >
                POI
              </Button>
              <Button
                size="sm"
                variant={nodeType === 'Junction' ? 'default' : 'secondary'}
                className="flex-1 text-xs"
                onClick={() => setNodeType('Junction')}
              >
                Junção
              </Button>
            </div>
          </div>

          <p className="text-[10px] text-muted-foreground">
            Clique no mapa para criar nós. Clique em 2 nós para conectar. Clique direito para opções.
          </p>

          {/* Import/Export */}
          <div className="flex gap-1">
            <Button size="sm" variant="secondary" className="flex-1 text-xs" onClick={onExport}>
              Exportar
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="flex-1 text-xs"
              onClick={() => fileRef.current?.click()}
            >
              Importar
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onImport(f);
              }}
            />
          </div>
        </>
      )}

      {mode === 'simulation' && (
        <>
          {/* Origin/Destination */}
          <div className="space-y-2">
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider">
                Origem
              </label>
              <select
                value={origin}
                onChange={(e) => setOrigin(e.target.value)}
                className="w-full bg-secondary text-foreground text-xs rounded px-2 py-1.5 border border-border focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">Selecione...</option>
                {pois.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider">
                Destino
              </label>
              <select
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                className="w-full bg-secondary text-foreground text-xs rounded px-2 py-1.5 border border-border focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">Selecione...</option>
                {pois.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <Button size="sm" className="w-full text-xs" onClick={onFindRoute}>
            ⚡ Gerar Rota
          </Button>
          <Button
            size="sm"
            variant="destructive"
            className="w-full text-xs"
            onClick={onRandomBlock}
          >
            🚧 Bloqueio Aleatório
          </Button>
        </>
      )}
    </div>
  );
}
