const TradingBot = require('../src/bot/TradingBot');

async function main() {
  try {
    const bot = new TradingBot();
    await bot.run();
  } catch (error) {
    console.error('Fatal error in run_live:', error);
  }
}

main();
