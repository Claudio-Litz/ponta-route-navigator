import { LogEntry } from '@/lib/engine';
import { Volume2, VolumeX } from 'lucide-react';

interface RadioConsoleProps {
  logs: LogEntry[];
  isMuted?: boolean;
  toggleMute?: () => void;
}

const typeColors: Record<LogEntry['type'], string> = {
  info: 'text-muted-foreground',
  warning: 'text-yellow-400',
  route: 'text-primary',
  block: 'text-destructive',
};

export default function RadioConsole({ logs, isMuted, toggleMute }: RadioConsoleProps) {
  return (
    <div className="absolute bottom-4 left-4 z-30 w-96 max-h-52 glass-panel rounded-lg overflow-hidden flex flex-col">
      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          <span className="text-xs font-semibold text-primary tracking-wider uppercase">Console de Rádio</span>
        </div>
        {toggleMute && (
          <button onClick={toggleMute} className="text-muted-foreground hover:text-primary transition-colors" title={isMuted ? "Ativar Voz" : "Silenciar Voz"}>
            {isMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </button>
        )}
      </div>
      <div className="overflow-y-auto max-h-40 p-2 space-y-1 text-xs font-mono">
        {logs.length === 0 && <p className="text-muted-foreground italic">Aguardando eventos...</p>}
        {logs.map((log) => (
          <div key={log.id} className={`flex gap-2 ${typeColors[log.type]}`}>
            <span className="text-muted-foreground shrink-0">{log.timestamp.toLocaleTimeString('pt-BR')}</span>
            <span>{log.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
