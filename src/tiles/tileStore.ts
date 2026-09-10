// In-memory tile cache for the active scenario, mirrored to IndexedDB so a
// page refresh keeps baked imagery. Tiles are keyed "layer/z/x/y".

const DB_NAME = "wargamer";
const STORE = "tiles";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

const idbKey = (scenarioId: string, k: string) => `${scenarioId}::${k}`;

let activeScenarioId: string | null = null;
let mem = new Map<string, Uint8Array>();

export function activeTileCount(): number {
  return mem.size;
}

export function getTile(key: string): Uint8Array | undefined {
  return mem.get(key);
}

export function allActiveTiles(): Map<string, Uint8Array> {
  return mem;
}

/** Point the cache at a scenario, loading its tiles from IndexedDB into memory. */
export async function setActiveScenario(scenarioId: string): Promise<void> {
  activeScenarioId = scenarioId;
  mem = new Map();
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const store = tx.objectStore(STORE);
      const prefix = `${scenarioId}::`;
      const range = IDBKeyRange.bound(prefix, prefix + "￿");
      const req = store.openCursor(range);
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) {
          resolve();
          return;
        }
        const k = String(cur.key).slice(prefix.length);
        mem.set(k, cur.value as Uint8Array);
        cur.continue();
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    /* IndexedDB unavailable — run from memory only */
  }
}

/** Add tiles for a scenario (memory if active, always IndexedDB). */
export async function putTiles(
  scenarioId: string,
  entries: { key: string; bytes: Uint8Array }[],
): Promise<void> {
  if (scenarioId === activeScenarioId) {
    for (const e of entries) mem.set(e.key, e.bytes);
  }
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      for (const e of entries) store.put(e.bytes, idbKey(scenarioId, e.key));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* non-fatal */
  }
}

export async function clearScenarioTiles(scenarioId: string): Promise<void> {
  if (scenarioId === activeScenarioId) mem = new Map();
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const prefix = `${scenarioId}::`;
      const range = IDBKeyRange.bound(prefix, prefix + "￿");
      const req = store.openCursor(range);
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) {
          resolve();
          return;
        }
        cur.delete();
        cur.continue();
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    /* non-fatal */
  }
}
