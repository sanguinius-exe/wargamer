import { zip, unzip, strToU8, strFromU8, AsyncZippable, Unzipped } from "fflate";
import { GameFile } from "../types";
import { normalizeGame } from "../schema";

const SCENARIO_ENTRY = "scenario.json";

const tileExt = (key: string) => (key.startsWith("imagery/") ? "jpg" : "png");

export interface LoadedBundle {
  game: GameFile;
  tiles: { key: string; bytes: Uint8Array }[];
}

function isZip(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b; // "PK"
}

/** Build a .wargame ZIP: scenario.json + tiles/<layer>/<z>/<x>/<y>.<ext>. */
export async function packBundle(
  game: GameFile,
  tiles: Map<string, Uint8Array>,
): Promise<Blob> {
  const files: AsyncZippable = {
    [SCENARIO_ENTRY]: [
      strToU8(JSON.stringify(game, null, 2)),
      { level: 6 },
    ],
  };
  for (const [key, bytes] of tiles) {
    // Tiles are already compressed media; store without re-deflating.
    files[`tiles/${key}.${tileExt(key)}`] = [bytes, { level: 0 }];
  }

  const zipped = await new Promise<Uint8Array>((resolve, reject) => {
    zip(files, { consume: false }, (err, data) =>
      err ? reject(err) : resolve(data),
    );
  });
  return new Blob([new Uint8Array(zipped)], { type: "application/zip" });
}

/** Read a .wargame ZIP or a bare scenario .json. */
export async function readBundle(input: ArrayBuffer): Promise<LoadedBundle> {
  const bytes = new Uint8Array(input);

  if (!isZip(bytes)) {
    const game = normalizeGame(JSON.parse(strFromU8(bytes)));
    return { game, tiles: [] };
  }

  const entries = await new Promise<Unzipped>((resolve, reject) => {
    unzip(bytes, (err, data) => (err ? reject(err) : resolve(data)));
  });

  const scenarioRaw = entries[SCENARIO_ENTRY];
  if (!scenarioRaw) throw new Error("Bundle is missing scenario.json.");
  const game = normalizeGame(JSON.parse(strFromU8(scenarioRaw)));

  const tiles: { key: string; bytes: Uint8Array }[] = [];
  for (const [path, data] of Object.entries(entries)) {
    const m = path.match(/^tiles\/(.+)\.(?:jpg|jpeg|png)$/i);
    if (m) tiles.push({ key: m[1], bytes: data });
  }
  return { game, tiles };
}
