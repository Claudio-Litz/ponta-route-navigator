import { useState, useCallback } from 'react';
import MapView from '@/components/MapView';
import ControlPanel from '@/components/ControlPanel';
import RadioConsole from '@/components/RadioConsole';
import EdgeContextMenu from '@/components/EdgeContextMenu';
import NodeContextMenu from '@/components/NodeContextMenu';
import { useGraph } from '@/hooks/useGraph';
import { GraphNode } from '@/lib/graph';

export default function Index() {
  const g = useGraph();
  const [nodeType, setNodeType] = useState<GraphNode['type']>('POI');
  const [contextMenu, setContextMenu] = useState<
    | { type: 'node'; id: string; x: number; y: number }
    | { type: 'edge'; id: string; x: number; y: number }
    | null
  >(null);

  const handleMapClick = useCallback(
    (lat: number, lng: number) => {
      g.addNode(lat, lng, nodeType);
    },
    [g, nodeType]
  );

  const handleNodeClick = useCallback(
    (id: string) => {
      if (g.mode === 'editor') {
        g.selectNodeForEdge(id);
      }
    },
    [g]
  );

  const handleNodeRightClick = useCallback((id: string) => {
    // Use mouse position from last event
    setContextMenu({ type: 'node', id, x: window.event ? (window.event as MouseEvent).clientX : 200, y: window.event ? (window.event as MouseEvent).clientY : 200 });
  }, []);

  const handleEdgeClick = useCallback(
    (id: string) => {
      if (g.mode === 'editor') {
        setContextMenu({ type: 'edge', id, x: window.event ? (window.event as MouseEvent).clientX : 200, y: window.event ? (window.event as MouseEvent).clientY : 200 });
      }
    },
    [g.mode]
  );

  const handleEdgeRightClick = useCallback((id: string) => {
    setContextMenu({ type: 'edge', id, x: window.event ? (window.event as MouseEvent).clientX : 200, y: window.event ? (window.event as MouseEvent).clientY : 200 });
  }, []);

  const contextNode = contextMenu?.type === 'node' ? g.nodes.find((n) => n.id === contextMenu.id) : null;
  const contextEdge = contextMenu?.type === 'edge' ? g.edges.find((e) => e.id === contextMenu.id) : null;

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-background">
      <MapView
        nodes={g.nodes}
        edges={g.edges}
        mode={g.mode}
        selectedNodes={g.selectedNodes}
        routeResult={g.routeResult}
        onMapClick={handleMapClick}
        onNodeClick={handleNodeClick}
        onNodeRightClick={handleNodeRightClick}
        onEdgeClick={handleEdgeClick}
        onEdgeRightClick={handleEdgeRightClick}
      />

      <ControlPanel
        mode={g.mode}
        setMode={g.setMode}
        pois={g.nodes.filter((n) => n.type === 'POI')}
        origin={g.origin}
        destination={g.destination}
        setOrigin={g.setOrigin}
        setDestination={g.setDestination}
        onFindRoute={g.findRoute}
        onRandomBlock={g.randomBlock}
        onExport={g.exportMap}
        onImport={g.importMap}
        nodeType={nodeType}
        setNodeType={setNodeType}
      />

      <RadioConsole logs={g.logs} />

      {contextMenu && contextNode && (
        <NodeContextMenu
          node={contextNode}
          position={{ x: contextMenu.x, y: contextMenu.y }}
          onRename={(name) => g.updateNodeName(contextMenu.id, name)}
          onToggleType={() =>
            g.updateNodeType(contextMenu.id, contextNode.type === 'POI' ? 'Junction' : 'POI')
          }
          onRemove={() => g.removeNode(contextMenu.id)}
          onClose={() => setContextMenu(null)}
        />
      )}

      {contextMenu && contextEdge && (
        <EdgeContextMenu
          edge={contextEdge}
          position={{ x: contextMenu.x, y: contextMenu.y }}
          onToggleDirection={() => g.toggleEdgeDirection(contextMenu.id)}
          onToggleBlock={() => g.toggleEdgeBlock(contextMenu.id)}
          onRemove={() => g.removeEdge(contextMenu.id)}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
