import type { Card, HandEvaluation } from "../../shared/types.js";
import { pluralRankName, rankName, rankValues } from "./cards.js";

const categoryStrength: Record<HandEvaluation["category"], number> = {
  "high-card": 0,
  pair: 1,
  "two-pair": 2,
  "three-of-a-kind": 3,
  straight: 4,
  flush: 5,
  "full-house": 6,
  "four-of-a-kind": 7,
  "straight-flush": 8
};

export function compareHands(a: HandEvaluation, b: HandEvaluation): number {
  const categoryDelta = categoryStrength[a.category] - categoryStrength[b.category];
  if (categoryDelta !== 0) {
    return categoryDelta;
  }

  const longest = Math.max(a.ranks.length, b.ranks.length);
  for (let index = 0; index < longest; index += 1) {
    const delta = (a.ranks[index] ?? 0) - (b.ranks[index] ?? 0);
    if (delta !== 0) {
      return delta;
    }
  }

  return 0;
}

export function evaluateBestHand(cards: Card[]): HandEvaluation {
  if (cards.length < 5 || cards.length > 7) {
    throw new Error("Texas Hold'em hand evaluation requires between five and seven cards.");
  }

  const combinations = chooseFive(cards);
  const [first, ...rest] = combinations.map(evaluateFiveCards);
  return rest.reduce((best, current) => (compareHands(current, best) > 0 ? current : best), first);
}

function chooseFive(cards: Card[]): Card[][] {
  const results: Card[][] = [];

  function walk(start: number, hand: Card[]): void {
    if (hand.length === 5) {
      results.push([...hand]);
      return;
    }

    for (let index = start; index <= cards.length - (5 - hand.length); index += 1) {
      hand.push(cards[index]);
      walk(index + 1, hand);
      hand.pop();
    }
  }

  walk(0, []);
  return results;
}

function evaluateFiveCards(cards: Card[]): HandEvaluation {
  const values = cards.map((card) => rankValues[card.rank]).sort((a, b) => b - a);
  const counts = [...countRanks(values).entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || b.value - a.value);
  const flush = cards.every((card) => card.suit === cards[0].suit);
  const straightHigh = findStraightHigh(values);
  const sortedCards = [...cards].sort((a, b) => rankValues[b.rank] - rankValues[a.rank]);

  if (flush && straightHigh !== undefined) {
    return {
      category: "straight-flush",
      label: `${rankName(straightHigh)}-high straight flush`,
      ranks: [straightHigh],
      cards: sortedCards
    };
  }

  if (counts[0].count === 4) {
    const kicker = counts.find((entry) => entry.count === 1)?.value ?? 0;
    return {
      category: "four-of-a-kind",
      label: `Four of a kind, ${pluralRankName(counts[0].value)}`,
      ranks: [counts[0].value, kicker],
      cards: sortedCards
    };
  }

  if (counts[0].count === 3 && counts[1]?.count === 2) {
    return {
      category: "full-house",
      label: `${pluralRankName(counts[0].value)} full of ${pluralRankName(counts[1].value)}`,
      ranks: [counts[0].value, counts[1].value],
      cards: sortedCards
    };
  }

  if (flush) {
    return {
      category: "flush",
      label: `${rankName(values[0])}-high flush`,
      ranks: values,
      cards: sortedCards
    };
  }

  if (straightHigh !== undefined) {
    return {
      category: "straight",
      label: `${rankName(straightHigh)}-high straight`,
      ranks: [straightHigh],
      cards: sortedCards
    };
  }

  if (counts[0].count === 3) {
    const kickers = counts.filter((entry) => entry.count === 1).map((entry) => entry.value);
    return {
      category: "three-of-a-kind",
      label: `Three of a kind, ${pluralRankName(counts[0].value)}`,
      ranks: [counts[0].value, ...kickers],
      cards: sortedCards
    };
  }

  if (counts[0].count === 2 && counts[1]?.count === 2) {
    const pairs = counts.filter((entry) => entry.count === 2).map((entry) => entry.value);
    const kicker = counts.find((entry) => entry.count === 1)?.value ?? 0;
    return {
      category: "two-pair",
      label: `Two pair, ${pluralRankName(pairs[0])} and ${pluralRankName(pairs[1])}`,
      ranks: [...pairs, kicker],
      cards: sortedCards
    };
  }

  if (counts[0].count === 2) {
    const kickers = counts.filter((entry) => entry.count === 1).map((entry) => entry.value);
    return {
      category: "pair",
      label: `Pair of ${pluralRankName(counts[0].value)}`,
      ranks: [counts[0].value, ...kickers],
      cards: sortedCards
    };
  }

  return {
    category: "high-card",
    label: `${rankName(values[0])} high`,
    ranks: values,
    cards: sortedCards
  };
}

function countRanks(values: number[]): Map<number, number> {
  return values.reduce((counts, value) => counts.set(value, (counts.get(value) ?? 0) + 1), new Map<number, number>());
}

function findStraightHigh(values: number[]): number | undefined {
  const unique = [...new Set(values)].sort((a, b) => b - a);
  if (unique.includes(14)) {
    unique.push(1);
  }

  for (let index = 0; index <= unique.length - 5; index += 1) {
    const run = unique.slice(index, index + 5);
    if (run.every((value, runIndex) => runIndex === 0 || value === run[runIndex - 1] - 1)) {
      return run[0] === 1 ? 5 : run[0];
    }
  }

  return undefined;
}
