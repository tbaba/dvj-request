import type { ConnectionState } from "../useEventSocket";

export function ConnectionBadge({ state }: { state: ConnectionState }) {
  if (state === "open") return null;
  return <div className="conn-badge">{state === "connecting" ? "接続中…" : "再接続しています…"}</div>;
}
