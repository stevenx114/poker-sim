import type { Card, Rank, Suit } from "../../shared/types.js";

export const suits: Suit[] = ["spades", "hearts", "diamonds", "clubs"];
export const ranks: Rank[] = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];

export const rankValues: Record<Rank, number> = {
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  T: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14
};

const rankNames: Record<Rank, string> = {
  "2": "Two",
  "3": "Three",
  "4": "Four",
  "5": "Five",
  "6": "Six",
  "7": "Seven",
  "8": "Eight",
  "9": "Nine",
  T: "Ten",
  J: "Jack",
  Q: "Queen",
  K: "King",
  A: "Ace"
};

export function createDeck(): Card[] {
  return suits.flatMap((suit) => ranks.map((rank) => ({ rank, suit })));
}

export function shuffle(deck: Card[]): Card[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function cardLabel(card: Card): string {
  return `${card.rank}${card.suit[0].toUpperCase()}`;
}

export function rankName(value: number): string {
  const rank = (Object.entries(rankValues).find(([, rankValue]) => rankValue === value)?.[0] ?? "A") as Rank;
  return rankNames[rank];
}

export function pluralRankName(value: number): string {
  const name = rankName(value);
  return name.endsWith("Six") ? "Sixes" : `${name}s`;
}
