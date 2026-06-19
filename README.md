# Poker Sim

A full-stack no-limit Texas Hold'em simulator with AI opponents, an Express API, and a graphical React table.

## Features

- Configurable player count, stack size, blinds, and AI style
- Button rotation, small blind, and big blind posting
- Preflop, flop, turn, river, and showdown progression
- No-limit actions: fold, check, call, bet, raise, and all-in
- Min-raise handling, all-in runouts, side pots, and split pots
- Seven-card hand evaluation with kickers and ace-low straights
- Automated AI players with tight, balanced, and loose tendencies
- Graphical table UI with seats, cards, pot display, action controls, winners, and hand history

## Development

```bash
npm install
npm run dev
```

The Vite client runs with an `/api` proxy to the Express server.

## Verification

```bash
npm run test
npm run typecheck
npm run build
```

## Production

```bash
npm run build
npm run start
```

The production server serves the built React app and the `/api` routes from the same Express process.
