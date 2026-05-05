/**
 * Per-conversation thread memory — stores qualification context
 * backed by a JSON file so state survives across restarts/polls
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const MEMORY_DIR = '/tmp/solar-agent-memory';

export function getThreadMemory(threadId) {
  const file = `${MEMORY_DIR}/${threadId}.json`;
  if (existsSync(file)) {
    return JSON.parse(readFileSync(file, 'utf8'));
  }
  return {
    threadId,
    status: 'new',
    data: {},
    questionsAsked: [],
    lastUpdated: null,
  };
}

export function saveThreadMemory(threadId, memory) {
  // ensure directory exists
  import('fs').then(({ mkdirSync }) => {
    mkdirSync(MEMORY_DIR, { recursive: true });
    writeFileSync(`${MEMORY_DIR}/${threadId}.json`, JSON.stringify({
      ...memory,
      lastUpdated: new Date().toISOString(),
    }, null, 2));
  });
}

export function clearThreadMemory(threadId) {
  const file = `${MEMORY_DIR}/${threadId}.json`;
  if (existsSync(file)) {
    import('fs').then(({ unlinkSync }) => unlinkSync(file));
  }
}
