import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { REQUEST_STATUSES, type EventStatus, type RequestStatus } from "../shared/types";
import { KEY_ALPHABET, randomString, sha256Hex, SLUG_ALPHABET } from "./crypto";
import type { EventRoom, Result } from "./event-room";

export { EventRoom } from "./event-room";

type AppEnv = { Bindings: Env };

const app = new Hono<AppEnv>().basePath("/api");

function room(env: Env, slug: string): DurableObjectStub<EventRoom> {
  const ns = env.EVENT_ROOM as DurableObjectNamespace<EventRoom>;
  return ns.get(ns.idFromName(slug));
}

function bearer(header: string | undefined): string | null {
  const m = header?.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

function isSlug(s: string): boolean {
  return /^[a-z0-9]{4,32}$/.test(s);
}

function respond<T>(c: { json: (body: unknown, status?: ContentfulStatusCode) => Response }, r: Result<T>) {
  return r.ok ? c.json(r.value) : c.json({ error: r.error }, r.status);
}

const notFound = { error: "イベントが見つかりません" };

app.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
  // VJ ソフトなど別オリジンからの読み取りを許可する（書き込みはブースキー必須）
  c.header("Access-Control-Allow-Origin", "*");
});

app.options("*", (c) =>
  c.body(null, 204, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  }),
);

app.post("/events", async (c) => {
  const body = await c.req.json<{ name?: unknown }>().catch(() => ({}) as { name?: unknown });
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name === "" || name.length > 60) return c.json({ error: "イベント名は1〜60文字で入力してください" }, 400);

  const boothKey = randomString(24, KEY_ALPHABET);
  const hash = await sha256Hex(boothKey);
  for (let i = 0; i < 5; i++) {
    const slug = randomString(8, SLUG_ALPHABET);
    if (await room(c.env, slug).init(slug, name, hash)) {
      return c.json({ slug, boothKey }, 201);
    }
  }
  return c.json({ error: "イベントを作成できませんでした" }, 500);
});

app.get("/events/:slug", async (c) => {
  const slug = c.req.param("slug");
  if (!isSlug(slug)) return c.json(notFound, 404);
  const info = await room(c.env, slug).info();
  return info ? c.json(info) : c.json(notFound, 404);
});

app.patch("/events/:slug", async (c) => {
  const slug = c.req.param("slug");
  if (!isSlug(slug)) return c.json(notFound, 404);
  const body = await c.req.json<{ status?: unknown }>().catch(() => ({}) as { status?: unknown });
  if (body.status !== "open" && body.status !== "closed") return c.json({ error: "status が不正です" }, 400);
  return respond(c, await room(c.env, slug).setStatus(bearer(c.req.header("Authorization")), body.status as EventStatus));
});

app.post("/events/:slug/requests", async (c) => {
  const slug = c.req.param("slug");
  if (!isSlug(slug)) return c.json(notFound, 404);
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body || typeof body !== "object") return c.json({ error: "不正なリクエストです" }, 400);
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const r = await room(c.env, slug).createRequest({
    title: str(body.title),
    artist: str(body.artist),
    tieIn: str(body.tieIn),
    nickname: str(body.nickname),
    clientId: str(body.clientId) ?? "",
  });
  return r.ok ? c.json(r.value, 201) : c.json({ error: r.error }, r.status);
});

app.get("/events/:slug/requests", async (c) => {
  const slug = c.req.param("slug");
  if (!isSlug(slug)) return c.json(notFound, 404);
  return respond(c, await room(c.env, slug).listRequests(bearer(c.req.header("Authorization"))));
});

app.get("/events/:slug/requests/mine", async (c) => {
  const slug = c.req.param("slug");
  const clientId = c.req.query("clientId") ?? "";
  if (!isSlug(slug)) return c.json(notFound, 404);
  const mine = await room(c.env, slug).listMine(clientId);
  return mine ? c.json(mine) : c.json(notFound, 404);
});

app.patch("/events/:slug/requests/:id", async (c) => {
  const slug = c.req.param("slug");
  if (!isSlug(slug)) return c.json(notFound, 404);
  const body = await c.req.json<{ status?: unknown }>().catch(() => ({}) as { status?: unknown });
  if (!REQUEST_STATUSES.includes(body.status as RequestStatus)) return c.json({ error: "status が不正です" }, 400);
  return respond(
    c,
    await room(c.env, slug).updateRequestStatus(
      bearer(c.req.header("Authorization")),
      c.req.param("id"),
      body.status as RequestStatus,
    ),
  );
});

app.get("/events/:slug/public", async (c) => {
  const slug = c.req.param("slug");
  if (!isSlug(slug)) return c.json(notFound, 404);
  const pub = await room(c.env, slug).getPublic();
  return pub ? c.json(pub) : c.json(notFound, 404);
});

app.get("/events/:slug/latest", async (c) => {
  const slug = c.req.param("slug");
  if (!isSlug(slug)) return c.json(notFound, 404);
  const pub = await room(c.env, slug).getPublic();
  return pub ? c.json(pub.latest) : c.json(notFound, 404);
});

app.get("/events/:slug/ws", async (c) => {
  const slug = c.req.param("slug");
  if (!isSlug(slug)) return c.json(notFound, 404);
  if (c.req.header("Upgrade") !== "websocket") return c.json({ error: "WebSocket で接続してください" }, 426);
  return room(c.env, slug).fetch(c.req.raw);
});

app.notFound((c) => c.json({ error: "Not found" }, 404));

export default app;
