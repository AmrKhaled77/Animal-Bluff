import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { GameService, ServiceError } from "./game-service.js";

describe("game service action protections", () => {
  it("rate-limits authenticated actions even when their payload is invalid", async () => {
    const actor = {
      id: "player-a",
      roomCode: "ABC234",
      nickname: "Player A",
      avatar: "HORSE",
      joinOrder: 1,
      status: "CONNECTED",
      isReady: true,
    };
    const db = {
      $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          roomPlayer: { findUnique: async () => actor },
        }),
    };
    const games = new GameService(db as unknown as PrismaClient, () => 1_000);

    for (let attempt = 0; attempt < 90; attempt++)
      await assert.rejects(
        games.action("ABC234", "r".repeat(48), `command-${attempt}`, {
          type: "invalid",
        }),
        (error: unknown) =>
          error instanceof ServiceError && error.code === "INVALID_INPUT",
      );

    await assert.rejects(
      games.action("ABC234", "r".repeat(48), "command-90", {
        type: "invalid",
      }),
      (error: unknown) =>
        error instanceof ServiceError && error.code === "RATE_LIMITED",
    );
  });

  it("keeps error messages and credentials out of realtime audit records", async () => {
    const events: Array<Record<string, unknown>> = [];
    const db = {
      auditLogEvent: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          events.push(data);
        },
      },
    };
    const games = new GameService(db as unknown as PrismaClient);
    const secret = "reconnect-token-never-log";
    await games.auditRealtimeFailure(
      "ABC234",
      "player-a",
      new Error(`Request failed with ${secret}`),
    );

    assert.deepEqual(events, [
      {
        eventType: "SERVER_EXCEPTION",
        roomCode: "ABC234",
        actorPlayerId: "player-a",
        operationCode: "WEBSOCKET_ACTION",
        errorType: "Error",
        errorCode: "INTERNAL_ERROR",
      },
    ]);
    assert.equal(JSON.stringify(events).includes(secret), false);
  });
});
