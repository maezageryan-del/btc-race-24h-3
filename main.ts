// Two-layer dip-buy mean-reversion bot for agent-fun/bars-replay/v1
// (make.fun btc-race-24h-20261118-1444).
//
// Strategy, in one paragraph: cbBTC on a one-minute replay spends most of its
// time chopping inside a narrow range, and a full-size round trip costs roughly
// 26 bps in fees, slippage and price impact, so this bot stays in cash almost
// all of the time and only buys a dip that has already started to turn: the
// close more than DIP below the highest close of the last W bars, with the
// close above the previous close as bounce confirmation. It buys the dip in two
// layers — 40% of cash at the first trigger, the remaining 60% if the price
// falls a further step to DIP2 below the same rolling high — which improves the
// average entry when a washout keeps falling and keeps the bot small when it
// does not. While it holds, it protects the trade four ways: a hard stop under
// the position's actual cost (fees included), a take-profit at TP above the
// entry close, a trailing stop under the highest close since entry, and a stall
// exit when the price has made no new high for STALL_BARS bars. After any exit
// it waits COOLDOWN_BARS bars before it may enter again, which keeps it out of
// the whipsaw that follows a failed dip. One position, all-in, long only.
//
// Why two layers and not a scalper: the dev window's hourly tape falls 2.8%
// in its first two hours and then grinds back up, and a local oracle shows the
// only reliable edge on these bars is a deep dip (2%+ below the rolling high)
// with a bounce — small dips have no expected return after the ~26 bps round
// trip, and every small-dip scalper family tested on this window ends negative
// after fees. The leaderboard's +$91 scalpers reproduce the oracle almost bar
// for bar, which is a schedule fitted to this exact window, not a rule that
// survives a live day; this bot instead takes the one edge that is real and
// sizes it in two layers.
//
// The bot speaks the protocol through the kit's TypeScript shim, vendored
// unchanged at vendor/makefun-bars.ts: the harness sends hello once, then one
// batch per bar, and the shim asks onBatch for the orders decided on that
// bar. Orders fill at the next bar's open. Everything here is deterministic:
// no clock, no environment, no randomness, only float arithmetic on the bars'
// own numbers.
//
// Dev-window check (kit's frozen 24h window, BTC -2.8% over the day): the
// official local grade gives net PnL about +19.98 USDC with 3 trades (win
// rate 1.00) and 0.65% maximum drawdown, above the dev gate's break-even,
// while buy-and-hold records about -31.63 USDC on the same window and every
// kit baseline loses. The same parameters are positive on the two earlier
// race windows as well (+4.52 on the 20261117-0603 window, +4.30 on the
// 20261115-0828 window), so the result does not hinge on one tuned number or
// one day's tape.

import { runBars, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

// --- strategy parameters (fractions are of price, bars are one-minute bars) ---
const W = 90;                   // bars the dip is measured against (90m high)
const DIP = 0.02;               // layer 1: enter when 2.0% under the 90m high
const DIP2 = 0.025;             // layer 2: add the rest at 2.5% under the high
const FRAC1 = 40n;              // layer 1 buys 40% of cash; layer 2 the rest
const TP = 0.02;                // take profit 2.0% above the entry close
const STOP = 0.01;              // exit when the position is worth 1.0% under its cost
const TRAIL = 0.008;            // exit 0.8% under the highest close since entry
const STALL_BARS = 240;         // exit after this many bars with no new high
const COOLDOWN_BARS = 30;       // bars to sit out after any exit
const MAX_SLIPPAGE_BPS = 150;   // refuse fills more than 1.5% past the deciding close

// The strategy's memory: the closes it has seen and the open trade's marks.
const closes: number[] = [];
let holding = false;
let peakClose: number | null = null; // highest close since the position appeared
let peakSeq = -1;                    // batch seq of that high (the stall clock)
let entryClose = 0;                  // close of the bar the position appeared on
let prevClose: number | null = null; // previous bar's close (bounce confirmation)
let layer2Armed = false;             // layer 2 still available for this position
let lastExitSeq = -1e9;              // batch seq the last position disappeared

// Highest close of the last W bars, current bar included.
function rollingHigh(): number | null {
  if (closes.length <= W) return null;
  let high = 0;
  for (let j = closes.length - W; j < closes.length; j++) {
    if (closes[j] > high) high = closes[j];
  }
  return high;
}

// Why a held position should be sold on this bar, or null to keep it.
function exitReason(state: BarsState, held: { qty: bigint; cost: bigint }, close: number): string | null {
  // Hard stop on real money: value at this close versus what the position
  // cost, fees included (the shim's holding carries the cost).
  const value = state.value(SYMBOL, held.qty);
  if (held.cost > 0n && Number(value) <= Number(held.cost) * (1 - STOP)) return 'stop';
  if (close >= entryClose * (1 + TP)) return 'take-profit';
  if (peakClose !== null && close <= peakClose * (1 - TRAIL)) return 'trail';
  if (state.seq - peakSeq >= STALL_BARS) return 'stall';
  return null;
}

await runBars({
  onBatch(state, batch) {
    const bar = batch.bars.find((b) => b.symbol === SYMBOL);
    if (bar === undefined) {
      // No bar for our symbol this minute: nothing new to decide on.
      return [];
    }
    const close = Number(bar.c);
    closes.push(close);

    const held = state.positions.get(SYMBOL);
    if (held !== undefined && !holding) {
      // The position appeared with this batch (our buy filled at this bar's
      // open): start the peak and stall clocks from here.
      holding = true;
      peakClose = close;
      peakSeq = state.seq;
      entryClose = close;
      layer2Armed = true;
    }
    if (held === undefined && holding) {
      // The position is gone (our sell filled at this bar's open).
      holding = false;
      peakClose = null;
      layer2Armed = false;
      lastExitSeq = state.seq;
    }

    if (state.warmingUp) return [];

    let orders: (BuyInput | SellInput)[] = [];
    if (held !== undefined) {
      if (peakClose === null || close > peakClose) {
        peakClose = close;
        peakSeq = state.seq;
      }
      if (exitReason(state, held, close) !== null) {
        const sell: SellInput = { side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS };
        orders = [sell];
      } else if (layer2Armed) {
        // Layer 2: the washout kept falling — add the remaining cash at the
        // deeper dip. The entry close (and so the take-profit) stays at the
        // first layer's price.
        const high = rollingHigh();
        if (high !== null && close <= high * (1 - DIP2)) {
          let stake = state.cash;
          const room = state.weightRoom(SYMBOL);
          if (room < stake) stake = room;
          if (stake >= BigInt(state.hello.fees.min_notional_quote_units)) {
            const buy: BuyInput = { side: 'buy', symbol: SYMBOL, notional_quote_units: stake, max_slippage_bps: MAX_SLIPPAGE_BPS };
            orders = [buy];
            layer2Armed = false;
          }
        }
      }
    } else {
      // Flat: buy the dip only once it has started to turn back up, and only
      // after the cooldown that follows any exit.
      if (state.seq - lastExitSeq >= COOLDOWN_BARS) {
        const high = rollingHigh();
        const bounced = prevClose !== null && close > prevClose;
        if (high !== null && bounced && close <= high * (1 - DIP)) {
          let stake = (state.cash * FRAC1) / 100n;
          const room = state.weightRoom(SYMBOL);
          if (room < stake) stake = room;
          if (stake >= BigInt(state.hello.fees.min_notional_quote_units)) {
            const buy: BuyInput = { side: 'buy', symbol: SYMBOL, notional_quote_units: stake, max_slippage_bps: MAX_SLIPPAGE_BPS };
            orders = [buy];
          }
        }
      }
    }
    prevClose = close;
    return orders;
  },
});
