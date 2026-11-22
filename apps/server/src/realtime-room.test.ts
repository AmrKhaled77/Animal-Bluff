import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, describe, it } from "node:test";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { Client as ColyseusClient, type Room as ClientRoom } from "colyseus.js";
import { GameService, ServiceError } from "./game-service.js";
import {
  AnimalBluffRealtimeRoom,
  configureRealtimeRoom,
} from "./realtime-room.js";
import { RoomService } from "./rooms.js";

const roomCode = "ABC234";
const tokenA = "a".repeat(48);
const tokenB = "b".repeat(48);
const identities = new Map([
  [tokenA, { playerId: "player-a", status: "CONNECTED" }],
  [tokenB, { playerId: "player-b", status: "CONNECTED" }],
]);
const actions: Array<{
  roomCode: string;
  token: string;
  commandId: string;
  action: unknown;
}> = [];
const auditFailures: Array<{ actorId: string; code: string }> = [];
const authFailures: string[] = [];

const mockRooms = {
  realtimeIdentity: async (code: string, token: string) => {
    const identity = identities.get(token);
    if (code !== roomCode || !identity) throw new Error("UNAUTHORIZED");
    return identity;
  },
  heartbeat: async () => undefined,
  reconnect: async () => undefined,
  disconnect: async () => undefined,
  auditRealtimeAuthFailure: async (_code: string, reasonCode: string) => {
    authFailures.push(reasonCode);
  },
  getLobby: async () => ({
    code: roomCode,
    status: "MATCH",
    host: null,
    playerCount: 2,
    maxPlayers: 5,
    lobbyExpiresAt: new Date(0).toISOString(),
    players: [
      {
        id: "player-a",
        nickname: "Player A",
        avatar: "HORSE",
        status: "CONNECTED",
        isReady: true,
      },
      {
        id: "player-b",
        nickname: "Player B",
        avatar: "COW",
        status: "CONNECTED",
        isReady: true,
      },
    ],
  }),
};

const mockGames = {
  action: async (
    code: string,
    token: string,
    commandId: string,
    action: unknown,
  ) => {
    if (commandId === "bad-command")
      throw new ServiceError("INVALID_COMMAND_ID");
    actions.push({ roomCode: code, token, commandId, action });
    return { duplicate: false };
  },
  snapshot: async (_code: string, token: string) => ({
    game: { phase: "TURN", privateMarker: token === tokenA ? "A" : "B" },
    log: [],
    serverNow: Date.now(),
  }),
  auditRealtimeFailure: async (
    _code: string,
    actorId: string,
    error: unknown,
  ) => {
    auditFailures.push({
      actorId,
      code: error instanceof ServiceError ? error.code : "INTERNAL_ERROR",
    });
  },
};

function nextMessage<T>(room: ClientRoom, type: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for ${type}`)),
      4_000,
    );
    room.onMessage(type, (message: T) => {
      clearTimeout(timeout);
      resolve(message);
    });
  });
}

describe("Colyseus realtime room", () => {
  let gameServer: Server | undefined;
  let client: ColyseusClient;
  let endpoint: string;
  const joinedRooms: ClientRoom[] = [];

  before(async () => {
    actions.length = 0;
    auditFailures.length = 0;
    authFailures.length = 0;
    configureRealtimeRoom(
      mockRooms as unknown as RoomService,
      mockGames as unknown as GameService,
    );
    const httpServer = createServer();
    const transport = new WebSocketTransport({
      server: httpServer,
      pingInterval: 0,
      pingMaxRetries: 0,
    });
    gameServer = new Server({ transport, greet: false });
    gameServer
      .define("animal-bluff", AnimalBluffRealtimeRoom)
      .filterBy(["roomCode"]);
    await gameServer.listen(0, "127.0.0.1");
    const address = httpServer.address();
    if (!address || typeof address === "string")
      throw new Error("Test server did not bind to a TCP port");
    endpoint = `http://127.0.0.1:${address.port}`;
    client = new ColyseusClient(endpoint);
  });

  after(async () => {
    await Promise.all(joinedRooms.map((room) => room.leave()));
    await gameServer?.gracefullyShutdown(false);
  });

  it("authenticates identity, routes actions, and sends private snapshots per player", async () => {
    const playerA = await client.joinOrCreate("animal-bluff", {
      roomCode,
      playerId: "player-a",
      token: tokenA,
    });
    joinedRooms.push(playerA);
    const playerB = await client.joinOrCreate("animal-bluff", {
      roomCode,
      playerId: "player-b",
      token: tokenB,
    });
    joinedRooms.push(playerB);

    const initialSyncA = nextMessage<{
      game: { privateMarker: string };
    }>(playerA, "sync");
    const initialSyncB = nextMessage<{
      game: { privateMarker: string };
    }>(playerB, "sync");
    playerA.send("sync");
    playerB.send("sync");
    assert.equal((await initialSyncA).game.privateMarker, "A");
    assert.equal((await initialSyncB).game.privateMarker, "B");

    const actionResult = nextMessage<{ commandId: string; duplicate: boolean }>(
      playerA,
      "action_result",
    );
    const syncA = nextMessage<{
      game: { privateMarker: string };
    }>(playerA, "sync");
    const syncB = nextMessage<{
      game: { privateMarker: string };
    }>(playerB, "sync");
    playerA.send("action", {
      commandId: "command-0001",
      action: { type: "startAuction" },
    });

    assert.deepEqual(await actionResult, {
      commandId: "command-0001",
      duplicate: false,
    });
    assert.equal((await syncA).game.privateMarker, "A");
    assert.equal((await syncB).game.privateMarker, "B");
    assert.deepEqual(actions, [
      {
        roomCode,
        token: tokenA,
        commandId: "command-0001",
        action: { type: "startAuction" },
      },
    ]);

    const actionError = nextMessage<{ code: string }>(playerA, "action_error");
    playerA.send("action", {
      commandId: "bad-command",
      action: { type: "startAuction" },
    });
    assert.equal((await actionError).code, "INVALID_COMMAND_ID");
    assert.deepEqual(auditFailures, [
      { actorId: "player-a", code: "INVALID_COMMAND_ID" },
    ]);

    const impostor = new ColyseusClient(endpoint);
    await assert.rejects(
      impostor.joinOrCreate("animal-bluff", {
        roomCode,
        playerId: "player-c",
        token: tokenA,
      }),
    );
    assert.deepEqual(authFailures, ["PLAYER_ID_MISMATCH"]);
  });
});
