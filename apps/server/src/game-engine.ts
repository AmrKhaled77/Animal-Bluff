import { randomInt, randomUUID } from "node:crypto";

export const ANIMALS = [
  "HORSE",
  "COW",
  "PIG",
  "DONKEY",
  "GOAT",
  "SHEEP",
  "DOG",
  "CAT",
  "GOOSE",
  "ROOSTER",
] as const;
export type Animal = (typeof ANIMALS)[number];
export const ANIMAL_VALUES: Record<Animal, number> = {
  HORSE: 1000,
  COW: 800,
  PIG: 650,
  DONKEY: 500,
  GOAT: 350,
  SHEEP: 250,
  DOG: 160,
  CAT: 90,
  GOOSE: 40,
  ROOSTER: 10,
};
export type GamePhase =
  | "TURN"
  | "AUCTION"
  | "AUCTIONEER_CHOICE"
  | "PAYMENT"
  | "NEGOTIATION"
  | "COMPLETED"
  | "ENDED_NO_RESULT"
  | "RULE_DECISION_REQUIRED";
export type GamePlayer = {
  id: string;
  nickname: string;
  avatar: string;
  joinOrder: number;
  status: "CONNECTED" | "DISCONNECTED" | "FORFEITED";
  reconnectExpiresAt?: number | null;
};
export type AnimalCard = {
  id: string;
  type: Animal;
  ownerId: string | null;
  acquiredAt: number | null;
  previousOwnerId: string | null;
  acquisitionSource: "AUCTION" | "KUHHANDEL" | null;
};
export type MoneyCard = {
  id: string;
  value: 0 | 10 | 50 | 100 | 200 | 500;
  ownerId: string | null;
};
export type AuctionState = {
  animalCardId: string;
  auctioneerId: string;
  highBid: number;
  highBidderId: string | null;
  deadlineAt: number;
  paymentDeadlineAt: number | null;
  choiceDeadlineAt: number | null;
  payerId: string | null;
  payeeId: string | null;
  due: number;
  attempt: number;
  state: "BIDDING" | "CHOICE" | "PAYMENT" | "RULE_DECISION_REQUIRED";
  ruleDecision: string | null;
  choicePausedRemainingMs: number | null;
  paymentPausedRemainingMs: number | null;
};
export type NegotiationState = {
  challengerId: string;
  targetId: string;
  animalType: Animal;
  cardCount: 1 | 2;
  challengerAnimalIds: string[];
  targetAnimalIds: string[];
  firstOfferIds: string[];
  secondOfferIds: string[] | null;
  deadlineAt: number;
  pausedRemainingMs: number | null;
};
export type GameState = {
  version: number;
  phase: GamePhase;
  players: GamePlayer[];
  animals: AnimalCard[];
  money: MoneyCard[];
  currentPlayerId: string | null;
  firstPlayerId: string;
  auction: AuctionState | null;
  negotiation: NegotiationState | null;
  donkeyCount: number;
  startedAt: number;
  endedAt: number | null;
  endReason: string | null;
  results: Array<{
    playerId: string;
    quartetCount: number;
    quartetValueSum: number;
    score: number;
    isWinner: boolean;
  }>;
  publicReveal: { playerId: string; denominations: number[] } | null;
};
export type GameEvent = {
  type: string;
  actorId?: string;
  targetId?: string;
  animalType?: Animal;
  animalCardCount?: number;
  amount?: number;
  outcomeCode?: string;
  reasonCode?: string;
  submittedMoneyDenominations?: number[];
  submittedMoneyValue?: number;
};
export type GameAction =
  | { type: "startAuction" }
  | { type: "bid"; amount: number }
  | { type: "chooseAuctioneer"; choice: "BUY" | "PASS" }
  | { type: "confirmPayment"; moneyCardIds: string[] }
  | {
      type: "initiateTrade";
      animalType: Animal;
      targetId: string;
      moneyCardIds: string[];
    }
  | { type: "respondTrade"; response: "ACCEPT" }
  | { type: "respondTrade"; response: "COUNTER"; moneyCardIds: string[] }
  | { type: "timer"; timer: "AUCTION" | "CHOICE" | "PAYMENT" | "NEGOTIATION" };
export class GameRuleError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}
const moneyValues: MoneyCard["value"][] = [
  ...Array<0>(10).fill(0),
  ...Array<10>(20).fill(10),
  ...Array<50>(10).fill(50),
  ...Array<100>(5).fill(100),
  ...Array<200>(5).fill(200),
  ...Array<500>(5).fill(500),
];
const active = (player: GamePlayer) => player.status !== "FORFEITED";
const sumCards = (cards: MoneyCard[]) =>
  cards.reduce((total, card) => total + card.value, 0);
function nextPlayer(state: GameState, afterId: string): string | null {
  const seats = state.players.filter(active);
  if (!seats.length) return null;
  const current = seats.findIndex((player) => player.id === afterId);
  const deckEmpty = state.animals.every((card) => card.ownerId !== null);
  for (let offset = 1; offset <= seats.length; offset++) {
    const candidate = seats[(current + offset) % seats.length]!;
    if (!deckEmpty || candidate.status === "DISCONNECTED") return candidate.id;
    const hasTrade = state.players.some(
      (target) =>
        target.id !== candidate.id &&
        target.status === "CONNECTED" &&
        active(target) &&
        ANIMALS.some((animal) => {
          const own = state.animals.filter(
            (card) => card.ownerId === candidate.id && card.type === animal,
          ).length;
          const other = state.animals.filter(
            (card) => card.ownerId === target.id && card.type === animal,
          ).length;
          return own > 0 && other > 0 && own < 4 && other < 4;
        }),
    );
    if (hasTrade) return candidate.id;
  }
  return null;
}
function complete(
  state: GameState,
  endReason: string,
  now: number,
): GameEvent[] {
  if (endReason === "NO_CONNECTED_PLAYERS") {
    state.phase = "ENDED_NO_RESULT";
    state.endReason = endReason;
    state.endedAt = now;
    state.results = [];
    return [{ type: "MATCH_ENDED", reasonCode: endReason }];
  }
  state.phase = "COMPLETED";
  state.endedAt = now;
  state.endReason = endReason;
  const scores = calculateResults(state);
  state.results = scores;
  return [{ type: "MATCH_ENDED", reasonCode: endReason }];
}

export function calculateResults(state: GameState) {
  const scores = state.players.map((player) => {
    const completed = ANIMALS.filter(
      (animal) =>
        state.animals.filter(
          (card) => card.ownerId === player.id && card.type === animal,
        ).length === 4,
    );
    const sum = completed.reduce(
      (total, animal) => total + ANIMAL_VALUES[animal],
      0,
    );
    return {
      playerId: player.id,
      quartetCount: completed.length,
      quartetValueSum: sum,
      score: sum * completed.length,
      isWinner: false,
    };
  });
  const high = Math.max(...scores.map((score) => score.score));
  scores.forEach((score) => {
    score.isWinner = score.score === high;
  });
  return scores;
}
function advanceTurn(
  state: GameState,
  fromId: string,
  now: number,
): GameEvent[] {
  state.phase = "TURN";
  state.auction = null;
  state.negotiation = null;
  if (state.animals.every((card) => card.ownerId !== null)) {
    const allQuartetsComplete = ANIMALS.every((animal) =>
      state.players.some(
        (player) =>
          state.animals.filter(
            (card) => card.ownerId === player.id && card.type === animal,
          ).length === 4,
      ),
    );
    if (allQuartetsComplete)
      return complete(state, "ALL_QUARTETS_COMPLETE", now);
  }
  const next = nextPlayer(state, fromId);
  if (!next) {
    return complete(
      state,
      state.players.some((player) => player.status === "CONNECTED")
        ? "NO_ELIGIBLE_LEGAL_TURN"
        : "NO_CONNECTED_PLAYERS",
      now,
    );
  }
  state.currentPlayerId = next;
  const events: GameEvent[] = [{ type: "TURN_STARTED", actorId: next }];
  return events;
}
export function createInitialGame(
  players: GamePlayer[],
  now = Date.now(),
): GameState {
  if (players.length < 3 || players.length > 5)
    throw new GameRuleError("INVALID_PLAYER_COUNT");
  const animals = shuffle(
    ANIMALS.flatMap((type) =>
      Array.from({ length: 4 }, () => ({
        id: randomUUID(),
        type,
        ownerId: null,
        acquiredAt: null,
        previousOwnerId: null,
        acquisitionSource: null,
      })),
    ),
  );
  const first = players[randomInt(players.length)]!;
  const money: MoneyCard[] = moneyValues.map((value) => ({
    id: randomUUID(),
    value,
    ownerId: null,
  }));
  const seatPlayers = [...players].sort((a, b) => a.joinOrder - b.joinOrder);
  for (const player of seatPlayers) {
    for (const denomination of [0, 0, 10, 10, 10, 10, 50] as const) {
      const card = money.find(
        (candidate) =>
          candidate.value === denomination && candidate.ownerId === null,
      );
      if (!card) throw new GameRuleError("MONEY_SETUP_FAILED");
      card.ownerId = player.id;
    }
  }
  return {
    version: 1,
    phase: "TURN",
    players: seatPlayers,
    animals,
    money,
    currentPlayerId: first.id,
    firstPlayerId: first.id,
    auction: null,
    negotiation: null,
    donkeyCount: 0,
    startedAt: now,
    endedAt: null,
    endReason: null,
    results: [],
    publicReveal: null,
  };
}
function assertTurn(state: GameState, actorId: string): void {
  if (state.currentPlayerId !== actorId)
    throw new GameRuleError("NOT_YOUR_TURN");
}
function resolveAnimal(
  state: GameState,
  animalId: string,
  playerId: string,
  now: number,
  source: "AUCTION" | "KUHHANDEL",
): void {
  const card = state.animals.find((candidate) => candidate.id === animalId);
  if (!card || card.ownerId !== null)
    throw new GameRuleError("ANIMAL_UNAVAILABLE");
  card.ownerId = playerId;
  card.acquiredAt = now;
  card.acquisitionSource = source;
}
function publicOffer(
  state: GameState,
  ids: string[],
  ownerId: string,
): { values: number[]; total: number } {
  if (new Set(ids).size !== ids.length)
    throw new GameRuleError("DUPLICATE_CARD");
  const cards = ids.map((id) =>
    state.money.find((card) => card.id === id && card.ownerId === ownerId),
  );
  if (cards.some((card) => !card))
    throw new GameRuleError("INVALID_MONEY_CARD");
  const values = cards.map((card) => card!.value);
  return { values, total: values.reduce<number>((a, b) => a + b, 0) };
}

export function applyGameAction(
  original: GameState,
  actorId: string,
  action: GameAction,
  now = Date.now(),
): {
  state: GameState;
  events: GameEvent[];
  privateReveal?: { playerId: string; denominations: number[] };
} {
  const state = structuredClone(original);
  state.publicReveal = null;
  const events: GameEvent[] = [];
  const actor = state.players.find((player) => player.id === actorId);
  if (!actor || (!active(actor) && action.type !== "timer"))
    throw new GameRuleError("PLAYER_INACTIVE");
  if (actor.status !== "CONNECTED" && action.type !== "timer")
    throw new GameRuleError("PLAYER_DISCONNECTED");
  if (state.phase === "RULE_DECISION_REQUIRED")
    throw new GameRuleError("RULE_DECISION_REQUIRED");

  if (action.type === "startAuction") {
    assertTurn(state, actorId);
    if (state.phase !== "TURN") throw new GameRuleError("INVALID_PHASE");
    const card = state.animals.find((candidate) => candidate.ownerId === null);
    if (!card) throw new GameRuleError("AUCTION_UNAVAILABLE");
    const eventsBefore: GameEvent[] = [];
    if (card.type === "DONKEY") {
      const distribution = [50, 100, 200, 500][state.donkeyCount];
      if (distribution === undefined)
        throw new GameRuleError("DONKEY_DISTRIBUTION_EXHAUSTED");
      state.donkeyCount++;
      for (const player of state.players) {
        const moneyCard = state.money.find(
          (candidate) =>
            candidate.ownerId === null && candidate.value === distribution,
        );
        if (!moneyCard) throw new GameRuleError("DONKEY_BANK_EXHAUSTED");
        moneyCard.ownerId = player.id;
        eventsBefore.push({
          type: "DONKEY_DISTRIBUTION",
          actorId: player.id,
          amount: distribution,
        });
      }
    }
    state.phase = "AUCTION";
    state.auction = {
      animalCardId: card.id,
      auctioneerId: actorId,
      highBid: 0,
      highBidderId: null,
      deadlineAt: now + 15_000,
      paymentDeadlineAt: null,
      choiceDeadlineAt: null,
      payerId: null,
      payeeId: null,
      due: 0,
      attempt: 1,
      state: "BIDDING",
      ruleDecision: null,
      choicePausedRemainingMs: null,
      paymentPausedRemainingMs: null,
    };
    events.push(...eventsBefore, {
      type: "AUCTION_STARTED",
      actorId,
      animalType: card.type,
    });
  } else if (action.type === "bid") {
    const auction = state.auction;
    if (state.phase !== "AUCTION" || !auction || auction.state !== "BIDDING")
      throw new GameRuleError("INVALID_PHASE");
    if (now > auction.deadlineAt) throw new GameRuleError("ACTION_EXPIRED");
    if (actorId === auction.auctioneerId)
      throw new GameRuleError("AUCTIONEER_CANNOT_BID");
    if (!Number.isSafeInteger(action.amount) || action.amount < 1)
      throw new GameRuleError("INVALID_BID");
    if (auction.highBidderId && action.amount < auction.highBid + 10)
      throw new GameRuleError("BID_INCREMENT_TOO_LOW");
    if (
      auction.attempt > 1 &&
      action.amount >
        sumCards(state.money.filter((card) => card.ownerId === actorId))
    )
      throw new GameRuleError("BID_EXCEEDS_MONEY");
    auction.highBid = action.amount;
    auction.highBidderId = actorId;
    auction.deadlineAt = now + 15_000;
    events.push({ type: "BID_ACCEPTED", actorId, amount: action.amount });
  } else if (action.type === "timer" && action.timer === "AUCTION") {
    const auction = state.auction;
    if (!auction || auction.state !== "BIDDING" || now < auction.deadlineAt)
      throw new GameRuleError("TIMER_NOT_EXPIRED");
    if (!auction.highBidderId) {
      resolveAnimal(
        state,
        auction.animalCardId,
        auction.auctioneerId,
        now,
        "AUCTION",
      );
      events.push({
        type: "AUCTION_CLOSED",
        actorId: auction.auctioneerId,
        animalCardCount: 1,
        outcomeCode: "NO_BIDS_FREE",
      });
      events.push(...advanceTurn(state, auction.auctioneerId, now));
    } else {
      auction.state = "CHOICE";
      auction.choiceDeadlineAt = now + 15_000;
      auction.paymentDeadlineAt = now + 30_000;
      state.phase = "AUCTIONEER_CHOICE";
      events.push({
        type: "AUCTION_CLOSED",
        actorId: auction.highBidderId,
        amount: auction.highBid,
      });
    }
  } else if (action.type === "chooseAuctioneer") {
    const auction = state.auction;
    if (
      state.phase !== "AUCTIONEER_CHOICE" ||
      !auction ||
      auction.state !== "CHOICE" ||
      actorId !== auction.auctioneerId
    )
      throw new GameRuleError("INVALID_PHASE");
    if (now > auction.choiceDeadlineAt!)
      throw new GameRuleError("ACTION_EXPIRED");
    const buyer =
      action.choice === "BUY" ? auction.auctioneerId : auction.highBidderId!;
    const seller =
      action.choice === "BUY" ? auction.highBidderId! : auction.auctioneerId;
    auction.payerId = buyer;
    auction.payeeId = seller;
    auction.due = auction.highBid;
    if (buyer === auction.auctioneerId)
      auction.paymentDeadlineAt = now + 30_000;
    auction.state = "PAYMENT";
    state.phase = "PAYMENT";
    events.push({
      type: "AUCTIONEER_CHOICE",
      actorId,
      outcomeCode: action.choice,
    });
  } else if (action.type === "timer" && action.timer === "CHOICE") {
    const auction = state.auction;
    if (
      !auction ||
      auction.state !== "CHOICE" ||
      now < auction.choiceDeadlineAt!
    )
      throw new GameRuleError("TIMER_NOT_EXPIRED");
    auction.payerId = auction.highBidderId;
    auction.payeeId = auction.auctioneerId;
    auction.due = auction.highBid;
    auction.state = "PAYMENT";
    state.phase = "PAYMENT";
    events.push({
      type: "AUCTIONEER_CHOICE",
      actorId: auction.auctioneerId,
      outcomeCode: "PASS_TIMEOUT",
    });
  } else if (action.type === "confirmPayment") {
    const auction = state.auction;
    if (
      state.phase !== "PAYMENT" ||
      !auction ||
      auction.state !== "PAYMENT" ||
      actorId !== auction.payerId
    )
      throw new GameRuleError("INVALID_PHASE");
    const deadline = auction.paymentDeadlineAt;
    if (deadline === null) throw new GameRuleError("INVALID_PHASE");
    if (now > deadline) throw new GameRuleError("ACTION_EXPIRED");
    const chosen = publicOffer(state, action.moneyCardIds, actorId);
    if (chosen.total < auction.due)
      throw new GameRuleError("PAYMENT_INSUFFICIENT");
    for (const id of action.moneyCardIds)
      state.money.find((card) => card.id === id)!.ownerId = auction.payeeId;
    resolveAnimal(state, auction.animalCardId, actorId, now, "AUCTION");
    events.push({
      type: "PAYMENT_SUCCEEDED",
      actorId,
      targetId: auction.payeeId!,
      amount: chosen.total,
    });
    events.push({
      type: "ANIMAL_TRANSFERRED",
      actorId: auction.payeeId!,
      targetId: actorId,
      animalCardCount: 1,
    });
    events.push(...advanceTurn(state, auction.auctioneerId, now));
  } else if (action.type === "timer" && action.timer === "PAYMENT") {
    const auction = state.auction;
    if (
      !auction ||
      auction.state !== "PAYMENT" ||
      now < auction.paymentDeadlineAt!
    )
      throw new GameRuleError("TIMER_NOT_EXPIRED");
    if (
      auction.payerId !== auction.highBidderId &&
      auction.payerId !== auction.auctioneerId
    )
      throw new GameRuleError("INVALID_PHASE");
    if (
      auction.payerId === auction.auctioneerId &&
      auction.payeeId === auction.highBidderId
    ) {
      // The approved rules don't define a forfeited/disconnected high bidder during this pending sale.
      const highBidder = state.players.find(
        (player) => player.id === auction.highBidderId,
      );
      if (!highBidder || highBidder.status !== "CONNECTED") {
        state.phase = "RULE_DECISION_REQUIRED";
        auction.state = "RULE_DECISION_REQUIRED";
        auction.ruleDecision =
          "AUCTIONEER_PURCHASE_WITH_UNAVAILABLE_HIGH_BIDDER";
        state.version++;
        events.push({
          type: "RULE_DECISION_REQUIRED",
          reasonCode: auction.ruleDecision,
        });
        return { state, events };
      }
    }
    const failedId = auction.payerId!;
    const remaining = state.money.filter((card) => card.ownerId === failedId);
    if (failedId === auction.auctioneerId) {
      // Approved fallback: first-purchase failure grants the high bidder a fresh payment window.
      auction.payerId = auction.highBidderId;
      auction.payeeId = auction.auctioneerId;
      auction.due = auction.highBid;
      auction.paymentDeadlineAt = now + 30_000;
      events.push({
        type: "PAYMENT_FAILED",
        actorId: failedId,
        reasonCode: "TIMEOUT",
      });
    } else {
      const reveal = remaining.map((card) => card.value);
      state.publicReveal = { playerId: failedId, denominations: reveal };
      const bidder = state.players.find((player) => player.id === failedId);
      if (bidder?.status === "FORFEITED") {
        auction.attempt++;
        auction.highBidderId = null;
        auction.highBid = 0;
        auction.state = "BIDDING";
        auction.deadlineAt = now + 15_000;
        state.phase = "AUCTION";
        events.push(
          {
            type: "PAYMENT_FAILED",
            actorId: failedId,
            reasonCode: "FORFEITED",
          },
          { type: "REAUCTION_STARTED", actorId: auction.auctioneerId },
        );
        state.version++;
        return {
          state,
          events,
          privateReveal: { playerId: failedId, denominations: reveal },
        };
      }
      auction.attempt++;
      auction.highBidderId = null;
      auction.highBid = 0;
      auction.state = "BIDDING";
      auction.deadlineAt = now + 15_000;
      state.phase = "AUCTION";
      events.push(
        { type: "PAYMENT_FAILED", actorId: failedId, reasonCode: "TIMEOUT" },
        { type: "REAUCTION_STARTED", actorId: auction.auctioneerId },
      );
      state.version++;
      return {
        state,
        events,
        privateReveal: { playerId: failedId, denominations: reveal },
      };
    }
  } else if (action.type === "initiateTrade") {
    assertTurn(state, actorId);
    if (state.phase !== "TURN")
      throw new GameRuleError("TRADING_NOT_AVAILABLE");
    const target = state.players.find(
      (player) =>
        player.id === action.targetId &&
        active(player) &&
        player.status === "CONNECTED",
    );
    if (!target || target.id === actorId)
      throw new GameRuleError("INVALID_TARGET");
    const challengerCards = state.animals.filter(
      (card) => card.ownerId === actorId && card.type === action.animalType,
    );
    const targetCards = state.animals.filter(
      (card) => card.ownerId === target.id && card.type === action.animalType,
    );
    if (
      !challengerCards.length ||
      !targetCards.length ||
      challengerCards.length === 4 ||
      targetCards.length === 4
    )
      throw new GameRuleError("NO_ELIGIBLE_PLAYER");
    const count: 1 | 2 =
      challengerCards.length >= 2 && targetCards.length >= 2 ? 2 : 1;
    const offer = publicOffer(state, action.moneyCardIds, actorId);
    state.negotiation = {
      challengerId: actorId,
      targetId: target.id,
      animalType: action.animalType,
      cardCount: count,
      challengerAnimalIds: challengerCards
        .slice(0, count)
        .map((card) => card.id),
      targetAnimalIds: targetCards.slice(0, count).map((card) => card.id),
      firstOfferIds: [...action.moneyCardIds],
      secondOfferIds: null,
      deadlineAt: now + 30_000,
      pausedRemainingMs: null,
    };
    state.phase = "NEGOTIATION";
    events.push({
      type: "KUHHANDEL_OFFER_SUBMITTED",
      actorId,
      targetId: target.id,
      animalType: action.animalType,
      animalCardCount: count,
      submittedMoneyDenominations: offer.values,
      submittedMoneyValue: offer.total,
    });
  } else if (action.type === "respondTrade") {
    const trade = state.negotiation;
    if (state.phase !== "NEGOTIATION" || !trade || actorId !== trade.targetId)
      throw new GameRuleError("INVALID_PHASE");
    if (now > trade.deadlineAt) throw new GameRuleError("ACTION_EXPIRED");
    if (action.response === "COUNTER") {
      if (trade.secondOfferIds) throw new GameRuleError("ALREADY_RESPONDED");
      const counter = publicOffer(state, action.moneyCardIds, actorId);
      trade.secondOfferIds = [...action.moneyCardIds];
      events.push({
        type: "KUHHANDEL_RESPONSE",
        actorId,
        targetId: trade.challengerId,
        outcomeCode: "COUNTER",
        submittedMoneyDenominations: counter.values,
        submittedMoneyValue: counter.total,
      });
    } else if (trade.secondOfferIds) {
      throw new GameRuleError("ALREADY_RESPONDED");
    }
    const first = publicOffer(state, trade.firstOfferIds, trade.challengerId);
    let winner = trade.challengerId;
    if (trade.secondOfferIds) {
      const second = publicOffer(state, trade.secondOfferIds, trade.targetId);
      if (second.total > first.total) winner = trade.targetId;
      events.push({
        type: "KUHHANDEL_RESOLVED",
        actorId: winner,
        targetId:
          winner === trade.challengerId ? trade.targetId : trade.challengerId,
        animalType: trade.animalType,
        animalCardCount: trade.cardCount,
        amount: Math.max(first.total, second.total),
        outcomeCode:
          first.total === second.total
            ? "TIE_CHALLENGER_WINS"
            : "HIGHER_OFFER_WINS",
      });
      for (const id of trade.firstOfferIds)
        state.money.find((card) => card.id === id)!.ownerId = trade.targetId;
      for (const id of trade.secondOfferIds!)
        state.money.find((card) => card.id === id)!.ownerId =
          trade.challengerId;
    } else {
      events.push({
        type: "KUHHANDEL_RESOLVED",
        actorId: trade.challengerId,
        targetId: trade.targetId,
        animalType: trade.animalType,
        animalCardCount: trade.cardCount,
        outcomeCode: "ACCEPTED",
      });
      for (const id of trade.firstOfferIds)
        state.money.find((card) => card.id === id)!.ownerId = trade.targetId;
    }
    const fromIds =
      winner === trade.challengerId
        ? trade.targetAnimalIds
        : trade.challengerAnimalIds;
    const from =
      winner === trade.challengerId ? trade.targetId : trade.challengerId;
    for (const id of fromIds) {
      const card = state.animals.find((candidate) => candidate.id === id)!;
      card.previousOwnerId = card.ownerId;
      card.ownerId = winner;
      card.acquiredAt = now;
      card.acquisitionSource = "KUHHANDEL";
    }
    events.push({
      type: "ANIMAL_TRANSFERRED",
      actorId: from,
      targetId: winner,
      animalType: trade.animalType,
      animalCardCount: trade.cardCount,
    });
    if (
      state.animals.filter(
        (card) => card.ownerId === winner && card.type === trade.animalType,
      ).length === 4
    )
      events.push({
        type: "QUARTET_COMPLETED",
        actorId: winner,
        animalType: trade.animalType,
      });
    events.push(...advanceTurn(state, trade.challengerId, now));
  } else if (action.type === "timer" && action.timer === "NEGOTIATION") {
    const trade = state.negotiation;
    if (!trade || now < trade.deadlineAt)
      throw new GameRuleError("TIMER_NOT_EXPIRED");
    events.push({
      type: "KUHHANDEL_RESOLVED",
      actorId: trade.challengerId,
      targetId: trade.targetId,
      reasonCode: "TIMEOUT",
      outcomeCode: "CANCELLED",
    });
    events.push(...advanceTurn(state, trade.challengerId, now));
  }
  state.version++;
  return { state, events };
}

export function markGameDisconnected(
  original: GameState,
  playerId: string,
  now = Date.now(),
) {
  const state = structuredClone(original);
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player || player.status !== "CONNECTED")
    throw new GameRuleError("PLAYER_NOT_CONNECTED");
  player.status = "DISCONNECTED";
  player.reconnectExpiresAt = now + 60_000;
  const events: GameEvent[] = [
    { type: "PLAYER_DISCONNECTED", actorId: playerId },
  ];
  if (
    state.auction?.state === "CHOICE" &&
    state.auction.auctioneerId === playerId &&
    state.auction.choicePausedRemainingMs === null
  ) {
    state.auction.choicePausedRemainingMs = Math.max(
      0,
      (state.auction.choiceDeadlineAt ?? now) - now,
    );
    state.auction.choiceDeadlineAt = Number.MAX_SAFE_INTEGER;
  }
  if (
    state.auction?.state === "PAYMENT" &&
    state.auction.payerId === playerId &&
    state.auction.paymentPausedRemainingMs === null
  ) {
    state.auction.paymentPausedRemainingMs = Math.max(
      0,
      (state.auction.paymentDeadlineAt ?? now) - now,
    );
    state.auction.paymentDeadlineAt = Number.MAX_SAFE_INTEGER;
  }
  if (
    state.negotiation &&
    (state.negotiation.challengerId === playerId ||
      state.negotiation.targetId === playerId) &&
    state.negotiation.pausedRemainingMs === null
  ) {
    state.negotiation.pausedRemainingMs = Math.max(
      0,
      state.negotiation.deadlineAt - now,
    );
    state.negotiation.deadlineAt = Number.MAX_SAFE_INTEGER;
  }
  state.version++;
  return { state, events };
}

export function markGameReconnected(
  original: GameState,
  playerId: string,
  now = Date.now(),
) {
  const state = structuredClone(original);
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (
    !player ||
    player.status !== "DISCONNECTED" ||
    player.reconnectExpiresAt === undefined ||
    player.reconnectExpiresAt === null ||
    now > player.reconnectExpiresAt
  )
    throw new GameRuleError("RECONNECT_EXPIRED");
  player.status = "CONNECTED";
  player.reconnectExpiresAt = null;
  if (
    state.auction?.auctioneerId === playerId &&
    state.auction.choicePausedRemainingMs !== null
  ) {
    state.auction.choiceDeadlineAt =
      now + state.auction.choicePausedRemainingMs;
    state.auction.choicePausedRemainingMs = null;
  }
  if (
    state.auction?.payerId === playerId &&
    state.auction.paymentPausedRemainingMs !== null
  ) {
    state.auction.paymentDeadlineAt =
      now + state.auction.paymentPausedRemainingMs;
    state.auction.paymentPausedRemainingMs = null;
  }
  if (
    state.negotiation?.pausedRemainingMs !== null &&
    state.negotiation &&
    state.players.find(
      (candidate) => candidate.id === state.negotiation!.challengerId,
    )?.status === "CONNECTED" &&
    state.players.find(
      (candidate) => candidate.id === state.negotiation!.targetId,
    )?.status === "CONNECTED"
  ) {
    state.negotiation.deadlineAt = now + state.negotiation.pausedRemainingMs!;
    state.negotiation.pausedRemainingMs = null;
  }
  state.version++;
  return { state, events: [{ type: "PLAYER_RECONNECTED", actorId: playerId }] };
}

export function markGameForfeited(
  original: GameState,
  playerId: string,
  now = Date.now(),
) {
  const state = structuredClone(original);
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (
    !player ||
    player.status !== "DISCONNECTED" ||
    player.reconnectExpiresAt === undefined ||
    player.reconnectExpiresAt === null ||
    now <= player.reconnectExpiresAt
  )
    throw new GameRuleError("RECONNECT_WINDOW_ACTIVE");
  player.status = "FORFEITED";
  player.reconnectExpiresAt = null;
  const events: GameEvent[] = [{ type: "PLAYER_FORFEITED", actorId: playerId }];
  let reveal: { playerId: string; denominations: number[] } | undefined;
  const block = (decision: string) => {
    state.phase = "RULE_DECISION_REQUIRED";
    if (state.auction) {
      state.auction.state = "RULE_DECISION_REQUIRED";
      state.auction.ruleDecision = decision;
    }
    events.push({
      type: "RULE_DECISION_REQUIRED",
      actorId: playerId,
      reasonCode: decision,
    });
  };
  const reauctionFor = (bidderId: string) => {
    const auction = state.auction!;
    reveal = {
      playerId: bidderId,
      denominations: state.money
        .filter((card) => card.ownerId === bidderId)
        .map((card) => card.value),
    };
    state.publicReveal = reveal;
    auction.attempt++;
    auction.highBid = 0;
    auction.highBidderId = null;
    auction.payerId = null;
    auction.payeeId = null;
    auction.due = 0;
    auction.state = "BIDDING";
    auction.deadlineAt = now + 15_000;
    state.phase = "AUCTION";
    events.push(
      { type: "PAYMENT_FAILED", actorId: bidderId, reasonCode: "FORFEITED" },
      { type: "REAUCTION_STARTED", actorId: auction.auctioneerId },
    );
  };

  if (
    state.negotiation &&
    (state.negotiation.challengerId === playerId ||
      state.negotiation.targetId === playerId)
  ) {
    const challengerId = state.negotiation.challengerId;
    events.push({
      type: "KUHHANDEL_RESOLVED",
      actorId: challengerId,
      targetId: playerId,
      reasonCode: "PLAYER_FORFEITED",
      outcomeCode: "CANCELLED",
    });
    events.push(...advanceTurn(state, challengerId, now));
  } else if (state.auction) {
    const auction = state.auction;
    if (auction.state === "CHOICE") {
      if (playerId === auction.highBidderId)
        block("HIGH_BIDDER_FORFEITED_DURING_AUCTIONEER_CHOICE");
      else if (playerId === auction.auctioneerId) {
        if (
          state.players.find(
            (candidate) => candidate.id === auction.highBidderId,
          )?.status === "FORFEITED"
        )
          block("HIGH_BIDDER_FORFEITED_DURING_AUCTIONEER_CHOICE");
        else {
          auction.payerId = auction.highBidderId;
          auction.payeeId = auction.auctioneerId;
          auction.due = auction.highBid;
          auction.choiceDeadlineAt = null;
          auction.choicePausedRemainingMs = null;
          auction.state = "PAYMENT";
          state.phase = "PAYMENT";
          events.push({
            type: "AUCTIONEER_CHOICE",
            actorId: playerId,
            outcomeCode: "FORFEITED_PASS",
          });
        }
      }
    } else if (auction.state === "BIDDING") {
      if (playerId === auction.highBidderId) reauctionFor(playerId);
      else if (playerId === auction.auctioneerId)
        block("AUCTIONEER_FORFEITED_DURING_AUCTION");
    } else if (auction.state === "PAYMENT") {
      if (playerId === auction.payerId && playerId === auction.highBidderId)
        reauctionFor(playerId);
      else if (
        playerId === auction.payerId &&
        playerId === auction.auctioneerId
      ) {
        const bidder = state.players.find(
          (candidate) => candidate.id === auction.highBidderId,
        );
        if (!bidder || bidder.status !== "CONNECTED")
          block("HIGH_BIDDER_UNAVAILABLE_DURING_AUCTIONEER_PURCHASE");
        else {
          auction.payerId = auction.highBidderId;
          auction.payeeId = auction.auctioneerId;
          auction.paymentDeadlineAt = now + 30_000;
          auction.paymentPausedRemainingMs = null;
          events.push({
            type: "PAYMENT_FAILED",
            actorId: playerId,
            reasonCode: "FORFEITED",
          });
        }
      } else if (
        playerId === auction.highBidderId &&
        auction.payerId === auction.auctioneerId
      ) {
        block("HIGH_BIDDER_FORFEITED_DURING_AUCTIONEER_PURCHASE");
      }
    }
  } else if (state.phase === "TURN" && state.currentPlayerId === playerId) {
    events.push(...advanceTurn(state, playerId, now));
  }
  if (
    state.phase !== "COMPLETED" &&
    state.phase !== "ENDED_NO_RESULT" &&
    state.players.every((candidate) => candidate.status !== "CONNECTED")
  )
    events.push(...complete(state, "NO_CONNECTED_PLAYERS", now));
  if (
    state.phase !== "COMPLETED" &&
    state.phase !== "ENDED_NO_RESULT" &&
    state.players.filter((candidate) => candidate.status !== "FORFEITED")
      .length <= 1
  )
    events.push(...complete(state, "ONE_ELIGIBLE_PLAYER_REMAINS", now));
  state.version++;
  return { state, events, publicReveal: reveal };
}

export function publicGameState(state: GameState, viewerId: string) {
  const negotiation = state.negotiation
    ? {
        ...state.negotiation,
        firstOfferValues: state.negotiation.firstOfferIds.map(
          (id) => state.money.find((card) => card.id === id)?.value ?? 0,
        ),
        secondOfferValues: (state.negotiation.secondOfferIds ?? []).map(
          (id) => state.money.find((card) => card.id === id)?.value ?? 0,
        ),
        firstOfferTotal: state.negotiation.firstOfferIds.reduce(
          (total, id) =>
            total + (state.money.find((card) => card.id === id)?.value ?? 0),
          0,
        ),
        secondOfferTotal: (state.negotiation.secondOfferIds ?? []).reduce(
          (total, id) =>
            total + (state.money.find((card) => card.id === id)?.value ?? 0),
          0,
        ),
      }
    : null;
  return {
    version: state.version,
    phase: state.phase,
    players: state.players.map(({ id, nickname, avatar, status }) => ({
      id,
      nickname,
      avatar,
      status,
    })),
    animals: state.animals,
    currentPlayerId: state.currentPlayerId,
    firstPlayerId: state.firstPlayerId,
    auction: state.auction,
    negotiation,
    ownMoney: state.money.filter((card) => card.ownerId === viewerId),
    publicReveal: state.publicReveal,
    results: state.results,
    endReason: state.endReason,
  };
}
