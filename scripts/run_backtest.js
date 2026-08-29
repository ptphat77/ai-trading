const BacktestEngine = require('../src/backtest/BacktestEngine');
const ReportGenerator = require('../src/backtest/ReportGenerator');

async function main() {
  const engine = new BacktestEngine();
  const results = await engine.runRuleBased();
  ReportGenerator.generateReport(results);
}

main();
