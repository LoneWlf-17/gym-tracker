import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

const STORAGE_DB = 'gym-tracker-storage';
const STORAGE_STORE = 'database';
const STORAGE_KEY = 'gym-tracker.sqlite3';

let sqlite3;
let db;

function openStorage() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(STORAGE_DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORAGE_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getStoredBytes() {
  const storage = await openStorage();
  return new Promise((resolve, reject) => {
    const tx = storage.transaction(STORAGE_STORE, 'readonly');
    const req = tx.objectStore(STORAGE_STORE).get(STORAGE_KEY);
    req.onsuccess = () => resolve(req.result ? new Uint8Array(req.result) : null);
    req.onerror = () => reject(req.error);
  });
}

async function putStoredBytes(bytes) {
  const storage = await openStorage();
  return new Promise((resolve, reject) => {
    const tx = storage.transaction(STORAGE_STORE, 'readwrite');
    tx.objectStore(STORAGE_STORE).put(bytes, STORAGE_KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

function createFreshDatabase() {
  const fresh = new sqlite3.oo1.DB();
  fresh.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS entries (
      id INTEGER PRIMARY KEY,
      workout_date TEXT NOT NULL,
      split TEXT NOT NULL CHECK (split IN ('push', 'pull', 'leg')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS exercise_rows (
      id INTEGER PRIMARY KEY,
      entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      reps TEXT NOT NULL DEFAULT '',
      weights TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(workout_date DESC, id DESC);
  `);
  return fresh;
}

async function restoreDatabase(bytes) {
  const restored = new sqlite3.oo1.DB();
  const p = sqlite3.wasm.allocFromTypedArray(bytes);
  const rc = sqlite3.capi.sqlite3_deserialize(
    restored.pointer,
    'main',
    p,
    bytes.byteLength,
    bytes.byteLength,
    sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE |
      sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE
  );
  restored.checkRc(rc);
  return restored;
}

export async function initDb() {
  sqlite3 = await sqlite3InitModule();
  const saved = await getStoredBytes();
  db = saved ? await restoreDatabase(saved) : createFreshDatabase();
  // Foreign-key enforcement is connection-specific, so enable it after every restore.
  db.exec('PRAGMA foreign_keys = ON;');
  // Clean up any orphaned exercise rows left by older database versions.
  db.exec(`DELETE FROM exercise_rows WHERE entry_id NOT IN (SELECT id FROM entries)`);
  await persistDb();
}

export async function persistDb() {
  const bytes = sqlite3.capi.sqlite3_js_db_export(db);
  await putStoredBytes(bytes);
}

export function getDb() {
  if (!db) throw new Error('Database is not initialized');
  return db;
}

export function listEntries() {
  return db.selectObjects(`
    SELECT
      e.id,
      e.workout_date AS date,
      e.split,
      COUNT(r.id) AS exercise_count
    FROM entries e
    LEFT JOIN exercise_rows r ON r.entry_id = e.id
    GROUP BY e.id
    ORDER BY e.workout_date DESC, e.id DESC
  `);
}

export function getEntry(id) {
  const entry = db.selectObject(
    `SELECT id, workout_date AS date, split FROM entries WHERE id = ?`,
    [id]
  );
  if (!entry) return null;
  entry.rows = db.selectObjects(
    `SELECT id, position, name, reps, weights FROM exercise_rows WHERE entry_id = ? ORDER BY position, id`,
    [id]
  );
  return entry;
}

export async function saveEntry({ id = null, date, split, rows }) {
  if (!date) throw new Error('Date is required');
  if (!['push', 'pull', 'leg'].includes(split)) throw new Error('Invalid workout split');

  const cleanRows = rows
    .map((row) => ({
      name: String(row.name ?? '').trim(),
      reps: String(row.reps ?? '').trim(),
      weights: String(row.weights ?? '').trim(),
    }))
    .filter((row) => row.name || row.reps || row.weights);

  if (!cleanRows.length) throw new Error('Add at least one exercise row before saving.');

  let entryId = id;

  db.exec('BEGIN');
  try {
    if (entryId) {
      db.exec(`UPDATE entries SET workout_date = ?, split = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, { bind: [date, split, entryId] });
      db.exec(`DELETE FROM exercise_rows WHERE entry_id = ?`, { bind: [entryId] });
    } else {
      const stmt = db.prepare(`INSERT INTO entries (workout_date, split) VALUES (?, ?)`);
      stmt.bind([date, split]);
      stmt.step();
      stmt.finalize();
      entryId = db.selectValue(`SELECT last_insert_rowid()`);
    }

    const insert = db.prepare(`INSERT INTO exercise_rows (entry_id, position, name, reps, weights) VALUES (?, ?, ?, ?, ?)`);
    cleanRows.forEach((row, index) => {
      insert.bind([entryId, index, row.name, row.reps, row.weights]);
      insert.step();
      insert.reset();
    });
    insert.finalize();
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }

  await persistDb();
  return Number(entryId);
}

export async function deleteEntry(id) {
  db.exec('BEGIN');
  try {
    // Explicitly delete child rows as a safety net, even if FK enforcement is unavailable
    // for a legacy/restored database.
    db.exec(`DELETE FROM exercise_rows WHERE entry_id = ?`, { bind: [id] });
    db.exec(`DELETE FROM entries WHERE id = ?`, { bind: [id] });
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
  await persistDb();
}

export function exportDatabase() {
  return sqlite3.capi.sqlite3_js_db_export(db);
}

export function exportJSON() {
  return {
    exportedAt: new Date().toISOString(),
    entries: listEntries().map((item) => getEntry(item.id)),
  };
}
