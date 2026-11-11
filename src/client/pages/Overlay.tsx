import { useEffect, useState } from "react";
import type { PublicRequest } from "../../shared/types";
import { Song } from "../components/Song";
import { useEventSocket } from "../useEventSocket";

/**
 * VJ ソフトに取り込むための透過オーバーレイ。
 * ?duration=秒（既定10）: 「流しました」になったときに表示する時間
 * ?persist=1: 最後に流したリクエストを常に表示する
 */
export function Overlay({ slug }: { slug: string }) {
  const params = new URLSearchParams(window.location.search);
  const duration = Math.max(1, Number(params.get("duration")) || 10) * 1000;
  const persist = params.get("persist") === "1";

  const [current, setCurrent] = useState<PublicRequest | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    document.documentElement.classList.add("overlay-root");
    return () => document.documentElement.classList.remove("overlay-root");
  }, []);

  useEventSocket({
    slug,
    role: "vj",
    onMessage: (msg) => {
      if (msg.type === "snapshot" && persist) {
        setCurrent(msg.public.latest);
        setVisible(msg.public.latest !== null);
      } else if (msg.type === "public" && persist) {
        setCurrent(msg.public.latest);
        setVisible(msg.public.latest !== null);
      } else if (msg.type === "played") {
        setCurrent(msg.request);
        setVisible(true);
      }
    },
  });

  useEffect(() => {
    if (!visible || persist) return;
    const t = setTimeout(() => setVisible(false), duration);
    return () => clearTimeout(t);
  }, [visible, current, persist, duration]);

  return (
    <main className="overlay">
      {current && (
        <div className={`overlay-card ${visible ? "show" : ""}`}>
          <div className="overlay-by">{current.nickname} さんからのリクエスト</div>
          <Song song={current} />
        </div>
      )}
    </main>
  );
}
