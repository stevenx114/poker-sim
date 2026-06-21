import { describe, expect, it } from "vitest";
import type { Card, Rank, Suit } from "../../shared/types";
import { compareHands, evaluateBestHand } from "./evaluator";

describe("evaluateBestHand", () => {
  it("recognizes an ace-low wheel straight", () => {
    const hand = evaluateBestHand([c("AS"), c("2D"), c("3C"), c("4H"), c("5S"), c("KD"), c("9C")]);

    expect(hand.category).toBe("straight");
    expect(hand.ranks).toEqual([5]);
  });

  it("uses kickers to compare equal pair categories", () => {
    const aceKicker = evaluateBestHand([c("AH"), c("AD"), c("KC"), c("9S"), c("7D"), c("4C"), c("2H")]);
    const queenKicker = evaluateBestHand([c("AS"), c("AC"), c("QD"), c("9H"), c("7C"), c("4S"), c("2D")]);

    expect(compareHands(aceKicker, queenKicker)).toBeGreaterThan(0);
  });

  it("chooses the best full house from multiple trips and pairs", () => {
    const hand = evaluateBestHand([c("KH"), c("KD"), c("KC"), c("QS"), c("QD"), c("QH"), c("2D")]);

    expect(hand.category).toBe("full-house");
    expect(hand.ranks).toEqual([13, 12]);
  });

  it("ranks a flush by all five cards", () => {
    const kingHighFlush = evaluateBestHand([c("KS"), c("JS"), c("9S"), c("7S"), c("3S"), c("AD"), c("AC")]);
    const queenHighFlush = evaluateBestHand([c("QS"), c("JS"), c("9S"), c("7S"), c("3S"), c("KD"), c("KC")]);

    expect(compareHands(kingHighFlush, queenHighFlush)).toBeGreaterThan(0);
  });

  it("ranks a straight flush above four of a kind", () => {
    const straightFlush = evaluateBestHand([c("9H"), c("8H"), c("7H"), c("6H"), c("5H"), c("AD"), c("2C")]);
    const quads = evaluateBestHand([c("AS"), c("AH"), c("AD"), c("AC"), c("KH"), c("2D"), c("3C")]);

    expect(compareHands(straightFlush, quads)).toBeGreaterThan(0);
  });
});

function c(value: string): Card {
  const rank = value[0] as Rank;
  const suitLookup: Record<string, Suit> = {
    S: "spades",
    H: "hearts",
    D: "diamonds",
    C: "clubs"
  };
  return { rank, suit: suitLookup[value[1]] };
}
