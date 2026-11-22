import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ANIMALS,
  applyGameAction,
  calculateResults,
  createInitialGame,
  GameRuleError,
  markGameDisconnected,
  markGameForfeited,
  markGameReconnected,
  publicGameState,
  type GameAction,
  type GameState,
} from "./game-engine.js";

const players = [
  {
    id: "p1",
    nickname: "One",
    avatar: "HORSE",
    joinOrder: 1,
    status: "CONNECTED" as const,
  },
  {
    id: "p2",
    nickname: "Two",
    avatar: "COW",
    joinOrder: 2,
    status: "CONNECTED" as const,
  },
  {
    id: "p3",
    nickname: "Three",
    avatar: "PIG",
    joinOrder: 3,
    status: "CONNECTED" as const,
  },
];
const state = (at = 1_000) => {
  const game = createInitialGame(players, at);
  game.animals.sort(
    (a, b) => ANIMALS.indexOf(a.type) - ANIMALS.indexOf(b.type),
  );
  return game;
};
function run(
  current: GameState,
  actor: string,
  action: GameAction,
  at = 1_000,
) {
  return applyGameAction(current, actor, action, at);
}
function offerIds(
  current: GameState,
  playerId: string,
  total: number,
): string[] {
  const card = current.money.find(
    (item) => item.ownerId === playerId && item.value >= total,
  );
  if (card) return [card.id];
  const cards = current.money.filter((item) => item.ownerId === playerId);
  let sum = 0;
  const ids: string[] = [];
  for (const item of cards) {
    ids.push(item.id);
    sum += item.value;
    if (sum >= total) break;
  }
  return ids;
}
function assertCode(code: string, action: () => unknown) {
  assert.throws(
    action,
    (error: unknown) => error instanceof GameRuleError && error.code === code,
  );
}
function tradeFixture(firstCount: 1 | 2 = 1) {
  const game = state();
  const challenger = game.players[0]!.id;
  const target = game.players[1]!.id;
  const collector = game.players[2]!.id;
  let horses = 0;
  for (const card of game.animals) {
    if (card.type !== "HORSE") card.ownerId = collector;
    else {
      card.ownerId = horses++ < firstCount ? challenger : target;
    }
  }
  game.phase = "TURN";
  game.currentPlayerId = challenger;
  return { game, challenger, target, collector };
}

describe("server-authoritative game rules", () => {
  it("creates the classic 40-animal and 55-money deck with 90 starting money", () => {
    const game = state();
    assert.equal(game.animals.length, 40);
    assert.equal(game.money.length, 55);
    assert.equal(new Set(game.animals.map((card) => card.type)).size, 10);
    assert.equal(ANIMALS.length, 10);
    for (const player of players) {
      const hand = game.money.filter((card) => card.ownerId === player.id);
      assert.equal(hand.length, 7);
      assert.equal(
        hand.reduce((sum, card) => sum + card.value, 0),
        90,
      );
    }
    assert.ok(players.some((player) => player.id === game.firstPlayerId));
  });

  it("sets up a five-player match with unique cards and correct starting hands", () => {
    const fivePlayers = [
      ...players,
      {
        id: "p4",
        nickname: "Four",
        avatar: "DOG",
        joinOrder: 4,
        status: "CONNECTED" as const,
      },
      {
        id: "p5",
        nickname: "Five",
        avatar: "CAT",
        joinOrder: 5,
        status: "CONNECTED" as const,
      },
    ];
    const game = createInitialGame(fivePlayers, 1_000);
    assert.equal(game.players.length, 5);
    assert.equal(game.animals.length, 40);
    assert.equal(new Set(game.animals.map((card) => card.id)).size, 40);
    assert.equal(new Set(game.money.map((card) => card.id)).size, 55);
    for (const player of fivePlayers) {
      const hand = game.money.filter((card) => card.ownerId === player.id);
      assert.equal(hand.length, 7);
      assert.equal(
        hand.reduce((sum, card) => sum + card.value, 0),
        90,
      );
    }
  });

  it("shares victory when players tie under the official scoring formula", () => {
    const game = state();
    for (const animal of ANIMALS) {
      const cards = game.animals.filter((card) => card.type === animal);
      cards[0]!.ownerId = "p1";
      cards[1]!.ownerId = "p2";
      cards[2]!.ownerId = "p3";
      cards[3]!.ownerId = "p3";
    }
    const results = calculateResults(game);
    assert.deepEqual(
      results
        .filter((result) => result.isWinner)
        .map((result) => result.playerId),
      ["p1", "p2", "p3"],
    );
    assert.ok(results.every((result) => result.score === 0));
  });

  it("rejects the auctioneer and applies opening bids and ten-unit increases", () => {
    const game = state();
    let current = run(game, game.currentPlayerId!, {
      type: "startAuction",
    }).state;
    assertCode("AUCTIONEER_CANNOT_BID", () =>
      run(current, game.currentPlayerId!, { type: "bid", amount: 5 }),
    );
    const bidder = players.find(
      (player) => player.id !== game.currentPlayerId,
    )!.id;
    current = run(current, bidder, { type: "bid", amount: 1 }).state;
    assertCode("BID_INCREMENT_TOO_LOW", () =>
      run(
        current,
        players.find(
          (player) =>
            player.id !== bidder && player.id !== game.currentPlayerId,
        )!.id,
        { type: "bid", amount: 10 },
      ),
    );
    const nextBidder = players.find(
      (player) => player.id !== bidder && player.id !== game.currentPlayerId,
    )!.id;
    const raised = run(
      current,
      nextBidder,
      { type: "bid", amount: 11 },
      2_000,
    ).state;
    assert.equal(raised.auction?.highBid, 11);
    assert.equal(raised.auction?.deadlineAt, 17_000);
  });

  it("gives an unbid animal to the auctioneer when the auction expires", () => {
    let game = state();
    const auctioneer = game.currentPlayerId!;
    const animalId = game.animals[0]!.id;
    game = run(game, auctioneer, { type: "startAuction" }, 2_000).state;
    const result = run(
      game,
      auctioneer,
      { type: "timer", timer: "AUCTION" },
      17_000,
    );
    assert.equal(
      result.state.animals.find((card) => card.id === animalId)?.ownerId,
      auctioneer,
    );
    assert.equal(
      result.state.animals.find((card) => card.id === animalId)
        ?.acquisitionSource,
      "AUCTION",
    );
    assert.equal(result.state.phase, "TURN");
  });

  it("accepts a valid low opening bid and pays with overpayment without change", () => {
    let game = state();
    const auctioneer = game.currentPlayerId!;
    const bidder = players.find((player) => player.id !== auctioneer)!.id;
    game = run(game, auctioneer, { type: "startAuction" }, 1_000).state;
    game = run(game, bidder, { type: "bid", amount: 5 }, 2_000).state;
    game = run(game, bidder, { type: "timer", timer: "AUCTION" }, 17_000).state;
    game = run(
      game,
      auctioneer,
      { type: "chooseAuctioneer", choice: "PASS" },
      17_001,
    ).state;
    const ids = offerIds(game, bidder, 5);
    const result = run(
      game,
      bidder,
      { type: "confirmPayment", moneyCardIds: ids },
      17_002,
    );
    assert.equal(
      result.events.find((event) => event.type === "PAYMENT_SUCCEEDED")?.amount,
      10,
    );
    assert.equal(
      result.state.money
        .filter((card) => card.ownerId === auctioneer)
        .reduce((sum, card) => sum + card.value, 0),
      100,
    );
  });

  it("supports the auctioneer first-purchase choice and transfers the payment to the bidder", () => {
    let game = state();
    const auctioneer = game.currentPlayerId!;
    const bidder = players.find((player) => player.id !== auctioneer)!.id;
    game = run(game, auctioneer, { type: "startAuction" }, 1_000).state;
    game = run(game, bidder, { type: "bid", amount: 5 }, 2_000).state;
    game = run(game, bidder, { type: "timer", timer: "AUCTION" }, 17_000).state;
    game = run(
      game,
      auctioneer,
      { type: "chooseAuctioneer", choice: "BUY" },
      17_001,
    ).state;
    const animalId = game.auction!.animalCardId;
    const result = run(
      game,
      auctioneer,
      { type: "confirmPayment", moneyCardIds: offerIds(game, auctioneer, 5) },
      17_002,
    );
    assert.equal(
      result.state.animals.find((card) => card.id === animalId)?.ownerId,
      auctioneer,
    );
    assert.equal(
      result.state.money
        .filter((card) => card.ownerId === bidder)
        .reduce((sum, card) => sum + card.value, 0),
      100,
    );
  });

  it("re-auctions after failed payment and reveals denominations in public state only", () => {
    let game = state();
    const auctioneer = game.currentPlayerId!;
    const bidder = players.find((player) => player.id !== auctioneer)!.id;
    game = run(game, auctioneer, { type: "startAuction" }, 1_000).state;
    game = run(game, bidder, { type: "bid", amount: 500 }, 2_000).state;
    game = run(game, bidder, { type: "timer", timer: "AUCTION" }, 17_000).state;
    game = run(
      game,
      auctioneer,
      { type: "chooseAuctioneer", choice: "PASS" },
      17_001,
    ).state;
    const timedOut = run(
      game,
      bidder,
      { type: "timer", timer: "PAYMENT" },
      47_000,
    );
    assert.equal(timedOut.state.phase, "AUCTION");
    assert.ok(timedOut.privateReveal);
    assert.deepEqual(
      publicGameState(timedOut.state, auctioneer).publicReveal?.denominations,
      timedOut.privateReveal?.denominations,
    );
    assert.equal(
      JSON.stringify(timedOut.events).includes("submittedMoneyDenominations"),
      false,
    );
  });

  it("distributes scheduled Donkey money to every player before its auction", () => {
    const game = state();
    const donkey = game.animals.find((card) => card.type === "DONKEY")!;
    game.animals = [
      donkey,
      ...game.animals.filter((card) => card.id !== donkey.id),
    ];
    const before = players.map(
      (player) =>
        game.money.filter((card) => card.ownerId === player.id).length,
    );
    const result = run(
      game,
      game.currentPlayerId!,
      { type: "startAuction" },
      1_000,
    );
    assert.equal(
      result.events.filter((event) => event.type === "DONKEY_DISTRIBUTION")
        .length,
      3,
    );
    players.forEach((player, index) =>
      assert.equal(
        result.state.money.filter((card) => card.ownerId === player.id).length,
        before[index]! + 1,
      ),
    );
  });

  it("accepts a Kuhhandel and completes a quartet without disclosing unsubmitted hands", () => {
    const game = state();
    const challenger = game.currentPlayerId!;
    const target = players.find((player) => player.id !== challenger)!.id;
    game.animals.forEach((card) => {
      card.ownerId =
        card.type === "HORSE"
          ? card.id === game.animals.find((c) => c.type === "HORSE")!.id
            ? challenger
            : target
          : players[2]!.id;
    });
    game.phase = "TURN";
    const result = run(game, challenger, {
      type: "initiateTrade",
      animalType: "HORSE",
      targetId: target,
      moneyCardIds: [],
    });
    const settled = run(
      result.state,
      target,
      {
        type: "respondTrade",
        response: "ACCEPT",
      },
      2_000,
    );
    assert.equal(
      settled.state.animals.filter(
        (card) => card.ownerId === challenger && card.type === "HORSE",
      ).length,
      2,
    );
    assert.equal(
      settled.events.some((event) => event.type === "QUARTET_COMPLETED"),
      false,
    );
    const tradedCard = settled.state.animals.find(
      (card) =>
        card.ownerId === challenger &&
        card.type === "HORSE" &&
        card.previousOwnerId === target,
    )!;
    assert.equal(tradedCard.previousOwnerId, target);
    assert.equal(tradedCard.acquiredAt, 2_000);
    assert.equal(tradedCard.acquisitionSource, "KUHHANDEL");
    assert.equal("ownMoney" in publicGameState(settled.state, target), true);
  });

  it("rejects a completed quartet as a trade target", () => {
    const game = state();
    const challenger = game.currentPlayerId!;
    const target = players.find((player) => player.id !== challenger)!.id;
    game.animals.forEach((card) => {
      card.ownerId = card.type === "HORSE" ? target : players[2]!.id;
    });
    game.phase = "TURN";
    assertCode("NO_ELIGIBLE_PLAYER", () =>
      run(game, challenger, {
        type: "initiateTrade",
        animalType: "HORSE",
        targetId: target,
        moneyCardIds: [],
      }),
    );
  });

  it("allows Kuhhandel before the animal pile is empty when a match exists", () => {
    const game = state();
    const challenger = game.currentPlayerId!;
    const target = players.find((player) => player.id !== challenger)!.id;
    const horses = game.animals.filter((card) => card.type === "HORSE");
    horses[0]!.ownerId = challenger;
    horses[1]!.ownerId = target;
    assert.equal(
      game.animals.some((card) => card.ownerId === null),
      true,
    );
    const result = run(game, challenger, {
      type: "initiateTrade",
      animalType: "HORSE",
      targetId: target,
      moneyCardIds: [],
    });
    assert.equal(result.state.phase, "NEGOTIATION");
    assert.equal(result.state.negotiation?.targetId, target);
  });

  it("uses a single-card Kuhhandel when a triple faces one matching card", () => {
    const game = state();
    const challenger = "p1";
    const target = "p2";
    for (const card of game.animals) {
      card.ownerId = card.type === "HORSE" ? challenger : "p3";
    }
    game.animals
      .filter((card) => card.type === "HORSE")
      .slice(3)
      .forEach((card) => (card.ownerId = target));
    game.phase = "TURN";
    game.currentPlayerId = challenger;
    const proposed = run(game, challenger, {
      type: "initiateTrade",
      animalType: "HORSE",
      targetId: target,
      moneyCardIds: [],
    });
    assert.equal(proposed.state.negotiation?.cardCount, 1);
    const accepted = run(proposed.state, target, {
      type: "respondTrade",
      response: "ACCEPT",
    });
    assert.equal(
      accepted.state.animals.filter(
        (card) => card.ownerId === challenger && card.type === "HORSE",
      ).length,
      4,
    );
  });

  it("skips connected players with no legal trade after the animal deck empties", () => {
    const game = state();
    const challenger = "p2";
    const target = "p1";
    for (const card of game.animals) {
      card.ownerId = card.type === "HORSE" ? target : "p3";
    }
    game.animals
      .filter((card) => card.type === "HORSE")
      .slice(1)
      .forEach((card) => (card.ownerId = challenger));
    game.phase = "TURN";
    game.currentPlayerId = challenger;
    const offer = run(game, challenger, {
      type: "initiateTrade",
      animalType: "HORSE",
      targetId: target,
      moneyCardIds: [],
    });
    const settled = run(
      offer.state,
      target,
      { type: "timer", timer: "NEGOTIATION" },
      offer.state.negotiation!.deadlineAt,
    );
    assert.equal(settled.state.currentPlayerId, target);
    assert.equal(settled.state.phase, "TURN");
  });

  it("resolves counteroffers by value, exchanges submitted money, and lets the winner take the pair", () => {
    const { game, challenger, target } = tradeFixture(2);
    const initialOffer = game.money.find(
      (card) => card.ownerId === challenger && card.value === 10,
    )!;
    const counterOffer = game.money.find(
      (card) => card.ownerId === target && card.value === 50,
    )!;
    const proposed = run(game, challenger, {
      type: "initiateTrade",
      animalType: "HORSE",
      targetId: target,
      moneyCardIds: [initialOffer.id],
    });
    const settled = run(proposed.state, target, {
      type: "respondTrade",
      response: "COUNTER",
      moneyCardIds: [counterOffer.id],
    });
    assert.equal(
      settled.state.animals.filter(
        (card) => card.ownerId === target && card.type === "HORSE",
      ).length,
      4,
    );
    assert.equal(
      settled.state.money.find((card) => card.id === initialOffer.id)?.ownerId,
      target,
    );
    assert.equal(
      settled.state.money.find((card) => card.id === counterOffer.id)?.ownerId,
      challenger,
    );
    assert.equal(
      settled.state.results.some(
        (result) => result.playerId === target && result.quartetCount === 1,
      ),
      true,
    );
    assert.equal(settled.state.endReason, "ALL_QUARTETS_COMPLETE");
    assert.equal(
      settled.events.some((event) => event.type === "QUARTET_COMPLETED"),
      true,
    );
  });

  it("awards equal counteroffers to the original challenger and allows empty offers", () => {
    const { game, challenger, target } = tradeFixture();
    const proposed = run(game, challenger, {
      type: "initiateTrade",
      animalType: "HORSE",
      targetId: target,
      moneyCardIds: [],
    });
    const settled = run(proposed.state, target, {
      type: "respondTrade",
      response: "COUNTER",
      moneyCardIds: [],
    });
    assert.equal(
      settled.state.animals.filter(
        (card) => card.ownerId === challenger && card.type === "HORSE",
      ).length,
      2,
    );
    assert.equal(
      settled.events.find((event) => event.type === "KUHHANDEL_RESOLVED")
        ?.outcomeCode,
      "TIE_CHALLENGER_WINS",
    );
  });

  it("accepts a bid exactly at the deadline and rejects one after it", () => {
    const initial = state();
    const auctioneer = initial.currentPlayerId!;
    const bidder = players.find((player) => player.id !== auctioneer)!.id;
    const game = run(
      initial,
      auctioneer,
      { type: "startAuction" },
      1_000,
    ).state;
    const accepted = run(game, bidder, { type: "bid", amount: 1 }, 16_000);
    assert.equal(accepted.state.auction?.highBid, 1);
    assertCode("ACTION_EXPIRED", () =>
      run(game, bidder, { type: "bid", amount: 1 }, 16_001),
    );
  });

  it("keeps other players' money private in public projections", () => {
    const game = state();
    const view = publicGameState(game, players[0]!.id);
    assert.equal(view.ownMoney.length, 7);
    assert.equal("money" in view, false);
    assert.equal("joinOrder" in view.players[0]!, false);
    assert.equal("reconnectExpiresAt" in view.players[0]!, false);
  });

  it("pauses and resumes the auctioneer choice timer across disconnection", () => {
    const initial = state();
    const auctioneer = initial.currentPlayerId!;
    const bidder = players.find((player) => player.id !== auctioneer)!.id;
    let current = run(
      initial,
      auctioneer,
      { type: "startAuction" },
      1_000,
    ).state;
    current = run(current, bidder, { type: "bid", amount: 10 }, 2_000).state;
    current = run(
      current,
      bidder,
      { type: "timer", timer: "AUCTION" },
      17_001,
    ).state;
    const disconnected = markGameDisconnected(
      current,
      auctioneer,
      20_000,
    ).state;
    assert.equal(disconnected.auction?.choicePausedRemainingMs, 12_001);
    const reconnected = markGameReconnected(
      disconnected,
      auctioneer,
      40_000,
    ).state;
    assert.equal(reconnected.auction?.choiceDeadlineAt, 52_001);
    assert.equal(reconnected.phase, "AUCTIONEER_CHOICE");
  });

  it("holds a forfeited high bidder during an unresolved auctioneer choice", () => {
    const initial = state();
    const auctioneer = initial.currentPlayerId!;
    const bidder = players.find((player) => player.id !== auctioneer)!.id;
    let current = run(
      initial,
      auctioneer,
      { type: "startAuction" },
      1_000,
    ).state;
    current = run(current, bidder, { type: "bid", amount: 10 }, 2_000).state;
    current = run(
      current,
      bidder,
      { type: "timer", timer: "AUCTION" },
      17_001,
    ).state;
    const disconnected = markGameDisconnected(current, bidder, 20_000).state;
    const result = markGameForfeited(disconnected, bidder, 80_001);
    assert.equal(result.state.phase, "RULE_DECISION_REQUIRED");
    assert.equal(
      result.state.auction?.ruleDecision,
      "HIGH_BIDDER_FORFEITED_DURING_AUCTIONEER_CHOICE",
    );
  });
});
