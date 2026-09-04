const TradingBot = require('../src/bot/TradingBot');
const BrokerClient = require('../src/data/BrokerClient');

async function main() {
  try {
    const brokerClient = new BrokerClient();
    const bot = new TradingBot({ dataClient: brokerClient });
    await bot.run();
  } catch (error) {
    console.error('Fatal error in run_live:', error);
  }
}

main();
