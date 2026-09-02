# TradeBot_XAU_Gemini

🚀 **An AI-powered automated trading bot for XAU/USD (Gold) using a Pluggable AI Engine (Google Gemini / Qwen) and configurable Broker REST API.**

## Overview

TradeBot_XAU is designed to combine traditional technical analysis with modern Large Language Models (LLMs) to make intelligent trading decisions. It calculates market signals using a multi-timeframe approach (H1 + M5) with indicators like MA, RSI, ADX, and ATR, and then relies on an AI engine to analyze the context and decide whether to enter a trade and where to place Stop Loss (SL) and Take Profit (TP).

**Prioritizing capital safety**, the bot implements strict risk management and never enters a trade blindly. It includes a comprehensive backtesting engine to quantitatively evaluate strategies on historical data before transitioning to Paper or Live trading.

## Key Features

- 🧠 **Pluggable AI Engine**: Swap between AI providers (e.g., Google Gemini, Qwen) simply by changing the `.env` configuration. No code changes required.
- 📊 **Multi-Timeframe Strategy**: Utilizes H1 for macro trend filtering and M5 for precise entry points (EMA, RSI, ADX, ATR).
- 🛡️ **Strict Risk Management**: Dynamic SL/TP based on ATR, position sizing based on fixed account percentage risk, and fallback safety mechanisms.
- 🧪 **Comprehensive Backtesting**: Built-in engine supporting both fast Rule-based simulation and full AI-simulated backtesting using local CSV data.
- 🔌 **Decoupled Architecture**: Clean separation between Data Layer, Indicator Layer, AI Engine, and Trading Bot logic.

## Trading Strategy

The bot utilizes a hybrid approach, combining traditional technical analysis (Rule-based) with Large Language Models (AI) to filter and execute trades.

### 1. Rule-Based Core (Technical Indicators)
The baseline strategy uses a Multi-Timeframe approach to identify high-probability setups:
- **Macro Trend (H1)**: Uses EMA50 and EMA200 alignments to determine the overall market direction (Uptrend/Downtrend). The system automatically aggregates M5 candles into H1 candles on-the-fly to ensure data consistency.
- **Entry Triggers (M5)**: Looks for localized setups within the macro trend using EMA9/EMA21 crossovers, RSI confirmation (avoiding overbought/oversold extremes), and ADX for trend strength.
- **Dynamic Risk**: Uses ATR(14) to dynamically calculate Stop Loss (SL) and Take Profit (TP) distances.

### 2. AI Engine (Final Decision)
Even when all rule-based conditions are met, the bot does not blindly enter a trade. Instead, it aggregates the current market context (trend, RSI, ADX, candle shapes) into a prompt and sends it to the configured AI Engine (Gemini/Qwen).
- The AI acts as a final filter, evaluating the context against common trading pitfalls.
- The AI must return a JSON response containing the action (`buy`/`sell`/`skip`), a `confidence` score, and the reasoning.
- The bot only executes the trade if the AI's confidence score exceeds the `MIN_CONFIDENCE` threshold (e.g., `0.70`). If the API times out, fails to parse, or returns low confidence, the bot safely skips.

### 3. Trade & Risk Management
To ensure capital safety, the bot enforces strict operational rules:
- **Strict Position Sizing**: Every trade must pass through the `RiskManager`, which calculates the exact lot size based on the account balance and `RISK_PER_TRADE` (e.g., 1%).
- **Single Active Trade**: The bot will never open a new position on the same symbol if one is already active.
- **Fail-safe Execution**: The bot will never trade blind. If any API (Broker or AI) fails, times out, or returns incomplete data, the current cycle is safely skipped.
- **Trailing Stop**: Implements dynamic trailing stops to secure profits as the trade moves in favor, while giving the trend room to develop.
- **Time-Decay Exit**: Incorporates early exit logic to close stagnant positions that linger too long without hitting SL or TP, reducing exposure to dead markets.

> ⚠️ **Note**: The exact parameters (EMA periods, RSI thresholds, AI prompts) are frequently tuned and optimized. For the most up-to-date strategy parameters, backtest records, and logic, please refer directly to [**STRATEGY.md**](docs/STRATEGY.md).

## Documentation

The project is heavily documented to ensure maintainability and strict adherence to architectural rules. **Please read these before contributing or modifying the code:**

- 🏗️ [**ARCHITECTURE.md**](docs/ARCHITECTURE.md): Detailed explanation of the layered architecture, module boundaries, and project structure.
- 📋 [**PRD.md**](docs/PRD.md): Product Requirements Document, defining the scope, goals, and success metrics.
- 📏 [**PROJECT-RULES.md**](docs/PROJECT-RULES.md): Coding conventions, safety constraints, and hard rules (e.g., Never trade blind, Never bypass RiskManager).
- 📈 [**STRATEGY.md**](docs/STRATEGY.md): The current trading strategy parameters (MA periods, RSI thresholds, etc.), AI prompts, and backtest changelog. *Do not hardcode parameters in code, read from here via config.*
- 📝 [**API-CONTRACTS.md**](docs/data/API-CONTRACTS.md): Definition of Broker REST API endpoints, request/response schemas, and internal data contracts.
- 📊 [**DATA-SCHEMA.md**](docs/data/DATA-SCHEMA.md): Schemas for Candles, Indicator Outputs, AI Context, Trade Logs, etc.

## Setup & Installation

1. **Clone the repository** and navigate to the project directory.
2. **Install dependencies**:
   ```bash
   npm install
   ```
3. **Configure Environment Variables**:
   Copy the example environment file and fill in your actual API keys and preferences.
   ```bash
   cp .env.example .env
   ```
   > ⚠️ **IMPORTANT**: Never commit your `.env` file to version control. Keep your API keys secure.

### Key Configuration Options (`.env`)
- `AI_PROVIDER`: The AI engine to use (e.g., `qwen`, `gemini`).
- `BROKER_BASE_URL`: URL for the Broker REST API (Demo or Live).
- `RISK_PER_TRADE`: Percentage of account balance to risk per trade (e.g., `0.01` for 1%).
- `MIN_CONFIDENCE`: Minimum AI confidence score required to enter a trade (e.g., `0.70`).

## Usage & Project Phases

The bot is designed to operate in distinct phases to ensure safety:

| Phase | Mode | Data Source | Command |
|---|---|---|---|
| **1** | **Unit Test** | Mock Data | `npm test` |
| **2** | **Backtest** | `CsvDataClient` (local `data/candles.csv`) | `npm run backtest` |
| **3** | **Paper Trading** | `BrokerClient` (Broker Demo API) | `npm start` |
| **4** | **Live Trading** | `BrokerClient` (Broker Live API) | `npm start` (with Live URL) |

### Running a Backtest (Phase 2)
Before trading on a demo or live account, always validate strategy changes using the backtest engine:
```bash
npm run backtest
```
*Note: Ensure you have historical data in `data/candles.csv`.*

### Running the Bot (Phase 3 & 4)
To start the bot connecting to the Broker REST API:
```bash
npm start
```
*Note: Only switch to Live Trading (Phase 4) after running stably on Paper Trading (Phase 3) for at least 1 continuous week.*
