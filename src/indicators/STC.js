const { EMA } = require('technicalindicators');

/**
 * Calculate Schaff Trend Cycle (STC) oscillator.
 * STC is calculated by passing a MACD through a smoothed stochastic.
 * 
 * @param {number[]} closes - Array of close prices.
 * @param {number} length - Cycle length (default 80)
 * @param {number} fastLength - MACD fast EMA length (default 27)
 * @param {number} slowLength - MACD slow EMA length (default 50)
 * @param {number} factor - Smoothing factor (default 0.5)
 * @returns {number[]} Array of calculated STC values (0-100).
 */
function calculate(closes, length = 80, fastLength = 27, slowLength = 50, factor = 0.5) {
  if (closes.length < slowLength) return [];
  
  const emaFast = EMA.calculate({ period: fastLength, values: closes });
  const emaSlow = EMA.calculate({ period: slowLength, values: closes });
  
  // Align MACD with emaSlow
  const diff = emaSlow.length - emaFast.length;
  const macd = [];
  for (let i = 0; i < emaSlow.length; i++) {
    macd.push(emaFast[i + diff] - emaSlow[i]);
  }
  
  const stc = [];
  let pf = null;
  let stcVal = null;
  
  const pfArr = [];
  
  for (let i = 0; i < macd.length; i++) {
    if (i < length - 1) {
      stc.push(null);
      pfArr.push(null);
      continue;
    }
    
    const windowMacd = macd.slice(i - length + 1, i + 1);
    const lowMacd = Math.min(...windowMacd);
    const highMacd = Math.max(...windowMacd);
    
    let stochMacd = 0;
    if (highMacd - lowMacd > 0) {
      stochMacd = ((macd[i] - lowMacd) / (highMacd - lowMacd)) * 100;
    }
    
    pf = pf === null ? stochMacd : pf + factor * (stochMacd - pf);
    pfArr.push(pf);
    
    const validWindowPf = pfArr.slice(i - length + 1, i + 1).filter(v => v !== null);
    if (validWindowPf.length < length) {
      stc.push(null);
      continue;
    }
    
    const lowPf = Math.min(...validWindowPf);
    const highPf = Math.max(...validWindowPf);
    
    let stochPf = 0;
    if (highPf - lowPf > 0) {
      stochPf = ((pf - lowPf) / (highPf - lowPf)) * 100;
    }
    
    stcVal = stcVal === null ? stochPf : stcVal + factor * (stochPf - stcVal);
    stc.push(stcVal);
  }
  
  // Pad the beginning so the array length matches closes.length
  const padding = Array(closes.length - stc.length).fill(null);
  return [...padding, ...stc];
}

module.exports = {
  calculate
};
