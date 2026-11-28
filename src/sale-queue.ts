export type Checkout = {
  p_business: string; p_store: string; p_request: string;
  p_lines: { product_id: string; quantity: number; expected_price?: number; operator_id?: string }[];
  p_cash: number; p_card: number; p_discount: number; p_expected: number;
  p_customer?: string;
  p_due?: string;
};

export type QueueEntry = {
  scope: string;
  request: Checkout;
  created: number;
  status: 'pending' | 'confirmed' | 'conflict';
  reason?: string;
};

function openQueue(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('tovarix-sales', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('sales', { keyPath: ['scope', 'request.p_request'] }).createIndex('scope', 'scope');
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openQueue();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('sales', mode);
      const request = run(tx.objectStore('sales'));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error ?? request.error);
    });
  } finally { db.close(); }
}

export async function listSales(scope: string): Promise<QueueEntry[]> {
  const entries = await transaction('readonly', store => store.index('scope').getAll(scope)) as QueueEntry[];
  return entries.sort((a, b) => a.created - b.created || a.request.p_request.localeCompare(b.request.p_request));
}

export function saveSale(entry: QueueEntry) {
  return transaction('readwrite', store => store.put(entry));
}

export function removeSale(entry: QueueEntry) {
  return transaction('readwrite', store => store.delete([entry.scope, entry.request.p_request]));
}

export async function importLegacySale(scope: string, raw: string) {
  const sale = JSON.parse(raw) as Checkout;
  const [, business, store] = scope.split('.');
  if (sale.p_business !== business || sale.p_store !== store || !sale.p_request) throw new Error('Invalid saved sale');
  try {
    await transaction('readwrite', records => records.add({ scope, request: sale, created: 0, status: 'pending' }));
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'ConstraintError')) throw error;
  }
}
