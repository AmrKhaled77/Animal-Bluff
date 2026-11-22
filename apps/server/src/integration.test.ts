import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { GameService } from "./game-service.js";
import { RoomService } from "./rooms.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const db = testDatabaseUrl
  ? new PrismaClient({ datasourceUrl: testDatabaseUrl })
  : null;
after(async () => {
  await db?.$disconnect();
});

it(
  "persists a started match and makes game commands idempotent",
  { skip: !testDatabaseUrl },
  async () => {
    assert.ok(db);
    const rooms = new RoomService(db);
    const games = new GameService(db);
    let roomCode: string | undefined;
    try {
      const host = await rooms.create({
        nickname: "Test Host",
        avatar: "HORSE",
      });
      roomCode = host.lobby.code;
      const guests = await Promise.all([
        rooms.join(roomCode, { nickname: "Test Guest A", avatar: "COW" }),
        rooms.join(roomCode, { nickname: "Test Guest B", avatar: "PIG" }),
      ]);
      const participants = [host, ...guests];
      for (const player of participants)
        await games.setReady(roomCode, player.reconnectToken, true);

      const started = await games.start(roomCode, host.reconnectToken);
      assert.equal(started.state.phase, "TURN");
      assert.equal(started.state.players.length, 3);
      assert.equal(started.state.ownMoney.length, 7);

      const currentPlayer = started.state.currentPlayerId;
      const current = participants.find(
        (player) => player.playerId === currentPlayer,
      );
      assert.ok(current);
      const commandId = randomUUID();
      const first = await games.action(
        roomCode,
        current.reconnectToken,
        commandId,
        {
          type: "startAuction",
        },
      );
      const duplicate = await games.action(
        roomCode,
        current.reconnectToken,
        commandId,
        { type: "startAuction" },
      );
      assert.equal(first.duplicate, false);
      assert.equal(duplicate.duplicate, true);
      assert.equal(duplicate.state.phase, "AUCTION");
      const restored = await games.snapshot(roomCode, current.reconnectToken);
      assert.equal(restored.game.phase, "AUCTION");
      assert.equal(restored.game.version, duplicate.state.version);
      assert.ok(
        restored.log.some((event) => event.eventType === "AUCTION_STARTED"),
      );
    } finally {
      if (roomCode) await db.room.deleteMany({ where: { code: roomCode } });
    }
  },
);
