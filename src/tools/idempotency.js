/**
 * Idempotency store — prevents duplicate processing of the same email
 * backed by a JSON file (swap for Redis in production)
 */
import { existsSync, readFileSync } from 'fs';

const IDEMPOTENCY_FILE = '/tmp/solar-agent-processed.json';
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // expire entries after 7 days

function readStore() {
  if (!existsSync(IDEMPOTENCY_FILE)) return {};
  try {
    return JSON.parse(readFileSync(IDEMPOTENCY_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeStore(store) {
  import('fs').then(({ writeFileSync }) => {
    writeFileSync(IDEMPOTENCY_FILE, JSON.stringify(store, null, 2));
  });
}

export function isAlreadyProcessed(emailId) {
  const store = readStore();
  const entry = store[emailId];
  if (!entry) return false;

  // Expire old entries
  if (Date.now() - entry.processedAt > TTL_MS) {
    const next = { ...store };
    delete next[emailId];
    writeStore(next);
    return false;
  }

  return true;
}

export function markProcessed(emailId, result = {}) {
  const store = readStore();
  store[emailId] = {
    processedAt: Date.now(),
    result,
  };
  writeStore(store);
  console.log(`[Idempotency] Marked ${emailId} as processed`);
}

export function clearProcessed(emailId) {
  const store = readStore();
  delete store[emailId];
  writeStore(store);
}