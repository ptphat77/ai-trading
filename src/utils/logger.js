const fs = require('fs');
const path = require('path');

const LOG_DIR = path.resolve(process.cwd(), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'trade_log.jsonl');

/**
 * Log to both console and logs/trade_log.jsonl (JSONL format).
 * 
 * @param {'info'|'warn'|'error'|'debug'} level
 * @param {string} message
 * @param {Object} [context={}]
 */
function log(level, message, context = {}) {
  const timestamp = new Date().toISOString();
  
  // 1. Console output (always)
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
  if (level === 'error') {
    console.error(`${prefix} ${message}`, Object.keys(context).length ? context : '');
  } else {
    console.log(`${prefix} ${message}`, Object.keys(context).length ? context : '');
  }

  // 2. File output (JSONL format per DATA-SCHEMA.md §6)
  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
    const entry = JSON.stringify({
      timestamp,
      level,
      message,
      ...context
    });
    fs.appendFileSync(LOG_FILE, entry + '\n', 'utf8');
  } catch (fileErr) {
    // File logging failure must never crash the bot loop
    console.error('[logger] Failed to write to log file:', fileErr.message);
  }
}

module.exports = { log };
