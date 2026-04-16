import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { GraphNode, GraphEdge, Vehicle, haversine, GroundType, isRailwayBlocked } from '@/lib/engine';
import { AppMode } from '@/hooks/useSimulation';
import { Map as MapIcon, Globe } from 'lucide-react';

interface MapViewProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  mode: AppMode;
  selectedNodes: string[];
  vehicles: Vehicle[];
  simulationRunning: boolean;
  focusedVehicleId: string | null;
  pois: GraphNode[];
  onMapClick: (lat: number, lng: number) => void;
  onNodeClick: (id: string) => void;
  onNodeRightClick: (id: string) => void;
  onEdgeClick: (id: string) => void;
  onVehicleClick: (id: string) => void;
  onVehicleArrived: (id: string) => void;
  onRecalcNeeded: (vehicleId: string, fromNodeId: string) => void;
  onChangeDestination: (vehicleId: string, newDestId: string, fromNodeId: string) => void;
  processNavigation: (vehicleId: string, lat: number, lng: number, segmentIndex: number) => void;
  updateEdgeAttribute?: (id: string, field: keyof GraphEdge, value: any) => void;
  simTime: number;
  /** Traffic congestion weights from the predictive traffic engine */
  trafficWeights?: Map<string, number>;
}

const NODE_COLORS = { POI: '#22c55e', Junction: '#64748b', selected: '#facc15' };
const GROUND_COLORS: Record<GroundType, string> = {
  asfalto: '#64748b',
  terra: '#92400e',
  brita: '#475569',
};

export default function MapView({
  nodes, edges, mode, selectedNodes,
  vehicles, simulationRunning, focusedVehicleId, pois,
  onMapClick, onNodeClick, onNodeRightClick, onEdgeClick,
  onVehicleClick, onVehicleArrived, onRecalcNeeded, onChangeDestination,
  processNavigation, updateEdgeAttribute, simTime, trafficWeights
}: MapViewProps) {
  const [isSatellite, setIsSatellite] = useState(false);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const nodeMarkersRef = useRef(new Map<string, L.CircleMarker>());
  const edgeLinesRef = useRef(new Map<string, L.Polyline>());
  const arrowsRef = useRef<L.Polyline[]>([]);
  const vehicleMarkersRef = useRef(new Map<string, L.CircleMarker>());
  const animStateRef = useRef(new Map<string, { segmentIndex: number; progress: number; pathVersion: number; blockedSegment?: number }>());
  const frameRef = useRef(0);
  const focusRouteRef = useRef<L.Polyline[]>([]);
  const focusPopupRef = useRef<L.Popup | null>(null);

  const vehiclesRef = useRef(vehicles);
  useEffect(() => { vehiclesRef.current = vehicles; }, [vehicles]);
  const nodesRef = useRef(nodes);
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  const cbRef = useRef({ onVehicleArrived, onRecalcNeeded, onVehicleClick, onChangeDestination, processNavigation });
  useEffect(() => { cbRef.current = { onVehicleArrived, onRecalcNeeded, onVehicleClick, onChangeDestination, processNavigation }; });
  const focusedRef = useRef(focusedVehicleId);
  useEffect(() => { focusedRef.current = focusedVehicleId; }, [focusedVehicleId]);
  const poisRef = useRef(pois);
  useEffect(() => { poisRef.current = pois; }, [pois]);
  const edgesRef = useRef(edges);
  useEffect(() => { edgesRef.current = edges; }, [edges]);
  const simTimeRef = useRef(simTime);
  useEffect(() => { simTimeRef.current = simTime; }, [simTime]);

  const nodeMapRef = useRef(new Map<string, GraphNode>());
  useEffect(() => {
    const m = new Map<string, GraphNode>();
    nodes.forEach((n) => m.set(n.id, n));
    nodeMapRef.current = m;
  }, [nodes]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    const map = L.map(mapContainerRef.current, {
      center: [-2.558, -44.368],
      zoom: 15,
      zoomControl: false,
    });
    tileLayerRef.current = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
    }).addTo(map);
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    mapContainerRef.current.addEventListener('change', (e) => {
      const target = e.target as HTMLSelectElement;
      if (target.id?.startsWith('vdest-')) {
        const vehicleId = target.id.replace('vdest-', '');
        const newDestId = target.value;
        const state = animStateRef.current.get(vehicleId);
        const vehicle = vehiclesRef.current.find((v) => v.id === vehicleId);
        if (state && vehicle?.path) {
          const fromNodeId = state.progress > 0.01
            ? vehicle.path[Math.min(state.segmentIndex + 1, vehicle.path.length - 1)]
            : vehicle.path[state.segmentIndex];
          cbRef.current.onChangeDestination(vehicleId, newDestId, fromNodeId);
        }
      }
    });

    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    if (tileLayerRef.current) {
      if (isSatellite) {
        tileLayerRef.current.setUrl('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}');
      } else {
        tileLayerRef.current.setUrl('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png');
      }
    }
  }, [isSatellite]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const handler = (e: L.LeafletMouseEvent) => {
      if (mode === 'editor') onMapClick(e.latlng.lat, e.latlng.lng);
    };
    map.on('click', handler);
    return () => { map.off('click', handler); };
  }, [mode, onMapClick]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const existing = nodeMarkersRef.current;
    const currentIds = new Set(nodes.map((n) => n.id));
    for (const [id, marker] of existing) {
      if (!currentIds.has(id)) { marker.remove(); existing.delete(id); }
    }
    for (const node of nodes) {
      const isSelected = selectedNodes.includes(node.id);
      const color = isSelected ? NODE_COLORS.selected : NODE_COLORS[node.type];
      if (existing.has(node.id)) {
        const m = existing.get(node.id)!;
        m.setLatLng([node.lat, node.lng]);
        m.setStyle({ fillColor: color, color: color });
      } else {
        const marker = L.circleMarker([node.lat, node.lng], {
          radius: node.type === 'POI' ? 8 : 5,
          fillColor: color, color, fillOpacity: 0.9, weight: 2,
        }).addTo(map);
        marker.bindTooltip(node.name, { permanent: false, className: 'node-tooltip', direction: 'top', offset: [0, -10] });
        marker.on('click', (e) => { L.DomEvent.stopPropagation(e); onNodeClick(node.id); });
        marker.on('contextmenu', (e) => { L.DomEvent.stopPropagation(e as any); L.DomEvent.preventDefault(e as any); onNodeRightClick(node.id); });
        existing.set(node.id, marker);
      }
    }
  }, [nodes, selectedNodes, onNodeClick, onNodeRightClick]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const existing = edgeLinesRef.current;
    const currentIds = new Set(edges.map((e) => e.id));
    arrowsRef.current.forEach((d) => d.remove());
    arrowsRef.current = [];
    for (const [id, line] of existing) {
      if (!currentIds.has(id)) { line.remove(); existing.delete(id); }
    }
    for (const edge of edges) {
      const fromNode = nodeMapRef.current.get(edge.from);
      const toNode = nodeMapRef.current.get(edge.to);
      if (!fromNode || !toNode) continue;
      const latlngs: L.LatLngExpression[] = [[fromNode.lat, fromNode.lng], [toNode.lat, toNode.lng]];
      
      let edgeColor = edge.isBlocked ? '#ef4444' : (edge.hasMud ? '#78350f' : GROUND_COLORS[edge.groundType]);
      let weight = edge.hasMud ? 5 : 3;
      let dashArray = edge.isBlocked ? '8, 8' : undefined;

      if (edge.railwayCrossing?.enabled) {
        const isBlocked = isRailwayBlocked(edge, simTime);
        edgeColor = isBlocked ? '#facc15' : '#fbbf24';
        weight = 6;
        dashArray = '10, 5';
      }

      if (existing.has(edge.id)) {
        const line = existing.get(edge.id)!;
        line.setLatLngs(latlngs);
        line.setStyle({ color: edgeColor, dashArray, weight });
      } else {
        const line = L.polyline(latlngs, { color: edgeColor, weight, opacity: 0.8, dashArray }).addTo(map);
        line.on('click', (e) => { L.DomEvent.stopPropagation(e); onEdgeClick(edge.id); });
        line.bindTooltip(`${edge.railwayCrossing?.enabled ? '[TREM] ' : ''}Lim: ${edge.speedLimit}km/h | Solo: ${edge.groundType}${edge.hasMud ? ' (LAMA)' : ''}`, { sticky: true });
        existing.set(edge.id, line);
      }
      if (!edge.bidirectional && !edge.isBlocked) {
        const midLat = (fromNode.lat + toNode.lat) / 2;
        const midLng = (fromNode.lng + toNode.lng) / 2;
        const angle = Math.atan2(toNode.lng - fromNode.lng, toNode.lat - fromNode.lat);
        const arrowLen = 0.0003;
        const tip: L.LatLngExpression = [midLat, midLng];
        const left: L.LatLngExpression = [midLat - arrowLen * Math.cos(angle - 0.5), midLng - arrowLen * Math.sin(angle - 0.5)];
        const right: L.LatLngExpression = [midLat - arrowLen * Math.cos(angle + 0.5), midLng - arrowLen * Math.sin(angle + 0.5)];
        const arrow = L.polyline([left, tip, right], { color: '#64748b', weight: 2, opacity: 0.9 }).addTo(map);
        arrowsRef.current.push(arrow);
      }
    }
  }, [edges, nodes, onEdgeClick, simTime]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!simulationRunning) {
      cancelAnimationFrame(frameRef.current);
      vehicleMarkersRef.current.forEach((m) => m.remove());
      vehicleMarkersRef.current.clear();
      animStateRef.current.clear();
      focusRouteRef.current.forEach((l) => l.remove());
      focusRouteRef.current = [];
      if (focusPopupRef.current) { focusPopupRef.current.remove(); focusPopupRef.current = null; }
      return;
    }

    for (const v of vehicles) {
      if ((v.status !== 'moving' && v.status !== 'stuck') || !v.path || v.path.length < 2) continue;
      if (!vehicleMarkersRef.current.has(v.id)) {
        const startNode = nodeMapRef.current.get(v.path[0]);
        if (!startNode) continue;
        const marker = L.circleMarker([startNode.lat, startNode.lng], {
          radius: 10, fillColor: v.color, color: '#ffffff', fillOpacity: 1, weight: 2,
        }).addTo(map);
        marker.on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          cbRef.current.onVehicleClick(v.id);
        });
        marker.bindTooltip(v.name, { permanent: false, className: 'node-tooltip', direction: 'top', offset: [0, -14] });
        vehicleMarkersRef.current.set(v.id, marker);
        animStateRef.current.set(v.id, { segmentIndex: 0, progress: 0, pathVersion: v.pathVersion });
      }
    }

    let lastTime = performance.now();
    // TIME_SCALE is owned by useSimulation — don't redeclare here or it overrides to 1
    const TIME_SCALE = 3;

    const animate = (time: number) => {
      const dt = Math.min((time - lastTime) / 1000, 0.1);
      lastTime = time;
      const currentVehicles = vehiclesRef.current;
      const currentEdges = edgesRef.current;
      const currentSimTime = simTimeRef.current;
      const nm = nodeMapRef.current;

      for (const v of currentVehicles) {
        if (v.status !== 'moving' || !v.path || v.path.length < 2) {
          if (v.status === 'arrived' || v.status === 'idle') {
            const m = vehicleMarkersRef.current.get(v.id);
            if (m) { m.remove(); vehicleMarkersRef.current.delete(v.id); animStateRef.current.delete(v.id); }
          }
          // 'stuck' vehicles keep their marker — they are frozen in place waiting
          continue;
        }

        let state = animStateRef.current.get(v.id);
        if (!state) {
          state = { segmentIndex: 0, progress: 0, pathVersion: v.pathVersion };
          animStateRef.current.set(v.id, state);
        }

        if (state.pathVersion !== v.pathVersion) {
          state.segmentIndex = 0;
          state.progress = 0;
          state.pathVersion = v.pathVersion;
          state.blockedSegment = undefined; // new path — clear blocked flag
        }

        if (state.segmentIndex >= v.path.length - 1) {
          const dest = nm.get(v.path[v.path.length - 1]);
          if (dest) vehicleMarkersRef.current.get(v.id)?.setLatLng([dest.lat, dest.lng]);
          cbRef.current.onVehicleArrived(v.id);
          continue;
        }

        const fromNode = nm.get(v.path[state.segmentIndex]);
        const toNode = nm.get(v.path[state.segmentIndex + 1]);
        if (!fromNode || !toNode) continue;

        const edge = currentEdges.find(e => 
          (e.from === fromNode.id && e.to === toNode.id) || 
          (e.bidirectional && e.to === fromNode.id && e.from === toNode.id)
        );

        // ── BLOCKED EDGE CHECK ─────────────────────────────────────────
        // Check both hard block and railway crossing timetable
        const isEdgeBlocked = edge && (edge.isBlocked || isRailwayBlocked(edge, currentSimTime));

        if (isEdgeBlocked) {
          // Stop the vehicle on this segment
          if (state.blockedSegment !== state.segmentIndex) {
            // First frame we detect the block — request an immediate reroute
            state.blockedSegment = state.segmentIndex;
            // Recalc from the node at the START of this segment (vehicle may be mid-segment)
            cbRef.current.onRecalcNeeded(v.id, v.path[state.segmentIndex]);
          }
          // Do not advance this frame
          continue;
        }

        // Edge is passable — clear any previous blocked marker
        if (state.blockedSegment === state.segmentIndex) {
          state.blockedSegment = undefined;
        }

        let speedKmh = v.speed;
        if (edge) {
          const groundFactor = edge.groundType === 'asfalto' ? 1.0 : (edge.groundType === 'terra' ? 0.7 : 0.5);
          speedKmh = Math.min(v.speed, edge.speedLimit * groundFactor);
          if (edge.hasMud) speedKmh = Math.min(speedKmh, 30);
        }

        const dist = haversine(fromNode.lat, fromNode.lng, toNode.lat, toNode.lng);
        const speedMs = speedKmh * 1000 / 3600;
        state.progress += (speedMs * dt * TIME_SCALE) / Math.max(dist, 1);

        if (state.progress >= 1) {
          state.segmentIndex++;
          state.progress = 0;
          state.blockedSegment = undefined; // cleared a segment — unblock flag
          if (state.segmentIndex >= v.path.length - 1) {
            const dest = nm.get(v.path[v.path.length - 1]);
            if (dest) vehicleMarkersRef.current.get(v.id)?.setLatLng([dest.lat, dest.lng]);
            cbRef.current.onVehicleArrived(v.id);
            continue;
          }
          // Trigger traffic-aware rerouting at this natural node boundary.
          // Safe: vehicle is EXACTLY at path[segmentIndex], so resetting to
          // segment 0 of the new path (which starts at that same node) has zero
          // visual jump. vehiclesRef is synced synchronously inside recalculateVehicle.
          cbRef.current.onRecalcNeeded(v.id, v.path[state.segmentIndex]);
        }

        const p = Math.min(state.progress, 1);
        const lat = fromNode.lat + (toNode.lat - fromNode.lat) * p;
        const lng = fromNode.lng + (toNode.lng - fromNode.lng) * p;
        const marker = vehicleMarkersRef.current.get(v.id);
        if (marker) marker.setLatLng([lat, lng]);

        cbRef.current.processNavigation(v.id, lat, lng, state.segmentIndex);

        if (focusedRef.current === v.id && focusPopupRef.current) {
          focusPopupRef.current.setLatLng([lat, lng]);
        }
      }
      frameRef.current = requestAnimationFrame(animate);
    };

    frameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameRef.current);
  // 'vehicles' intentionally excluded: animation reads vehiclesRef.current every frame.
  // Including it would restart the loop on every setVehicles call (arrivals,
  // navigation flags, assignments) — exactly what causes the multi-vehicle teleport.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simulationRunning, edges]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    focusRouteRef.current.forEach((l) => l.remove());
    focusRouteRef.current = [];
    if (focusPopupRef.current) { focusPopupRef.current.remove(); focusPopupRef.current = null; }

    if (!focusedVehicleId || !simulationRunning) return;

    const vehicle = vehicles.find((v) => v.id === focusedVehicleId);
    if (!vehicle?.path || vehicle.path.length < 2) return;

    const latlngs = vehicle.path
      .map((id) => nodeMapRef.current.get(id))
      .filter(Boolean)
      .map((n) => [n!.lat, n!.lng] as L.LatLngExpression);

    const glow = L.polyline(latlngs, { color: '#22c55e', weight: 8, opacity: 0.3, className: 'neon-glow-line' }).addTo(map);
    const line = L.polyline(latlngs, { color: '#22c55e', weight: 4, opacity: 0.9, className: 'neon-glow-line' }).addTo(map);
    focusRouteRef.current = [glow, line];

    const marker = vehicleMarkersRef.current.get(focusedVehicleId);
    const currentPois = poisRef.current;
    const options = currentPois.map((p) =>
      `<option value="${p.id}" ${p.id === vehicle.destinationId ? 'selected' : ''}>${p.name}</option>`
    ).join('');

    const popup = L.popup({ className: 'vehicle-popup', closeOnClick: false, autoClose: false, closeButton: true })
      .setContent(`
        <div style="font-family:Inter,sans-serif;font-size:12px;color:#e2e8f0;">
          <strong style="color:${vehicle.color};">● ${vehicle.name}</strong>
          <div style="font-size:10px;color:#94a3b8;margin-top:2px;">W: ${vehicle.width}m | H: ${vehicle.height}m</div>
          <div style="margin-top:6px;">
            <label style="font-size:10px;text-transform:uppercase;color:#94a3b8;">Novo Destino</label>
            <select id="vdest-${vehicle.id}" style="width:100%;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:4px;padding:4px;margin-top:2px;font-size:11px;">
              ${options}
            </select>
          </div>
        </div>
      `);

    if (marker) popup.setLatLng(marker.getLatLng());
    popup.openOn(map);
    focusPopupRef.current = popup;

    popup.on('remove', () => {
      focusPopupRef.current = null;
      cbRef.current.onVehicleClick(focusedVehicleId);
    });
  }, [focusedVehicleId, simulationRunning, vehicles]);

  // ── Traffic congestion visualization ──────────────────────────────────────
  // Updates edge colors reactively when the traffic engine emits new weights.
  // Keeps this separate from the main edge effect to avoid expensive re-renders.
  useEffect(() => {
    const tw = trafficWeights;
    if (!tw) return;

    for (const [edgeId, line] of edgeLinesRef.current) {
      const edge = edges.find(e => e.id === edgeId);
      if (!edge || edge.isBlocked) continue; // blocked edges keep their red color

      const fwdKey = `${edge.from}->${edge.to}`;
      const bwdKey = `${edge.to}->${edge.from}`;
      const weight = Math.max(
        tw.get(fwdKey) ?? 0,
        edge.bidirectional ? (tw.get(bwdKey) ?? 0) : 0
      );

      if (weight > 0) {
        // Orange = moderate (peso 0–2), Red = heavy (peso > 2)
        const congestionColor = weight >= 2 ? '#ef4444' : '#f97316';
        line.setStyle({ color: congestionColor, weight: 5, opacity: 0.95 });
      } else {
        // Restore baseline color when congestion clears
        const baseColor = edge.hasMud ? '#78350f' : GROUND_COLORS[edge.groundType];
        line.setStyle({ color: baseColor, weight: edge.hasMud ? 5 : 3, opacity: 0.8 });
      }
    }

    // Highlight intersection nodes with a slightly larger ring
    for (const [nodeId, marker] of nodeMarkersRef.current) {
      const node = nodes.find(n => n.id === nodeId);
      if (!node) continue;
      const isSelected = marker.options.fillColor === NODE_COLORS.selected;
      if (isSelected) continue; // keep selection highlight
      if (node.isIntersection) {
        marker.setStyle({ radius: 8, weight: 2.5, color: '#a78bfa' }); // purple ring
      } else {
        marker.setStyle({ radius: node.type === 'POI' ? 8 : 6, weight: 2, color: '#1e293b' });
      }
    }
  }, [trafficWeights, edges, nodes]);

  return (
    <>
      <div
        ref={mapContainerRef}
        className="absolute inset-0 z-0"
        style={{ cursor: mode === 'editor' ? 'crosshair' : 'default' }}
      />
      <button
        onClick={() => setIsSatellite(!isSatellite)}
        className="absolute bottom-[20px] right-[60px] z-[1000] p-2.5 bg-white/95 backdrop-blur-md rounded-full shadow-[0_4px_12px_rgba(0,0,0,0.15)] border border-gray-200 text-slate-600 hover:text-emerald-700 hover:bg-white transition-all flex items-center justify-center group"
        title={isSatellite ? "Mudar para visualização em mapa" : "Mudar para visualização por satélite"}
      >
        {isSatellite ? (
          <MapIcon size={22} className="group-hover:scale-110 transition-transform" />
        ) : (
          <Globe size={22} className="group-hover:scale-110 transition-transform" />
        )}
      </button>
    </>
  );
}
