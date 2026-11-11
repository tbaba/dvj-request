import type { EventInfo } from "../shared/types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit & { key?: string | null } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  if (init.key) headers.set("Authorization", `Bearer ${init.key}`);
  const res = await fetch(`/api${path}`, { ...init, headers });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(body?.error ?? `エラーが発生しました（${res.status}）`, res.status);
  return body as T;
}

export function fetchEvent(slug: string) {
  return api<EventInfo>(`/events/${slug}`);
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function load(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function save(key: string, value: string | null): void {
  try {
    if (value === null) storage()?.removeItem(key);
    else storage()?.setItem(key, value);
  } catch {
    // 保存できない環境（プライベートモードなど）では諦める
  }
}

/** 端末ごとの匿名 ID */
export function getClientId(): string {
  let id = load("dvj:clientId");
  if (!id) {
    id = crypto.randomUUID();
    save("dvj:clientId", id);
  }
  return id;
}

export function guestUrl(slug: string): string {
  return `${window.location.origin}/e/${slug}`;
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}
