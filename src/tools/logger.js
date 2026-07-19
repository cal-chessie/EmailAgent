/**
 * Structured logging utility
 */
const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL?.toUpperCase()] ?? LOG_LEVELS.INFO;

function format(level, component, message, meta = {}) {
  const timestamp = new Date().toISOString();
  const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
  return `[${timestamp}] [${level}] [${component}] ${message}${metaStr}`;
}

export function log(component, message, meta) {
  if (LOG_LEVELS.DEBUG >= currentLevel) console.log(format('DEBUG', component, message, meta));
}
export function info(component, message, meta) {
  if (LOG_LEVELS.INFO >= currentLevel) console.log(format('INFO', component, message, meta));
}
export function warn(component, message, meta) {
  if (LOG_LEVELS.WARN >= currentLevel) console.warn(format('WARN', component, message, meta));
}
export function error(component, message, meta) {
  if (LOG_LEVELS.ERROR >= currentLevel) console.error(format('ERROR', component, message, meta));
}