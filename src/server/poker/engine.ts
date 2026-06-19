import { randomUUID } from "node:crypto";
import type {
  ActionKind,
  ActionLogEntry,
  Card,
  GameConfig,
  GameState,
  LegalAction,
  NewGameRequest,
  PlayerActionRequest,
  PlayerState,
  Pot,
  Street,
  Winner
} from "../../shared/types.js";
import { createDeck, rankValues, shuffle } from "./cards.js";
import { compareHands, evaluateBestHand } from "./evaluator.js";

const defaultConfig: GameConfig = {
  playerCount: 6,
  startingStack: 2_000,
  smallBlind: 10,
  bigBlind: 20,
  humanSeat: 0,
  aiDifficulty: "balanced"
};

export class PokerGame {
  readonly id = randomUUID();

  private readonly config: GameConfig;
  private players: PlayerState[];
  private deck: Card[] = [];
  private communityCards: Card[] = [];
  private handNumber = 0;
  private dealerIndex = -1;
  private activeSeatId?: string;
  private street: Street = "complete";
  private currentBet = 0;
  private minRaise = 0;
  private winners: Winner[] = [];
  private actionLog: ActionLogEntry[] = [];
  private logId = 0;

  constructor(request: NewGameRequest = {}) {
    this.config = normalizeConfig(request);
    this.players = Array.from({ length: this.config.playerCount }, (_, seat) => ({
      id: randomUUID(),
      name: seat === this.config.humanSeat ? "You" : `AI ${seat}`,
      seat,
      isHuman: seat === this.config.humanSeat,
      isDealer: false,
      status: "active",
      stack: this.config.startingStack,
      bet: 0,
      totalCommitted: 0,
      acted: false,
      holeCards: []
    }));

    this.startNextHand();
  }

  getState(): GameState {
    const activePlayer = this.players.find((player) => player.id === this.activeSeatId);
    const pots = this.buildPots();

    return clone({
      id: this.id,
      config: this.config,
      handNumber: this.handNumber,
      dealerSeatId: this.players[this.dealerIndex]?.id ?? this.players[0].id,
      activeSeatId: this.activeSeatId,
      street: this.street,
      players: this.players,
      communityCards: this.communityCards,
      deckRemaining: this.deck.length,
      currentBet: this.currentBet,
      minRaise: this.minRaise,
      pots,
      totalPot: pots.reduce((total, pot) => total + pot.amount, 0),
      legalActions: activePlayer?.isHuman ? this.legalActionsFor(activePlayer) : [],
      winners: this.winners,
      actionLog: this.actionLog.slice(-120)
    });
  }

  startNextHand(): GameState {
    this.ensurePlayableStacks();
    this.handNumber += 1;
    this.deck = shuffle(createDeck());
    this.communityCards = [];
    this.currentBet = 0;
    this.minRaise = this.config.bigBlind;
    this.winners = [];
    this.street = "preflop";

    for (const player of this.players) {
      player.isDealer = false;
      player.bet = 0;
      player.totalCommitted = 0;
      player.acted = false;
      player.lastAction = undefined;
      player.holeCards = [];
      player.status = player.stack > 0 ? "active" : "out";
    }

    this.dealerIndex = this.nextFundedIndex(this.dealerIndex);
    this.players[this.dealerIndex].isDealer = true;
    this.log(`Hand ${this.handNumber} begins. ${this.players[this.dealerIndex].name} has the button.`);

    this.dealHoleCards();
    this.postBlinds();
    this.advanceToNextActor(this.preflopFirstActionIndex());
    this.runAiUntilHumanOrComplete();
    return this.getState();
  }

  performHumanAction(action: PlayerActionRequest): GameState {
    const player = this.players.find((candidate) => candidate.id === this.activeSeatId);
    if (!player || !player.isHuman) {
      throw new Error("It is not the human player's turn.");
    }

    this.applyAction(player, action);
    this.runAiUntilHumanOrComplete();
    return this.getState();
  }

  private applyAction(player: PlayerState, action: PlayerActionRequest): void {
    const legalAction = this.legalActionsFor(player).find((candidate) => candidate.kind === action.kind);
    if (!legalAction) {
      throw new Error(`${action.kind} is not legal right now.`);
    }

    const toCall = Math.max(0, this.currentBet - player.bet);

    switch (action.kind) {
      case "fold":
        player.status = "folded";
        player.acted = true;
        player.lastAction = "Folded";
        this.log(`${player.name} folds.`);
        break;
      case "check":
        if (toCall > 0) {
          throw new Error("Cannot check while facing a bet.");
        }
        player.acted = true;
        player.lastAction = "Checked";
        this.log(`${player.name} checks.`);
        break;
      case "call": {
        const committed = this.commitChips(player, toCall);
        player.acted = true;
        player.lastAction = committed < toCall ? `Called all-in for ${committed}` : `Called ${committed}`;
        this.log(`${player.name} ${committed < toCall ? "calls all-in" : "calls"} for ${committed}.`);
        break;
      }
      case "bet":
      case "raise": {
        const targetBet = clampAmount(action.amount, legalAction.minAmount, legalAction.maxAmount);
        const increase = targetBet - this.currentBet;
        this.commitChips(player, targetBet - player.bet);
        player.acted = true;
        this.currentBet = Math.max(this.currentBet, targetBet);
        this.minRaise = increase;
        this.reopenActionForOpponents(player);
        player.lastAction = `${action.kind === "bet" ? "Bet" : "Raised to"} ${targetBet}`;
        this.log(`${player.name} ${action.kind === "bet" ? "bets" : "raises to"} ${targetBet}.`);
        break;
      }
      case "all-in": {
        const targetBet = player.bet + player.stack;
        const increase = targetBet - this.currentBet;
        this.commitChips(player, player.stack);
        player.acted = true;

        if (targetBet > this.currentBet) {
          const qualifyingRaise = this.currentBet === 0 || increase >= this.minRaise;
          this.currentBet = targetBet;
          if (qualifyingRaise) {
            this.minRaise = Math.max(increase, this.config.bigBlind);
            this.reopenActionForOpponents(player);
          }
        }

        player.lastAction = `All-in for ${targetBet}`;
        this.log(`${player.name} moves all-in for ${targetBet}.`);
        break;
      }
      default:
        assertNever(action.kind);
    }

    this.afterAction(player);
  }

  private afterAction(player: PlayerState): void {
    const livePlayers = this.players.filter((candidate) => candidate.status !== "folded" && candidate.status !== "out");
    if (livePlayers.length === 1) {
      this.awardUncontestedPot(livePlayers[0]);
      return;
    }

    if (this.isBettingRoundComplete()) {
      this.advanceStreet();
      return;
    }

    this.advanceToNextActor(player.seat + 1);
  }

  private advanceStreet(): void {
    const livePlayers = this.players.filter((player) => player.status !== "folded" && player.status !== "out");
    if (livePlayers.length <= 1) {
      this.awardUncontestedPot(livePlayers[0]);
      return;
    }

    if (this.street === "river") {
      this.showdown();
      return;
    }

    this.resetStreetBets();

    if (this.street === "preflop") {
      this.burnCard();
      this.communityCards.push(this.draw(), this.draw(), this.draw());
      this.street = "flop";
      this.log(`Flop: ${this.formatCards(this.communityCards)}.`);
    } else if (this.street === "flop") {
      this.burnCard();
      this.communityCards.push(this.draw());
      this.street = "turn";
      this.log(`Turn: ${this.formatCards(this.communityCards)}.`);
    } else if (this.street === "turn") {
      this.burnCard();
      this.communityCards.push(this.draw());
      this.street = "river";
      this.log(`River: ${this.formatCards(this.communityCards)}.`);
    }

    if (this.players.every((player) => player.status !== "active")) {
      this.dealRemainingBoardAndShowdown();
      return;
    }

    this.advanceToNextActor(this.dealerIndex + 1);
  }

  private showdown(): void {
    this.street = "complete";
    this.activeSeatId = undefined;
    this.currentBet = 0;
    this.minRaise = this.config.bigBlind;

    const livePlayers = this.players.filter((player) => player.status !== "folded" && player.status !== "out");
    const evaluations = new Map(livePlayers.map((player) => [player.id, evaluateBestHand([...player.holeCards, ...this.communityCards])]));
    const awards = new Map<string, Winner>();

    for (const pot of this.buildPots()) {
      const eligible = livePlayers.filter((player) => pot.eligibleSeatIds.includes(player.id));
      if (eligible.length === 0 || pot.amount === 0) {
        continue;
      }

      const best = eligible.reduce((leader, challenger) => {
        const leaderHand = evaluations.get(leader.id);
        const challengerHand = evaluations.get(challenger.id);
        if (!leaderHand || !challengerHand) {
          return leader;
        }
        return compareHands(challengerHand, leaderHand) > 0 ? challenger : leader;
      }, eligible[0]);
      const bestHand = evaluations.get(best.id);
      if (!bestHand) {
        continue;
      }

      const potWinners = eligible.filter((player) => compareHands(evaluations.get(player.id) ?? bestHand, bestHand) === 0);
      const share = Math.floor(pot.amount / potWinners.length);
      const remainder = pot.amount % potWinners.length;

      potWinners
        .sort((a, b) => a.seat - b.seat)
        .forEach((winner, index) => {
          const amount = share + (index < remainder ? 1 : 0);
          winner.stack += amount;
          const hand = evaluations.get(winner.id) ?? bestHand;
          const existing = awards.get(winner.id);
          awards.set(winner.id, {
            playerId: winner.id,
            playerName: winner.name,
            amount: (existing?.amount ?? 0) + amount,
            hand
          });
        });
    }

    this.winners = [...awards.values()];
    for (const player of livePlayers) {
      const hand = evaluations.get(player.id);
      if (hand) {
        player.lastAction = hand.label;
      }
    }

    const summary = this.winners
      .map((winner) => `${winner.playerName} wins ${winner.amount} with ${winner.hand.label}`)
      .join("; ");
    this.log(`Showdown: ${summary}.`);
  }

  private awardUncontestedPot(winner: PlayerState): void {
    const amount = this.buildPots().reduce((total, pot) => total + pot.amount, 0);
    winner.stack += amount;
    this.winners = [
      {
        playerId: winner.id,
        playerName: winner.name,
        amount,
        hand: {
          category: "high-card",
          label: "Uncontested pot",
          ranks: [],
          cards: []
        }
      }
    ];
    this.street = "complete";
    this.activeSeatId = undefined;
    this.currentBet = 0;
    this.log(`${winner.name} wins ${amount} uncontested.`);
  }

  private legalActionsFor(player: PlayerState): LegalAction[] {
    if (this.street === "complete" || player.status !== "active") {
      return [];
    }

    const amountToCall = Math.max(0, this.currentBet - player.bet);
    const maxAmount = player.bet + player.stack;
    const actions: LegalAction[] = [];

    if (amountToCall > 0) {
      actions.push({ kind: "fold", label: "Fold", amountToCall });
      actions.push({
        kind: "call",
        label: player.stack <= amountToCall ? `Call all-in ${player.stack}` : `Call ${amountToCall}`,
        amountToCall
      });

      const minRaiseTo = this.currentBet + this.minRaise;
      if (maxAmount >= minRaiseTo) {
        actions.push({
          kind: "raise",
          label: `Raise to ${minRaiseTo}+`,
          amountToCall,
          minAmount: minRaiseTo,
          maxAmount
        });
      }
    } else {
      actions.push({ kind: "check", label: "Check", amountToCall });
      const minBet = Math.min(this.config.bigBlind, maxAmount);
      if (maxAmount > 0) {
        actions.push({
          kind: "bet",
          label: `Bet ${minBet}+`,
          amountToCall,
          minAmount: minBet,
          maxAmount
        });
      }
    }

    if (player.stack > 0) {
      actions.push({ kind: "all-in", label: `All-in ${maxAmount}`, amountToCall, minAmount: maxAmount, maxAmount });
    }

    return actions;
  }

  private runAiUntilHumanOrComplete(): void {
    let safety = 200;
    while (safety > 0 && this.street !== "complete") {
      safety -= 1;
      const player = this.players.find((candidate) => candidate.id === this.activeSeatId);
      if (!player || player.isHuman) {
        return;
      }
      this.applyAction(player, this.chooseAiAction(player));
    }

    if (safety === 0) {
      throw new Error("AI action loop exceeded safety limit.");
    }
  }

  private chooseAiAction(player: PlayerState): PlayerActionRequest {
    const legalActions = this.legalActionsFor(player);
    const strength = this.estimateStrength(player);
    const pressure = this.currentBet > 0 ? Math.max(0, this.currentBet - player.bet) / Math.max(1, player.stack + player.bet) : 0;
    const aggression = this.config.aiDifficulty === "loose" ? 0.18 : this.config.aiDifficulty === "tight" ? -0.14 : 0;
    const willingness = strength + aggression - pressure * 0.7 + (Math.random() - 0.5) * 0.18;
    const raiseAction = legalActions.find((action) => action.kind === "raise");
    const betAction = legalActions.find((action) => action.kind === "bet");
    const callAction = legalActions.find((action) => action.kind === "call");
    const checkAction = legalActions.find((action) => action.kind === "check");
    const foldAction = legalActions.find((action) => action.kind === "fold");
    const allInAction = legalActions.find((action) => action.kind === "all-in");

    if (allInAction && strength > 0.9 && Math.random() < 0.25) {
      return { kind: "all-in" };
    }

    if (raiseAction && willingness > 0.68) {
      return { kind: "raise", amount: this.pickAggressiveAmount(raiseAction, strength) };
    }

    if (betAction && willingness > 0.58) {
      return { kind: "bet", amount: this.pickAggressiveAmount(betAction, strength) };
    }

    if (callAction && willingness > 0.28) {
      return { kind: "call" };
    }

    if (checkAction) {
      return { kind: "check" };
    }

    if (foldAction && willingness < 0.22) {
      return { kind: "fold" };
    }

    return callAction ? { kind: "call" } : { kind: "fold" };
  }

  private estimateStrength(player: PlayerState): number {
    if (this.communityCards.length >= 3) {
      const evaluation = evaluateBestHand([...player.holeCards, ...this.communityCards]);
      const madeHandScore =
        {
          "high-card": 0.18,
          pair: 0.38,
          "two-pair": 0.56,
          "three-of-a-kind": 0.68,
          straight: 0.78,
          flush: 0.82,
          "full-house": 0.9,
          "four-of-a-kind": 0.96,
          "straight-flush": 1
        }[evaluation.category] ?? 0.2;
      return Math.min(1, madeHandScore + Math.min(0.12, evaluation.ranks[0] / 120));
    }

    const [first, second] = player.holeCards;
    const high = Math.max(rankValues[first.rank], rankValues[second.rank]);
    const low = Math.min(rankValues[first.rank], rankValues[second.rank]);
    const pair = first.rank === second.rank;
    const suited = first.suit === second.suit;
    const connected = Math.abs(high - low) <= 1;
    const gapPenalty = Math.min(0.2, Math.max(0, Math.abs(high - low) - 1) * 0.035);
    return Math.max(0.08, Math.min(1, high / 18 + (pair ? 0.34 : 0) + (suited ? 0.08 : 0) + (connected ? 0.05 : 0) - gapPenalty));
  }

  private pickAggressiveAmount(action: LegalAction, strength: number): number {
    const min = action.minAmount ?? 0;
    const max = action.maxAmount ?? min;
    const pot = Math.max(this.config.bigBlind, this.buildPots().reduce((total, current) => total + current.amount, 0));
    const target = Math.round(Math.min(max, Math.max(min, this.currentBet + pot * (0.45 + strength * 0.55))));
    return target;
  }

  private isBettingRoundComplete(): boolean {
    const livePlayers = this.players.filter((player) => player.status !== "folded" && player.status !== "out");
    if (livePlayers.length <= 1) {
      return true;
    }

    return livePlayers
      .filter((player) => player.status === "active")
      .every((player) => player.acted && player.bet === this.currentBet);
  }

  private advanceToNextActor(startIndex: number): void {
    const nextPlayer = this.nextPlayerNeedingAction(startIndex);
    this.activeSeatId = nextPlayer?.id;
    if (!nextPlayer && this.street !== "complete") {
      this.advanceStreet();
    }
  }

  private nextPlayerNeedingAction(startIndex: number): PlayerState | undefined {
    for (let offset = 0; offset < this.players.length; offset += 1) {
      const player = this.players[(startIndex + offset) % this.players.length];
      if (player.status === "active" && (!player.acted || player.bet < this.currentBet)) {
        return player;
      }
    }
    return undefined;
  }

  private resetStreetBets(): void {
    for (const player of this.players) {
      player.bet = 0;
      if (player.status === "active") {
        player.acted = false;
      }
    }
    this.currentBet = 0;
    this.minRaise = this.config.bigBlind;
  }

  private reopenActionForOpponents(aggressor: PlayerState): void {
    for (const player of this.players) {
      if (player.status === "active" && player.id !== aggressor.id) {
        player.acted = false;
      }
    }
  }

  private buildPots(): Pot[] {
    const levels = [...new Set(this.players.map((player) => player.totalCommitted).filter((amount) => amount > 0))].sort((a, b) => a - b);
    const pots: Pot[] = [];
    let previousLevel = 0;

    for (const level of levels) {
      const contributors = this.players.filter((player) => player.totalCommitted >= level);
      const amount = (level - previousLevel) * contributors.length;
      if (amount > 0) {
        pots.push({
          amount,
          eligibleSeatIds: contributors.filter((player) => player.status !== "folded" && player.status !== "out").map((player) => player.id)
        });
      }
      previousLevel = level;
    }

    return pots;
  }

  private postBlinds(): void {
    const activeCount = this.players.filter((player) => player.status === "active").length;
    const smallBlindIndex = activeCount === 2 ? this.dealerIndex : this.nextActiveIndex(this.dealerIndex);
    const bigBlindIndex = this.nextActiveIndex(smallBlindIndex);
    const smallBlind = this.players[smallBlindIndex];
    const bigBlind = this.players[bigBlindIndex];

    const smallBlindPaid = this.commitChips(smallBlind, this.config.smallBlind);
    smallBlind.lastAction = `Small blind ${smallBlindPaid}`;
    this.log(`${smallBlind.name} posts the small blind (${smallBlindPaid}).`);

    const bigBlindPaid = this.commitChips(bigBlind, this.config.bigBlind);
    bigBlind.lastAction = `Big blind ${bigBlindPaid}`;
    this.currentBet = Math.max(this.currentBet, bigBlind.bet);
    this.log(`${bigBlind.name} posts the big blind (${bigBlindPaid}).`);

    for (const player of this.players) {
      player.acted = false;
    }
  }

  private preflopFirstActionIndex(): number {
    const activeCount = this.players.filter((player) => player.status !== "out").length;
    if (activeCount === 2) {
      return this.dealerIndex;
    }

    const smallBlindIndex = this.nextActiveIndex(this.dealerIndex);
    const bigBlindIndex = this.nextActiveIndex(smallBlindIndex);
    return bigBlindIndex + 1;
  }

  private dealHoleCards(): void {
    for (let round = 0; round < 2; round += 1) {
      for (let offset = 0; offset < this.players.length; offset += 1) {
        const player = this.players[(this.dealerIndex + 1 + offset) % this.players.length];
        if (player.status === "active") {
          player.holeCards.push(this.draw());
        }
      }
    }
  }

  private dealRemainingBoardAndShowdown(): void {
    while (this.communityCards.length < 5) {
      this.burnCard();
      const cardsToDeal = this.communityCards.length === 0 ? 3 : 1;
      for (let index = 0; index < cardsToDeal && this.communityCards.length < 5; index += 1) {
        this.communityCards.push(this.draw());
      }
    }
    this.log(`Board runs out: ${this.formatCards(this.communityCards)}.`);
    this.showdown();
  }

  private commitChips(player: PlayerState, requestedAmount: number): number {
    const amount = Math.max(0, Math.min(player.stack, requestedAmount));
    player.stack -= amount;
    player.bet += amount;
    player.totalCommitted += amount;
    if (player.stack === 0 && player.status === "active") {
      player.status = "all-in";
    }
    return amount;
  }

  private draw(): Card {
    const card = this.deck.pop();
    if (!card) {
      throw new Error("The deck is empty.");
    }
    return card;
  }

  private burnCard(): void {
    this.draw();
  }

  private nextFundedIndex(startIndex: number): number {
    for (let offset = 1; offset <= this.players.length; offset += 1) {
      const index = (startIndex + offset + this.players.length) % this.players.length;
      if (this.players[index].stack > 0) {
        return index;
      }
    }
    return 0;
  }

  private nextActiveIndex(startIndex: number): number {
    for (let offset = 1; offset <= this.players.length; offset += 1) {
      const index = (startIndex + offset + this.players.length) % this.players.length;
      if (this.players[index].status === "active") {
        return index;
      }
    }
    throw new Error("No active player found.");
  }

  private ensurePlayableStacks(): void {
    if (this.players.filter((player) => player.stack > 0).length >= 2) {
      return;
    }

    for (const player of this.players) {
      player.stack = this.config.startingStack;
    }
    this.log("All players rebuy to keep the simulation running.");
  }

  private formatCards(cards: Card[]): string {
    return cards.map((card) => `${card.rank}${card.suit[0].toUpperCase()}`).join(" ");
  }

  private log(message: string): void {
    this.actionLog.push({ id: ++this.logId, handNumber: this.handNumber, message });
  }
}

function normalizeConfig(request: NewGameRequest): GameConfig {
  const playerCount = clampInteger(request.playerCount ?? defaultConfig.playerCount, 2, 9);
  const smallBlind = clampInteger(request.smallBlind ?? defaultConfig.smallBlind, 1, 1_000);
  const bigBlind = Math.max(smallBlind * 2, clampInteger(request.bigBlind ?? defaultConfig.bigBlind, smallBlind + 1, 2_000));

  return {
    playerCount,
    startingStack: clampInteger(request.startingStack ?? defaultConfig.startingStack, bigBlind * 10, 1_000_000),
    smallBlind,
    bigBlind,
    humanSeat: defaultConfig.humanSeat,
    aiDifficulty: request.aiDifficulty ?? defaultConfig.aiDifficulty
  };
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(Number.isFinite(value) ? value : min)));
}

function clampAmount(value: number | undefined, min = 0, max = min): number {
  if (value === undefined) {
    throw new Error("This action requires an amount.");
  }
  const amount = Math.floor(value);
  if (!Number.isFinite(amount) || amount < min || amount > max) {
    throw new Error(`Amount must be between ${min} and ${max}.`);
  }
  return amount;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled action: ${value}`);
}
