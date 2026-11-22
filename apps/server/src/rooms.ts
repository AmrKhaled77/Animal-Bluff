import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import {
  markGameDisconnected,
  markGameForfeited,
  markGameReconnected,
  type GameEvent,
  type GameState,
} from "./game-engine.js";

export const ROOM_CAPACITY = 5;
export const LOBBY_DURATION_MS = 30 * 60 * 1000;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
// The Prisma AnimalType enum is the project's built-in animal avatar set.
export const AVATARS = [
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

export type RoomErrorCode =
  | "INVALID_INPUT"
  | "ROOM_NOT_FOUND"
  | "ROOM_FULL"
  | "ROOM_EXPIRED"
  | "ROOM_NOT_LOBBY"
  | "DUPLICATE_NICKNAME"
  | "DUPLICATE_AVATAR"
  | "PLAYER_REMOVED"
  | "HOST_ONLY"
  | "INVALID_AVATAR"
  | "ROOM_CODE_EXHAUSTED"
  | "ROOM_CREATE_FAILED";
export class RoomError extends Error {
  constructor(readonly code: RoomErrorCode) {
    super(code);
  }
}

export type GuestInput = { nickname?: unknown; avatar?: unknown };
type PublicPlayer = {
  id: string;
  nickname: string;
  avatar: string;
  status: string;
  isReady: boolean;
};
type PublicLobby = {
  code: string;
  status: string;
  host: PublicPlayer | null;
  playerCount: number;
  maxPlayers: number;
  lobbyExpiresAt: string;
  players: PublicPlayer[];
};
type GuestResult = {
  playerId: string;
  reconnectToken: string;
  lobby: PublicLobby;
};

function validateGuest(input: GuestInput): {
  nickname: string;
  avatar: (typeof AVATARS)[number];
} {
  const validCharacters =
    typeof input.nickname === "string" &&
    Array.from(input.nickname).every(
      (character) =>
        /^[A-Za-z0-9 ]$/u.test(character) ||
        (/^\p{Script=Arabic}$/u.test(character) &&
          /^[\p{L}\p{M}\p{N}]$/u.test(character)),
    );
  if (
    typeof input.nickname !== "string" ||
    input.nickname.length < 3 ||
    input.nickname.length > 16 ||
    !validCharacters ||
    !/[A-Za-z\p{Script=Arabic}0-9]/u.test(input.nickname)
  ) {
    throw new RoomError("INVALID_INPUT");
  }
  if (
    typeof input.avatar !== "string" ||
    !(AVATARS as readonly string[]).includes(input.avatar)
  ) {
    throw new RoomError("INVALID_AVATAR");
  }
  return {
    nickname: input.nickname,
    avatar: input.avatar as (typeof AVATARS)[number],
  };
}

function newCode(): string {
  return Array.from(
    { length: 6 },
    () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)],
  ).join("");
}

const lobbyInclude = {
  players: {
    orderBy: { joinOrder: "asc" as const },
    select: {
      id: true,
      nickname: true,
      avatar: true,
      status: true,
      isReady: true,
      removedAt: true,
    },
  },
  hostPlayer: {
    select: {
      id: true,
      nickname: true,
      avatar: true,
      status: true,
      isReady: true,
      removedAt: true,
    },
  },
};
type LobbyRecord = Prisma.RoomGetPayload<{ include: typeof lobbyInclude }>;
function publicLobby(room: LobbyRecord): PublicLobby {
  const activePlayers = room.players.filter(
    (player) =>
      player.status !== "FORFEITED" &&
      player.status !== "KICKED" &&
      player.removedAt === null,
  );
  const toPublic = (player: LobbyRecord["players"][number]) => ({
    id: player.id,
    nickname: player.nickname,
    avatar: player.avatar,
    status: player.status,
    isReady: player.isReady,
  });
  return {
    code: room.code,
    status: room.status,
    host: room.hostPlayer ? toPublic(room.hostPlayer) : null,
    playerCount: activePlayers.length,
    maxPlayers: ROOM_CAPACITY,
    lobbyExpiresAt: room.lobbyExpiresAt.toISOString(),
    players: room.players
      .filter(
        (player) =>
          player.status !== "KICKED" &&
          (player.removedAt === null || player.status === "FORFEITED"),
      )
      .map(toPublic),
  };
}

export class RoomService {
  constructor(
    private readonly db: PrismaClient,
    private readonly now = () => new Date(),
  ) {}

  async create(
    input: GuestInput,
  ): Promise<GuestResult & { lobby: PublicLobby }> {
    const guest = validateGuest(input);
    let exhaustedBy: "CODE_COLLISION" | "SERIALIZATION" = "CODE_COLLISION";
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = newCode();
      const playerId = randomUUID();
      const reconnectToken = randomBytes(32).toString("base64url");
      const createdAt = this.now();
      try {
        const lobby = await this.db.$transaction(
          async (tx) => {
            await tx.roomCodeReservation.create({
              data: { code, reservedAt: createdAt },
            });
            await tx.room.create({
              data: {
                code,
                lobbyExpiresAt: new Date(
                  createdAt.getTime() + LOBBY_DURATION_MS,
                ),
                createdAt,
              },
            });
            await tx.roomPlayer.create({
              data: {
                id: playerId,
                roomCode: code,
                nickname: guest.nickname,
                avatar: guest.avatar,
                joinOrder: 1,
                reconnectToken,
                joinedAt: createdAt,
              },
            });
            await tx.room.update({
              where: { code },
              data: { hostPlayerId: playerId },
              include: lobbyInclude,
            });
            await this.appendRoomEvent(tx, code, "ROOM_CREATED", playerId);
            await tx.auditLogEvent.create({
              data: {
                eventType: "ROOM_CREATED",
                roomCode: code,
                actorPlayerId: playerId,
                operationCode: "ROOM_CREATE",
              },
            });
            return tx.room.findUniqueOrThrow({
              where: { code },
              include: lobbyInclude,
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        return { playerId, reconnectToken, lobby: publicLobby(lobby) };
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          // A reserved code collision is retried; other unique violations are input conflicts.
          if (
            String(error.meta?.target ?? "").includes("code") ||
            String(error.meta?.modelName ?? "").includes("RoomCodeReservation")
          ) {
            exhaustedBy = "CODE_COLLISION";
            continue;
          }
          if (String(error.meta?.target ?? "").includes("nickname"))
            throw new RoomError("DUPLICATE_NICKNAME");
        }
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2034"
        ) {
          exhaustedBy = "SERIALIZATION";
          continue;
        }
        throw error;
      }
    }
    throw new RoomError(
      exhaustedBy === "SERIALIZATION"
        ? "ROOM_CREATE_FAILED"
        : "ROOM_CODE_EXHAUSTED",
    );
  }

  async join(codeInput: string, input: GuestInput): Promise<GuestResult> {
    return this.joinAttempt(codeInput, input, 0);
  }

  private async joinAttempt(
    codeInput: string,
    input: GuestInput,
    retry: number,
  ): Promise<GuestResult> {
    const guest = validateGuest(input);
    const code = codeInput.toUpperCase();
    const playerId = randomUUID();
    const reconnectToken = randomBytes(32).toString("base64url");
    try {
      const lobby = await this.db.$transaction(
        async (tx) => {
          const room = await tx.room.findUnique({
            where: { code },
            include: {
              players: {
                select: {
                  id: true,
                  joinOrder: true,
                  status: true,
                  removedAt: true,
                  avatar: true,
                },
              },
            },
          });
          if (!room) throw new RoomError("ROOM_NOT_FOUND");
          const now = this.now();
          if (room.status !== "LOBBY") throw new RoomError("ROOM_NOT_LOBBY");
          if (room.lobbyExpiresAt <= now) throw new RoomError("ROOM_EXPIRED");
          if (room.hostlessExpiresAt && room.hostlessExpiresAt <= now)
            throw new RoomError("ROOM_EXPIRED");
          const slotCount = room.players.filter(
            (player) =>
              player.status !== "FORFEITED" &&
              player.status !== "KICKED" &&
              player.removedAt === null,
          ).length;
          if (slotCount >= ROOM_CAPACITY) throw new RoomError("ROOM_FULL");
          if (
            room.players.some(
              (player) =>
                player.avatar === guest.avatar &&
                player.status !== "FORFEITED" &&
                player.status !== "KICKED" &&
                player.removedAt === null,
            )
          )
            throw new RoomError("DUPLICATE_AVATAR");
          const nextOrder =
            room.players.reduce(
              (max, player) => Math.max(max, player.joinOrder),
              0,
            ) + 1;
          await tx.roomPlayer.create({
            data: {
              id: playerId,
              roomCode: code,
              nickname: guest.nickname,
              avatar: guest.avatar,
              joinOrder: nextOrder,
              reconnectToken,
              joinedAt: now,
            },
          });
          if (!room.hostPlayerId) {
            const successor = room.players
              .filter(
                (player) =>
                  player.status === "CONNECTED" && player.removedAt === null,
              )
              .sort((a, b) => a.joinOrder - b.joinOrder)[0];
            await tx.room.update({
              where: { code },
              data: {
                hostPlayerId: successor?.id ?? playerId,
                hostlessExpiresAt: null,
              },
            });
            const nextHostId = successor?.id ?? playerId;
            await this.appendRoomEvent(
              tx,
              code,
              "HOST_TRANSFERRED",
              nextHostId,
              playerId,
            );
            await tx.auditLogEvent.create({
              data: {
                eventType: "HOST_TRANSFERRED",
                roomCode: code,
                actorPlayerId: nextHostId,
                subjectPlayerId: playerId,
                operationCode: "HOSTLESS_HOST_ASSIGNMENT",
              },
            });
          }
          await this.appendRoomEvent(tx, code, "PLAYER_JOINED", playerId);
          await tx.auditLogEvent.create({
            data: {
              eventType: "PLAYER_JOINED",
              roomCode: code,
              actorPlayerId: playerId,
              operationCode: "ROOM_JOIN",
            },
          });
          return tx.room.findUniqueOrThrow({
            where: { code },
            include: lobbyInclude,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return { playerId, reconnectToken, lobby: publicLobby(lobby) };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === "P2002") throw new RoomError("DUPLICATE_NICKNAME");
        if (error.code === "P2034" && retry < 5)
          return this.joinAttempt(code, input, retry + 1);
      }
      throw error;
    }
  }

  async getLobby(codeInput: string): Promise<PublicLobby> {
    const room = await this.db.room.findUnique({
      where: { code: codeInput.toUpperCase() },
      include: lobbyInclude,
    });
    if (!room) throw new RoomError("ROOM_NOT_FOUND");
    return publicLobby(room);
  }

  async updateProfile(
    roomCodeInput: string,
    token: string,
    input: GuestInput,
  ): Promise<PublicLobby> {
    const guest = validateGuest(input);
    const roomCode = roomCodeInput.toUpperCase();
    return this.db.$transaction(
      async (tx) => {
        const player = await this.ownedPlayer(tx, roomCode, token);
        const room = await tx.room.findUnique({
          where: { code: roomCode },
          select: { status: true },
        });
        if (!room) throw new RoomError("ROOM_NOT_FOUND");
        if (room.status !== "LOBBY") throw new RoomError("ROOM_NOT_LOBBY");
        const nicknameTaken = await tx.roomPlayer.findFirst({
          where: {
            roomCode,
            id: { not: player.id },
            nickname: guest.nickname,
            removedAt: null,
            status: { notIn: ["KICKED", "FORFEITED"] },
          },
          select: { id: true },
        });
        if (nicknameTaken) throw new RoomError("DUPLICATE_NICKNAME");
        const avatarTaken = await tx.roomPlayer.findFirst({
          where: {
            roomCode,
            id: { not: player.id },
            avatar: guest.avatar,
            removedAt: null,
            status: { notIn: ["KICKED", "FORFEITED"] },
          },
          select: { id: true },
        });
        if (avatarTaken) throw new RoomError("DUPLICATE_AVATAR");
        await tx.roomPlayer.update({
          where: { id: player.id },
          data: { nickname: guest.nickname, avatar: guest.avatar },
        });
        return publicLobby(
          await tx.room.findUniqueOrThrow({
            where: { code: roomCode },
            include: lobbyInclude,
          }),
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async ownedPlayer(
    tx: Prisma.TransactionClient,
    roomCode: string,
    token: string,
  ) {
    if (typeof token !== "string" || token.length < 40 || token.length > 100)
      throw new RoomError("INVALID_INPUT");
    const player = await tx.roomPlayer.findUnique({
      where: { reconnectToken: token },
    });
    if (!player || player.roomCode !== roomCode)
      throw new RoomError("ROOM_NOT_FOUND");
    return player;
  }

  private async appendRoomEvent(
    tx: Prisma.TransactionClient,
    roomCode: string,
    eventType:
      | "ROOM_CREATED"
      | "PLAYER_JOINED"
      | "PLAYER_DISCONNECTED"
      | "PLAYER_RECONNECTED"
      | "PLAYER_FORFEITED"
      | "PLAYER_LEFT"
      | "HOST_TRANSFERRED",
    actorPlayerId: string,
    targetPlayerId?: string,
  ) {
    await this.persistGameEvent(tx, roomCode, {
      type: eventType,
      actorId: actorPlayerId,
      targetId: targetPlayerId,
    });
  }

  private async persistGameEvent(
    tx: Prisma.TransactionClient,
    roomCode: string,
    event: GameEvent,
  ) {
    await tx.$queryRaw`SELECT "code" FROM "Room" WHERE "code" = ${roomCode} FOR UPDATE`;
    const current = await tx.publicGameEvent.aggregate({
      where: { roomCode },
      _max: { sequence: true },
    });
    await tx.publicGameEvent.create({
      data: {
        roomCode,
        sequence: (current._max.sequence ?? 0) + 1,
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

  private async updateMatchConnection(
    tx: Prisma.TransactionClient,
    roomCode: string,
    playerId: string,
    change: "DISCONNECTED" | "RECONNECTED" | "FORFEITED",
    now: Date,
  ) {
    const rows = await tx.$queryRaw<
      Array<{ id: string; state: GameState | null }>
    >`SELECT "id", "state" FROM "Match" WHERE "roomCode" = ${roomCode} AND "status" = 'ACTIVE' FOR UPDATE`;
    const match = rows[0];
    if (!match?.state) return null;
    const matchPlayer = match.state.players.find(
      (player) => player.id === playerId,
    );
    // A concurrent disconnect can win the match-state update after another
    // caller has read the still-connected room row. Treat that exact transition
    // as already applied; the caller reconciles the room row below.
    if (change === "DISCONNECTED" && matchPlayer?.status === "DISCONNECTED")
      return match.state;
    const result =
      change === "DISCONNECTED"
        ? markGameDisconnected(match.state, playerId, now.getTime())
        : change === "RECONNECTED"
          ? markGameReconnected(match.state, playerId, now.getTime())
          : markGameForfeited(match.state, playerId, now.getTime());
    const phase =
      result.state.phase === "RULE_DECISION_REQUIRED"
        ? "PAYMENT"
        : result.state.phase;
    await tx.$executeRaw`UPDATE "Match" SET "state" = ${JSON.stringify(result.state)}::jsonb, "phase" = ${phase}::"MatchPhase", "version" = "version" + 1 WHERE "id" = ${match.id}::uuid`;
    for (const event of result.events) {
      if (event.type === "RULE_DECISION_REQUIRED") continue;
      await this.persistGameEvent(tx, roomCode, {
        ...event,
        actorId: event.actorId ?? playerId,
      });
    }
    if (
      result.state.phase === "ENDED_NO_RESULT" ||
      result.state.phase === "COMPLETED"
    ) {
      const noResult = result.state.phase === "ENDED_NO_RESULT";
      await tx.match.update({
        where: { id: match.id },
        data: {
          status: noResult ? "ENDED_NO_RESULT" : "COMPLETED",
          endReason: result.state.endReason as never,
          endedAt: now,
        },
      });
      await tx.room.update({
        where: { code: roomCode },
        data: {
          status: "COMPLETED",
          postMatchExpiresAt: new Date(
            now.getTime() + (noResult ? 60_000 : 10 * 60_000),
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
    if (result.state.phase === "RULE_DECISION_REQUIRED") {
      await tx.auditLogEvent.create({
        data: {
          eventType: "SERVER_ERROR",
          roomCode,
          matchId: match.id,
          operationCode: "RULE_DECISION_HOLD",
          reasonCode:
            result.state.auction?.ruleDecision ?? "UNSPECIFIED_GAME_EDGE",
          errorCode: "RULE_DECISION_REQUIRED",
        },
      });
    }
    return result.state;
  }

  async heartbeat(roomCode: string, token: string): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const player = await this.ownedPlayer(tx, roomCode, token);
      if (player.status !== "CONNECTED") throw new RoomError("INVALID_INPUT");
      await tx.roomPlayer.update({
        where: { id: player.id },
        data: { status: "CONNECTED" },
      });
    });
  }

  async realtimeIdentity(roomCodeInput: string, token: string) {
    if (typeof token !== "string" || token.length < 40 || token.length > 100)
      throw new RoomError("INVALID_INPUT");
    const player = await this.db.roomPlayer.findUnique({
      where: { reconnectToken: token },
      select: { id: true, roomCode: true, status: true },
    });
    if (!player || player.roomCode !== roomCodeInput.toUpperCase())
      throw new RoomError("ROOM_NOT_FOUND");
    return { playerId: player.id, status: player.status };
  }

  async auditRealtimeAuthFailure(
    roomCode: string,
    reasonCode: string,
  ): Promise<void> {
    await this.db.auditLogEvent
      .create({
        data: {
          eventType: "INVALID_REQUEST_REJECTED",
          roomCode: /^[A-Z0-9]{6}$/u.test(roomCode) ? roomCode : undefined,
          operationCode: "WEBSOCKET_AUTH",
          reasonCode,
        },
      })
      .catch(() => undefined);
  }

  async markStaleConnections(): Promise<number> {
    const threshold = new Date(this.now().getTime() - 12_000);
    const stale = await this.db.roomPlayer.findMany({
      where: {
        status: "CONNECTED",
        updatedAt: { lt: threshold },
        reconnectToken: { not: null },
      },
      select: { id: true, roomCode: true, reconnectToken: true },
    });
    for (const player of stale) {
      if (player.reconnectToken)
        await this.disconnect(
          player.roomCode,
          player.reconnectToken,
          threshold,
        );
    }
    return stale.length;
  }

  async disconnect(
    roomCode: string,
    token: string,
    staleBefore?: Date,
  ): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const player = await this.ownedPlayer(tx, roomCode, token);
      if (staleBefore && player.updatedAt >= staleBefore) return;
      if (player.status !== "CONNECTED") return;
      const now = this.now();
      const disconnected = await tx.roomPlayer.updateMany({
        where: {
          id: player.id,
          status: "CONNECTED",
          ...(staleBefore ? { updatedAt: { lt: staleBefore } } : {}),
        },
        data: {
          status: "DISCONNECTED",
          isReady: false,
          disconnectedAt: now,
          reconnectExpiresAt: new Date(now.getTime() + 60_000),
        },
      });
      if (disconnected.count === 0) return;
      const gameState = await this.updateMatchConnection(
        tx,
        roomCode,
        player.id,
        "DISCONNECTED",
        now,
      );
      const matchPlayer = gameState?.players.find(
        (candidate) => candidate.id === player.id,
      );
      if (
        matchPlayer?.status === "DISCONNECTED" &&
        matchPlayer.reconnectExpiresAt !== null &&
        matchPlayer.reconnectExpiresAt !== undefined
      ) {
        const matchDeadline = new Date(matchPlayer.reconnectExpiresAt);
        if (matchDeadline.getTime() !== now.getTime() + 60_000)
          await tx.roomPlayer.update({
            where: { id: player.id },
            data: { reconnectExpiresAt: matchDeadline },
          });
      }
      const room = await tx.room.findUniqueOrThrow({
        where: { code: roomCode },
        select: { hostPlayerId: true },
      });
      if (!gameState)
        await this.appendRoomEvent(
          tx,
          roomCode,
          "PLAYER_DISCONNECTED",
          player.id,
        );
      await tx.auditLogEvent.create({
        data: {
          eventType: "PLAYER_DISCONNECTED",
          roomCode,
          actorPlayerId: player.id,
          operationCode: "PLAYER_DISCONNECT",
        },
      });
      if (room.hostPlayerId === player.id) {
        const successor = await tx.roomPlayer.findFirst({
          where: { roomCode, status: "CONNECTED" },
          orderBy: { joinOrder: "asc" },
          select: { id: true },
        });
        await tx.room.update({
          where: { code: roomCode },
          data: {
            hostPlayerId: successor?.id ?? null,
            hostlessExpiresAt: successor
              ? null
              : new Date(now.getTime() + 60_000),
          },
        });
        if (successor) {
          await this.appendRoomEvent(
            tx,
            roomCode,
            "HOST_TRANSFERRED",
            player.id,
            successor.id,
          );
          await tx.auditLogEvent.create({
            data: {
              eventType: "HOST_TRANSFERRED",
              roomCode,
              actorPlayerId: player.id,
              subjectPlayerId: successor.id,
              operationCode: "HOST_RECONNECTED_ASSIGNMENT",
            },
          });
          await tx.auditLogEvent.create({
            data: {
              eventType: "HOST_TRANSFERRED",
              roomCode,
              actorPlayerId: player.id,
              subjectPlayerId: successor.id,
              operationCode: "HOST_TRANSFER",
            },
          });
        }
      }
    });
  }

  async reconnect(
    roomCode: string,
    token: string,
    playerId?: string,
  ): Promise<PublicLobby> {
    return this.db.$transaction(async (tx) => {
      let player: Prisma.RoomPlayerGetPayload<object>;
      try {
        player = await this.ownedPlayer(tx, roomCode, token);
      } catch (error) {
        if (
          error instanceof RoomError &&
          error.code === "ROOM_NOT_FOUND" &&
          playerId
        ) {
          const removedPlayer = await tx.roomPlayer.findFirst({
            where: { id: playerId, roomCode, status: "KICKED" },
            select: { id: true },
          });
          if (removedPlayer) throw new RoomError("PLAYER_REMOVED");
        }
        throw error;
      }
      const now = this.now();
      if (
        player.status !== "DISCONNECTED" ||
        !player.reconnectExpiresAt ||
        player.reconnectExpiresAt < now
      )
        throw new RoomError("ROOM_NOT_LOBBY");
      await tx.roomPlayer.update({
        where: { id: player.id },
        data: {
          status: "CONNECTED",
          isReady: false,
          disconnectedAt: null,
          reconnectExpiresAt: null,
        },
      });
      const gameState = await this.updateMatchConnection(
        tx,
        roomCode,
        player.id,
        "RECONNECTED",
        now,
      );
      const room = await tx.room.findUniqueOrThrow({
        where: { code: roomCode },
        include: {
          players: {
            orderBy: { joinOrder: "asc" },
            select: { id: true, status: true, joinOrder: true },
          },
        },
      });
      if (!room.hostPlayerId) {
        const successor = room.players
          .filter((candidate) => candidate.status === "CONNECTED")
          .sort((a, b) => a.joinOrder - b.joinOrder)[0];
        if (successor) {
          await tx.room.update({
            where: { code: roomCode },
            data: { hostPlayerId: successor.id, hostlessExpiresAt: null },
          });
          await this.appendRoomEvent(
            tx,
            roomCode,
            "HOST_TRANSFERRED",
            player.id,
            successor.id,
          );
        }
      }
      if (!gameState)
        await this.appendRoomEvent(
          tx,
          roomCode,
          "PLAYER_RECONNECTED",
          player.id,
        );
      await tx.auditLogEvent.create({
        data: {
          eventType: "PLAYER_RECONNECTED",
          roomCode,
          actorPlayerId: player.id,
          operationCode: "PLAYER_RECONNECT",
        },
      });
      const lobby = await tx.room.findUniqueOrThrow({
        where: { code: roomCode },
        include: lobbyInclude,
      });
      return publicLobby(lobby);
    });
  }

  async kick(
    roomCode: string,
    token: string,
    targetId: string,
  ): Promise<PublicLobby> {
    return this.db.$transaction(async (tx) => {
      const host = await this.ownedPlayer(tx, roomCode, token);
      const room = await tx.room.findUnique({
        where: { code: roomCode },
        select: { status: true, hostPlayerId: true },
      });
      if (!room) throw new RoomError("ROOM_NOT_FOUND");
      if (room.status !== "LOBBY") throw new RoomError("ROOM_NOT_LOBBY");
      if (room.hostPlayerId !== host.id) throw new RoomError("HOST_ONLY");
      if (targetId === host.id) throw new RoomError("INVALID_INPUT");
      const target = await tx.roomPlayer.findFirst({
        where: { id: targetId, roomCode },
      });
      if (!target || target.removedAt !== null)
        throw new RoomError("ROOM_NOT_FOUND");
      const now = this.now();
      await tx.roomPlayer.update({
        where: { id: target.id },
        data: {
          status: "KICKED",
          isReady: false,
          reconnectToken: null,
          reconnectExpiresAt: null,
          removedAt: now,
        },
      });
      await this.appendRoomEvent(
        tx,
        roomCode,
        "PLAYER_LEFT",
        target.id,
        host.id,
      );
      await tx.auditLogEvent.create({
        data: {
          eventType: "PLAYER_LEFT",
          roomCode,
          actorPlayerId: host.id,
          subjectPlayerId: target.id,
          operationCode: "PLAYER_KICK",
        },
      });
      return publicLobby(
        await tx.room.findUniqueOrThrow({
          where: { code: roomCode },
          include: lobbyInclude,
        }),
      );
    });
  }

  async close(roomCode: string, token: string): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const host = await this.ownedPlayer(tx, roomCode, token);
      const room = await tx.room.findUnique({
        where: { code: roomCode },
        select: { status: true, hostPlayerId: true },
      });
      if (!room) throw new RoomError("ROOM_NOT_FOUND");
      if (room.status !== "LOBBY") throw new RoomError("ROOM_NOT_LOBBY");
      if (room.hostPlayerId !== host.id) throw new RoomError("HOST_ONLY");
      await tx.room.delete({ where: { code: roomCode } });
      await tx.auditLogEvent.create({
        data: {
          eventType: "ROOM_DELETED",
          roomCode,
          actorPlayerId: host.id,
          operationCode: "HOST_CLOSED_ROOM",
        },
      });
    });
  }

  async forfeitExpired(): Promise<number> {
    const now = this.now();
    const expired = await this.db.roomPlayer.findMany({
      where: { status: "DISCONNECTED", reconnectExpiresAt: { lt: now } },
      select: { id: true, roomCode: true },
    });
    let count = 0;
    for (const item of expired) {
      await this.db.$transaction(async (tx) => {
        const player = await tx.roomPlayer.findFirst({
          where: {
            id: item.id,
            roomCode: item.roomCode,
            status: "DISCONNECTED",
            reconnectExpiresAt: { lt: now },
          },
          select: { id: true, roomCode: true },
        });
        if (!player) return;
        await tx.roomPlayer.update({
          where: { id: player.id },
          data: {
            status: "FORFEITED",
            isReady: false,
            reconnectToken: null,
            reconnectExpiresAt: null,
            forfeitedAt: now,
            removedAt: now,
          },
        });
        const gameState = await this.updateMatchConnection(
          tx,
          player.roomCode,
          player.id,
          "FORFEITED",
          now,
        );
        if (!gameState)
          await this.appendRoomEvent(
            tx,
            player.roomCode,
            "PLAYER_FORFEITED",
            player.id,
          );
        await tx.auditLogEvent.create({
          data: {
            eventType: "PLAYER_FORFEITED",
            roomCode: player.roomCode,
            actorPlayerId: player.id,
            operationCode: "PLAYER_FORFEIT",
          },
        });
        count++;
      });
    }
    return count;
  }

  async cleanupExpired(): Promise<number> {
    const now = this.now();
    const expiredRooms = await this.db.room.findMany({
      where: {
        OR: [
          { status: "LOBBY", lobbyExpiresAt: { lte: now } },
          { hostlessExpiresAt: { lte: now } },
          { postMatchExpiresAt: { lte: now } },
        ],
      },
      select: { code: true },
    });
    let removed = 0;
    for (const { code } of expiredRooms) {
      await this.db.$transaction(async (tx) => {
        const result = await tx.room.deleteMany({
          where: {
            code,
            OR: [
              { status: "LOBBY", lobbyExpiresAt: { lte: now } },
              { hostlessExpiresAt: { lte: now } },
              { postMatchExpiresAt: { lte: now } },
            ],
          },
        });
        if (result.count === 0) return;
        await tx.auditLogEvent.create({
          data: {
            eventType: "ROOM_DELETED",
            roomCode: code,
            operationCode: "ROOM_EXPIRY_CLEANUP",
          },
        });
        removed++;
      });
    }
    return removed;
  }

  async pruneAuditLog(): Promise<number> {
    const cutoff = new Date(this.now().getTime() - 90 * 24 * 60 * 60 * 1000);
    const result = await this.db.auditLogEvent.deleteMany({
      where: { occurredAt: { lt: cutoff } },
    });
    return result.count;
  }
}
