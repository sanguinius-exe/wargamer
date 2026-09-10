import { BasemapLayerMeta } from "../types";
import { TileId, tileKey, tilesForBounds } from "./tileMath";

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";

export const IMAGERY_URL = `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`;
const TRANSPORT_URL = `${ESRI}/World_Transportation/MapServer/tile/{z}/{y}/{x}`;
const PLACES_URL = `${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`;

export const IMAGERY_ATTRIB =
  "Imagery: Esri, Maxar, Earthstar Geographics, and the GIS User Community";
export const REFERENCE_ATTRIB =
  "Roads & labels: Esri, HERE, Garmin, © OpenStreetMap contributors";

const fill = (tpl: string, t: TileId) =>
  tpl.replace("{z}", `${t.z}`).replace("{x}", `${t.x}`).replace("{y}", `${t.y}`);

export interface BakeOptions {
  bounds: [number, number, number, number];
  minZoom: number;
  maxZoom: number;
  layers: { imagery: boolean; reference: boolean };
  concurrency?: number;
  signal: AbortSignal;
  onProgress: (done: number, total: number) => void;
  onTiles: (entries: { key: string; bytes: Uint8Array }[]) => void;
}

export interface BakeResult {
  imagery?: BasemapLayerMeta;
  reference?: BasemapLayerMeta;
}

interface Task {
  layer: "imagery" | "reference";
  t: TileId;
}

async function fetchBytes(url: string, signal: AbortSignal): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url, { signal, mode: "cors" });
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

async function bitmapFromBytes(bytes: Uint8Array): Promise<ImageBitmap | null> {
  try {
    return await createImageBitmap(new Blob([new Uint8Array(bytes)]));
  } catch {
    return null;
  }
}

function makeCanvas(): { canvas: OffscreenCanvas | HTMLCanvasElement; ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D } {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(256, 256);
    return { canvas, ctx: canvas.getContext("2d")! };
  }
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  return { canvas, ctx: canvas.getContext("2d")! };
}

async function canvasToPng(
  canvas: OffscreenCanvas | HTMLCanvasElement,
): Promise<Uint8Array> {
  const blob =
    canvas instanceof OffscreenCanvas
      ? await canvas.convertToBlob({ type: "image/png" })
      : await new Promise<Blob>((r) => (canvas as HTMLCanvasElement).toBlob((b) => r(b!), "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}

/** Fetch transport + places tiles and flatten them into one transparent PNG. */
async function compositeReference(
  t: TileId,
  signal: AbortSignal,
): Promise<Uint8Array | null> {
  const [road, place] = await Promise.all([
    fetchBytes(fill(TRANSPORT_URL, t), signal),
    fetchBytes(fill(PLACES_URL, t), signal),
  ]);
  if (!road && !place) return null;
  const { canvas, ctx } = makeCanvas();
  ctx.clearRect(0, 0, 256, 256);
  for (const bytes of [road, place]) {
    if (!bytes) continue;
    const bmp = await bitmapFromBytes(bytes);
    if (bmp) {
      ctx.drawImage(bmp, 0, 0, 256, 256);
      bmp.close();
    }
  }
  return canvasToPng(canvas);
}

export async function bakeBasemap(opts: BakeOptions): Promise<BakeResult> {
  const { bounds, minZoom, maxZoom, layers, signal, onProgress, onTiles } = opts;
  const concurrency = opts.concurrency ?? 8;

  const grid = tilesForBounds(bounds, minZoom, maxZoom);
  const tasks: Task[] = [];
  if (layers.imagery) for (const t of grid) tasks.push({ layer: "imagery", t });
  if (layers.reference) for (const t of grid) tasks.push({ layer: "reference", t });

  const total = tasks.length;
  let done = 0;
  let cursor = 0;
  let buffer: { key: string; bytes: Uint8Array }[] = [];
  const counts = { imagery: 0, reference: 0 };

  const flush = () => {
    if (buffer.length) {
      onTiles(buffer);
      buffer = [];
    }
  };

  async function worker() {
    while (cursor < tasks.length) {
      if (signal.aborted) return;
      const task = tasks[cursor++];
      const bytes =
        task.layer === "imagery"
          ? await fetchBytes(fill(IMAGERY_URL, task.t), signal)
          : await compositeReference(task.t, signal);
      if (bytes && bytes.length > 0) {
        buffer.push({ key: tileKey(task.layer, task.t), bytes });
        counts[task.layer]++;
        if (buffer.length >= 64) flush();
      }
      done++;
      if (done % 8 === 0 || done === total) onProgress(done, total);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, worker),
  );
  flush();
  onProgress(done, total);

  if (signal.aborted) throw new DOMException("Bake cancelled", "AbortError");

  const layerMeta = (
    tileCount: number,
    attribution: string,
  ): BasemapLayerMeta => ({
    minzoom: minZoom,
    maxzoom: maxZoom,
    bounds,
    tileCount,
    attribution,
  });

  return {
    imagery: layers.imagery ? layerMeta(counts.imagery, IMAGERY_ATTRIB) : undefined,
    reference: layers.reference
      ? layerMeta(counts.reference, REFERENCE_ATTRIB)
      : undefined,
  };
}
