const DB_NAME = 'studyclip';
const DB_VERSION = 1;
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('sources')) db.createObjectStore('sources', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('state')) db.createObjectStore('state');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbPromise = null; reject(req.error); };
  });
  return dbPromise;
}

function reqP(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

function notify(extra = {}) {
  getClips().then((clips) => {
    try {
      chrome.runtime.sendMessage({ type: 'clips-changed', count: clips.length, ...extra }).catch(() => {});
    } catch {}
  });
}

export async function hashBytes(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function getClips() {
  const db = await openDB();
  const tx = db.transaction('state', 'readonly');
  return (await reqP(tx.objectStore('state').get('clips'))) || [];
}

export async function setClips(clips) {
  const db = await openDB();
  const tx = db.transaction('state', 'readwrite');
  tx.objectStore('state').put(clips, 'clips');
  await txDone(tx);
  await pruneSources();
  notify({ reason: 'set' });
}

export async function hasSource(id) {
  const db = await openDB();
  const tx = db.transaction('sources', 'readonly');
  return (await reqP(tx.objectStore('sources').getKey(id))) !== undefined;
}

export async function putSource(source) {
  if (await hasSource(source.id)) return;
  const db = await openDB();
  const tx = db.transaction('sources', 'readwrite');
  tx.objectStore('sources').put({ addedAt: Date.now(), ...source });
  await txDone(tx);
}

export async function getSource(id) {
  const db = await openDB();
  const tx = db.transaction('sources', 'readonly');
  return reqP(tx.objectStore('sources').get(id));
}

export async function listSourcesMeta() {
  const db = await openDB();
  const tx = db.transaction('sources', 'readonly');
  const out = [];
  await new Promise((resolve, reject) => {
    const cur = tx.objectStore('sources').openCursor();
    cur.onsuccess = () => {
      const c = cur.result;
      if (!c) return resolve();
      const { id, name, url, addedAt, data } = c.value;
      out.push({ id, name, url, addedAt, size: data?.byteLength || 0 });
      c.continue();
    };
    cur.onerror = () => reject(cur.error);
  });
  return out;
}

export async function toggleClip(sourceId, page) {
  const db = await openDB();
  const tx = db.transaction('state', 'readwrite');
  const store = tx.objectStore('state');
  const clips = (await reqP(store.get('clips'))) || [];
  const idx = clips.findIndex((c) => c.sourceId === sourceId && c.page === page);
  let added;
  if (idx >= 0) { clips.splice(idx, 1); added = false; }
  else { clips.push({ sourceId, page, addedAt: Date.now() }); added = true; }
  store.put(clips, 'clips');
  await txDone(tx);
  if (!added) await pruneSources();
  notify({ reason: added ? 'add' : 'remove', sourceId, page });
  return { added, count: clips.length };
}

export async function undoLast() {
  const clips = await getClips();
  if (!clips.length) return null;
  let last = 0;
  clips.forEach((c, i) => { if (c.addedAt >= clips[last].addedAt) last = i; });
  const [removed] = clips.splice(last, 1);
  const db = await openDB();
  const tx = db.transaction('state', 'readwrite');
  tx.objectStore('state').put(clips, 'clips');
  await txDone(tx);
  await pruneSources();
  notify({ reason: 'undo', sourceId: removed.sourceId, page: removed.page });
  return removed;
}

export async function clearAll() {
  const db = await openDB();
  const tx = db.transaction(['state', 'sources'], 'readwrite');
  tx.objectStore('state').put([], 'clips');
  tx.objectStore('sources').clear();
  await txDone(tx);
  notify({ reason: 'clear' });
}

async function pruneSources() {
  const clips = await getClips();
  const used = new Set(clips.map((c) => c.sourceId));
  const metas = await listSourcesMeta();
  const unused = metas.filter((m) => !used.has(m.id));
  if (!unused.length) return;
  const db = await openDB();
  const tx = db.transaction('sources', 'readwrite');
  unused.forEach((m) => tx.objectStore('sources').delete(m.id));
  await txDone(tx);
}
