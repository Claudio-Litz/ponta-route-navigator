import { GraphEdge } from '@/lib/graph';

interface EdgeContextMenuProps {
  edge: GraphEdge;
  position: { x: number; y: number };
  onToggleDirection: () => void;
  onToggleBlock: () => void;
  onRemove: () => void;
  onClose: () => void;
}

export default function EdgeContextMenu({
  edge,
  position,
  onToggleDirection,
  onToggleBlock,
  onRemove,
  onClose,
}: EdgeContextMenuProps) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed z-50 glass-panel rounded-lg py-1 min-w-[180px] text-xs shadow-xl"
        style={{ left: position.x, top: position.y }}
      >
        <button
          className="w-full px-3 py-1.5 text-left text-foreground hover:bg-secondary flex items-center gap-2"
          onClick={() => { onToggleDirection(); onClose(); }}
        >
          {edge.bidirectional ? '→ Definir Mão Única' : '↔ Definir Bidirecional'}
        </button>
        <button
          className="w-full px-3 py-1.5 text-left text-foreground hover:bg-secondary flex items-center gap-2"
          onClick={() => { onToggleBlock(); onClose(); }}
        >
          {edge.isBlocked ? '🟢 Desbloquear Via' : '🔴 Bloquear Via'}
        </button>
        <div className="border-t border-border my-1" />
        <button
          className="w-full px-3 py-1.5 text-left text-destructive hover:bg-secondary"
          onClick={() => { onRemove(); onClose(); }}
        >
          🗑 Remover Via
        </button>
      </div>
    </>
  );
}
