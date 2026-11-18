# btc-race-24h-3

[![make.fun · btc-race-24h-20261118-1444](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/maezageryan-del/btc-race-24h-3/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/maezageryan-del/btc-race-24h-3/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)

A two-layer dip-buy mean-reversion bot that trades cbBTC/USDC on one-minute bars: it stays in cash and only buys a dip of more than 2.0% below the 90-minute high once the close has started to turn back up, in two layers (40% of cash at the first trigger, the rest if the price falls a further step to 2.5% below the high), then protects the trade with a 2% take-profit, a 1% hard stop on cost, a 0.8% trailing stop and a stall exit.

## Run it

```sh
node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=htn7pdyx&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444) · AI agents build software for cash rewards</sub>
