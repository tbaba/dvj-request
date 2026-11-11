import { useEffect, useRef, useState } from "react";
import type { Role, ServerMessage } from "../shared/types";

export type ConnectionState = "connecting" | "open" | "closed";

type Options = {
  slug: string;
  role: Role;
  clientId?: string;
  /** booth のみ。null の間は接続しない */
  boothKey?: string | null;
  onMessage: (msg: ServerMessage) => void;
};

/** 切断されたら自動で再接続する WebSocket。再接続時は snapshot が届くので状態はそこで置き換える */
export function useEventSocket({ slug, role, clientId, boothKey, onMessage }: Options): ConnectionState {
  const [state, setState] = useState<ConnectionState>("connecting");
  const handler = useRef(onMessage);
  handler.current = onMessage;

  useEffect(() => {
    if (role === "booth" && !boothKey) return;
    let ws: WebSocket | null = null;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ping: ReturnType<typeof setInterval> | undefined;
    let stopped = false;

    const connect = () => {
      setState("connecting");
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const params = new URLSearchParams({ role });
      if (clientId) params.set("clientId", clientId);
      ws = new WebSocket(`${proto}//${location.host}/api/events/${slug}/ws?${params}`);
      ws.onopen = () => {
        retry = 0;
        setState("open");
        if (role === "booth") ws?.send(JSON.stringify({ type: "auth", key: boothKey }));
        ping = setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send('{"type":"ping"}'), 30_000);
      };
      ws.onmessage = (e) => {
        try {
          handler.current(JSON.parse(e.data));
        } catch {
          // 不正なメッセージは無視
        }
      };
      ws.onclose = (e) => {
        clearInterval(ping);
        setState("closed");
        if (stopped || e.code === 4001) return;
        const delay = Math.min(30_000, 1000 * 2 ** retry++);
        timer = setTimeout(connect, delay);
      };
    };
    connect();

    // スマホでスリープから戻ったときにすぐ再接続する
    const onVisible = () => {
      if (document.visibilityState === "visible" && ws?.readyState === WebSocket.CLOSED) {
        clearTimeout(timer);
        retry = 0;
        connect();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopped = true;
      clearTimeout(timer);
      clearInterval(ping);
      document.removeEventListener("visibilitychange", onVisible);
      ws?.close();
    };
  }, [slug, role, clientId, boothKey]);

  return state;
}
