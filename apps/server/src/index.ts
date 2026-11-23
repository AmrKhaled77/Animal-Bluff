import "dotenv/config";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { PrismaClient } from "@prisma/client";
import { RoomError, RoomService } from "./rooms.js";
import { GameService, ServiceError } from "./game-service.js";
import {
  AnimalBluffRealtimeRoom,
  configureRealtimeRoom,
} from "./realtime-room.js";

const port = Number(process.env.PORT ?? process.env.SERVER_PORT ?? 2567);
const host =
  process.env.SERVER_HOST ??
  (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000";
const prisma = new PrismaClient();
const rooms = new RoomService(prisma);
const games = new GameService(prisma);
configureRealtimeRoom(rooms, games);
const rateLimits = new Map<string, { startsAt: number; count: number }>();

function enforceRateLimit(request: IncomingMessage, url: URL): void {
  const path = url.pathname;
  const bucket =
    path === "/api/rooms" && request.method === "POST"
      ? { name: "create", limit: 10 }
      : path.endsWith("/join")
        ? { name: "join", limit: 24 }
        : path.endsWith("/heartbeat") ||
            path.endsWith("/snapshot") ||
            (path === "/api/rooms" && request.method === "GET")
          ? { name: "read", limit: 100 }
          : { name: "mutate", limit: 90 };
  const key = `${request.socket.remoteAddress ?? "unknown"}:${bucket.name}`;
  const now = Date.now();
  let record = rateLimits.get(key);
  if (!record || now - record.startsAt >= 60_000) {
    record = { startsAt: now, count: 0 };
    rateLimits.set(key, record);
  }
  record.count++;
  if (rateLimits.size > 10_000) {
    for (const [entry, value] of rateLimits)
      if (now - value.startsAt >= 60_000) rateLimits.delete(entry);
  }
  if (record.count > bucket.limit) throw new ServiceError("RATE_LIMITED", 429);
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

async function readJson(
  request: IncomingMessage,
  allowedKeys: readonly string[] = ["nickname", "avatar"],
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  if (Buffer.concat(chunks).length > 4096) throw new RoomError("INVALID_INPUT");
  const data: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new RoomError("INVALID_INPUT");
  const body = data as Record<string, unknown>;
  if (Object.keys(body).some((key) => !allowedKeys.includes(key)))
    throw new RoomError("INVALID_INPUT");
  return body;
}

function handleError(error: unknown, response: ServerResponse): void {
  if (error instanceof ServiceError) {
    sendJson(response, error.status, { error: { code: error.code } });
    return;
  }
  if (error instanceof RoomError) {
    const status =
      error.code === "HOST_ONLY"
        ? 403
        : error.code === "PLAYER_REMOVED"
          ? 403
          : error.code === "ROOM_NOT_FOUND"
            ? 404
            : error.code === "ROOM_FULL"
              ? 409
              : error.code === "ROOM_EXPIRED" ||
                  error.code === "ROOM_NOT_LOBBY" ||
                  error.code === "DUPLICATE_NICKNAME" ||
                  error.code === "DUPLICATE_AVATAR"
                ? 409
                : error.code === "ROOM_CODE_EXHAUSTED" ||
                    error.code === "ROOM_CREATE_FAILED"
                  ? 503
                  : 400;
    sendJson(response, status, { error: { code: error.code } });
    return;
  }
  if (error instanceof SyntaxError) {
    sendJson(response, 400, { error: { code: "INVALID_INPUT" } });
    return;
  }
  sendJson(response, 500, { error: { code: "INTERNAL_ERROR" } });
}

async function auditRequestFailure(
  request: IncomingMessage,
  error: unknown,
): Promise<void> {
  const expected = error instanceof ServiceError || error instanceof RoomError;
  const errorCode = expected
    ? error.code
    : error instanceof SyntaxError
      ? "INVALID_JSON"
      : "INTERNAL_ERROR";
  const pathname = (request.url ?? "/").split("?", 1)[0] ?? "/";
  const route =
    /^\/api\/rooms(?:\/([A-Z0-9]{6})(?:\/(join|ready|start|action|snapshot|heartbeat|reconnect|disconnect|kick|close|profile))?)?$/i.exec(
      pathname,
    );
  const operation = route ? (route[2] ?? "ROOM").toUpperCase() : "OTHER";
  const roomCode = route?.[1]?.toUpperCase();
  await prisma.auditLogEvent
    .create({
      data: {
        eventType:
          expected || error instanceof SyntaxError
            ? "INVALID_REQUEST_REJECTED"
            : "SERVER_EXCEPTION",
        roomCode,
        operationCode: `HTTP_${request.method ?? "UNKNOWN"}_${operation}`,
        errorType:
          error instanceof Error
            ? error.constructor.name.slice(0, 80)
            : "UNKNOWN",
        errorCode,
      },
    })
    .catch(() => undefined);
}

const httpServer = createServer(
  (request: IncomingMessage, response: ServerResponse) => {
    if (request.headers.origin === webOrigin) {
      response.setHeader("access-control-allow-origin", webOrigin);
      response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
      response.setHeader("access-control-allow-headers", "content-type");
      response.setHeader("vary", "Origin");
    }
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }
    if (
      request.method === "GET" &&
      (request.url === "/health" || request.url === "/api/health")
    ) {
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
      });
      response.end(
        JSON.stringify({ status: "ok", service: "animal-bluff-server" }),
      );
      return;
    }

    void (async () => {
      try {
        const url = new URL(
          request.url ?? "/",
          `http://${request.headers.host ?? "localhost"}`,
        );
        enforceRateLimit(request, url);
        if (request.method === "POST" && url.pathname === "/api/rooms") {
          sendJson(response, 201, await rooms.create(await readJson(request)));
          return;
        }
        const match =
          /^\/api\/rooms\/([A-Z0-9]{6})(?:\/(join|ready|start|action|snapshot|heartbeat|reconnect|disconnect|kick|close|profile))?$/.exec(
            url.pathname,
          );
        if (match && request.method === "POST" && match[2] === "join") {
          sendJson(
            response,
            200,
            await rooms.join(match[1]!, await readJson(request)),
          );
          return;
        }
        if (match && request.method === "POST" && match[2] === "ready") {
          const body = await readJson(request, ["token", "ready"]);
          sendJson(
            response,
            200,
            await games.setReady(
              match[1]!,
              body.token as string,
              body.ready as boolean,
            ),
          );
          return;
        }
        if (match && request.method === "POST" && match[2] === "profile") {
          const body = await readJson(request, ["token", "nickname", "avatar"]);
          sendJson(
            response,
            200,
            await rooms.updateProfile(match[1]!, body.token as string, body),
          );
          return;
        }
        if (match && request.method === "POST" && match[2] === "heartbeat") {
          const body = await readJson(request, ["token"]);
          await rooms.heartbeat(match[1]!, body.token as string);
          sendJson(response, 200, { status: "ok" });
          return;
        }
        if (match && request.method === "POST" && match[2] === "reconnect") {
          const body = await readJson(request, ["token", "playerId"]);
          sendJson(
            response,
            200,
            await rooms.reconnect(
              match[1]!,
              body.token as string,
              typeof body.playerId === "string" ? body.playerId : undefined,
            ),
          );
          return;
        }
        if (match && request.method === "POST" && match[2] === "disconnect") {
          const body = await readJson(request, ["token"]);
          await rooms.disconnect(match[1]!, body.token as string);
          sendJson(response, 200, { status: "ok" });
          return;
        }
        if (match && request.method === "POST" && match[2] === "kick") {
          const body = await readJson(request, ["token", "targetId"]);
          if (typeof body.targetId !== "string")
            throw new RoomError("INVALID_INPUT");
          sendJson(
            response,
            200,
            await rooms.kick(match[1]!, body.token as string, body.targetId),
          );
          return;
        }
        if (match && request.method === "POST" && match[2] === "close") {
          const body = await readJson(request, ["token"]);
          await rooms.close(match[1]!, body.token as string);
          sendJson(response, 200, { status: "ok" });
          return;
        }
        if (match && request.method === "POST" && match[2] === "start") {
          const body = await readJson(request, ["token"]);
          sendJson(
            response,
            201,
            await games.start(match[1]!, body.token as string),
          );
          return;
        }
        if (match && request.method === "POST" && match[2] === "action") {
          const body = await readJson(request, [
            "token",
            "commandId",
            "action",
          ]);
          sendJson(
            response,
            200,
            await games.action(
              match[1]!,
              body.token as string,
              body.commandId as string,
              body.action,
            ),
          );
          return;
        }
        if (match && request.method === "POST" && match[2] === "snapshot") {
          const body = await readJson(request, ["token"]);
          sendJson(
            response,
            200,
            await games.snapshot(match[1]!, body.token as string),
          );
          return;
        }
        if (match && request.method === "GET" && !match[2]) {
          sendJson(response, 200, await rooms.getLobby(match[1]!));
          return;
        }
        sendJson(response, 404, { error: { code: "NOT_FOUND" } });
      } catch (error) {
        if (
          !(error instanceof ServiceError) &&
          !(error instanceof RoomError) &&
          !(error instanceof SyntaxError)
        )
          console.error("HTTP request processing failed:", error);
        await auditRequestFailure(request, error);
        handleError(error, response);
      }
    })();
    return;
  },
);

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});
gameServer
  .define("animal-bluff", AnimalBluffRealtimeRoom)
  .filterBy(["roomCode"]);

let workersStarted = false;
function startBackgroundWorkers(): void {
  if (workersStarted) return;
  workersStarted = true;

  const maintenanceTimer = setInterval(
    () => {
      void rooms.pruneAuditLog().catch((error: unknown) => {
        console.error("Audit retention cleanup failed:", error);
      });
    },
    6 * 60 * 60_000,
  );
  maintenanceTimer.unref();

  let schedulerTick = 0;
  let schedulerRunning = false;
  const actionTimer = setInterval(() => {
    if (schedulerRunning) return;
    schedulerRunning = true;
    void (async () => {
      await rooms.forfeitExpired();
      await games.processDueTimers();
      if (++schedulerTick % 4 === 0) await rooms.cleanupExpired();
    })()
      .catch((error: unknown) => {
        console.error("Game timer processing failed:", error);
      })
      .finally(() => {
        schedulerRunning = false;
      });
  }, 250);
  actionTimer.unref();

  let monitoringRunning = false;
  const heartbeatTimer = setInterval(() => {
    if (monitoringRunning) return;
    monitoringRunning = true;
    void rooms
      .markStaleConnections()
      .catch((error: unknown) => {
        console.error("Connection monitoring failed:", error);
      })
      .finally(() => {
        monitoringRunning = false;
      });
  }, 2_000);
  heartbeatTimer.unref();
}

void (async () => {
  try {
    await prisma.$connect();
    await gameServer.listen(port, host);
    startBackgroundWorkers();
    console.log(`Animal Bluff server listening on http://${host}:${port}`);
  } catch (error) {
    console.error("Animal Bluff server startup failed:", error);
    process.exitCode = 1;
  }
})();
