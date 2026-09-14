import { useEffect, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent } from "react";
import maplibregl, { StyleSpecification } from "maplibre-gl";
import { useGameStore } from "../store";
import { useSession } from "../session";
import {
  Division,
  Team,
  GameFile,
  effectiveness,
  effColor,
  teamColor,
} from "../types";
import { renderSymbol } from "../symbols";
import { IMAGERY_URL, IMAGERY_ATTRIB, REFERENCE_ATTRIB } from "../tiles/bake";
import { activeTileCount } from "../tiles/tileStore";

/** How this client may interact with the board. */
function boardMode() {
  const s = useSession.getState();
  if (s.status !== "connected") return { kind: "solo" as const };
  if (s.role === "gm") return { kind: "gm" as const, phase: s.phase, submissions: s.submissions };
  return {
    kind: "player" as const,
    phase: s.phase,
    myTeamId: s.myTeamId,
    proposals: s.proposals,
  };
}

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";
const TRANSPORT_URL = `${ESRI}/World_Transportation/MapServer/tile/{z}/{y}/{x}`;
const PLACES_URL = `${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`;

type FC = GeoJSON.FeatureCollection;
const EMPTY_FC: FC = { type: "FeatureCollection", features: [] };
type LayerVisible = { imagery: boolean; reference: boolean };

const vis = (on: boolean) => (on ? "visible" : "none") as "visible" | "none";

// Deepest zoom Esri World Imagery has real tiles for effectively everywhere;
// past this you start hitting "map data not available" placeholder tiles.
const STREAM_MAX_ZOOM = 16;

// Division symbols track a real ground footprint (roughly a small unit
// frontage) rather than a fixed screen size — small, and capped near ~½ km so
// they never dominate the view. The sqrt keeps the growth gentle across the
// whole working zoom range instead of snapping between the two clamps.
const MAP_SYMBOL_SIZE = 24; // milsymbol base size for the map icon
const NATURAL_FRAME_PX = 36; // ~ rendered frame width at that base size
const TARGET_GROUND_M = 1500; // reference ground width the icon tracks
const MARKER_MIN_SCALE = 0.5; // never smaller than ~18 px
const MARKER_MAX_SCALE = 1.45; // never larger than ~52 px (~½ km around z13)

function metresPerPixel(lat: number, zoom: number): number {
  return (156543.03392804097 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

function markerScale(zoom: number, lat: number): number {
  const raw = TARGET_GROUND_M / metresPerPixel(lat, zoom) / NATURAL_FRAME_PX;
  return Math.max(MARKER_MIN_SCALE, Math.min(MARKER_MAX_SCALE, Math.sqrt(raw)));
}

/**
 * Full MapLibre style: baked tiles when we actually hold them, else streamed
 * Esri tiles. In a shared session a guest can have `basemap` metadata but none
 * of the GM's tiles — `haveBakedTiles` keeps them on the live stream.
 */
function buildStyle(
  game: GameFile,
  lv: LayerVisible,
  haveBakedTiles: boolean,
): StyleSpecification {
  const layers: StyleSpecification["layers"] = [
    { id: "bg", type: "background", paint: { "background-color": "#0b0e14" } },
  ];
  const sources: StyleSpecification["sources"] = {};
  const bm = haveBakedTiles ? game.basemap : null;

  if (bm?.imagery) {
    sources.imagery = {
      type: "raster",
      tiles: ["wgtiles://imagery/{z}/{x}/{y}"],
      tileSize: 256,
      minzoom: bm.imagery.minzoom,
      maxzoom: bm.imagery.maxzoom,
      bounds: bm.imagery.bounds,
      attribution: bm.imagery.attribution,
    };
    layers.push({
      id: "imagery",
      type: "raster",
      source: "imagery",
      layout: { visibility: vis(lv.imagery) },
    });
  } else {
    sources.imagery = {
      type: "raster",
      tiles: [IMAGERY_URL],
      tileSize: 256,
      maxzoom: STREAM_MAX_ZOOM,
      attribution: IMAGERY_ATTRIB,
    };
    layers.push({
      id: "imagery",
      type: "raster",
      source: "imagery",
      layout: { visibility: vis(lv.imagery) },
    });
  }

  if (bm?.reference) {
    sources.reference = {
      type: "raster",
      tiles: ["wgtiles://reference/{z}/{x}/{y}"],
      tileSize: 256,
      minzoom: bm.reference.minzoom,
      maxzoom: bm.reference.maxzoom,
      bounds: bm.reference.bounds,
      attribution: bm.reference.attribution,
    };
    layers.push({
      id: "reference",
      type: "raster",
      source: "reference",
      layout: { visibility: vis(lv.reference) },
    });
  } else {
    // Esri reference services stop at ~z18 (roads) / ~z13 (places); cap so
    // MapLibre over-zooms the deepest tile instead of requesting 404s.
    sources.ref_roads = {
      type: "raster",
      tiles: [TRANSPORT_URL],
      tileSize: 256,
      maxzoom: 18,
      attribution: REFERENCE_ATTRIB,
    };
    sources.ref_places = {
      type: "raster",
      tiles: [PLACES_URL],
      tileSize: 256,
      maxzoom: 13,
    };
    layers.push({
      id: "ref_roads",
      type: "raster",
      source: "ref_roads",
      layout: { visibility: vis(lv.reference) },
    });
    layers.push({
      id: "ref_places",
      type: "raster",
      source: "ref_places",
      layout: { visibility: vis(lv.reference) },
    });
  }

  return { version: 8, sources, layers };
}

const REFERENCE_LAYER_IDS = ["reference", "ref_roads", "ref_places"];

function maskFC(b: [number, number, number, number] | null): FC {
  if (!b) return EMPTY_FC;
  const [w, s, e, n] = b;
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [-180, -85],
              [180, -85],
              [180, 85],
              [-180, 85],
              [-180, -85],
            ],
            [
              [w, s],
              [w, n],
              [e, n],
              [e, s],
              [w, s],
            ],
          ],
        },
      },
    ],
  };
}

function outlineFC(b: [number, number, number, number] | null): FC {
  if (!b) return EMPTY_FC;
  const [w, s, e, n] = b;
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: [
            [w, s],
            [w, n],
            [e, n],
            [e, s],
            [w, s],
          ],
        },
      },
    ],
  };
}

export default function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map>();
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  // Set during a group drag (started on a marker that's part of the current
  // box selection): the dragged marker's id plus every selected marker's
  // position at drag-start, so followers can be slid by the same delta.
  const dragGroupRef = useRef<{ leaderId: string; starts: Map<string, [number, number]> } | null>(
    null,
  );
  const [ready, setReady] = useState(false);

  const theatre = useGameStore((s) => s.game.theatre);
  const divisions = useGameStore((s) => s.game.divisions);
  const teams = useGameStore((s) => s.game.teams);
  const hiddenTeamIds = useGameStore((s) => s.hiddenTeamIds);
  const selectedId = useGameStore((s) => s.selectedDivisionId);
  const selectedIds = useGameStore((s) => s.selectedIds);
  const selectingTheatre = useGameStore((s) => s.selectingTheatre);
  const layerVisible = useGameStore((s) => s.layerVisible);
  const basemapKey = useGameStore((s) => s.game.basemap?.bakedAt ?? "online");
  const tileEpoch = useGameStore((s) => s.tileEpoch);

  const sessStatus = useSession((s) => s.status);
  const sessRole = useSession((s) => s.role);
  const sessPhase = useSession((s) => s.phase);
  const myTeamId = useSession((s) => s.myTeamId);
  const proposals = useSession((s) => s.proposals);
  const submissions = useSession((s) => s.submissions);

  // --- init once ----------------------------------------------------------
  useEffect(() => {
    const st = useGameStore.getState();
    const tb = st.game.theatre?.bounds;
    const map = new maplibregl.Map({
      container: containerRef.current!,
      style: buildStyle(st.game, st.layerVisible, activeTileCount() > 0),
      ...(tb
        ? { bounds: [tb[0], tb[1], tb[2], tb[3]] as [number, number, number, number], fitBoundsOptions: { padding: 48 } }
        : { center: [30, 25] as [number, number], zoom: 2 }),
      maxZoom: STREAM_MAX_ZOOM,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    // A physical mouse wheel (common on Windows) fires one large discrete delta
    // per notch, which MapLibre turns into a coarse stepped zoom. Shrinking the
    // per-notch zoom rate (default 1/450) makes the eased steps blend together.
    map.scrollZoom.setWheelZoomRate(1 / 600);
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    map.on("zoom", applyMarkerScale);

    // MapLibre's "load" event is unreliable in some environments (it can never
    // fire even once the style + tiles are ready), so poll isStyleLoaded() and
    // stop the moment we're ready. markReady is idempotent.
    let readyDone = false;
    const markReady = () => {
      if (readyDone || !mapRef.current || !map.isStyleLoaded()) return;
      readyDone = true;
      clearInterval(readyPoll);
      ensureOverlay(map);
      setReady(true);
    };
    const readyPoll = setInterval(markReady, 200);
    markReady();
    map.once("load", markReady);

    // setStyle() (basemap changes) wipes our custom sources/layers — re-add
    // them and repaint whenever the style settles.
    map.on("styledata", () => {
      if (!mapRef.current || !map.isStyleLoaded()) return;
      ensureOverlay(map);
      if (readyDone) {
        syncTheatre();
        syncPlan();
      }
    });

    map.on("click", (e) => {
      const s = useGameStore.getState();
      if (s.selectingTheatre) s.theatreClick([e.lngLat.lng, e.lngLat.lat]);
      else {
        s.selectDivision(null);
        if (s.selectedIds.length) s.setSelectedIds([]);
      }
    });

    // --- right-click-drag box select ------------------------------------
    // Right button drags a marquee over the map; anything draggable whose
    // marker falls inside it becomes the group selection, which a
    // subsequent left-drag on any one of them moves together (see
    // dragstart/drag/dragend below). Held Shift adds to the existing
    // selection instead of replacing it.
    const container = containerRef.current!;
    let boxStart: { x: number; y: number } | null = null;
    let boxEl: HTMLDivElement | null = null;

    const updateBox = (x0: number, y0: number, x1: number, y1: number) => {
      if (!boxEl) return;
      boxEl.style.left = `${Math.min(x0, x1)}px`;
      boxEl.style.top = `${Math.min(y0, y1)}px`;
      boxEl.style.width = `${Math.abs(x1 - x0)}px`;
      boxEl.style.height = `${Math.abs(y1 - y0)}px`;
    };
    const onBoxMove = (e: MouseEvent) => {
      if (!boxStart) return;
      const rect = container.getBoundingClientRect();
      updateBox(boxStart.x, boxStart.y, e.clientX - rect.left, e.clientY - rect.top);
    };
    const onBoxUp = (e: MouseEvent) => {
      window.removeEventListener("mousemove", onBoxMove);
      window.removeEventListener("mouseup", onBoxUp);
      if (!boxStart) return;
      const rect = container.getBoundingClientRect();
      const x0 = boxStart.x;
      const y0 = boxStart.y;
      const x1 = e.clientX - rect.left;
      const y1 = e.clientY - rect.top;
      boxStart = null;
      boxEl?.remove();
      boxEl = null;

      const minX = Math.min(x0, x1);
      const maxX = Math.max(x0, x1);
      const minY = Math.min(y0, y1);
      const maxY = Math.max(y0, y1);
      if (maxX - minX < 4 && maxY - minY < 4) return; // a plain right-click, not a drag

      const hits: string[] = [];
      for (const [id, marker] of markersRef.current) {
        if (!marker.isDraggable()) continue;
        const p = map.project(marker.getLngLat());
        if (p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY) hits.push(id);
      }
      const s = useGameStore.getState();
      s.setSelectedIds(e.shiftKey ? [...new Set([...s.selectedIds, ...hits])] : hits);
    };
    const onBoxDown = (e: MouseEvent) => {
      if (e.button !== 2) return;
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      boxStart = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      boxEl = document.createElement("div");
      boxEl.className = "wg-selectbox";
      container.appendChild(boxEl);
      updateBox(boxStart.x, boxStart.y, boxStart.x, boxStart.y);
      window.addEventListener("mousemove", onBoxMove);
      window.addEventListener("mouseup", onBoxUp);
    };
    const onContextMenu = (e: MouseEvent) => e.preventDefault();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const s = useGameStore.getState();
      s.selectDivision(null);
      if (s.selectedIds.length) s.setSelectedIds([]);
    };
    container.addEventListener("mousedown", onBoxDown);
    container.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      clearInterval(readyPoll);
      container.removeEventListener("mousedown", onBoxDown);
      container.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("mousemove", onBoxMove);
      window.removeEventListener("mouseup", onBoxUp);
      window.removeEventListener("keydown", onKeyDown);
      boxEl?.remove();
      map.remove();
      mapRef.current = undefined;
      markersRef.current.clear();
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- rebuild style when the basemap source changes --------------------
  const styleKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const st = useGameStore.getState();
    const haveTiles = activeTileCount() > 0;
    const bm = haveTiles ? st.game.basemap : null;

    // The constructor already built the initial style; only re-set it when the
    // basemap source actually changed, to avoid a tile-reload flash on load.
    const key = `${basemapKey}#${tileEpoch}#${haveTiles ? 1 : 0}`;
    if (styleKeyRef.current !== null && styleKeyRef.current !== key) {
      map.setStyle(buildStyle(st.game, st.layerVisible, haveTiles));
      map.once("styledata", () => {
        ensureOverlay(map);
        syncTheatre();
        syncMarkers();
      });
    }
    styleKeyRef.current = key;

    // With baked imagery there is no live fallback, so keep the camera inside
    // the covered area: clamp min-zoom and constrain panning to the AO.
    const cov = bm?.imagery ?? bm?.reference;
    if (cov) {
      const [w, s, e, n] = cov.bounds;
      const mx = Math.max((e - w) * 0.25, (n - s) * 0.25, 0.05);
      // Cap zoom at the deepest baked level so you never pan into empty tiles.
      map.setMaxZoom(cov.maxzoom);
      map.setMaxBounds([[w - mx, s - mx], [e + mx, n + mx]]);
      map.fitBounds([[w, s], [e, n]], { padding: 24, duration: 0 });
      map.setMinZoom(Math.max(0, Math.min(cov.minzoom, map.getZoom())));
    } else {
      map.setMaxZoom(STREAM_MAX_ZOOM);
      map.setMaxBounds(null);
      map.setMinZoom(0);
    }
    applyMarkerScale();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, basemapKey, tileEpoch]);

  // --- layer visibility -------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (map.getLayer("imagery"))
      map.setLayoutProperty("imagery", "visibility", vis(layerVisible.imagery));
    for (const id of REFERENCE_LAYER_IDS) {
      if (map.getLayer(id))
        map.setLayoutProperty(id, "visibility", vis(layerVisible.reference));
    }
  }, [ready, layerVisible]);

  // --- first fit once ready -------------------------------------------
  useEffect(() => {
    if (ready) {
      syncTheatre();
      syncMarkers();
      fitTheatre();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // --- theatre mask + outline -----------------------------------------
  function ensureOverlay(map: maplibregl.Map) {
    if (!map.isStyleLoaded()) return;
    if (!map.getSource("theatre-mask")) {
      map.addSource("theatre-mask", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "theatre-mask",
        type: "fill",
        source: "theatre-mask",
        paint: { "fill-color": "#05070d", "fill-opacity": 0.6 },
      });
    }
    if (!map.getSource("theatre-outline")) {
      map.addSource("theatre-outline", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "theatre-outline",
        type: "line",
        source: "theatre-outline",
        paint: { "line-color": "#f2b134", "line-width": 2, "line-dasharray": [3, 1.5] },
      });
    }
    if (!map.getSource("wg-plan-lines")) {
      map.addSource("wg-plan-lines", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "wg-plan-lines",
        type: "line",
        source: "wg-plan-lines",
        paint: {
          "line-color": ["coalesce", ["get", "color"], "#f2b134"],
          "line-width": 2,
          "line-dasharray": [2, 2],
          "line-opacity": 0.9,
        },
      });
    }
    if (!map.getSource("wg-plan-targets")) {
      map.addSource("wg-plan-targets", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "wg-plan-targets",
        type: "circle",
        source: "wg-plan-targets",
        paint: {
          "circle-radius": 4,
          "circle-color": ["coalesce", ["get", "color"], "#f2b134"],
          "circle-stroke-color": "#0b0e14",
          "circle-stroke-width": 1.5,
        },
      });
    }
  }

  function syncPlan() {
    const map = mapRef.current;
    if (!map || !ready) return;
    ensureOverlay(map);
    const game = useGameStore.getState().game;
    const divById = new Map(game.divisions.map((d) => [d.id, d]));
    const mode = boardMode();
    const lines: FC["features"] = [];
    const targets: FC["features"] = [];
    const add = (
      from: { lng: number; lat: number },
      to: { lng: number; lat: number },
      color: string,
    ) => {
      lines.push({
        type: "Feature",
        properties: { color },
        geometry: {
          type: "LineString",
          coordinates: [
            [from.lng, from.lat],
            [to.lng, to.lat],
          ],
        },
      });
      targets.push({
        type: "Feature",
        properties: { color },
        geometry: { type: "Point", coordinates: [to.lng, to.lat] },
      });
    };
    const colorOf = (teamId: string | null | undefined) => {
      const t = game.teams.find((x) => x.id === teamId);
      return t ? teamColor(t) : "#f2b134";
    };
    if (mode.kind === "player" && mode.phase === "planning") {
      for (const [id, to] of Object.entries(mode.proposals)) {
        const d = divById.get(id);
        if (d?.position) add(d.position, to, colorOf(d.teamId));
      }
    } else if (mode.kind === "gm" && mode.phase === "adjudicating") {
      for (const sub of Object.values(mode.submissions)) {
        for (const [id, to] of Object.entries(sub.moves)) {
          const d = divById.get(id);
          if (d?.position) add(d.position, to, colorOf(sub.teamId));
        }
      }
    }
    (map.getSource("wg-plan-lines") as maplibregl.GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: lines,
    });
    (map.getSource("wg-plan-targets") as maplibregl.GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: targets,
    });
  }

  function syncTheatre() {
    const map = mapRef.current;
    if (!map || !ready) return;
    ensureOverlay(map);
    const b = useGameStore.getState().game.theatre?.bounds ?? null;
    (map.getSource("theatre-mask") as maplibregl.GeoJSONSource | undefined)?.setData(maskFC(b));
    (map.getSource("theatre-outline") as maplibregl.GeoJSONSource | undefined)?.setData(outlineFC(b));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(syncTheatre, [ready, theatre]);

  function fitTheatre() {
    const map = mapRef.current;
    const b = useGameStore.getState().game.theatre?.bounds;
    if (map && b) map.fitBounds([b[0], b[1], b[2], b[3]], { padding: 60, duration: 0 });
  }

  // --- crosshair while drawing --------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getCanvas().style.cursor = selectingTheatre ? "crosshair" : "";
  }, [selectingTheatre]);

  // --- NATO symbol markers ----------------------------------------
  function syncMarkers() {
    const map = mapRef.current;
    if (!map || !ready) return;
    ensureOverlay(map);
    const s = useGameStore.getState();
    const curDivisions = s.game.divisions;
    const curTeams = s.game.teams;
    const curHidden = s.hiddenTeamIds;
    const curSelected = s.selectedDivisionId;
    const curGrouped = new Set(s.selectedIds);
    const mode = boardMode();
    const teamById = new Map(curTeams.map((t) => [t.id, t]));
    const want = new Set<string>();

    for (const d of curDivisions) {
      if (!d.position) continue;
      if (curHidden.includes(d.teamId)) continue;
      const team = teamById.get(d.teamId);
      if (!team) continue;
      want.add(d.id);

      const isMine = mode.kind !== "player" || d.teamId === mode.myTeamId;
      let lng = d.position.lng;
      let lat = d.position.lat;
      if (mode.kind === "player" && isMine) {
        const p = mode.proposals[d.id];
        if (p) {
          lng = p.lng;
          lat = p.lat;
        }
      }
      const draggable =
        mode.kind === "solo" ||
        mode.kind === "gm" ||
        (mode.kind === "player" && isMine && mode.phase === "planning");

      let m = markersRef.current.get(d.id);
      if (!m) {
        const el = document.createElement("div");
        el.className = "wg-marker";
        el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          useGameStore.getState().selectDivision(d.id);
        });
        m = new maplibregl.Marker({ element: el, draggable });
        // If this marker is part of the current box selection, dragging it
        // drags the whole group by the same delta (see the drag/dragend
        // handlers below, which read this snapshot via dragGroupRef).
        m.on("dragstart", () => {
          const ids = useGameStore.getState().selectedIds;
          if (ids.length > 1 && ids.includes(d.id)) {
            const starts = new Map<string, [number, number]>();
            for (const gid of ids) {
              const gm = markersRef.current.get(gid);
              if (gm) {
                const ll = gm.getLngLat();
                starts.set(gid, [ll.lng, ll.lat]);
              }
            }
            dragGroupRef.current = { leaderId: d.id, starts };
          } else {
            dragGroupRef.current = null;
          }
        });
        m.on("drag", () => {
          const grp = dragGroupRef.current;
          if (!grp || grp.leaderId !== d.id) return;
          const start = grp.starts.get(d.id);
          if (!start) return;
          const now = m!.getLngLat();
          const dLng = now.lng - start[0];
          const dLat = now.lat - start[1];
          for (const [gid, gstart] of grp.starts) {
            if (gid === d.id) continue;
            markersRef.current.get(gid)?.setLngLat([gstart[0] + dLng, gstart[1] + dLat]);
          }
        });
        m.on("dragend", () => {
          const ll = m!.getLngLat();
          const grp = dragGroupRef.current;
          dragGroupRef.current = null;
          const isPlayer = boardMode().kind === "player";
          if (grp && grp.leaderId === d.id && grp.starts.size > 1) {
            const start = grp.starts.get(d.id)!;
            const dLng = ll.lng - start[0];
            const dLat = ll.lat - start[1];
            const moves: Record<string, [number, number]> = {};
            for (const [gid, gstart] of grp.starts) {
              moves[gid] = gid === d.id ? [ll.lng, ll.lat] : [gstart[0] + dLng, gstart[1] + dLat];
            }
            if (isPlayer) {
              for (const [gid, pos] of Object.entries(moves)) useSession.getState().propose(gid, pos);
            } else {
              useGameStore.getState().moveDivisions(moves);
            }
          } else if (isPlayer) {
            useSession.getState().propose(d.id, [ll.lng, ll.lat]);
          } else {
            useGameStore.getState().moveDivision(d.id, [ll.lng, ll.lat]);
          }
        });
        markersRef.current.set(d.id, m);
        m.setLngLat([lng, lat]).addTo(map);
      } else {
        m.setDraggable(draggable);
        m.setLngLat([lng, lat]);
      }
      m.getElement().dataset.foe = isMine ? "" : "1";
      paintMarker(m.getElement(), m, d, team, curSelected === d.id, curGrouped.has(d.id));
    }

    for (const [id, m] of markersRef.current) {
      if (!want.has(id)) {
        m.remove();
        markersRef.current.delete(id);
      }
    }
    applyMarkerScale();
    syncPlan();
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(syncMarkers, [
    ready,
    divisions,
    teams,
    hiddenTeamIds,
    selectedId,
    selectedIds,
    sessStatus,
    sessRole,
    sessPhase,
    myTeamId,
    proposals,
    submissions,
  ]);

  // Resize every symbol to the current zoom (called on map "zoom" + after sync),
  // and slide its text label to just under the (scaled) icon.
  function applyMarkerScale() {
    const map = mapRef.current;
    if (!map) return;
    const k = markerScale(map.getZoom(), map.getCenter().lat);
    for (const m of markersRef.current.values()) {
      const el = m.getElement();
      const inner = el.querySelector<HTMLElement>(".wg-mk-inner");
      const label = el.querySelector<HTMLElement>(".wg-mk-label");
      inner?.style.setProperty("--mk-scale", k.toFixed(3));
      if (label) {
        const ih = Number(el.dataset.ih) || 0;
        const ay = Number(el.dataset.ay) || 0;
        const below = (ih - ay) * k + 4;
        label.style.transform = `translate(-50%, ${below.toFixed(1)}px)`;
      }
    }
  }

  // --- drop from the roster -----------------------------------------
  function onDragOver(e: ReactDragEvent) {
    if (e.dataTransfer.types.includes("text/wg-division")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    }
  }
  function onDrop(e: ReactDragEvent) {
    if (boardMode().kind === "player") return; // players can't deploy
    const id = e.dataTransfer.getData("text/wg-division");
    const map = mapRef.current;
    if (!id || !map || !containerRef.current) return;
    e.preventDefault();
    const rect = containerRef.current.getBoundingClientRect();
    const ll = map.unproject([e.clientX - rect.left, e.clientY - rect.top]);
    useGameStore.getState().deployDivision(id, [ll.lng, ll.lat]);
  }

  return (
    <div ref={containerRef} className="wg-map" onDragOver={onDragOver} onDrop={onDrop} />
  );
}

function paintMarker(
  el: HTMLElement,
  marker: maplibregl.Marker,
  d: Division,
  team: Team,
  selected: boolean,
  grouped: boolean,
) {
  const r = renderSymbol(d, team, { size: MAP_SYMBOL_SIZE, detail: "icon" });
  const eff = effectiveness(d.status);
  el.innerHTML =
    `<div class="wg-mk-inner">${r.svg}</div>` +
    `<div class="wg-mk-label"><span class="nm"></span><span class="ef"></span></div>`;

  const inner = el.querySelector<HTMLElement>(".wg-mk-inner")!;
  const label = el.querySelector<HTMLElement>(".wg-mk-label")!;
  // The marker element is a zero-size point; place the icon so its SIDC anchor
  // sits on that point, and scale it about the same anchor.
  inner.style.left = `${-r.anchor.x}px`;
  inner.style.top = `${-r.anchor.y}px`;
  inner.style.transformOrigin = `${r.anchor.x}px ${r.anchor.y}px`;

  label.querySelector<HTMLElement>(".nm")!.textContent = d.name;
  const ef = label.querySelector<HTMLElement>(".ef")!;
  ef.textContent = `${eff}%`;
  ef.style.color = effColor(eff);

  el.dataset.ih = String(r.height);
  el.dataset.ay = String(r.anchor.y);
  el.classList.toggle("selected", selected);
  el.classList.toggle("grouped", grouped);
  el.dataset.reserve = d.position ? "" : "1";
  marker.setOffset([0, 0]);
}
