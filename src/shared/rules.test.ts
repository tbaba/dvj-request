import { describe, expect, it } from "vitest";
import {
  ANONYMOUS_NAME,
  buildPublicState,
  checkRateLimit,
  MAX_OPEN_PER_CLIENT,
  RATE_LIMIT_MS,
  toGuest,
  validateRequest,
} from "./rules";
import type { RequestStatus, SongRequest } from "./types";

function req(over: Partial<SongRequest> & { status: RequestStatus }): SongRequest {
  return {
    id: crypto.randomUUID(),
    title: "t",
    artist: "a",
    tieIn: null,
    nickname: null,
    clientId: "client-1",
    createdAt: 0,
    updatedAt: 0,
    playedAt: null,
    ...over,
  };
}

describe("validateRequest", () => {
  it("2項目以上で OK", () => {
    expect(validateRequest({ title: "曲", artist: "人" }).ok).toBe(true);
    expect(validateRequest({ title: "曲", tieIn: "作品" }).ok).toBe(true);
    expect(validateRequest({ artist: "人", tieIn: "作品" }).ok).toBe(true);
  });

  it("1項目以下や空白のみは NG", () => {
    expect(validateRequest({ title: "曲" }).ok).toBe(false);
    expect(validateRequest({ title: "曲", artist: "   " }).ok).toBe(false);
    expect(validateRequest({}).ok).toBe(false);
  });

  it("前後の空白と連続空白を整える", () => {
    const r = validateRequest({ title: "  a   b ", artist: "c", nickname: "  " });
    expect(r).toEqual({ ok: true, value: { title: "a b", artist: "c", tieIn: null, nickname: null } });
  });

  it("長すぎる入力は NG", () => {
    expect(validateRequest({ title: "x".repeat(101), artist: "a" }).ok).toBe(false);
    expect(validateRequest({ title: "a", artist: "b", nickname: "x".repeat(31) }).ok).toBe(false);
  });
});

describe("checkRateLimit", () => {
  it("初回は OK", () => {
    expect(checkRateLimit([], 1000).ok).toBe(true);
  });

  it("間隔が短いと NG、経過後は OK", () => {
    const prev = [req({ status: "played", createdAt: 1000 })];
    expect(checkRateLimit(prev, 1000 + RATE_LIMIT_MS - 1).ok).toBe(false);
    expect(checkRateLimit(prev, 1000 + RATE_LIMIT_MS).ok).toBe(true);
  });

  it("未処理が上限に達すると NG。流した・流せないは数えない", () => {
    const open = Array.from({ length: MAX_OPEN_PER_CLIENT }, () => req({ status: "accepted" }));
    expect(checkRateLimit(open, 10 ** 9).ok).toBe(false);
    const closed = [req({ status: "played" }), req({ status: "rejected" }), req({ status: "requested" })];
    expect(checkRateLimit(closed, 10 ** 9).ok).toBe(true);
  });
});

describe("toGuest", () => {
  it("rejected は requested として見せる", () => {
    expect(toGuest(req({ status: "rejected" })).status).toBe("requested");
  });
  it("ニックネーム未入力は名無しさん", () => {
    expect(toGuest(req({ status: "requested" })).nickname).toBe(ANONYMOUS_NAME);
  });
});

describe("buildPublicState", () => {
  it("accepted と played だけを公開し、requested は件数のみ", () => {
    const all = [
      req({ id: "r1", status: "requested" }),
      req({ id: "r2", status: "requested" }),
      req({ id: "x", status: "rejected" }),
      req({ id: "a2", status: "accepted", createdAt: 20 }),
      req({ id: "a1", status: "accepted", createdAt: 10 }),
      req({ id: "p1", status: "played", playedAt: 100 }),
      req({ id: "p2", status: "played", playedAt: 200 }),
    ];
    const s = buildPublicState(all);
    expect(s.requestedCount).toBe(2);
    expect(s.accepted.map((r) => r.id)).toEqual(["a1", "a2"]);
    expect(s.played.map((r) => r.id)).toEqual(["p2", "p1"]);
    expect(s.latest?.id).toBe("p2");
    expect(JSON.stringify(s)).not.toContain("client-1");
    expect(JSON.stringify(s)).not.toContain('"x"');
  });
});
