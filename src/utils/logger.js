function log(level, message, context = {}) {
  // Logs to both console and logs/trade_log.jsonl
  console.log(`[${level}] ${message}`, context);
}

module.exports = {
  log
};
