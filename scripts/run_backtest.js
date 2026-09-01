const BacktestEngine = require('../src/backtest/BacktestEngine');
const ReportGenerator = require('../src/backtest/ReportGenerator');
const CsvDataClient = require('../src/data/CsvDataClient');
const config = require('../src/config');
const path = require('path');

async function main() {
  const isAiMode = process.argv.includes('--mode=ai') || process.argv.includes('-ai');
  const customConfig = {};

  // Check if custom data path or sample size passed
  const candlesArg = process.argv.find(arg => arg.startsWith('--candles='));
  if (candlesArg) {
    const count = parseInt(candlesArg.split('=')[1], 10);
    if (!isNaN(count) && count > 0) {
      customConfig.MAX_CANDLES_TO_PROCESS = count;
    }
  }

  const aiProviderName = config.AI_PROVIDER === 'gemini'
    ? `Gemini: ${config.GEMINI_MODEL}`
    : `Qwen: ${config.DASHSCOPE_MODEL}`;

  console.log(`\n🚀 Starting Backtest in [${isAiMode ? `AI-SIMULATED (${aiProviderName})` : 'RULE-BASED'}] mode...`);
  
  const dataClient = new CsvDataClient();
  // Ensure CSV path resolves to M5 data if available or config path
  if (process.env.CSV_DATA_PATH) {
    dataClient.csvPath = path.resolve(process.cwd(), process.env.CSV_DATA_PATH);
  }

  const engine = new BacktestEngine({ dataClient });
  const results = isAiMode
    ? await engine.runAISimulated(customConfig)
    : await engine.runRuleBased(customConfig);

  ReportGenerator.generateReport(results, customConfig);
}

main().catch(err => {
  console.error('Backtest failed with error:', err);
  process.exit(1);
});
