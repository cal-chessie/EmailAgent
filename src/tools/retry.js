/**
 * Retry with exponential backoff
 */
export async function withRetry(fn, { retries = 3, baseDelayMs = 1000, label = fn.name } = {}) {
  let lastError;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === retries) break;

      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      console.warn(`[Retry] ${label} attempt ${attempt}/${retries} failed: ${err.message}. Retrying in ${delay}ms...`);
      await sleep(delay);
    }
  }

  throw new Error(`${label} failed after ${retries} attempts: ${lastError.message}`);
}

export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}