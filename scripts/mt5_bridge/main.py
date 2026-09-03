import os
import sys
from typing import Optional, List, Dict, Any
from datetime import datetime
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

try:
    import MetaTrader5 as mt5
except ImportError:
    mt5 = None

app = FastAPI(
    title="MT5 FastAPI Bridge",
    description="Real-time candle & market data bridge for TradeBot_XAU",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

TIMEFRAME_MAP = {
    "M1": 1,     # mt5.TIMEFRAME_M1
    "M2": 2,     # mt5.TIMEFRAME_M2
    "M3": 3,     # mt5.TIMEFRAME_M3
    "M5": 5,     # mt5.TIMEFRAME_M5
    "M15": 15,   # mt5.TIMEFRAME_M15
    "M30": 30,   # mt5.TIMEFRAME_M30
    "H1": 16385, # mt5.TIMEFRAME_H1 (0x4001)
    "H4": 16388, # mt5.TIMEFRAME_H4 (0x4004)
    "D1": 16408, # mt5.TIMEFRAME_D1 (0x4018)
}

def ensure_mt5_connected() -> bool:
    """Ensure MetaTrader5 library is initialized and connected to the active terminal."""
    if mt5 is None:
        return False
    
    # Check if already initialized
    terminal_info = mt5.terminal_info()
    if terminal_info is not None and terminal_info.connected:
        return True

    # Try initializing
    if not mt5.initialize():
        error = mt5.last_error()
        print(f"[MT5 Bridge] mt5.initialize() failed, error code: {error}", file=sys.stderr)
        return False
    return True

def resolve_symbol(requested_symbol: str) -> str:
    """Resolve symbol variation (e.g. XAU_USD -> XAUUSD or XAUUSD.r)."""
    clean_sym = requested_symbol.replace("_", "").replace("-", "").replace("/", "").upper()
    
    if mt5 is None or not ensure_mt5_connected():
        return clean_sym

    # Direct match check
    info = mt5.symbol_info(clean_sym)
    if info is not None:
        if not info.visible:
            mt5.symbol_select(clean_sym, True)
        return clean_sym

    # Check variation in available symbols (e.g. broker suffixes like XAUUSD.r, XAUUSD.m, GOLD)
    all_symbols = mt5.symbols_get()
    if all_symbols:
        for s in all_symbols:
            name_upper = s.name.upper()
            if clean_sym in name_upper or (clean_sym == "XAUUSD" and "GOLD" in name_upper):
                if not s.visible:
                    mt5.symbol_select(s.name, True)
                return s.name

    return clean_sym

@app.get("/health")
def get_health() -> Dict[str, Any]:
    """Check health status and connection to MT5 terminal."""
    if mt5 is None:
        return {
            "status": "error",
            "message": "MetaTrader5 Python package is not installed.",
            "connected": False
        }

    is_conn = ensure_mt5_connected()
    terminal_info = mt5.terminal_info()._asdict() if (is_conn and mt5.terminal_info()) else None
    account_info = mt5.account_info()._asdict() if (is_conn and mt5.account_info()) else None
    version_info = mt5.version() if is_conn else None

    return {
        "status": "ok" if is_conn else "disconnected",
        "connected": is_conn,
        "version": version_info,
        "terminal": {
            "name": terminal_info.get("name") if terminal_info else None,
            "path": terminal_info.get("path") if terminal_info else None,
            "connected": terminal_info.get("connected") if terminal_info else False,
        } if terminal_info else None,
        "account": {
            "login": account_info.get("login") if account_info else None,
            "server": account_info.get("server") if account_info else None,
            "currency": account_info.get("currency") if account_info else None,
            "balance": account_info.get("balance") if account_info else None,
            "equity": account_info.get("equity") if account_info else None,
            "leverage": account_info.get("leverage") if account_info else None,
        } if account_info else None
    }

@app.get("/candles")
def get_candles(
    symbol: str = Query("XAU_USD", description="Symbol name e.g. XAU_USD, XAUUSD, GOLD"),
    timeframe: str = Query("M5", description="Timeframe e.g. M1, M5, M15, H1, H4, D1"),
    count: int = Query(2000, ge=1, le=50000, description="Number of bars to fetch"),
    before_time: Optional[int] = Query(None, description="Fetch historical bars before this Unix timestamp")
) -> List[Dict[str, Any]]:
    """Fetch recent or historical OHLCV candles from the connected MT5 terminal."""
    if not ensure_mt5_connected():
        raise HTTPException(
            status_code=503,
            detail="MetaTrader 5 terminal is not connected. Please make sure MT5 is open and logged in."
        )

    resolved = resolve_symbol(symbol)
    tf_upper = timeframe.upper()
    tf_code = TIMEFRAME_MAP.get(tf_upper, 5) # default M5

    # Fetch rates from MT5 (either before specific timestamp or most recent)
    if before_time:
        dt_target = datetime.utcfromtimestamp(before_time)
        rates = mt5.copy_rates_from(resolved, tf_code, dt_target, count)
    else:
        rates = mt5.copy_rates_from_pos(resolved, tf_code, 0, count)

    if rates is None or len(rates) == 0:
        return []

    results = []
    for r in rates:
        r_time = int(r["time"])
        # If before_time is specified, strictly exclude equal/future bars
        if before_time and r_time >= before_time:
            continue
        results.append({
            "time": r_time,
            "open": float(r["open"]),
            "high": float(r["high"]),
            "low": float(r["low"]),
            "close": float(r["close"]),
            "volume": int(r["tick_volume"] if "tick_volume" in r.dtype.names else (r["real_volume"] if "real_volume" in r.dtype.names else 0))
        })

    return results

@app.get("/price")
def get_price(
    symbol: str = Query("XAU_USD", description="Symbol name")
) -> Dict[str, Any]:
    """Get latest real-time tick (bid/ask/time) for symbol."""
    if not ensure_mt5_connected():
        raise HTTPException(
            status_code=503,
            detail="MetaTrader 5 terminal is not connected."
        )

    resolved = resolve_symbol(symbol)
    tick = mt5.symbol_info_tick(resolved)
    if tick is None:
        error = mt5.last_error()
        raise HTTPException(
            status_code=404,
            detail=f"Tick information not available for '{resolved}'. Error: {error}"
        )

    return {
        "symbol": resolved,
        "bid": float(tick.bid),
        "ask": float(tick.ask),
        "last": float(tick.last) if tick.last else float(tick.bid),
        "volume": int(tick.volume),
        "time": int(tick.time)
    }

@app.get("/positions")
def get_positions(
    symbol: Optional[str] = Query(None, description="Filter positions by symbol")
) -> List[Dict[str, Any]]:
    """Get active open positions in MT5."""
    if not ensure_mt5_connected():
        raise HTTPException(status_code=503, detail="MT5 terminal not connected.")

    if symbol:
        resolved = resolve_symbol(symbol)
        positions = mt5.positions_get(symbol=resolved)
    else:
        positions = mt5.positions_get()

    if positions is None:
        return []

    results = []
    for p in positions:
        results.append({
            "ticket": int(p.ticket),
            "symbol": p.symbol,
            "type": "BUY" if p.type == 0 else "SELL",
            "volume": float(p.volume),
            "price_open": float(p.price_open),
            "sl": float(p.sl),
            "tp": float(p.tp),
            "price_current": float(p.price_current),
            "profit": float(p.profit),
            "time": int(p.time)
        })
    return results

if __name__ == "__main__":
    port = int(os.environ.get("BRIDGE_PORT", 8000))
    print(f"\n=======================================================")
    print(f"  🚀 MT5 Python FastAPI Bridge starting on port {port}")
    print(f"  👉 Documentation: http://localhost:{port}/docs")
    print(f"=======================================================\n")
    uvicorn.run("main:app", host="127.0.0.1", port=port, reload=False)
