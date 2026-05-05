/**
 * Dead Letter Queue — stores failed messages for manual review
 * backed by a JSON file (swap for Redis/Postgres in production)
 */
import { existsSync, readFileSync, appendFileSync } from 'fs';

const DLQ_FILE = '/tmp/solar-agent-dlq.json';

export function getDLQ() {
  if (!existsSync(DLQ_FILE)) return [];
  try {
    return JSON.parse(readFileSync(DLQ_FILE, 'utf8'));
  } catch {
    return [];
  }
}

export function enqueueDLQ(entry) {
  const dlq = getDLQ();
  dlq.push({
    ...entry,
    enqueuedAt: new Date().toISOString(),
    attempts: (entry.attempts || 0) + 1,
  });
  // Keep last 100 entries
  import('fs').then(({ writeFileSync }) =>
    writeFileSync(DLQ_FILE, JSON.stringify(dlq.slice(-100), null, 2))
  );
  console.error(`[DLQ] ❌ Failed message enqueued: ${entry.emailId} — ${entry.error}`);
}

export function dequeueDLQ() {
  const dlq = getDLQ();
  if (dlq.length === 0) return null;
  const [first, ...rest] = dlq;
  import('fs').then(({ writeFileSync }) =>
    writeFileSync(DLQ_FILE, JSON.stringify(rest, null, 2))
  );
  return first;
}

export function clearDLQ() {
  import('fs').then(({ writeFileSync, unlinkSync }) => {
    try { unlinkSync(DLQ_FILE); } catch { /* ignore */ }
  });
}