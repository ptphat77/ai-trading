/**
 * CSV Parser — reads and parses MT5/TradingView/Dukascopy candle CSV files.
 * 
 * Features:
 * - Auto-detect encoding: UTF-16LE, UTF-16BE, UTF-8
 * - Auto-detect separator: tab, semicolon, comma
 * - Auto-detect column order by header name
 * - Filter by beforeTime for pagination
 */

const fs = require('fs');

function readCsvFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const buf = fs.readFileSync(filePath);
  let text;
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    text = buf.toString('utf16le');
  } else if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    text = buf.swap16().toString('utf16le');
  } else {
    text = buf.toString('utf8');
  }
  if (text.charCodeAt(0) === 0xFEFF) {
    text = text.slice(1);
  }
  return text;
}

function parseCsvToCandles(csvText, maxCount = 5000, beforeTime = null) {
  const lines = csvText.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length < 2) return [];

  const headerLine = lines[0].toLowerCase();
  const sep = headerLine.includes('\t') ? '\t' : (headerLine.includes(';') ? ';' : ',');
  const headers = headerLine.split(sep).map(h => h.replace(/[<>]/g, '').trim());

  let dIdx = -1, tIdx = -1, oIdx = -1, hIdx = -1, lIdx = -1, cIdx = -1, vIdx = -1;
  headers.forEach((h, i) => {
    if (h === 'date' || h === 'datetime' || h === 'time_utc') dIdx = i;
    else if (h === 'time') tIdx = i;
    else if (h === 'open') oIdx = i;
    else if (h === 'high') hIdx = i;
    else if (h === 'low') lIdx = i;
    else if (h === 'close') cIdx = i;
    else if (h === 'tickvol' || h === 'vol' || h === 'volume') vIdx = i;
  });

  if (oIdx === -1 || hIdx === -1 || lIdx === -1 || cIdx === -1) {
    // Default column fallback
    dIdx = 0; tIdx = 1; oIdx = 2; hIdx = 3; lIdx = 4; cIdx = 5; vIdx = 6;
  }

  const candles = [];
  const startIdx = 1;
  for (let i = startIdx; i < lines.length; i++) {
    const row = lines[i].split(sep);
    if (row.length <= Math.max(oIdx, hIdx, lIdx, cIdx)) continue;

    const dateStr = (dIdx !== -1 ? row[dIdx] : '').trim();
    const timeStr = (tIdx !== -1 ? row[tIdx] : '').trim();
    const fullDate = timeStr ? `${dateStr} ${timeStr}` : dateStr;

    const parts = fullDate.split(/[\sT]+/);
    const dPart = parts[0] || '';
    const tPart = parts[1] || '00:00:00';

    let year = 1970, month = 1, day = 1;
    if (dPart.includes('.')) {
      const dp = dPart.split('.');
      year = parseInt(dp[0], 10);
      month = parseInt(dp[1], 10);
      day = parseInt(dp[2], 10);
    } else if (dPart.includes('-')) {
      const dp = dPart.split('-');
      year = parseInt(dp[0], 10);
      month = parseInt(dp[1], 10);
      day = parseInt(dp[2], 10);
    } else if (dPart.includes('/')) {
      const dp = dPart.split('/');
      year = parseInt(dp[2] && dp[2].length === 4 ? dp[2] : dp[0], 10);
      month = parseInt(dp[1] || dp[0], 10);
      day = parseInt(dp[0] || dp[1], 10);
    }

    const tp = tPart.split(':');
    const hours = parseInt(tp[0] || 0, 10);
    const minutes = parseInt(tp[1] || 0, 10);
    const seconds = parseInt(tp[2] || 0, 10);

    const timeSec = Math.floor(Date.UTC(year, month - 1, day, hours, minutes, seconds) / 1000);
    const open = parseFloat(row[oIdx]);
    const high = parseFloat(row[hIdx]);
    const low = parseFloat(row[lIdx]);
    const close = parseFloat(row[cIdx]);
    const volume = vIdx !== -1 ? parseFloat(row[vIdx]) : 0;

    if (!isNaN(timeSec) && !isNaN(open) && !isNaN(high) && !isNaN(low) && !isNaN(close)) {
      candles.push({ time: timeSec, open, high, low, close, volume: isNaN(volume) ? 0 : volume });
    }
  }

  // Filter beforeTime if specified
  if (beforeTime) {
    const filtered = candles.filter(c => c.time < beforeTime);
    if (filtered.length > maxCount) {
      return filtered.slice(filtered.length - maxCount);
    }
    return filtered;
  }

  // Return tail if maxCount exceeded
  if (candles.length > maxCount) {
    return candles.slice(candles.length - maxCount);
  }
  return candles;
}

module.exports = { readCsvFile, parseCsvToCandles };
