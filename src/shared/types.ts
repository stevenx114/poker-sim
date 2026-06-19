export type Suit = "spades" | "hearts" | "diamonds" | "clubs";
export type Rank =
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "T"
  | "J"
  | "Q"
  | "K"
  | "A";

export interface Card {
  rank: Rank;
  suit: Suit;
}

export type Street = "preflop" | "flop" | "turn" | "river" | "showdown" | "complete";

export type PlayerStatus = "active" | "folded" | "all-in" | "out";

export type ActionKind = "fold" | "check" | "call" | "bet" | "raise" | "all-in";

export interface PlayerState {
  id: string;
  name: string;
  seat: number;
  isHuman: boolean;
  isDealer: boolean;
  status: PlayerStatus;
  stack: number;
  bet: number;
  totalCommitted: number;
  acted: boolean;
  lastAction?: string;
  holeCards: Card[];
}

export interface GameConfig {
  playerCount: number;
  startingStack: number;
  smallBlind: number;
  bigBlind: number;
  humanSeat: number;
  aiDifficulty: "balanced" | "loose" | "tight";
}

export interface LegalAction {
  kind: ActionKind;
  label: string;
  amountToCall: number;
  minAmount?: number;
  maxAmount?: number;
}

export interface Pot {
  amount: number;
  eligibleSeatIds: string[];
}

export interface HandEvaluation {
  category:
    | "high-card"
    | "pair"
    | "two-pair"
    | "three-of-a-kind"
    | "straight"
    | "flush"
    | "full-house"
    | "four-of-a-kind"
    | "straight-flush";
  label: string;
  ranks: number[];
  cards: Card[];
}

export interface Winner {
  playerId: string;
  playerName: string;
  amount: number;
  hand: HandEvaluation;
}

export interface ActionLogEntry {
  id: number;
  handNumber: number;
  message: string;
}

export interface GameState {
  id: string;
  config: GameConfig;
  handNumber: number;
  dealerSeatId: string;
  activeSeatId?: string;
  street: Street;
  players: PlayerState[];
  communityCards: Card[];
  deckRemaining: number;
  currentBet: number;
  minRaise: number;
  pots: Pot[];
  totalPot: number;
  legalActions: LegalAction[];
  winners: Winner[];
  actionLog: ActionLogEntry[];
}

export interface NewGameRequest {
  playerCount?: number;
  startingStack?: number;
  smallBlind?: number;
  bigBlind?: number;
  aiDifficulty?: GameConfig["aiDifficulty"];
}

export interface PlayerActionRequest {
  kind: ActionKind;
  amount?: number;
}
