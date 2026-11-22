-- Additive match state, idempotency and guest re-entry support.
ALTER TYPE "RoomPlayerStatus" ADD VALUE 'LEFT';

CREATE TYPE "MatchPhase" AS ENUM (
  'SETUP',
  'TURN',
  'AUCTION',
  'AUCTIONEER_CHOICE',
  'PAYMENT',
  'NEGOTIATION',
  'COMPLETED',
  'ENDED_NO_RESULT'
);

ALTER TABLE "Match"
  ADD COLUMN "phase" "MatchPhase" NOT NULL DEFAULT 'SETUP',
  ADD COLUMN "state" JSONB,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;

DROP INDEX "RoomPlayer_roomCode_nickname_key";
CREATE INDEX "RoomPlayer_roomCode_nickname_idx" ON "RoomPlayer"("roomCode", "nickname");
CREATE UNIQUE INDEX "RoomPlayer_active_room_nickname_key"
  ON "RoomPlayer"("roomCode", "nickname")
  WHERE "removedAt" IS NULL;

CREATE TABLE "GameCommand" (
  "id" UUID NOT NULL,
  "roomCode" TEXT NOT NULL,
  "matchId" UUID NOT NULL,
  "commandId" TEXT NOT NULL,
  "actorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GameCommand_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GameCommand_roomCode_commandId_key"
  ON "GameCommand"("roomCode", "commandId");
CREATE INDEX "GameCommand_matchId_createdAt_idx"
  ON "GameCommand"("matchId", "createdAt");

ALTER TABLE "GameCommand"
  ADD CONSTRAINT "GameCommand_roomCode_matchId_fkey"
  FOREIGN KEY ("roomCode", "matchId")
  REFERENCES "Match"("roomCode", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
