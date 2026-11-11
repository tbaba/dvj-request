import { DurableObject } from "cloudflare:workers";
import {
  buildPublicState,
  checkRateLimit,
  toGuest,
  toPublic,
  validateRequest,
} from "../shared/rules";
import type {
  ClientMessage,
  EventInfo,
  EventStatus,
  NewRequestInput,
  PublicState,
  RequestStatus,
  Role,
  ServerMessage,
  SongRequest,
} from "../shared/types";
import { sha256Hex } from "./crypto";

type Attachment = { role: Role; clientId: string | null; authed: boolean };

type Row = {
  id: string;
  title: string | null;
  artist: string | null;
  tie_in: string | null;
  nickname: string | null;
  client_id: string;
  status: RequestStatus;
  created_at: number;
  updated_at: number;
  played_at: number | null;
};

export type Result<T> = { ok: true; value: T } | { ok: false; status: 400 | 401 | 403 | 404 | 429; error: string };

function rowToRequest(r: Row): SongRequest {
  return {
    id: r.id,
    title: r.title,
    artist: r.artist,
    tieIn: r.tie_in,
    nickname: r.nickname,
    clientId: r.client_id,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    playedAt: r.played_at,
  };
}

/** 1イベント = 1インスタンス */
export class EventRoom extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS requests (
        id TEXT PRIMARY KEY,
        title TEXT,
        artist TEXT,
        tie_in TEXT,
        nickname TEXT,
        client_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        played_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS requests_client ON requests (client_id);
    `);
  }

  // ---------- meta ----------

  private getMeta(key: string): string | null {
    const rows = this.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = ?", key).toArray();
    return rows[0]?.value ?? null;
  }

  private setMeta(key: string, value: string): void {
    this.sql.exec("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", key, value);
  }

  private getEvent(): EventInfo | null {
    const slug = this.getMeta("slug");
    if (slug === null) return null;
    return {
      slug,
      name: this.getMeta("name") ?? "",
      status: (this.getMeta("status") as EventStatus | null) ?? "open",
      createdAt: Number(this.getMeta("createdAt") ?? 0),
    };
  }

  private async verifyKey(key: string | null): Promise<boolean> {
    const hash = this.getMeta("boothKeyHash");
    if (!key || !hash) return false;
    return (await sha256Hex(key)) === hash;
  }

  // ---------- requests ----------

  private allRequests(): SongRequest[] {
    return this.sql
      .exec<Row>("SELECT * FROM requests ORDER BY created_at ASC")
      .toArray()
      .map(rowToRequest);
  }

  private getRequest(id: string): SongRequest | null {
    const rows = this.sql.exec<Row>("SELECT * FROM requests WHERE id = ?", id).toArray();
    return rows[0] ? rowToRequest(rows[0]) : null;
  }

  private requestsOf(clientId: string): SongRequest[] {
    return this.sql
      .exec<Row>("SELECT * FROM requests WHERE client_id = ? ORDER BY created_at ASC", clientId)
      .toArray()
      .map(rowToRequest);
  }

  private publicState(): PublicState {
    return buildPublicState(this.allRequests());
  }

  // ---------- RPC ----------

  /** 新規作成。既に作成済みなら false */
  async init(slug: string, name: string, boothKeyHash: string): Promise<boolean> {
    if (this.getMeta("slug") !== null) return false;
    this.setMeta("slug", slug);
    this.setMeta("name", name);
    this.setMeta("boothKeyHash", boothKeyHash);
    this.setMeta("status", "open");
    this.setMeta("createdAt", String(Date.now()));
    return true;
  }

  async info(): Promise<EventInfo | null> {
    return this.getEvent();
  }

  async setStatus(key: string | null, status: EventStatus): Promise<Result<EventInfo>> {
    if (!this.getEvent()) return { ok: false, status: 404, error: "イベントが見つかりません" };
    if (!(await this.verifyKey(key))) return { ok: false, status: 401, error: "ブースキーが正しくありません" };
    this.setMeta("status", status);
    const event = this.getEvent()!;
    this.broadcast(() => ({ type: "event", event }));
    return { ok: true, value: event };
  }

  async createRequest(input: Partial<NewRequestInput>): Promise<Result<SongRequest>> {
    const event = this.getEvent();
    if (!event) return { ok: false, status: 404, error: "イベントが見つかりません" };
    if (event.status !== "open") return { ok: false, status: 403, error: "リクエストの受付は終了しました" };
    if (typeof input.clientId !== "string" || !/^[\w-]{8,64}$/.test(input.clientId)) {
      return { ok: false, status: 400, error: "不正なリクエストです" };
    }
    const v = validateRequest(input);
    if (!v.ok) return { ok: false, status: 400, error: v.error };

    const now = Date.now();
    const limit = checkRateLimit(this.requestsOf(input.clientId), now);
    if (!limit.ok) return { ok: false, status: 429, error: limit.error };

    const req: SongRequest = {
      id: crypto.randomUUID(),
      ...v.value,
      clientId: input.clientId,
      status: "requested",
      createdAt: now,
      updatedAt: now,
      playedAt: null,
    };
    this.sql.exec(
      `INSERT INTO requests (id, title, artist, tie_in, nickname, client_id, status, created_at, updated_at, played_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      req.id, req.title, req.artist, req.tieIn, req.nickname, req.clientId, req.status, req.createdAt, req.updatedAt, req.playedAt,
    );
    this.notifyRequestChanged(req, null);
    return { ok: true, value: req };
  }

  async updateRequestStatus(key: string | null, id: string, status: RequestStatus): Promise<Result<SongRequest>> {
    if (!this.getEvent()) return { ok: false, status: 404, error: "イベントが見つかりません" };
    if (!(await this.verifyKey(key))) return { ok: false, status: 401, error: "ブースキーが正しくありません" };
    const before = this.getRequest(id);
    if (!before) return { ok: false, status: 404, error: "リクエストが見つかりません" };
    if (before.status === status) return { ok: true, value: before };

    const now = Date.now();
    const playedAt = status === "played" ? now : null;
    this.sql.exec(
      "UPDATE requests SET status = ?, updated_at = ?, played_at = ? WHERE id = ?",
      status, now, playedAt, id,
    );
    const after = this.getRequest(id)!;
    this.notifyRequestChanged(after, before);
    return { ok: true, value: after };
  }

  async listRequests(key: string | null): Promise<Result<SongRequest[]>> {
    if (!this.getEvent()) return { ok: false, status: 404, error: "イベントが見つかりません" };
    if (!(await this.verifyKey(key))) return { ok: false, status: 401, error: "ブースキーが正しくありません" };
    return { ok: true, value: this.allRequests() };
  }

  async listMine(clientId: string) {
    if (!this.getEvent()) return null;
    return this.requestsOf(clientId).map(toGuest);
  }

  async getPublic(): Promise<PublicState | null> {
    if (!this.getEvent()) return null;
    return this.publicState();
  }

  // ---------- WebSocket ----------

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }
    const event = this.getEvent();
    if (!event) return new Response("Not found", { status: 404 });

    const url = new URL(request.url);
    const role = url.searchParams.get("role") as Role | null;
    if (role !== "guest" && role !== "booth" && role !== "display" && role !== "vj") {
      return new Response("Invalid role", { status: 400 });
    }
    const clientId = url.searchParams.get("clientId");
    if (role === "guest" && (!clientId || !/^[\w-]{8,64}$/.test(clientId))) {
      return new Response("clientId required", { status: 400 });
    }

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    const attachment: Attachment = { role, clientId: role === "guest" ? clientId : null, authed: role !== "booth" };
    server.serializeAttachment(attachment);

    if (attachment.authed) this.sendSnapshot(server, attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }
    const att = ws.deserializeAttachment() as Attachment;
    if (msg.type === "auth" && att.role === "booth" && !att.authed) {
      if (await this.verifyKey(msg.key)) {
        const next: Attachment = { ...att, authed: true };
        ws.serializeAttachment(next);
        this.sendSnapshot(ws, next);
      } else {
        this.send(ws, { type: "auth_error" });
        ws.close(4001, "unauthorized");
      }
    }
    // ping は何もしない（接続維持のため）
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1005 ? 1000 : code, "closed");
    } catch {
      // 既に閉じている
    }
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // 切断済み
    }
  }

  private sendSnapshot(ws: WebSocket, att: Attachment): void {
    const event = this.getEvent()!;
    const msg: ServerMessage = { type: "snapshot", event, public: this.publicState() };
    if (att.role === "booth") msg.requests = this.allRequests();
    if (att.role === "guest" && att.clientId) msg.mine = this.requestsOf(att.clientId).map(toGuest);
    this.send(ws, msg);
  }

  /** ロールごとに送るメッセージを作る関数を受け取り、全接続に配信する */
  private broadcast(build: (att: Attachment) => ServerMessage | ServerMessage[] | null): void {
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment;
      if (!att.authed) continue;
      const out = build(att);
      if (!out) continue;
      for (const m of Array.isArray(out) ? out : [out]) this.send(ws, m);
    }
  }

  private notifyRequestChanged(after: SongRequest, before: SongRequest | null): void {
    const pub = this.publicState();
    const becamePlayed = after.status === "played" && before?.status !== "played";
    const publicPlayed = becamePlayed ? toPublic(after) : null;

    this.broadcast((att) => {
      const out: ServerMessage[] = [];
      if (att.role === "booth") {
        out.push({ type: "request", request: after });
      } else if (att.role === "guest" && att.clientId === after.clientId) {
        out.push({ type: "request", request: toGuest(after) });
      }
      out.push({ type: "public", public: pub });
      if (publicPlayed && att.role !== "booth") out.push({ type: "played", request: publicPlayed });
      return out;
    });
  }
}
