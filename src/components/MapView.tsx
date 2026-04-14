import { useEffect, useRef, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { GraphNode, GraphEdge } from '@/lib/graph';
import { AStarResult } from '@/lib/astar';
import { AppMode } from '@/hooks/useGraph';

interface MapViewProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  mode: AppMode;
  selectedNodes: string[];
  routeResult: AStarResult | null;
  onMapClick: (lat: number, lng: number) => void;
  onNodeClick: (id: string) => void;
  onNodeRightClick: (id: string) => void;
  onEdgeClick: (id: string) => void;
  onEdgeRightClick: (id: string) => void;
}

const NODE_COLORS = {
  POI: '#22c55e',
  Junction: '#64748b',
  selected: '#facc15',
};

export default function MapView({
  nodes,
  edges,
  mode,
  selectedNodes,
  routeResult,
  onMapClick,
  onNodeClick,
  onNodeRightClick,
  onEdgeClick,
  onEdgeRightClick,
}: MapViewProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<{
    nodeMarkers: Map<string, L.CircleMarker>;
    edgeLines: Map<string, L.Polyline>;
    routeLine: L.Polyline | null;
    arrowDecorators: L.Polyline[];
  }>({
    nodeMarkers: new Map(),
    edgeLines: new Map(),
    routeLine: null,
    arrowDecorators: [],
  });

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [-2.558, -44.368],
      zoom: 15,
      zoomControl: false,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
    }).addTo(map);

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Grid overlay
    const gridGroup = L.layerGroup().addTo(map);
    const drawGrid = () => {
      gridGroup.clearLayers();
      const bounds = map.getBounds();
      const step = 0.002;
      const south = Math.floor(bounds.getSouth() / step) * step;
      const west = Math.floor(bounds.getWest() / step) * step;

      for (let lat = south; lat <= bounds.getNorth(); lat += step) {
        L.polyline(
          [
            [lat, bounds.getWest()],
            [lat, bounds.getEast()],
          ],
          { color: 'rgba(100,116,139,0.15)', weight: 1 }
        ).addTo(gridGroup);
      }
      for (let lng = west; lng <= bounds.getEast(); lng += step) {
        L.polyline(
          [
            [bounds.getSouth(), lng],
            [bounds.getNorth(), lng],
          ],
          { color: 'rgba(100,116,139,0.15)', weight: 1 }
        ).addTo(gridGroup);
      }
    };
    map.on('moveend zoomend', drawGrid);
    drawGrid();

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Map click handler
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const handler = (e: L.LeafletMouseEvent) => {
      if (mode === 'editor') {
        onMapClick(e.latlng.lat, e.latlng.lng);
      }
    };
    map.on('click', handler);
    return () => {
      map.off('click', handler);
    };
  }, [mode, onMapClick]);

  // Draw nodes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const existing = layersRef.current.nodeMarkers;
    const currentIds = new Set(nodes.map((n) => n.id));

    // Remove deleted
    for (const [id, marker] of existing) {
      if (!currentIds.has(id)) {
        marker.remove();
        existing.delete(id);
      }
    }

    // Add/update
    for (const node of nodes) {
      const isSelected = selectedNodes.includes(node.id);
      const color = isSelected ? NODE_COLORS.selected : NODE_COLORS[node.type];

      if (existing.has(node.id)) {
        const marker = existing.get(node.id)!;
        marker.setLatLng([node.lat, node.lng]);
        marker.setStyle({ fillColor: color, color: color });
      } else {
        const marker = L.circleMarker([node.lat, node.lng], {
          radius: node.type === 'POI' ? 8 : 5,
          fillColor: color,
          color: color,
          fillOpacity: 0.9,
          weight: 2,
        }).addTo(map);

        marker.bindTooltip(node.name, {
          permanent: false,
          className: 'node-tooltip',
          direction: 'top',
          offset: [0, -10],
        });

        marker.on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          onNodeClick(node.id);
        });
        marker.on('contextmenu', (e) => {
          L.DomEvent.stopPropagation(e);
          L.DomEvent.preventDefault(e);
          onNodeRightClick(node.id);
        });

        existing.set(node.id, marker);
      }
    }
  }, [nodes, selectedNodes, onNodeClick, onNodeRightClick]);

  // Draw edges
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const existing = layersRef.current.edgeLines;
    const currentIds = new Set(edges.map((e) => e.id));

    // Clear old decorators
    layersRef.current.arrowDecorators.forEach((d) => d.remove());
    layersRef.current.arrowDecorators = [];

    // Remove deleted
    for (const [id, line] of existing) {
      if (!currentIds.has(id)) {
        line.remove();
        existing.delete(id);
      }
    }

    for (const edge of edges) {
      const fromNode = nodes.find((n) => n.id === edge.from);
      const toNode = nodes.find((n) => n.id === edge.to);
      if (!fromNode || !toNode) continue;

      const latlngs: L.LatLngExpression[] = [
        [fromNode.lat, fromNode.lng],
        [toNode.lat, toNode.lng],
      ];

      const edgeColor = edge.isBlocked ? '#ef4444' : '#64748b';
      const dashArray = edge.isBlocked ? '8, 8' : undefined;

      if (existing.has(edge.id)) {
        const line = existing.get(edge.id)!;
        line.setLatLngs(latlngs);
        line.setStyle({ color: edgeColor, dashArray });
      } else {
        const line = L.polyline(latlngs, {
          color: edgeColor,
          weight: 3,
          opacity: 0.8,
          dashArray,
        }).addTo(map);

        line.on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          onEdgeClick(edge.id);
        });
        line.on('contextmenu', (e) => {
          L.DomEvent.stopPropagation(e);
          L.DomEvent.preventDefault(e);
          onEdgeRightClick(edge.id);
        });

        existing.set(edge.id, line);
      }

      // Arrow for one-way edges
      if (!edge.bidirectional && !edge.isBlocked) {
        const midLat = (fromNode.lat + toNode.lat) / 2;
        const midLng = (fromNode.lng + toNode.lng) / 2;
        const angle = Math.atan2(toNode.lng - fromNode.lng, toNode.lat - fromNode.lat);
        const arrowLen = 0.0003;

        const tip: L.LatLngExpression = [midLat, midLng];
        const left: L.LatLngExpression = [
          midLat - arrowLen * Math.cos(angle - 0.5),
          midLng - arrowLen * Math.sin(angle - 0.5),
        ];
        const right: L.LatLngExpression = [
          midLat - arrowLen * Math.cos(angle + 0.5),
          midLng - arrowLen * Math.sin(angle + 0.5),
        ];

        const arrow = L.polyline([left, tip, right], {
          color: '#64748b',
          weight: 2,
          opacity: 0.9,
        }).addTo(map);
        layersRef.current.arrowDecorators.push(arrow);
      }
    }
  }, [edges, nodes, onEdgeClick, onEdgeRightClick]);

  // Draw route
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (layersRef.current.routeLine) {
      layersRef.current.routeLine.remove();
      layersRef.current.routeLine = null;
    }

    if (routeResult?.success && routeResult.path.length >= 2) {
      const latlngs: L.LatLngExpression[] = routeResult.path
        .map((id) => nodes.find((n) => n.id === id))
        .filter(Boolean)
        .map((n) => [n!.lat, n!.lng] as L.LatLngExpression);

      // Glow background
      L.polyline(latlngs, {
        color: '#22c55e',
        weight: 8,
        opacity: 0.3,
        className: 'neon-glow-line',
      }).addTo(map);

      const routeLine = L.polyline(latlngs, {
        color: '#22c55e',
        weight: 4,
        opacity: 0.9,
        className: 'neon-glow-line',
      }).addTo(map);

      layersRef.current.routeLine = routeLine;
    }
  }, [routeResult, nodes]);

  return (
    <div
      ref={mapContainerRef}
      className="absolute inset-0 z-0"
      style={{ cursor: mode === 'editor' ? 'crosshair' : 'default' }}
    />
  );
}
