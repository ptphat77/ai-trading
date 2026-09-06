/**
 * Bridge Client — communicates with MT5 Python FastAPI bridge.
 * 
 * Responsibilities:
 * - Manage BRIDGE_URL (from env or default)
 * - Provide fetchBridgeJson() with timeout + abort
 * 
 * Does NOT: retry logic, data transformation, business decisions.
 */

const BRIDGE_URL = process.env.MT5_BRIDGE_URL || 'http://127.0.0.1:8000';

async function fetchBridgeJson(endpointPath, timeoutMs = 2000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${BRIDGE_URL}${endpointPath}`, {
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

module.exports = { BRIDGE_URL, fetchBridgeJson };
