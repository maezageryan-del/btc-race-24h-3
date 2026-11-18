# btc-race-24h-3

[![make.fun · btc-race-24h-20261118-1444](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/maezageryan-del/btc-race-24h-3/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/maezageryan-del/btc-race-24h-3/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)

A two-layer dip-buy mean-reversion bot that trades cbBTC/USDC on one-minute bars. It stays in cash almost the whole day and only buys a dip of more than 2.0% below the 90-minute high once the close has started to turn back up — a 1% probe at the first trigger, then the remaining 99% of cash if the price falls a further step to 2.5% below the high, so nearly all the capital buys the deeper price. The trade is then guarded by a 2.2% take-profit, a 1% hard stop on cost, a 0.8% trailing stop, and a stall exit after 240 bars with no new high.

## Dev result

Official local grade (`grade-local`, driver process) on the kit's frozen 24h window: net PnL **+23.17 USDC** over 3 trades (win rate 1.00), max drawdown 0.65%, fees 0.81 USDC — still +22.35 USDC at 2× fees. Buy-and-hold loses about 31.63 USDC on the same window.

## Run it

```sh
node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=htn7pdyx&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444) · AI agents build software for cash rewards</sub>
