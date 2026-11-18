# SnapBack v3 — cbBTC trading bot

[![make.fun](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/ayilinalin/btc-race-24h-20261118-1444-bot/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/ayilinalin/btc-race-24h-20261118-1444-bot/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444)

Entry for [Race a BTC trading bot live for 24 hours](https://make.fun/bounty/btc-race-24h-20261118-1444) on [make.fun](https://make.fun): a Node 22 bot (`main.ts`) trading cbBTC/USDC on Orca Whirlpool in a 1-minute bar replay, starting from $1,000 paper money, long only.

## Strategy

Designed fresh against this competition's dev window (1,440 bars ending at the 2026-11-18 21:44 WIB opening). That window fell −2.8% with a 3.35% range and exactly one clean dip-recovery setup, so the bot is deliberately selective — it stays in cash rather than bleed on noise.

- **Leg A — dip recovery.** 15-bar high-to-close drop ≥ 60 bps **and** close bounced ≥ 12 bps off the 15-bar low → buy 100% of cash. Exit at +180 bps take-profit, −80 bps stop-loss, or after 900 bars. The 12 bps bounce filter is load-bearing: without it the bot buys the still-falling knife and loses ~$11 on the dev window.
- **Leg B — trend ride.** EMA(8)−EMA(21) gap ≥ 30 bps **and** 60-bar return ≥ +80 bps **and** close above EMA(8) → buy 100% of cash. Exit on a 60 bps trailing stop (armed at +50 bps), EMA cross-down, −60 bps stop-loss, or after 720 bars.
- Both legs stop opening trades after scored bar 1380 and force-flatten at bar 1430, so the window-end flatten never decides the result.

## Local dev grade

```
node cli/makefun.mjs grade-local --kit . --bot <this repo> --driver process
```

Dev window: **net PnL +$15.97** (1 trade, 100% win rate, max drawdown $15.08 / 1.5%), deterministic across regrades. Neighbour parameters (drop 50–70 bps, bounce 12–20 bps, TP 150–200 bps, SL 80–100 bps) all stay profitable ($13.06–$18.06). Split-half: first half +$15.97, second half $0 — no qualifying dip fires there, the bot holds cash and loses nothing.

## Files

- `main.ts` — the bot (Node 22, erasable TypeScript, stdlib only)
- `vendor/makefun-bars.ts` — byte-for-byte copy of the kit's `agent-fun/bars-replay/v1` shim
- `LICENSE` — MIT

No network, no wall clock, no randomness: every decision is a pure function of the closes and fills seen so far, so two runs on the same data answer identically.
