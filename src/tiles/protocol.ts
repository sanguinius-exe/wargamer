import maplibregl from "maplibre-gl";
import { getTile } from "./tileStore";

// Serves baked tiles from the in-memory cache under the "wgtiles" scheme, e.g.
//   wgtiles://imagery/8/145/89
// A missing tile resolves to an empty response so MapLibre just shows a gap.

let registered = false;

export function registerTileProtocol(): void {
  if (registered) return;
  registered = true;

  maplibregl.addProtocol("wgtiles", async (params) => {
    const key = params.url.replace(/^wgtiles:\/\//, "");
    const bytes = getTile(key);
    if (!bytes) return { data: new Uint8Array(0) };
    const copy = bytes.slice();
    return { data: copy.buffer };
  });
}
