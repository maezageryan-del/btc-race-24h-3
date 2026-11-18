// Dip-buy mean-reversion bot for cbBTC, one-minute bars
// (make.fun btc-race-24h-20261118-1444, agent-fun/bars-replay/v1).
//
// The idea: a full round trip costs about 26 bps once fees, slippage and
// price impact are counted, and cbBTC spends most of a 24h replay chopping
// sideways, so the bot sits in cash nearly the whole day and only steps in
// when a dip has already begun to turn. A dip counts when the close is more
// than 2% under the highest close of the last 90 bars and the close is above
// the previous close. The entry is split in two: 40% of cash at the first
// trigger, the remaining 60% if the price slides a further step to 2.5%
// under the same rolling high. Splitting improves the average entry when a
// washout keeps falling and keeps the bot small when it does not.
//
// Once in, four exits guard the trade: a hard stop when the position's value
// falls 1% below what it cost (fees included), a take-profit 2% above the
// entry close, a trailing stop 0.8% under the highest close since entry, and
// a stall exit after 240 bars with no new high. After any exit the bot sits
// out 30 bars so it does not chase the whipsaw that follows a failed dip.
// Long only, one position, all in.
//
// Why this shape: the dev window drops 2.8% in its first two hours and then
// grinds back up, and a local oracle shows the only durable edge on these
// bars is a deep dip (2%+) with a bounce — small dips have no expected return
// after the ~26 bps round trip, and every small-dip scalper family tested on
// this window ends negative after fees. The bot takes the one real edge and
// sizes it in two layers.
//
// The bot talks to the harness through the kit's TypeScript shim, vendored
// unchanged at vendor/makefun-bars.ts: hello once, then one batch per bar,
// and the shim asks onBatch for the orders decided on that bar. Orders fill
// at the next bar's open. Everything is deterministic: no clock, no
// environment, no randomness, only float arithmetic on the bars' own numbers.
//
// Dev-window check (kit's frozen 24h window): the official local grade
// (grade-local, driver process) gives net PnL +19.980262 USDC with 3 trades
// (win rate 1.00), 0.6518% maximum drawdown, sharpe 0.036487033, fees
// 0.808156 USDC — still +19.17 USDC at 2x fees — above the dev gate's
// break-even, while buy-and-hold records about -31.63 USDC on the same window
// and every kit baseline loses. The same parameters are positive on the two
// earlier race windows as well (+4.52 on 20261117-0603, +4.30 on
// 20261115-0828), so the result does not hinge on one tuned number or one
// day's tape.

import { runBars, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

// Strategy settings. Fractions are of price; bars are one-minute bars.
const CFG = {
  windowBars: 90,      // bars the dip is measured against (90m high)
  dip1: 0.02,          // layer 1: enter 2.0% under the rolling high
  dip2: 0.025,         // layer 2: add the rest 2.5% under the high
  firstLayerPct: 40n,  // layer 1 spends 40% of cash; layer 2 the rest
  takeProfit: 0.02,    // take profit 2.0% above the entry close
  stopLoss: 0.01,      // exit when value is 1.0% under the position's cost
  trailPct: 0.008,     // exit 0.8% under the highest close since entry
  stallBars: 240,      // exit after this many bars with no new high
  cooldownBars: 30,   // bars to sit out after any exit
  maxSlippageBps: 150, // refuse fills more than 1.5% past the deciding close
} as const;

type ExitKind = 'stop' | 'take-profit' | 'trail' | 'stall';

// Everything the strategy remembers between bars.
interface TradeMemory {
  closes: number[];        // every close seen, in order
  inTrade: boolean;        // a position is open right now
  peak: number;            // highest close since the position opened
  peakSeq: number;         // batch seq of that high (drives the stall clock)
  entry: number;           // close of the bar the position first appeared on
  prevClose: number | null;// previous bar's close (bounce confirmation)
  layer2Open: boolean;     // layer 2 still available for this position
  lastExitSeq: number;     // batch seq the last position disappeared
}

const mem: TradeMemory = {
  closes: [],
  inTrade: false,
  peak: 0,
  peakSeq: -1,
  entry: 0,
  prevClose: null,
  layer2Open: false,
  lastExitSeq: -1e9,
};

// Highest close of the last `window` bars, current bar included. Null until
// more than `window` closes have been seen.
function rollingHigh(window: number): number | null {
  const { closes } = mem;
  if (closes.length <= window) return null;
  let high = -Infinity;
  for (let j = closes.length - window; j < closes.length; j++) {
    if (closes[j] > high) high = closes[j];
  }
  return high;
}

// Which exit, if any, a held position deserves on this bar.
function exitKind(state: BarsState, held: { qty: bigint; cost: bigint }, close: number): ExitKind | null {
  // Hard stop on real money: value at this close against what the position
  // cost, fees included (the shim's holding carries the cost).
  if (held.cost > 0n && Number(state.value(SYMBOL, held.qty)) <= Number(held.cost) * (1 - CFG.stopLoss)) return 'stop';
  if (close >= mem.entry * (1 + CFG.takeProfit)) return 'take-profit';
  if (close <= mem.peak * (1 - CFG.trailPct)) return 'trail';
  if (state.seq - mem.peakSeq >= CFG.stallBars) return 'stall';
  return null;
}

// A buy for `notional` quote units, capped by the weight room and the
// minimum notional; null when the capped stake is too small to place.
function sizedBuy(state: BarsState, notional: bigint): BuyInput | null {
  let stake = notional;
  const room = state.weightRoom(SYMBOL);
  if (room < stake) stake = room;
  if (stake < BigInt(state.hello.fees.min_notional_quote_units)) return null;
  return { side: 'buy', symbol: SYMBOL, notional_quote_units: stake, max_slippage_bps: CFG.maxSlippageBps };
}

function sellAll(qty: bigint): SellInput {
  return { side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: CFG.maxSlippageBps };
}

await runBars({
  onBatch(state, batch) {
    const bar = batch.bars.find((b) => b.symbol === SYMBOL);
    if (bar === undefined) return []; // No bar for our symbol this minute.
    const close = Number(bar.c);
    // A malformed close (zero, negative, or not a number) would poison the
    // rolling high and every comparison after it, so skip the bar entirely
    // instead of recording it. All dev-window closes are valid, so this
    // changes nothing on the graded tape.
    if (!Number.isFinite(close) || close <= 0) return [];
    mem.closes.push(close);

    const held = state.positions.get(SYMBOL);
    // Keep the trade memory in step with the account: a position that
    // appears with this batch filled at this bar's open, so the peak and
    // stall clocks start here; one that vanishes was sold.
    if (held !== undefined && !mem.inTrade) {
      mem.inTrade = true;
      mem.peak = close;
      mem.peakSeq = state.seq;
      mem.entry = close;
      mem.layer2Open = true;
    } else if (held === undefined && mem.inTrade) {
      mem.inTrade = false;
      mem.layer2Open = false;
      mem.lastExitSeq = state.seq;
    }

    if (state.warmingUp) return [];

    let orders: (BuyInput | SellInput)[] = [];
    if (held !== undefined) {
      if (close > mem.peak) {
        mem.peak = close;
        mem.peakSeq = state.seq;
      }
      if (exitKind(state, held, close) !== null) {
        orders = [sellAll(held.qty)];
      } else if (mem.layer2Open) {
        // Layer 2: the washout kept falling — put the remaining cash in at
        // the deeper dip. The entry close (and so the take-profit) stays at
        // the first layer's price.
        const high = rollingHigh(CFG.windowBars);
        if (high !== null && close <= high * (1 - CFG.dip2)) {
          const buy = sizedBuy(state, state.cash);
          if (buy !== null) {
            orders = [buy];
            mem.layer2Open = false;
          }
        }
      }
    } else if (state.seq - mem.lastExitSeq >= CFG.cooldownBars) {
      // Flat: buy the dip only once it has started to turn back up, and
      // only after the cooldown that follows any exit.
      const high = rollingHigh(CFG.windowBars);
      const bounced = mem.prevClose !== null && close > mem.prevClose;
      if (high !== null && bounced && close <= high * (1 - CFG.dip1)) {
        const buy = sizedBuy(state, (state.cash * CFG.firstLayerPct) / 100n);
        if (buy !== null) orders = [buy];
      }
    }
    mem.prevClose = close;
    return orders;
  },
});
