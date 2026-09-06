/**
 * Sanitize — strip sensitive fields before sending to browser.
 * Removes account login, server, balance details from bridge responses.
 */

function sanitizePositions(posArray) {
  if (!posArray || !Array.isArray(posArray)) return [];
  return posArray.map(p => ({
    symbol: p.symbol,
    type: p.type,
    price_open: p.price_open,
    sl: p.sl,
    tp: p.tp,
    price_current: p.price_current,
    time: p.time
  }));
}

function sanitizeHealth(health) {
  if (!health) return null;
  const safeHealth = JSON.parse(JSON.stringify(health));
  if (safeHealth.account) {
    delete safeHealth.account.login;
    delete safeHealth.account.server;
    delete safeHealth.account.balance;
    delete safeHealth.account.equity;
    delete safeHealth.account.leverage;
  }
  return safeHealth;
}

module.exports = { sanitizePositions, sanitizeHealth };
