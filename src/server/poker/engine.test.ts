import { describe, expect, it } from "vitest";
import { PokerGame } from "./engine";

describe("PokerGame client state", () => {
  it("keeps opponent hole cards hidden during an active hand", () => {
    const game = new PokerGame({ playerCount: 2 });
    const state = game.getState();
    const hero = state.players.find((player) => player.isHuman);
    const opponents = state.players.filter((player) => !player.isHuman);

    expect(state.street).not.toBe("complete");
    expect(hero?.holeCards).toHaveLength(2);
    expect(opponents).toHaveLength(1);
    expect(opponents[0].holeCards).toHaveLength(0);
  });
});
