import {
  Room,
  ServerError,
  type AuthContext,
  type Client,
} from "@colyseus/core";
import { GameRuleError } from "./game-engine.js";
import { GameService, ServiceError } from "./game-service.js";
import { SlidingWindowRateLimiter } from "./rate-limiter.js";
import { RoomError, RoomService } from "./rooms.js";

type RealtimeAuth = { playerId: string; token: string };
type SyncPayload = {
  lobby: Awaited<ReturnType<RoomService["getLobby"]>>;
  game?: Awaited<ReturnType<GameService["snapshot"]>>["game"];
  log?: Awaited<ReturnType<GameService["snapshot"]>>["log"];
  serverNow?: number;
};

let roomService: RoomService | null = null;
let gameService: GameService | null = null;
const realtimeAuthRateLimiter = new SlidingWindowRateLimiter(24, 60_000);

export function configureRealtimeRoom(
  rooms: RoomService,
  games: GameService,
): void {
  roomService = rooms;
  gameService = games;
}

function services() {
  if (!roomService || !gameService)
    throw new Error("REALTIME_SERVICES_UNAVAILABLE");
  return { rooms: roomService, games: gameService };
}

function errorCode(error: unknown): string {
  if (
    error instanceof RoomError ||
    error instanceof ServiceError ||
    error instanceof GameRuleError
  )
    return error.code;
  return "INTERNAL_ERROR";
}

export class AnimalBluffRealtimeRoom extends Room<
  Record<string, never>,
  { roomCode: string },
  { playerId: string },
  RealtimeAuth
> {
  private roomCode = "";
  private readonly signatures = new Map<string, string>();

  async onCreate(options: { roomCode?: unknown }) {
    if (
      typeof options.roomCode !== "string" ||
      !/^[A-Z0-9]{6}$/u.test(options.roomCode)
    )
      throw new ServerError(400, "INVALID_ROOM_CODE");
    this.roomCode = options.roomCode;
    this.maxClients = 5;
    await this.setMetadata({ roomCode: this.roomCode });
    this.clock.setInterval(() => void this.syncAll(), 1_500);
    this.onMessage("heartbeat", async (client) => {
      const auth = client.auth;
      if (!auth) return;
      try {
        await services().rooms.heartbeat(this.roomCode, auth.token);
      } catch {
        client.send("connection_error", { code: "RECONNECT_REQUIRED" });
      }
    });
    this.onMessage("sync", async (client) => {
      await this.syncClient(
        client as Client<{ playerId: string }, RealtimeAuth>,
        true,
      );
    });
    this.onMessage(
      "action",
      async (client, message: { commandId?: unknown; action?: unknown }) => {
        const auth = client.auth;
        if (!auth) {
          client.send("action_error", { code: "UNAUTHORIZED" });
          return;
        }
        try {
          const commandId = message?.commandId;
          const result = await services().games.action(
            this.roomCode,
            auth.token,
            commandId as string,
            message?.action,
          );
          client.send("action_result", {
            commandId,
            duplicate: result.duplicate,
          });
          await this.syncAll(true);
        } catch (error) {
          await services().games.auditRealtimeFailure(
            this.roomCode,
            auth.playerId,
            error,
          );
          client.send("action_error", {
            commandId:
              typeof message?.commandId === "string"
                ? message.commandId
                : undefined,
            code: errorCode(error),
          });
        }
      },
    );
  }

  async onAuth(
    _client: Client,
    options: { roomCode?: unknown; playerId?: unknown; token?: unknown },
    context: AuthContext,
  ): Promise<RealtimeAuth> {
    const address = Array.isArray(context.ip) ? context.ip[0] : context.ip;
    if (!realtimeAuthRateLimiter.consume(address || "unknown")) {
      await services().rooms.auditRealtimeAuthFailure(
        this.roomCode,
        "RATE_LIMITED",
      );
      throw new ServerError(429, "RATE_LIMITED");
    }
    if (
      options.roomCode !== this.roomCode ||
      typeof options.playerId !== "string" ||
      typeof options.token !== "string"
    ) {
      await services().rooms.auditRealtimeAuthFailure(
        this.roomCode,
        "INVALID_AUTH_OPTIONS",
      );
      throw new ServerError(401, "UNAUTHORIZED");
    }
    if (
      this.clients.some(
        (connected) => connected.userData?.playerId === options.playerId,
      )
    ) {
      await services().rooms.auditRealtimeAuthFailure(
        this.roomCode,
        "PLAYER_ALREADY_CONNECTED",
      );
      throw new ServerError(409, "PLAYER_ALREADY_CONNECTED");
    }
    const { rooms } = services();
    let identity: Awaited<ReturnType<RoomService["realtimeIdentity"]>>;
    try {
      identity = await rooms.realtimeIdentity(this.roomCode, options.token);
    } catch {
      await rooms.auditRealtimeAuthFailure(this.roomCode, "UNAUTHORIZED");
      throw new ServerError(401, "UNAUTHORIZED");
    }
    if (identity.playerId !== options.playerId) {
      await rooms.auditRealtimeAuthFailure(this.roomCode, "PLAYER_ID_MISMATCH");
      throw new ServerError(401, "UNAUTHORIZED");
    }
    try {
      if (identity.status === "CONNECTED")
        await rooms.heartbeat(this.roomCode, options.token);
      else if (identity.status === "DISCONNECTED")
        await rooms.reconnect(this.roomCode, options.token, identity.playerId);
      else throw new ServerError(401, "UNAUTHORIZED");
    } catch (error) {
      await rooms.auditRealtimeAuthFailure(this.roomCode, errorCode(error));
      throw error instanceof ServerError
        ? error
        : new ServerError(401, "UNAUTHORIZED");
    }
    return { playerId: options.playerId, token: options.token };
  }

  async onJoin(client: Client<{ playerId: string }, RealtimeAuth>) {
    client.userData = { playerId: client.auth!.playerId };
  }

  async onLeave(client: Client<{ playerId: string }, RealtimeAuth>) {
    const auth = client.auth;
    this.signatures.delete(client.sessionId);
    if (!auth) return;
    try {
      await services().rooms.disconnect(this.roomCode, auth.token);
      await this.syncAll(true);
    } catch {
      // The room may have been closed or cleaned up while this socket left.
    }
  }

  private async currentView(auth: RealtimeAuth): Promise<SyncPayload> {
    const { rooms, games } = services();
    const lobby = await rooms.getLobby(this.roomCode);
    if (lobby.status === "LOBBY") return { lobby };
    const snapshot = await games.snapshot(this.roomCode, auth.token);
    return { lobby, ...snapshot };
  }

  private async syncClient(
    client: Client<{ playerId: string }, RealtimeAuth>,
    force = false,
  ) {
    if (!client.auth) return;
    try {
      const payload = await this.currentView(client.auth);
      const signature = JSON.stringify({
        lobby: payload.lobby,
        game: payload.game,
        log: payload.log,
      });
      if (!force && this.signatures.get(client.sessionId) === signature) return;
      this.signatures.set(client.sessionId, signature);
      client.send("sync", payload);
    } catch (error) {
      const code = errorCode(error);
      client.send("sync_error", { code });
      if (code === "ROOM_NOT_FOUND") client.send("room_closed", {});
    }
  }

  private async syncAll(force = false) {
    await Promise.all(
      this.clients.map((client) =>
        this.syncClient(
          client as Client<{ playerId: string }, RealtimeAuth>,
          force,
        ),
      ),
    );
  }
}
