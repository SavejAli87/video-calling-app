/**
 * messageStore.js
 * Chat messages ko IndexedDB me rakhta hai (photos ke liye localStorage ka 5MB kaafi nahi).
 * Har device apni copy rakhta hai; server kuch store nahi karta.
 * 24 ghante se purane messages load karte waqt hi hata diye jaate hain.
 * IndexedDB na ho (private mode etc.) to sab functions chupchaap no-op hain.
 */
const DB_NAME = "video-call-chat";
const STORE = "messages";

let dbPromise = null;

const openDb = () => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: "key" });
          store.createIndex("timestamp", "timestamp");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
};

/** { [peerId]: Message[] } - expired records yahin delete ho jaate hain */
export async function loadMessages(ttlMs, now = Date.now()) {
  const db = await openDb();
  if (!db) return {};

  return new Promise((resolve) => {
    const byPeer = {};
    try {
      const tx = db.transaction(STORE, "readwrite");
      const req = tx.objectStore(STORE).openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        const rec = cursor.value;
        if (now - rec.timestamp > ttlMs) {
          cursor.delete();
        } else {
          (byPeer[rec.peerId] ||= []).push(rec.msg);
        }
        cursor.continue();
      };
      const done = () => {
        Object.values(byPeer).forEach((l) => l.sort((a, b) => a.timestamp - b.timestamp));
        resolve(byPeer);
      };
      tx.oncomplete = done;
      tx.onerror = done;
      tx.onabort = done;
    } catch {
      resolve({});
    }
  });
}

/** items: [{ peerId, msg }] */
export async function putMessages(items) {
  const db = await openDb();
  if (!db || !items.length) return;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      for (const { peerId, msg } of items) {
        store.put({ key: `${peerId}|${msg.id}`, peerId, timestamp: msg.timestamp, msg });
      }
      tx.oncomplete = resolve;
      tx.onerror = resolve;
      tx.onabort = resolve;
    } catch {
      resolve();
    }
  });
}

/** keys: ["peerId|messageId", ...] */
export async function deleteMessages(keys) {
  const db = await openDb();
  if (!db || !keys.length) return;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      keys.forEach((k) => store.delete(k));
      tx.oncomplete = resolve;
      tx.onerror = resolve;
      tx.onabort = resolve;
    } catch {
      resolve();
    }
  });
}
