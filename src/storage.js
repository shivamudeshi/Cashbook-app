// IndexedDB persistence. The DB name and KEY are load-bearing: data is keyed
// to the site origin and these constants — changing either orphans the book.
const DB_NAME = "cashbook";
const DB_VERSION = 1;
const STORE = "kv";
const KEY = "book";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function get(key) {
  const db = await openDB();
  try {
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function set(key, value) {
  const db = await openDB();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

// Migrations run forward on every load and never reset data. Each takes the
// stored book and returns it patched; `v` records the last one applied.
const MIGRATIONS = [
  // v1: opening.accounts — per-account opening balances used to live flat on
  // opening; fold any stray numeric keys into opening.accounts.
  (book) => {
    if (!book.opening) book.opening = { asOf: "", bank: 0, accounts: {} };
    if (!book.opening.accounts) {
      const accounts = {};
      for (const [k, val] of Object.entries(book.opening)) {
        if (k !== "asOf" && k !== "bank" && typeof val === "number") {
          accounts[k] = val;
          delete book.opening[k];
        }
      }
      book.opening.accounts = accounts;
    }
    return book;
  },
  // v2: parties + owedMemos replace nothing older — just ensure they exist.
  (book) => {
    if (!book.parties) book.parties = [];
    if (!book.owedMemos) book.owedMemos = [];
    return book;
  },
  // v3: codingRules — keyword → head mappings the local importer learns from.
  (book) => {
    if (!book.codingRules) book.codingRules = DEFAULT_CODING_RULES.map((r) => ({ ...r }));
    return book;
  },
];

// Starter keywords for the local importer; the review screen adds to these
// whenever the user re-codes a row.
export const DEFAULT_CODING_RULES = [
  { match: "swiggy", head: "Food out" },
  { match: "zomato", head: "Food out" },
  { match: "uber", head: "Transport" },
  { match: "ola", head: "Transport" },
  { match: "rapido", head: "Transport" },
  { match: "petrol", head: "Transport" },
  { match: "electricity", head: "Utilities" },
  { match: "jio", head: "Utilities" },
  { match: "airtel", head: "Utilities" },
  { match: "bigbasket", head: "Groceries" },
  { match: "blinkit", head: "Groceries" },
  { match: "zepto", head: "Groceries" },
  { match: "pharmacy", head: "Health" },
  { match: "amazon", head: "Shopping" },
  { match: "flipkart", head: "Shopping" },
  { match: "myntra", head: "Shopping" },
  { match: "rent", head: "Rent" },
  { match: "sip", head: "SIP" },
  { match: "salary", head: "Salary" },
  { match: "interest", head: "Interest" },
];

export async function loadBook() {
  let book = await get(KEY);
  if (!book) return null;
  const from = book.v || 0;
  for (let i = from; i < MIGRATIONS.length; i++) book = MIGRATIONS[i](book);
  book.v = MIGRATIONS.length;
  if (from !== book.v) await set(KEY, book);
  return book;
}

export async function saveBook(book) {
  book.v = MIGRATIONS.length;
  await set(KEY, book);
}

