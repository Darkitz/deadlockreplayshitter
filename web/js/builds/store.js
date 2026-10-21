// Build cache (from Build Shitter): one IndexedDB object store of { key, value, fetchedAt, tag }.
// Falls back to memory when IndexedDB is unavailable (private windows, blocked storage).
// Versioned: a DATA_VERSION change wipes this cache (bump when cached records change shape).
const DATA_VERSION = 2; // 2: player build lists carry publish times

const DB_NAME = "dldi-builds";
const STORE = "cache";
const LS_PREFIX = "dldi.builds.";
const LS_DATA_VERSION = `${LS_PREFIX}dataVersion`;
const KEEP = new Set([LS_DATA_VERSION]);

const memory = new Map();
let dbPromise = null;

const lsGet = (k) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k, v) => {
  try {
    localStorage.setItem(k, v);
  } catch {}
};

const req = (r) =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

function deleteDb() {
  return new Promise((resolve) => {
    try {
      const r = indexedDB.deleteDatabase(DB_NAME);
      r.onsuccess = r.onerror = r.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

// Wipe cached builds (IndexedDB + our localStorage keys).
export async function clearAll() {
  memory.clear();
  if (dbPromise) (await dbPromise.catch(() => null))?.close();
  dbPromise = null;
  await deleteDb();
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(LS_PREFIX) && !KEEP.has(k)) localStorage.removeItem(k);
  } catch {}
}

function openDb() {
  return (dbPromise ??= (async () => {
    if (lsGet(LS_DATA_VERSION) !== String(DATA_VERSION)) {
      await clearAll();
      lsSet(LS_DATA_VERSION, String(DATA_VERSION));
    }
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => {
      const s = open.result.createObjectStore(STORE, { keyPath: "key" });
      s.createIndex("tag", "tag");
    };
    return req(open);
  })());
}

async function tx(mode, fn) {
  const db = await openDb();
  const t = db.transaction(STORE, mode);
  return req(fn(t.objectStore(STORE)));
}

export async function get(key) {
  if (memory.has(key)) return memory.get(key);
  try {
    const row = await tx("readonly", (s) => s.get(key));
    if (row) memory.set(key, row);
    return row ?? null;
  } catch {
    return null;
  }
}

export async function set(key, value, tag = null, fetchedAt = Date.now()) {
  const row = { key, value, fetchedAt, tag: tag == null ? null : String(tag) };
  memory.set(key, row);
  try {
    await tx("readwrite", (s) => s.put(row));
  } catch {}
  return row;
}

export async function byTag(tag) {
  try {
    return await tx("readonly", (s) => s.index("tag").getAll(String(tag)));
  } catch {
    return [...memory.values()].filter((r) => r.tag === String(tag));
  }
}

// Resolve the version check up front so a stale cache is gone before anything reads it.
export const ready = openDb().catch(() => null);
