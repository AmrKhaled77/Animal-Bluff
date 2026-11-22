import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import {
  applyGameAction,
  createInitialGame,
  GameRuleError,
  publicGameState,
  type GameAction,
  type GameEvent,
  type GamePlayer,
  type GameState,
} from "./game-engine.js";
import { SlidingWindowRateLimiter } from "./rate-limiter.js";

export class ServiceError extends Error {
  constructor(
    readonly code: string,
    readonly status = 400,
  ) {
    super(code);
  }
}
type MatchRow = {
  id: string;
  roomCode: string;
  version: number;
  state: GameState | null;
};
type AuthPlayer = {
  id: string;
  roomCode: string;
  nickname: string;
  avatar: string;
  joinOrder: number;
  status: string;
  isReady: boolean;
};
const dbPhase = (phase: GameState["phase"]) =>
  phase === "RULE_DECISION_REQUIRED" ? "PAYMENT" : phase;

function validateAction(action: unknown): asserts action is GameAction {
  if (!action || typeof action !== "object" || Array.isArray(action))
    throw new ServiceError("INVALID_INPUT");
  const value = action as Record<string, unknown>;
  const stringArray = (input: unknown) =>
    Array.isArray(input) &&
    input.every((item) => typeof item === "string") &&
    new Set(input).size === input.length;
  switch (value.type) {
    case "startAuction":
      if (Object.keys(value).length === 1) return;
      break;
    case "bid":
      if (Object.keys(value).length === 2 && Number.isSafeInteger(value.amount))
        return;
      break;
    case "chooseAuctioneer":
      if (
        Object.keys(value).length === 2 &&
        (value.choice === "BUY" || value.choice === "PASS")
      )
        return;
      break;
    case "confirmPayment":
      if (Object.keys(value).length === 2 && stringArray(value.moneyCardIds))
        return;
      break;
    case "initiateTrade":
      if (
        Object.keys(value).length === 4 &&
        typeof value.targetId === "string" &&
        stringArray(value.moneyCardIds) &&
        typeof value.animalType === "string"
      )
        return;
      break;
    case "respondTrade":
      if (value.response === "ACCEPT" && Object.keys(value).length === 2)
        return;
      if (
        value.response === "COUNTER" &&
        Object.keys(value).length === 3 &&
        stringArray(value.moneyCardIds)
      )
        return;
      break;
  }
  throw new ServiceError("INVALID_INPUT");
}

export class GameService {
  private readonly actionRateLimiter: SlidingWindowRateLimiter;

  constructor(
    private readonly db: PrismaClient,
    private readonly now = () => Date.now(),
  ) {
    this.actionRateLimiter = new SlidingWindowRateLimiter(90, 60_000, now);
  }

  private async authenticate(
    tx: Prisma.TransactionClient,
    roomCode: string,
    token: string,
  ): Promise<AuthPlayer> {
    if (typeof token !== "string" || token.length < 40 || token.length > 100)
      throw new ServiceError("UNAUTHORIZED", 401);
    const player = await tx.roomPlayer.findUnique({
      where: { reconnectToken: token },
      select: {
        id: true,
        roomCode: true,
        nickname: true,
        avatar: true,
        joinOrder: true,
        status: true,
        isReady: true,
      },
    });
    if (
      !player ||
      player.roomCode !== roomCode ||
      player.status !== "CONNECTED"
    )
      throw new ServiceError("UNAUTHORIZED", 401);
    return player;
  }

  async setReady(roomCode: string, token: string, ready: boolean) {
    if (typeof ready !== "boolean") throw new ServiceError("INVALID_INPUT");
    return this.db.$transaction(async (tx) => {
      const player = await this.authenticate(tx, roomCode, token);
      const room = await tx.room.findUnique({
        where: { code: roomCode },
        select: { status: true },
      });
      if (!room) throw new ServiceError("ROOM_NOT_FOUND", 404);
      if (room.status !== "LOBBY")
        throw new ServiceError("ROOM_NOT_LOBBY", 409);
      await tx.roomPlayer.update({
        where: { id: player.id },
        data: { isReady: ready },
      });
      return tx.room.findUniqueOrThrow({
        where: { code: roomCode },
        include: {
          players: {
            orderBy: { joinOrder: "asc" },
            select: {
              id: true,
              nickname: true,
              avatar: true,
              status: true,
              isReady: true,
              joinOrder: true,
            },
          },
          hostPlayer: { select: { id: true } },
        },
      });
    });
  }

  async start(roomCode: string, token: string) {
    const now = new Date(this.now());
    return this.db.$transaction(
      async (tx) => {
        const actor = await this.authenticate(tx, roomCode, token);
        const room = await tx.room.findUnique({
          where: { code: roomCode },
          include: {
            players: {
              orderBy: { joinOrder: "asc" },
              select: {
                id: true,
                nickname: true,
                avatar: true,
                joinOrder: true,
                status: true,
                isReady: true,
              },
            },
          },
        });
        if (!room) throw new ServiceError("ROOM_NOT_FOUND", 404);
        if (room.status !== "LOBBY")
          throw new ServiceError("ROOM_NOT_LOBBY", 409);
        if (room.lobbyExpiresAt <= now)
          throw new ServiceError("ROOM_EXPIRED", 409);
        const host = await tx.room.findUnique({
          where: { code: roomCode },
          select: { hostPlayerId: true },
        });
        if (host?.hostPlayerId !== actor.id)
          throw new ServiceError("HOST_ONLY", 403);
        const activePlayers = room.players.filter(
          (player) => player.status === "CONNECTED",
        );
        if (activePlayers.length < 3)
          throw new ServiceError("NOT_ENOUGH_PLAYERS", 409);
        if (
          activePlayers.length > 5 ||
          !activePlayers.every((player) => player.isReady)
        )
          throw new ServiceError("PLAYERS_NOT_READY", 409);
        const gamePlayers: GamePlayer[] = activePlayers.map((player) => ({
          id: player.id,
          nickname: player.nickname,
          avatar: player.avatar,
          joinOrder: player.joinOrder,
          status: "CONNECTED",
        }));
        const state = createInitialGame(gamePlayers, now.getTime());
        const match = await tx.match.create({
          data: { roomCode, startedAt: now },
        });
        await tx.matchParticipant.createMany({
          data: activePlayers.map((player, seatOrder) => ({
            roomCode,
            matchId: match.id,
            roomPlayerId: player.id,
            seatOrder,
          })),
        });
        await tx.room.update({
          where: { code: roomCode },
          data: { status: "IN_MATCH", hostlessExpiresAt: null },
        });
        await this.saveState(tx, match.id, state);
        await tx.auditLogEvent.create({
          data: {
            eventType: "MATCH_STARTED",
            roomCode,
            matchId: match.id,
            actorPlayerId: actor.id,
            operationCode: "MATCH_START",
          },
        });
        await this.persistEvents(tx, roomCode, [
          { type: "MATCH_STARTED", actorId: actor.id },
          { type: "TURN_STARTED", actorId: state.currentPlayerId! },
        ]);
        return {
          matchId: match.id,
          serverNow: now.getTime(),
          state: publicGameState(state, actor.id),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async loadState(
    tx: Prisma.TransactionClient,
    roomCode: string,
  ): Promise<MatchRow> {
    const rows = await tx.$queryRaw<
      MatchRow[]
    >`SELECT "id", "roomCode", "version", "state" FROM "Match" WHERE "roomCode" = ${roomCode} FOR UPDATE`;
    const row = rows[0];
    if (!row || !row.state) throw new ServiceError("MATCH_NOT_FOUND", 404);
    return row;
  }

  private async saveState(
    tx: Prisma.TransactionClient,
    matchId: string,
    state: GameState,
  ): Promise<void> {
    await tx.$executeRaw`UPDATE "Match" SET "state" = ${JSON.stringify(state)}::jsonb, "phase" = ${dbPhase(state.phase)}::"MatchPhase", "version" = "version" + 1 WHERE "id" = ${matchId}`;
  }

  private async persistEvents(
    tx: Prisma.TransactionClient,
    roomCode: string,
    events: GameEvent[],
  ): Promise<void> {
    if (!events.length) return;
    await tx.$queryRaw`SELECT "code" FROM "Room" WHERE "code" = ${roomCode} FOR UPDATE`;
    const aggregate = await tx.publicGameEvent.aggregate({
      where: { roomCode },
      _max: { sequence: true },
    });
    let sequence = (aggregate._max.sequence ?? 0) + 1;
    for (const event of events) {
      if (event.type === "RULE_DECISION_REQUIRED") continue;
      await tx.publicGameEvent.create({
        data: {
          roomCode,
          sequence: sequence++,
          eventType: event.type as never,
          actorPlayerId: event.actorId,
          targetPlayerId: event.targetId,
          animalType: event.animalType as never,
          animalCardCount: event.animalCardCount,
          amount: event.amount,
          outcomeCode: event.outcomeCode,
          reasonCode: event.reasonCode,
          submittedMoneyDenominations: event.submittedMoneyDenominations,
          submittedMoneyValue: event.submittedMoneyValue,
        },
      });
    }
  }

  async action(
    roomCode: string,
    token: string,
    commandId: string,
    action: unknown,
  ) {
    try {
      return await this.db.$transaction(
        async (tx) => {
          const actor = await this.authenticate(tx, roomCode, token);
          if (
            typeof commandId !== "string" ||
            commandId.length < 8 ||
            commandId.length > 100
          )
            throw new ServiceError("INVALID_COMMAND_ID");
          if (!this.actionRateLimiter.consume(actor.id))
            throw new ServiceError("RATE_LIMITED", 429);
          validateAction(action);
          return this.applyActionTx(tx, roomCode, actor.id, commandId, action);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof GameRuleError) {
        throw new ServiceError(error.code, 409);
      }
      throw error;
    }
  }

  async auditRealtimeFailure(
    roomCode: string,
    actorId: string,
    error: unknown,
  ): Promise<void> {
    const reasonCode =
      error instanceof ServiceError || error instanceof GameRuleError
        ? error.code
        : undefined;
    await this.db.auditLogEvent
      .create({
        data: {
          eventType: reasonCode
            ? "INVALID_REQUEST_REJECTED"
            : "SERVER_EXCEPTION",
          roomCode,
          actorPlayerId: actorId,
          operationCode: "WEBSOCKET_ACTION",
          ...(reasonCode
            ? { reasonCode }
            : {
                errorType:
                  error instanceof Error
                    ? error.constructor.name.slice(0, 80)
                    : "UNKNOWN",
                errorCode: "INTERNAL_ERROR",
              }),
        },
      })
      .catch(() => undefined);
  }

  private async applyActionTx(
    tx: Prisma.TransactionClient,
    roomCode: string,
    actorId: string,
    commandId: string,
    action: GameAction,
  ) {
    const match = await this.loadState(tx, roomCode);
    const previous = await tx.$queryRaw<
      Array<{ actorId: string }>
    >`SELECT "actorId" FROM "GameCommand" WHERE "roomCode" = ${roomCode} AND "commandId" = ${commandId}`;
    if (previous.length) {
      if (previous[0]!.actorId !== actorId)
        throw new ServiceError("COMMAND_ID_CONFLICT", 409);
      return {
        duplicate: true,
        serverNow: this.now(),
        state: publicGameState(match.state!, actorId),
      };
    }
    const now = this.now();
    const pending = match.state!;
    if (
      action.type === "chooseAuctioneer" &&
      pending.phase === "AUCTIONEER_CHOICE" &&
      pending.auction !== null &&
      pending.auction.paymentDeadlineAt !== null &&
      pending.auction.choiceDeadlineAt !== null &&
      (pending.auction.choicePausedRemainingMs !== null ||
        pending.auction.paymentDeadlineAt <=
          pending.auction.choiceDeadlineAt) &&
      now >= pending.auction.paymentDeadlineAt
    ) {
      const next = structuredClone(pending);
      next.phase = "RULE_DECISION_REQUIRED";
      next.auction!.state = "RULE_DECISION_REQUIRED";
      next.auction!.ruleDecision =
        "AUCTIONEER_CHOICE_AND_BIDDER_PAYMENT_DEADLINE";
      next.version++;
      await tx.$executeRaw`INSERT INTO "GameCommand" ("id", "roomCode", "matchId", "commandId", "actorId") VALUES (${randomUUID()}::uuid, ${roomCode}, ${match.id}::uuid, ${commandId}, ${actorId}::uuid)`;
      await this.saveState(tx, match.id, next);
      await tx.auditLogEvent.create({
        data: {
          eventType: "SERVER_ERROR",
          roomCode,
          matchId: match.id,
          actorPlayerId: actorId,
          operationCode: "RULE_DECISION_HOLD",
          reasonCode: next.auction!.ruleDecision,
          errorCode: "RULE_DECISION_REQUIRED",
        },
      });
      return {
        duplicate: false,
        serverNow: now,
        state: publicGameState(next, actorId),
      };
    }
    const result = applyGameAction(pending, actorId, action, now);
    await tx.$executeRaw`INSERT INTO "GameCommand" ("id", "roomCode", "matchId", "commandId", "actorId") VALUES (${randomUUID()}::uuid, ${roomCode}, ${match.id}::uuid, ${commandId}, ${actorId}::uuid)`;
    await this.saveState(tx, match.id, result.state);
    await this.persistEvents(tx, roomCode, result.events);
    const auditType =
      action.type === "initiateTrade" || action.type === "respondTrade"
        ? "NEGOTIATION_OPERATION_SUCCEEDED"
        : action.type === "confirmPayment"
          ? "PAYMENT_OPERATION_SUCCEEDED"
          : "AUCTION_OPERATION_SUCCEEDED";
    await tx.auditLogEvent.create({
      data: {
        eventType: auditType,
        roomCode,
        matchId: match.id,
        actorPlayerId: actorId,
        operationCode: `GAME_${action.type.toUpperCase()}`,
      },
    });
    if (
      result.state.phase === "COMPLETED" ||
      result.state.phase === "ENDED_NO_RESULT"
    ) {
      const status =
        result.state.phase === "COMPLETED" ? "COMPLETED" : "ENDED_NO_RESULT";
      await tx.match.update({
        where: { id: match.id },
        data: {
          status,
          endedAt: new Date(this.now()),
          endReason: result.state.endReason as never,
        },
      });
      await tx.room.update({
        where: { code: roomCode },
        data: {
          status: "COMPLETED",
          postMatchExpiresAt: new Date(
            this.now() + (status === "COMPLETED" ? 10 * 60_000 : 60_000),
          ),
        },
      });
      for (const score of result.state.results)
        await tx.matchParticipant.update({
          where: {
            roomCode_roomPlayerId: { roomCode, roomPlayerId: score.playerId },
          },
          data: {
            quartetCount: score.quartetCount,
            quartetValueSum: score.quartetValueSum,
            finalScore: score.score,
            isWinner: score.isWinner,
          },
        });
      await tx.auditLogEvent.create({
        data: {
          eventType: "MATCH_ENDED",
          roomCode,
          matchId: match.id,
          operationCode: "MATCH_END",
          reasonCode: result.state.endReason,
        },
      });
    }
    return {
      duplicate: false,
      serverNow: now,
      state: publicGameState(result.state, actorId),
    };
  }

  async processDueTimers(): Promise<number> {
    const rows = await this.db.$queryRaw<
      Array<{ roomCode: string; state: GameState }>
    >`SELECT "roomCode", "state" FROM "Match" WHERE "status" = 'ACTIVE' AND "state" IS NOT NULL`;
    let processed = 0;
    for (const row of rows) {
      const state = row.state;
      if (
        state.phase === "AUCTIONEER_CHOICE" &&
        state.auction?.state === "CHOICE" &&
        state.auction.paymentDeadlineAt !== null &&
        state.auction.choiceDeadlineAt !== null &&
        this.now() >= state.auction.paymentDeadlineAt &&
        (state.auction.choicePausedRemainingMs !== null ||
          state.auction.paymentDeadlineAt <= state.auction.choiceDeadlineAt)
      ) {
        const commandId = `decision:${state.version}:choice-payment-deadline`;
        await this.db.$transaction(
          async (tx) => {
            const match = await this.loadState(tx, row.roomCode);
            if (
              match.version !== state.version ||
              match.state?.phase !== "AUCTIONEER_CHOICE" ||
              !match.state.auction
            )
              return;
            const next = structuredClone(match.state);
            next.phase = "RULE_DECISION_REQUIRED";
            next.auction!.state = "RULE_DECISION_REQUIRED";
            next.auction!.ruleDecision =
              "AUCTIONEER_CHOICE_AND_BIDDER_PAYMENT_DEADLINE";
            next.version++;
            const inserted =
              await tx.$executeRaw`INSERT INTO "GameCommand" ("id", "roomCode", "matchId", "commandId", "actorId") VALUES (${randomUUID()}::uuid, ${row.roomCode}, ${match.id}::uuid, ${commandId}, ${next.auction!.auctioneerId}::uuid) ON CONFLICT ("roomCode", "commandId") DO NOTHING`;
            if (inserted === 0) return;
            await this.saveState(tx, match.id, next);
            await tx.auditLogEvent.create({
              data: {
                eventType: "SERVER_ERROR",
                roomCode: row.roomCode,
                matchId: match.id,
                operationCode: "RULE_DECISION_HOLD",
                reasonCode: next.auction!.ruleDecision,
                errorCode: "RULE_DECISION_REQUIRED",
              },
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        processed++;
        continue;
      }
      let timer: Extract<GameAction, { type: "timer" }> | null = null;
      let actorId: string | null = null;
      let deadline = 0;
      if (state.phase === "AUCTION" && state.auction) {
        timer = { type: "timer", timer: "AUCTION" };
        actorId = state.auction.auctioneerId;
        deadline = state.auction.deadlineAt;
      } else if (state.phase === "AUCTIONEER_CHOICE" && state.auction) {
        timer = { type: "timer", timer: "CHOICE" };
        actorId = state.auction.auctioneerId;
        deadline = state.auction.choiceDeadlineAt ?? Number.MAX_SAFE_INTEGER;
      } else if (state.phase === "PAYMENT" && state.auction) {
        timer = { type: "timer", timer: "PAYMENT" };
        actorId = state.auction.payerId;
        deadline = state.auction.paymentDeadlineAt ?? Number.MAX_SAFE_INTEGER;
      } else if (state.phase === "NEGOTIATION" && state.negotiation) {
        timer = { type: "timer", timer: "NEGOTIATION" };
        actorId = state.negotiation.targetId;
        deadline = state.negotiation.deadlineAt;
      }
      // The exact-deadline request path wins before timers. A timer only runs after that instant.
      if (!timer || !actorId || this.now() <= deadline) continue;
      const commandId = `timer:${state.version}:${timer.timer}:${deadline}`;
      try {
        await this.db.$transaction(
          async (tx) =>
            this.applyActionTx(tx, row.roomCode, actorId!, commandId, timer!),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        processed++;
      } catch (error) {
        if (
          !(error instanceof GameRuleError) &&
          !(error instanceof ServiceError)
        )
          throw error;
      }
    }
    return processed;
  }

  async snapshot(roomCode: string, token: string) {
    return this.db.$transaction(async (tx) => {
      const actor = await this.authenticate(tx, roomCode, token);
      const match = await this.loadState(tx, roomCode);
      const game = publicGameState(match.state!, actor.id);
      const log = await tx.publicGameEvent.findMany({
        where: { roomCode },
        orderBy: { sequence: "asc" },
        select: {
          sequence: true,
          eventType: true,
          occurredAt: true,
          actorPlayerId: true,
          targetPlayerId: true,
          animalType: true,
          animalCardCount: true,
          amount: true,
          outcomeCode: true,
          reasonCode: true,
          submittedMoneyDenominations: true,
          submittedMoneyValue: true,
        },
      });
      return { game, log, serverNow: this.now() };
    });
  }
}
