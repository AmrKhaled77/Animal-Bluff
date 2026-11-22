import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createInitialGame, type GameState } from "./game-engine.js";
import { RoomService, RoomError, type GuestInput } from "./rooms.js";

type Player = {
  id: string;
  roomCode: string;
  nickname: string;
  avatar: string;
  joinOrder: number;
  status: string;
  isReady: boolean;
  reconnectToken: string | null;
  reconnectExpiresAt?: Date | null;
  removedAt: Date | null;
  updatedAt?: Date;
};
type Room = {
  code: string;
  status: string;
  hostPlayerId: string | null;
  lobbyExpiresAt: Date;
  createdAt: Date;
};

// Deterministic in-memory Prisma-shaped adapter lets service rules run without touching DATABASE_URL.
class MemoryDb {
  reservations = new Set<string>();
  rooms = new Map<string, Room>();
  players: Player[] = [];
  auditEvents: Array<{
    eventType: string;
    occurredAt: Date;
    roomCode?: string;
  }> = [];
  publicEvents: Array<{
    roomCode: string;
    sequence: number;
    eventType: string;
  }> = [];
  activeMatch: { id: string; state: GameState } | null = null;
  private chain: Promise<void> = Promise.resolve();
  roomCodeReservation = {
    create: async ({ data }: { data: { code: string } }) => {
      if (this.reservations.has(data.code))
        throw new Error("reservation collision");
      this.reservations.add(data.code);
    },
  };
  roomPlayer = {
    create: async ({
      data,
    }: {
      data: Omit<Player, "status" | "isReady" | "removedAt">;
    }) => {
      if (
        this.players.some(
          (p) =>
            p.roomCode === data.roomCode &&
            p.nickname === data.nickname &&
            p.removedAt === null,
        )
      )
        throw new RoomError("DUPLICATE_NICKNAME");
      this.players.push({
        ...data,
        status: "CONNECTED",
        isReady: false,
        removedAt: null,
        updatedAt: new Date(),
      });
    },
    findUnique: async ({
      where,
    }: {
      where: { reconnectToken?: string; id?: string };
    }) =>
      this.players.find(
        (player) =>
          (where.reconnectToken === undefined ||
            player.reconnectToken === where.reconnectToken) &&
          (where.id === undefined || player.id === where.id),
      ) ?? null,
    findFirst: async ({
      where,
    }: {
      where: {
        roomCode: string;
        id?: { not: string } | string;
        nickname?: string;
        avatar?: string;
        status?: { notIn: string[] } | string;
      };
    }) =>
      this.players.find(
        (player) =>
          player.roomCode === where.roomCode &&
          (!where.id ||
            (typeof where.id === "string"
              ? player.id === where.id
              : player.id !== where.id.not)) &&
          (!where.nickname || player.nickname === where.nickname) &&
          (!where.avatar || player.avatar === where.avatar) &&
          (!where.status ||
            (typeof where.status === "string"
              ? player.status === where.status
              : !where.status.notIn.includes(player.status))),
      ) ?? null,
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Partial<Player>;
    }) => {
      const player = this.players.find(
        (candidate) => candidate.id === where.id,
      );
      if (!player) throw new Error("Player not found");
      Object.assign(player, data);
      return player;
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: {
        id: string;
        status: string;
        updatedAt?: { lt: Date };
      };
      data: Partial<Player>;
    }) => {
      const player = this.players.find(
        (candidate) => candidate.id === where.id,
      );
      if (
        !player ||
        player.status !== where.status ||
        (where.updatedAt &&
          (!player.updatedAt || player.updatedAt >= where.updatedAt.lt))
      )
        return { count: 0 };
      Object.assign(player, data, { updatedAt: new Date() });
      return { count: 1 };
    },
  };
  room = {
    create: async ({ data }: { data: Room }) => {
      this.rooms.set(data.code, {
        ...data,
        status: "LOBBY",
        hostPlayerId: null,
      });
    },
    update: async ({
      where,
      data,
    }: {
      where: { code: string };
      data: { hostPlayerId: string };
    }) => {
      const room = this.rooms.get(where.code)!;
      room.hostPlayerId = data.hostPlayerId;
    },
    findUnique: async ({ where }: { where: { code: string } }) => {
      const room = this.rooms.get(where.code);
      if (!room) return null;
      const publicPlayer = (player: Player | undefined) =>
        player && {
          id: player.id,
          nickname: player.nickname,
          avatar: player.avatar,
          status: player.status,
          isReady: false,
          removedAt: player.removedAt,
        };
      return {
        ...room,
        players: this.players
          .filter((p) => p.roomCode === room.code)
          .map((p) => publicPlayer(p)),
        hostPlayer: publicPlayer(
          this.players.find((p) => p.id === room.hostPlayerId),
        ),
      };
    },
    findUniqueOrThrow: async ({ where }: { where: { code: string } }) =>
      this.room.findUnique({ where }),
    findMany: async ({
      where,
    }: {
      where: { OR: Array<Record<string, unknown>> };
    }) =>
      [...this.rooms.values()]
        .filter((room) =>
          where.OR.some((filter) => {
            if (filter.status && filter.status !== room.status) return false;
            const deadline = filter.lobbyExpiresAt as { lte: Date } | undefined;
            return Boolean(deadline && room.lobbyExpiresAt <= deadline.lte);
          }),
        )
        .map(({ code }) => ({ code })),
    deleteMany: async ({
      where,
    }: {
      where: { code: string; OR: Array<Record<string, unknown>> };
    }) => {
      const room = this.rooms.get(where.code);
      const shouldDelete =
        room &&
        where.OR.some((filter) => {
          if (filter.status && filter.status !== room.status) return false;
          const deadline = filter.lobbyExpiresAt as { lte: Date } | undefined;
          return Boolean(deadline && room.lobbyExpiresAt <= deadline.lte);
        });
      if (!shouldDelete) return { count: 0 };
      this.rooms.delete(where.code);
      this.players = this.players.filter(
        (player) => player.roomCode !== where.code,
      );
      return { count: 1 };
    },
  };
  auditLogEvent = {
    create: async ({
      data,
    }: {
      data: { eventType: string; roomCode?: string };
    }) => {
      this.auditEvents.push({ ...data, occurredAt: new Date() });
    },
    deleteMany: async ({ where }: { where: { occurredAt: { lt: Date } } }) => {
      const priorCount = this.auditEvents.length;
      this.auditEvents = this.auditEvents.filter(
        (event) => event.occurredAt >= where.occurredAt.lt,
      );
      return { count: priorCount - this.auditEvents.length };
    },
  };
  publicGameEvent = {
    aggregate: async ({ where }: { where: { roomCode: string } }) => {
      const entries = this.publicEvents.filter(
        (event) => event.roomCode === where.roomCode,
      );
      return {
        _max: { sequence: Math.max(0, ...entries.map((e) => e.sequence)) },
      };
    },
    create: async ({
      data,
    }: {
      data: { roomCode: string; sequence: number; eventType: string };
    }) => {
      this.publicEvents.push(data);
    },
  };
  async $queryRaw(strings: TemplateStringsArray) {
    if (strings.join("").includes('FROM "Match"') && this.activeMatch)
      return [this.activeMatch];
    return [];
  }
  async $transaction<T>(callback: (tx: this) => Promise<T>): Promise<T> {
    let release!: () => void;
    const prior = this.chain;
    this.chain = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prior;
    try {
      return await callback(this);
    } finally {
      release();
    }
  }
}

const guest = (nickname: string, avatar = "HORSE"): GuestInput => ({
  nickname,
  avatar,
});
function service(db = new MemoryDb(), now = new Date("2026-01-01T00:00:00Z")) {
  return { db, rooms: new RoomService(db as never, () => new Date(now)) };
}

describe("room creation and guest lobby", () => {
  it("reconciles a stale room record when the match already recorded disconnect", async () => {
    const { db, rooms } = service();
    const host = await rooms.create(guest("Host"));
    const game = createInitialGame(
      [
        {
          id: host.playerId,
          nickname: "Host",
          avatar: "HORSE",
          joinOrder: 1,
          status: "CONNECTED",
        },
        {
          id: "player-two",
          nickname: "Guest Two",
          avatar: "COW",
          joinOrder: 2,
          status: "CONNECTED",
        },
        {
          id: "player-three",
          nickname: "Guest Three",
          avatar: "PIG",
          joinOrder: 3,
          status: "CONNECTED",
        },
      ],
      new Date("2026-01-01T00:00:00Z").getTime(),
    );
    game.players[0]!.status = "DISCONNECTED";
    game.players[0]!.reconnectExpiresAt = new Date(
      "2026-01-01T00:00:30Z",
    ).getTime();
    db.activeMatch = { id: "match-a", state: game };
    const publicEventsBefore = db.publicEvents.length;

    await rooms.disconnect(host.lobby.code, host.reconnectToken);

    assert.equal(db.players[0]?.status, "DISCONNECTED");
    assert.equal(
      db.players[0]?.reconnectExpiresAt?.getTime(),
      game.players[0]?.reconnectExpiresAt,
    );
    assert.equal(db.publicEvents.length, publicEventsBefore);
  });

  it("ignores a stale scan that loses the atomic disconnect update", async () => {
    const { db, rooms } = service();
    const host = await rooms.create(guest("Host"));
    const updateMany = db.roomPlayer.updateMany;
    db.roomPlayer.updateMany = async ({ where }) => {
      const player = db.players.find((candidate) => candidate.id === where.id);
      if (player) player.status = "DISCONNECTED";
      return { count: 0 };
    };

    await rooms.disconnect(host.lobby.code, host.reconnectToken);

    assert.equal(db.players[0]?.status, "DISCONNECTED");
    assert.equal(db.publicEvents.length, 1);
    db.roomPlayer.updateMany = updateMany;
  });

  it("creates a reserved lobby, assigns creator as host, and sets the 30-minute deadline", async () => {
    const { db, rooms } = service();
    const result = await rooms.create(guest("Amr"));
    assert.equal(db.reservations.has(result.lobby.code), true);
    assert.equal(result.lobby.host?.id, result.playerId);
    assert.equal(result.lobby.playerCount, 1);
    assert.equal(result.lobby.lobbyExpiresAt, "2026-01-01T00:30:00.000Z");
    assert.equal(result.lobby.status, "LOBBY");
    assert.equal(db.players[0]?.joinOrder, 1);
    assert.deepEqual(
      db.publicEvents.map((event) => event.eventType),
      ["ROOM_CREATED"],
    );
  });

  it("joins successfully, returns private credentials only to the joining caller", async () => {
    const { db, rooms } = service();
    const created = await rooms.create(guest("Amr"));
    const joined = await rooms.join(
      created.lobby.code,
      guest("Guest 2", "CAT"),
    );
    assert.equal(joined.playerId.length > 0, true);
    assert.equal(joined.reconnectToken.length >= 40, true);
    assert.equal(joined.lobby.playerCount, 2);
    assert.equal(
      db.publicEvents.filter((event) => event.eventType === "PLAYER_JOINED")
        .length,
      1,
    );
    assert.equal(
      joined.lobby.players.some((player) => "reconnectToken" in player),
      false,
    );
    assert.equal(
      JSON.stringify(await rooms.getLobby(created.lobby.code)).includes(
        joined.reconnectToken,
      ),
      false,
    );
  });

  it("binds realtime authentication tokens to one player identity and status", async () => {
    const { db, rooms } = service();
    const created = await rooms.create(guest("Amr"));
    assert.deepEqual(
      await rooms.realtimeIdentity(created.lobby.code, created.reconnectToken),
      { playerId: created.playerId, status: "CONNECTED" },
    );
    db.players[0]!.status = "DISCONNECTED";
    assert.deepEqual(
      await rooms.realtimeIdentity(created.lobby.code, created.reconnectToken),
      { playerId: created.playerId, status: "DISCONNECTED" },
    );
    await assert.rejects(
      rooms.realtimeIdentity(`${created.lobby.code}X`, created.reconnectToken),
      (error: unknown) =>
        error instanceof RoomError && error.code === "ROOM_NOT_FOUND",
    );
  });

  it("allows lobby identity changes without resetting Ready and protects avatar uniqueness", async () => {
    const { db, rooms } = service();
    const host = await rooms.create(guest("Host", "HORSE"));
    await rooms.join(host.lobby.code, guest("Guest", "CAT"));
    db.players[0]!.isReady = true;
    await assert.rejects(
      rooms.updateProfile(host.lobby.code, host.reconnectToken, {
        nickname: "New Host",
        avatar: "CAT",
      }),
      (error: unknown) =>
        error instanceof RoomError && error.code === "DUPLICATE_AVATAR",
    );
    const updated = await rooms.updateProfile(
      host.lobby.code,
      host.reconnectToken,
      { nickname: "New Host", avatar: "SHEEP" },
    );
    assert.equal(updated.host?.nickname, "New Host");
    assert.equal(db.players[0]?.isReady, true);
  });

  it("lets a kicked guest rejoin as a new identity and reports the removal", async () => {
    const { rooms } = service();
    const host = await rooms.create(guest("Host", "HORSE"));
    const oldGuest = await rooms.join(host.lobby.code, guest("Guest", "CAT"));
    await rooms.kick(host.lobby.code, host.reconnectToken, oldGuest.playerId);
    await assert.rejects(
      rooms.reconnect(
        host.lobby.code,
        oldGuest.reconnectToken,
        oldGuest.playerId,
      ),
      (error: unknown) =>
        error instanceof RoomError && error.code === "PLAYER_REMOVED",
    );
    const returned = await rooms.join(host.lobby.code, guest("Guest", "CAT"));
    assert.notEqual(returned.playerId, oldGuest.playerId);
    assert.equal(returned.lobby.playerCount, 2);
    assert.equal(
      returned.lobby.players.some((p) => p.status === "KICKED"),
      false,
    );
  });

  it("keeps forfeited players visible while releasing their seats", async () => {
    const { db, rooms } = service();
    const host = await rooms.create(guest("Host", "HORSE"));
    const forfeited = await rooms.join(host.lobby.code, guest("Guest", "CAT"));
    const record = db.players.find(
      (player) => player.id === forfeited.playerId,
    )!;
    record.status = "FORFEITED";
    record.removedAt = new Date("2026-01-01T00:01:00Z");
    const lobby = await rooms.getLobby(host.lobby.code);
    assert.equal(lobby.playerCount, 1);
    assert.equal(
      lobby.players.some((player) => player.id === forfeited.playerId),
      true,
    );
    assert.equal(
      lobby.players.find((player) => player.id === forfeited.playerId)?.status,
      "FORFEITED",
    );
  });

  it("rejects exact duplicate names and avatars while allowing case variants", async () => {
    const { rooms } = service();
    const created = await rooms.create(guest("Amr"));
    await assert.rejects(
      rooms.join(created.lobby.code, guest("Amr", "CAT")),
      (e: unknown) => e instanceof RoomError && e.code === "DUPLICATE_NICKNAME",
    );
    await assert.rejects(
      rooms.join(created.lobby.code, guest("Other", "HORSE")),
      (e: unknown) => e instanceof RoomError && e.code === "DUPLICATE_AVATAR",
    );
    await rooms.join(created.lobby.code, guest("amr", "CAT"));
    await rooms.join(created.lobby.code, guest("Other", "COW"));
    assert.equal((await rooms.getLobby(created.lobby.code)).playerCount, 3);
  });

  it("rejects invalid nicknames and avatars", async () => {
    const { rooms } = service();
    for (const nickname of ["", "ab", "A!@", "<script>", "A".repeat(17)]) {
      await assert.rejects(
        rooms.create(guest(nickname)),
        (e: unknown) => e instanceof RoomError && e.code === "INVALID_INPUT",
        `nickname ${JSON.stringify(nickname)}`,
      );
    }
    await assert.rejects(
      rooms.create(guest("Valid", "../../secret.svg")),
      (e: unknown) => e instanceof RoomError && e.code === "INVALID_AVATAR",
    );
    await rooms.create(guest("عربي 123"));
  });

  it("rejects nonexistent, full, expired, and non-lobby rooms", async () => {
    const { db, rooms } = service();
    await assert.rejects(
      rooms.join("ABCDEF", guest("Guest")),
      (e: unknown) => e instanceof RoomError && e.code === "ROOM_NOT_FOUND",
    );
    const created = await rooms.create(guest("Host", "HORSE"));
    const available = ["COW", "PIG", "DONKEY", "GOAT"];
    for (let n = 2; n <= 5; n++)
      await rooms.join(
        created.lobby.code,
        guest(`Guest ${n}`, available[n - 2]!),
      );
    await assert.rejects(
      rooms.join(created.lobby.code, guest("Overflow", "SHEEP")),
      (e: unknown) => e instanceof RoomError && e.code === "ROOM_FULL",
    );
    const room = db.rooms.get(created.lobby.code)!;
    room.lobbyExpiresAt = new Date("2025-01-01T00:00:00Z");
    await assert.rejects(
      rooms.join(created.lobby.code, guest("Late", "SHEEP")),
      (e: unknown) => e instanceof RoomError && e.code === "ROOM_EXPIRED",
    );
    room.lobbyExpiresAt = new Date("2027-01-01T00:00:00Z");
    room.status = "IN_MATCH";
    await assert.rejects(
      rooms.join(created.lobby.code, guest("After start", "SHEEP")),
      (e: unknown) => e instanceof RoomError && e.code === "ROOM_NOT_LOBBY",
    );
  });

  it("keeps concurrent joins within five and rejects concurrent exact duplicates", async () => {
    const { rooms } = service();
    const created = await rooms.create(guest("Host", "HORSE"));
    const available = ["COW", "PIG", "DONKEY", "GOAT", "SHEEP", "DOG"];
    const arrivals = await Promise.allSettled(
      Array.from({ length: 12 }, (_, i) =>
        rooms.join(
          created.lobby.code,
          guest(`Guest ${i}`, available[i % available.length]!),
        ),
      ),
    );
    assert.equal(arrivals.filter((r) => r.status === "fulfilled").length, 4);
    assert.equal((await rooms.getLobby(created.lobby.code)).playerCount, 5);

    const second = await rooms.create(guest("Host2", "HORSE"));
    const duplicates = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) =>
        rooms.join(second.lobby.code, guest("Same", i === 0 ? "COW" : "PIG")),
      ),
    );
    assert.equal(duplicates.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(
      (await rooms.getLobby(second.lobby.code)).players.filter(
        (p) => p.nickname === "Same",
      ).length,
      1,
    );
  });

  it("expires lobby data while retaining permanent room-code reservations", async () => {
    const { db, rooms } = service();
    const created = await rooms.create(guest("Host"));
    db.rooms.get(created.lobby.code)!.lobbyExpiresAt = new Date(
      "2025-12-31T23:59:59Z",
    );
    assert.equal(await rooms.cleanupExpired(), 1);
    assert.equal(db.rooms.has(created.lobby.code), false);
    assert.equal(db.reservations.has(created.lobby.code), true);
    assert.equal(
      db.auditEvents.some((event) => event.eventType === "ROOM_DELETED"),
      true,
    );
  });
});
