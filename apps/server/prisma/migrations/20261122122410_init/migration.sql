-- CreateEnum
CREATE TYPE "RoomStatus" AS ENUM ('LOBBY', 'STARTING', 'IN_MATCH', 'COMPLETED');

-- CreateEnum
CREATE TYPE "RoomPlayerStatus" AS ENUM ('CONNECTED', 'DISCONNECTED', 'FORFEITED', 'KICKED');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ENDED_NO_RESULT');

-- CreateEnum
CREATE TYPE "MatchEndReason" AS ENUM ('ALL_QUARTETS_COMPLETE', 'ONE_ELIGIBLE_PLAYER_REMAINS', 'NO_ELIGIBLE_LEGAL_TURN', 'NO_CONNECTED_PLAYERS');

-- CreateEnum
CREATE TYPE "MatchParticipantStatus" AS ENUM ('ACTIVE', 'FORFEITED');

-- CreateEnum
CREATE TYPE "AnimalType" AS ENUM ('HORSE', 'COW', 'PIG', 'DONKEY', 'GOAT', 'SHEEP', 'DOG', 'CAT', 'GOOSE', 'ROOSTER');

-- CreateEnum
CREATE TYPE "PublicGameEventType" AS ENUM ('ROOM_CREATED', 'PLAYER_JOINED', 'PLAYER_LEFT', 'PLAYER_DISCONNECTED', 'PLAYER_RECONNECTED', 'PLAYER_FORFEITED', 'HOST_TRANSFERRED', 'MATCH_STARTED', 'MATCH_ENDED', 'TURN_STARTED', 'AUCTION_STARTED', 'BID_ACCEPTED', 'AUCTION_CLOSED', 'AUCTIONEER_CHOICE', 'PAYMENT_SUCCEEDED', 'PAYMENT_FAILED', 'REAUCTION_STARTED', 'DONKEY_DISTRIBUTION', 'KUHHANDEL_OFFER_SUBMITTED', 'KUHHANDEL_RESPONSE', 'KUHHANDEL_RESOLVED', 'ANIMAL_TRANSFERRED', 'QUARTET_COMPLETED');

-- CreateEnum
CREATE TYPE "AuditLogEventType" AS ENUM ('ROOM_CREATED', 'ROOM_DELETED', 'MATCH_STARTED', 'MATCH_ENDED', 'PLAYER_JOINED', 'PLAYER_LEFT', 'PLAYER_DISCONNECTED', 'PLAYER_RECONNECTED', 'PLAYER_FORFEITED', 'HOST_TRANSFERRED', 'AUCTION_OPERATION_SUCCEEDED', 'AUCTION_OPERATION_FAILED', 'PAYMENT_OPERATION_SUCCEEDED', 'PAYMENT_OPERATION_FAILED', 'NEGOTIATION_OPERATION_SUCCEEDED', 'NEGOTIATION_OPERATION_FAILED', 'INVALID_REQUEST_REJECTED', 'SERVER_ERROR', 'SERVER_EXCEPTION');

-- CreateTable
CREATE TABLE "RoomCodeReservation" (
    "code" TEXT NOT NULL,
    "reservedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoomCodeReservation_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "Room" (
    "code" TEXT NOT NULL,
    "status" "RoomStatus" NOT NULL DEFAULT 'LOBBY',
    "hostPlayerId" UUID,
    "lobbyExpiresAt" TIMESTAMPTZ(3) NOT NULL,
    "hostlessExpiresAt" TIMESTAMPTZ(3),
    "postMatchExpiresAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "RoomPlayer" (
    "id" UUID NOT NULL,
    "roomCode" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "avatar" TEXT NOT NULL,
    "joinOrder" INTEGER NOT NULL,
    "status" "RoomPlayerStatus" NOT NULL DEFAULT 'CONNECTED',
    "isReady" BOOLEAN NOT NULL DEFAULT false,
    "reconnectToken" TEXT,
    "joinedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnectedAt" TIMESTAMPTZ(3),
    "reconnectExpiresAt" TIMESTAMPTZ(3),
    "forfeitedAt" TIMESTAMPTZ(3),
    "removedAt" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RoomPlayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" UUID NOT NULL,
    "roomCode" TEXT NOT NULL,
    "status" "MatchStatus" NOT NULL DEFAULT 'ACTIVE',
    "endReason" "MatchEndReason",
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchParticipant" (
    "id" UUID NOT NULL,
    "roomCode" TEXT NOT NULL,
    "matchId" UUID NOT NULL,
    "roomPlayerId" UUID NOT NULL,
    "seatOrder" INTEGER NOT NULL,
    "status" "MatchParticipantStatus" NOT NULL DEFAULT 'ACTIVE',
    "quartetCount" INTEGER,
    "quartetValueSum" INTEGER,
    "finalScore" INTEGER,
    "isWinner" BOOLEAN,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicGameEvent" (
    "id" UUID NOT NULL,
    "roomCode" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "eventType" "PublicGameEventType" NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorPlayerId" UUID,
    "targetPlayerId" UUID,
    "animalType" "AnimalType",
    "animalCardCount" INTEGER,
    "amount" INTEGER,
    "outcomeCode" TEXT,
    "reasonCode" TEXT,
    "submittedMoneyDenominations" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "submittedMoneyValue" INTEGER,

    CONSTRAINT "PublicGameEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLogEvent" (
    "id" UUID NOT NULL,
    "eventType" "AuditLogEventType" NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "roomCode" TEXT,
    "matchId" UUID,
    "actorPlayerId" UUID,
    "subjectPlayerId" UUID,
    "operationCode" TEXT,
    "reasonCode" TEXT,
    "errorType" TEXT,
    "errorCode" TEXT,

    CONSTRAINT "AuditLogEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Room_hostPlayerId_key" ON "Room"("hostPlayerId");

-- CreateIndex
CREATE INDEX "Room_status_lobbyExpiresAt_idx" ON "Room"("status", "lobbyExpiresAt");

-- CreateIndex
CREATE INDEX "Room_status_hostlessExpiresAt_idx" ON "Room"("status", "hostlessExpiresAt");

-- CreateIndex
CREATE INDEX "Room_status_postMatchExpiresAt_idx" ON "Room"("status", "postMatchExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Room_code_hostPlayerId_key" ON "Room"("code", "hostPlayerId");

-- CreateIndex
CREATE UNIQUE INDEX "RoomPlayer_reconnectToken_key" ON "RoomPlayer"("reconnectToken");

-- CreateIndex
CREATE INDEX "RoomPlayer_roomCode_status_joinOrder_idx" ON "RoomPlayer"("roomCode", "status", "joinOrder");

-- CreateIndex
CREATE INDEX "RoomPlayer_status_reconnectExpiresAt_idx" ON "RoomPlayer"("status", "reconnectExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "RoomPlayer_roomCode_nickname_key" ON "RoomPlayer"("roomCode", "nickname");

-- CreateIndex
CREATE UNIQUE INDEX "RoomPlayer_roomCode_joinOrder_key" ON "RoomPlayer"("roomCode", "joinOrder");

-- CreateIndex
CREATE UNIQUE INDEX "RoomPlayer_roomCode_id_key" ON "RoomPlayer"("roomCode", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Match_roomCode_key" ON "Match"("roomCode");

-- CreateIndex
CREATE INDEX "Match_status_startedAt_idx" ON "Match"("status", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Match_roomCode_id_key" ON "Match"("roomCode", "id");

-- CreateIndex
CREATE INDEX "MatchParticipant_matchId_status_idx" ON "MatchParticipant"("matchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MatchParticipant_roomCode_roomPlayerId_key" ON "MatchParticipant"("roomCode", "roomPlayerId");

-- CreateIndex
CREATE UNIQUE INDEX "MatchParticipant_matchId_seatOrder_key" ON "MatchParticipant"("matchId", "seatOrder");

-- CreateIndex
CREATE INDEX "PublicGameEvent_roomCode_eventType_sequence_idx" ON "PublicGameEvent"("roomCode", "eventType", "sequence");

-- CreateIndex
CREATE INDEX "PublicGameEvent_roomCode_actorPlayerId_sequence_idx" ON "PublicGameEvent"("roomCode", "actorPlayerId", "sequence");

-- CreateIndex
CREATE INDEX "PublicGameEvent_roomCode_targetPlayerId_sequence_idx" ON "PublicGameEvent"("roomCode", "targetPlayerId", "sequence");

-- CreateIndex
CREATE INDEX "PublicGameEvent_occurredAt_idx" ON "PublicGameEvent"("occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "PublicGameEvent_roomCode_sequence_key" ON "PublicGameEvent"("roomCode", "sequence");

-- CreateIndex
CREATE INDEX "AuditLogEvent_roomCode_occurredAt_idx" ON "AuditLogEvent"("roomCode", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditLogEvent_matchId_occurredAt_idx" ON "AuditLogEvent"("matchId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditLogEvent_eventType_occurredAt_idx" ON "AuditLogEvent"("eventType", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditLogEvent_actorPlayerId_occurredAt_idx" ON "AuditLogEvent"("actorPlayerId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditLogEvent_occurredAt_idx" ON "AuditLogEvent"("occurredAt");

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_code_fkey" FOREIGN KEY ("code") REFERENCES "RoomCodeReservation"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_code_hostPlayerId_fkey" FOREIGN KEY ("code", "hostPlayerId") REFERENCES "RoomPlayer"("roomCode", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomPlayer" ADD CONSTRAINT "RoomPlayer_roomCode_fkey" FOREIGN KEY ("roomCode") REFERENCES "Room"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_roomCode_fkey" FOREIGN KEY ("roomCode") REFERENCES "Room"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchParticipant" ADD CONSTRAINT "MatchParticipant_roomCode_matchId_fkey" FOREIGN KEY ("roomCode", "matchId") REFERENCES "Match"("roomCode", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchParticipant" ADD CONSTRAINT "MatchParticipant_roomCode_roomPlayerId_fkey" FOREIGN KEY ("roomCode", "roomPlayerId") REFERENCES "RoomPlayer"("roomCode", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicGameEvent" ADD CONSTRAINT "PublicGameEvent_roomCode_fkey" FOREIGN KEY ("roomCode") REFERENCES "Room"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicGameEvent" ADD CONSTRAINT "PublicGameEvent_roomCode_actorPlayerId_fkey" FOREIGN KEY ("roomCode", "actorPlayerId") REFERENCES "RoomPlayer"("roomCode", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicGameEvent" ADD CONSTRAINT "PublicGameEvent_roomCode_targetPlayerId_fkey" FOREIGN KEY ("roomCode", "targetPlayerId") REFERENCES "RoomPlayer"("roomCode", "id") ON DELETE CASCADE ON UPDATE CASCADE;
