import type {
  GuestRequest,
  NewRequestInput,
  PublicRequest,
  PublicState,
  SongRequest,
} from "./types";

export const FIELD_MAX = 100;
export const NICKNAME_MAX = 30;
export const ANONYMOUS_NAME = "名無しさん";
/** 同じ端末から次のリクエストを送れるまでの間隔 */
export const RATE_LIMIT_MS = 2 * 60 * 1000;
/** 1人あたりの未処理（requested / accepted）リクエストの上限 */
export const MAX_OPEN_PER_CLIENT = 3;
/** バー表示に出す「最近流した曲」の件数 */
export const PLAYED_HISTORY_LIMIT = 10;

export type NormalizedRequest = {
  title: string | null;
  artist: string | null;
  tieIn: string | null;
  nickname: string | null;
};

export type ValidationResult =
  | { ok: true; value: NormalizedRequest }
  | { ok: false; error: string };

function clean(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s === "" ? null : s;
}

export function validateRequest(input: Partial<NewRequestInput>): ValidationResult {
  const title = clean(input.title);
  const artist = clean(input.artist);
  const tieIn = clean(input.tieIn);
  const nickname = clean(input.nickname);

  const filled = [title, artist, tieIn].filter((v) => v !== null).length;
  if (filled < 2) {
    return { ok: false, error: "タイトル・アーティスト・タイアップ作品のうち2つ以上を入力してください" };
  }
  for (const v of [title, artist, tieIn]) {
    if (v !== null && v.length > FIELD_MAX) {
      return { ok: false, error: `各項目は${FIELD_MAX}文字以内で入力してください` };
    }
  }
  if (nickname !== null && nickname.length > NICKNAME_MAX) {
    return { ok: false, error: `ニックネームは${NICKNAME_MAX}文字以内で入力してください` };
  }
  return { ok: true, value: { title, artist, tieIn, nickname } };
}

export type RateLimitResult = { ok: true } | { ok: false; error: string };

/** clientRequests: 同じ clientId の過去のリクエスト */
export function checkRateLimit(clientRequests: SongRequest[], now: number): RateLimitResult {
  const open = clientRequests.filter((r) => r.status === "requested" || r.status === "accepted");
  if (open.length >= MAX_OPEN_PER_CLIENT) {
    return { ok: false, error: `未処理のリクエストは${MAX_OPEN_PER_CLIENT}件までです。流れるまでお待ちください` };
  }
  if (clientRequests.length === 0) return { ok: true };
  const last = Math.max(...clientRequests.map((r) => r.createdAt));
  const wait = last + RATE_LIMIT_MS - now;
  if (wait > 0) {
    return { ok: false, error: `連続でのリクエストはできません。あと${Math.ceil(wait / 1000)}秒お待ちください` };
  }
  return { ok: true };
}

export function toPublic(r: SongRequest): PublicRequest | null {
  if (r.status !== "accepted" && r.status !== "played") return null;
  return {
    id: r.id,
    title: r.title,
    artist: r.artist,
    tieIn: r.tieIn,
    nickname: r.nickname ?? ANONYMOUS_NAME,
    status: r.status,
    createdAt: r.createdAt,
    playedAt: r.playedAt,
  };
}

export function toGuest(r: SongRequest): GuestRequest {
  return {
    id: r.id,
    title: r.title,
    artist: r.artist,
    tieIn: r.tieIn,
    nickname: r.nickname ?? ANONYMOUS_NAME,
    // 「流せない」は本人に告知しない
    status: r.status === "rejected" ? "requested" : r.status,
    createdAt: r.createdAt,
    playedAt: r.playedAt,
  };
}

export function buildPublicState(all: SongRequest[]): PublicState {
  const accepted = all
    .filter((r) => r.status === "accepted")
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((r) => toPublic(r)!);
  const played = all
    .filter((r) => r.status === "played")
    .sort((a, b) => (b.playedAt ?? 0) - (a.playedAt ?? 0))
    .slice(0, PLAYED_HISTORY_LIMIT)
    .map((r) => toPublic(r)!);
  return {
    accepted,
    played,
    latest: played[0] ?? null,
    requestedCount: all.filter((r) => r.status === "requested").length,
  };
}
