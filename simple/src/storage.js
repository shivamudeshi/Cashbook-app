// IndexedDB persistence for the Simple companion app. A separate database
// from the main app's ("cashbook") on purpose — the two apps never share or
// see each other's data. The DB name and KEY are load-bearing: data is keyed
// to the site origin and these constants — changing either orphans the book.
const DB_NAME = "cashbook-simple";
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

// No legacy data exists yet for this app — defaultBook() is already
// v1-shaped, so there's nothing to migrate forward from. Future additive
// changes append here, same pattern as the main app's storage.js.
const MIGRATIONS = [];

// Seed auto-coding rules, matching the approved mockup's Setup screen
// exactly (Zepto -> Groceries etc.) plus a few more using only categories
// that actually exist in defaultBook()'s seed category lists below.
export const DEFAULT_CODING_RULES = [
  { match: "zepto", head: "Groceries" },
  { match: "bigbasket", head: "Groceries" },
  { match: "blinkit", head: "Groceries" },
  { match: "swiggy", head: "Food out" },
  { match: "zomato", head: "Food out" },
  { match: "uber", head: "Transport" },
  { match: "ola", head: "Transport" },
  { match: "rapido", head: "Transport" },
  { match: "petrol", head: "Transport" },
  { match: "electricity", head: "Utilities" },
  { match: "jio", head: "Utilities" },
  { match: "airtel", head: "Utilities" },
  { match: "amazon", head: "Shopping" },
  { match: "flipkart", head: "Shopping" },
  { match: "myntra", head: "Shopping" },
  { match: "rent", head: "Rent" },
  { match: "salary", head: "Salary" },
  { match: "interest", head: "Interest" },
];

export function defaultBook() {
  return {
    v: 1,
    prefs: {
      lock: { on: false, pin: "" }, name: "",
      hideBalances: false, autoLockOption: "1min", lastBackup: null,
      notifPrefs: { paymentDue: true, unexplained: true, approval: true },
    },
    accounts: [],
    categories: {
      expense: ["Rent", "Groceries", "Food out", "Transport", "Utilities", "Shopping", "Suspense"],
      income: ["Salary", "Interest", "Other income"],
    },
    bsCategories: ["Home Loan EMI"],
    parties: [],
    owedMemos: [],
    entries: [],
    codingRules: DEFAULT_CODING_RULES.map((r) => ({ ...r })),
  };
}

export async function loadBook() {
  let book = await get(KEY);
  if (!book) return null;
  const from = book.v || 0;
  for (let i = from; i < MIGRATIONS.length; i++) book = MIGRATIONS[i](book);
  book.v = MIGRATIONS.length || 1;
  if (from !== book.v) await set(KEY, book);
  return book;
}

export async function saveBook(book) {
  book.v = MIGRATIONS.length || 1;
  await set(KEY, book);
}
