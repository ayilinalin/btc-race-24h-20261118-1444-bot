// SnapBack v3 — dip-recovery + trend-ride bot for make.fun btc-race-24h-20261118-1444.
// Trades cbBTC/USDC (Orca Whirlpool) on 1-minute bars, $1,000 paper money, long only.
// Every decision is a pure function of the closes and fills seen so far: no clock,
// no environment, no randomness, so two runs on the same data answer identically.
//
// Strategy (designed fresh against THIS kit's dev window, 1440 bars ending at the
// 2026-11-18 21:44 WIB opening; the window fell -2.8% with a 3.35% range and exactly
// one clean dip-recovery setup, so the bot is deliberately selective):
//   Leg A — dip recovery: 15-bar high-to-close drop >= 60 bps AND close bounced
//     >= 12 bps off the 15-bar low -> buy 100% of cash. Exit at +180 bps (TP),
//     -80 bps (SL), or after 900 bars. The 12 bps bounce filter matters: without
//     it the bot buys the still-falling knife and loses ~$11 on this window.
//   Leg B — trend ride: EMA(8)-EMA(21) gap >= 30 bps AND 60-bar return >= +80 bps
//     AND close above EMA(8) -> buy 100% of cash. Exit on a 60 bps trailing stop
//     (armed at +50 bps), EMA cross-down, -60 bps SL, or after 720 bars.
//   Both legs stop opening trades after scored bar 1380 and force-flatten at 1430,
//   so the window-end flatten never decides the result. Max drawdown on dev: ~$15.
import { runBars } from "./vendor/makefun-bars.ts";

const SYMBOL = "CBBTC";
const LOOKBACK = 15; // bars for the dip high/low window
const DROP_BPS = 60; // Leg A: drop from the 15-bar high
const BOUNCE_BPS = 12; // Leg A: bounce off the 15-bar low
const TP_BPS = 180; // Leg A take profit
const SL_BPS = 80; // Leg A stop loss
const MAX_HOLD_A = 900; // Leg A max hold, bars
const GAP_BPS = 30; // Leg B: EMA(8)-EMA(21) gap
const RET60_BPS = 80; // Leg B: 60-bar return
const TRAIL_BPS = 60; // Leg B trailing stop
const TRAIL_ARM_BPS = 50; // Leg B trailing arms at +50 bps
const SL_B_BPS = 60; // Leg B stop loss
const MAX_HOLD_B = 720; // Leg B max hold, bars
const NO_ENTRY_BEFORE = 30; // let indicators warm up
const NO_ENTRY_AFTER = 1380; // stop opening trades near the end
const FORCE_EXIT_IDX = 1430; // flatten before the window ends
const MAX_SLIPPAGE_BPS = 300; // headroom vs the ~7 bps typical 1-min move

const closes: number[] = [];
let ema8 = 0;
let ema21 = 0;
let entryPrice = 0; // fill price of the open position, in price-scale units
let entryIdx = -1; // scored bar index at which the position was filled
let peak = 0; // highest close since entry, in price-scale units
let leg = ""; // "A" | "B" | ""
let openLeg = ""; // leg of the buy order currently awaiting its fill

function bpsMove(now: number, ref: number): number {
  return ((now - ref) / ref) * 10000;
}

await runBars({
  onBatch(state, batch) {
    // Fills first: a buy fill opens the position, a sell fill closes it.
    for (const fill of batch.fills) {
      if (fill.status !== "filled") continue;
      if (fill.side === "buy") {
        entryPrice = Number(fill.price);
        peak = entryPrice;
        entryIdx = state.seq - state.warmupBars;
        leg = openLeg;
      } else if (fill.side === "sell") {
        entryPrice = 0;
        entryIdx = -1;
        peak = 0;
        leg = "";
      }
    }
    openLeg = "";

    const bar = batch.bars[0];
    if (bar === undefined || bar.symbol !== SYMBOL) return [];
    const close = Number(bar.c);
    const idx = state.seq - state.warmupBars;

    // Indicators update on every bar, warm-up included.
    closes.push(close);
    const k8 = 2 / 9;
    const k21 = 2 / 22;
    ema8 = closes.length === 1 ? close : close * k8 + ema8 * (1 - k8);
    ema21 = closes.length === 1 ? close : close * k21 + ema21 * (1 - k21);

    const held = state.positions.get(SYMBOL)?.qty ?? 0n;
    if (held === 0n) {
      if (state.warmingUp || idx < NO_ENTRY_BEFORE || idx >= NO_ENTRY_AFTER) return [];
      // Leg A: dip recovery.
      if (closes.length >= LOOKBACK) {
        let hi = 0;
        let lo = Infinity;
        for (let j = closes.length - LOOKBACK; j < closes.length; j++) {
          if (closes[j]! > hi) hi = closes[j]!;
          if (closes[j]! < lo) lo = closes[j]!;
        }
        const dropBps = bpsMove(close, hi) * -1;
        const bounceBps = bpsMove(close, lo);
        if (dropBps >= DROP_BPS && bounceBps >= BOUNCE_BPS) {
          openLeg = "A";
          return [{ side: "buy", symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
        }
      }
      // Leg B: trend ride.
      if (closes.length > 60) {
        const gapBps = bpsMove(ema8, ema21);
        const ret60Bps = bpsMove(close, closes[closes.length - 61]!);
        if (gapBps >= GAP_BPS && ret60Bps >= RET60_BPS && close > ema8) {
          openLeg = "B";
          return [{ side: "buy", symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
        }
      }
      return [];
    }

    // Holding: manage the exit.
    if (close > peak) peak = close;
    const chgBps = bpsMove(close, entryPrice);
    const trailBps = bpsMove(close, peak) * -1;
    const gapBps = bpsMove(ema8, ema21);
    let exit = false;
    if (leg === "A") {
      exit =
        chgBps >= TP_BPS ||
        chgBps <= -SL_BPS ||
        idx - entryIdx >= MAX_HOLD_A ||
        idx >= FORCE_EXIT_IDX;
    } else {
      exit =
        (chgBps >= TRAIL_ARM_BPS && trailBps >= TRAIL_BPS) ||
        gapBps < 0 ||
        chgBps <= -SL_B_BPS ||
        idx - entryIdx >= MAX_HOLD_B ||
        idx >= FORCE_EXIT_IDX;
    }
    if (!exit) return [];
    return [{ side: "sell", symbol: SYMBOL, qty: held, max_slippage_bps: MAX_SLIPPAGE_BPS }];
  },
  onDone(state) {
    // Diagnostics only (stderr never reaches the harness): final equity in USDC.
    console.error(`snapback-v3 done: equity $${(Number(state.equity) / 1e6).toFixed(2)} cash $${(Number(state.cash) / 1e6).toFixed(2)}`);
  },
});
