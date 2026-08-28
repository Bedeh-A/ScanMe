import type { BarcodeResult, ScanSource } from "./barcodes/types";

const DATABASE_NAME = "scanme";
const STORE_NAME = "scan-history";
const HISTORY_ENABLED_KEY = "scanme:history-enabled";
const MAX_ENTRIES = 50;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface HistoryResult {
  text: string;
  format: string;
}

export interface HistoryEntry {
  id: string;
  createdAt: number;
  source: ScanSource;
  results: HistoryResult[];
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function isHistoryEnabled(): boolean {
  return localStorage.getItem(HISTORY_ENABLED_KEY) === "true";
}

export function setHistoryEnabled(enabled: boolean): void {
  localStorage.setItem(HISTORY_ENABLED_KEY, String(enabled));
}

export function retainedHistory(
  entries: HistoryEntry[],
  now = Date.now(),
): HistoryEntry[] {
  return entries
    .filter((entry) => now - entry.createdAt <= RETENTION_MS)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_ENTRIES);
}

export async function loadHistory(): Promise<HistoryEntry[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const entries = await requestToPromise<HistoryEntry[]>(
      transaction.objectStore(STORE_NAME).getAll(),
    );
    await transactionDone(transaction);

    const retained = retainedHistory(entries);
    const retainedIds = new Set(retained.map((entry) => entry.id));
    const expiredIds = entries
      .filter((entry) => !retainedIds.has(entry.id))
      .map((entry) => entry.id);

    if (expiredIds.length > 0) {
      const cleanup = database.transaction(STORE_NAME, "readwrite");
      for (const id of expiredIds) cleanup.objectStore(STORE_NAME).delete(id);
      await transactionDone(cleanup);
    }

    return retained;
  } finally {
    database.close();
  }
}

export async function saveHistoryEntry(
  results: BarcodeResult[],
  source: ScanSource,
): Promise<HistoryEntry> {
  const entry: HistoryEntry = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    source,
    results: results.map(({ text, format }) => ({ text, format })),
  };

  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(entry);
    await transactionDone(transaction);
  } finally {
    database.close();
  }

  await loadHistory();
  return entry;
}

export async function deleteHistoryEntry(id: string): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(id);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function clearHistory(): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).clear();
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}
