import { GraphNode } from '@/lib/graph';

interface NodeContextMenuProps {
  node: GraphNode;
  position: { x: number; y: number };
  onRename: (name: string) => void;
  onToggleType: () => void;
  onRemove: () => void;
  onClose: () => void;
}

export default function NodeContextMenu({
  node,
  position,
  onRename,
  onToggleType,
  onRemove,
  onClose,
}: NodeContextMenuProps) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed z-50 glass-panel rounded-lg py-1 min-w-[180px] text-xs shadow-xl"
        style={{ left: position.x, top: position.y }}
      >
        <div className="px-3 py-1.5 border-b border-border">
          <input
            type="text"
            defaultValue={node.name}
            className="bg-transparent border-b border-primary text-foreground text-xs w-full outline-none"
            onBlur={(e) => onRename(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                onRename((e.target as HTMLInputElement).value);
                onClose();
              }
            }}
            autoFocus
          />
        </div>
        <button
          className="w-full px-3 py-1.5 text-left text-foreground hover:bg-secondary"
          onClick={() => { onToggleType(); onClose(); }}
        >
          Alternar para {node.type === 'POI' ? 'Junção' : 'POI'}
        </button>
        <div className="border-t border-border my-1" />
        <button
          className="w-full px-3 py-1.5 text-left text-destructive hover:bg-secondary"
          onClick={() => { onRemove(); onClose(); }}
        >
          🗑 Remover Nó
        </button>
      </div>
    </>
  );
}
