import { useEffect, useState } from "react";
import type { EventInfo, PublicState } from "../../shared/types";
import { Qr } from "../components/Qr";
import { Song } from "../components/Song";
import { ConnectionBadge } from "../components/StatusBar";
import { formatTime, guestUrl } from "../lib";
import { useEventSocket } from "../useEventSocket";
import { NotFound } from "./Guest";

/** バーカウンター用の閲覧専用画面 */
export function Display({ slug }: { slug: string }) {
  const [event, setEvent] = useState<EventInfo | null>(null);
  const [pub, setPub] = useState<PublicState | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const conn = useEventSocket({
    slug,
    role: "display",
    onMessage: (msg) => {
      if (msg.type === "snapshot") {
        setEvent(msg.event);
        setPub(msg.public);
      } else if (msg.type === "event") setEvent(msg.event);
      else if (msg.type === "public") setPub(msg.public);
      else if (msg.type === "played") setFlash(msg.request.id);
    },
  });

  useEffect(() => {
    fetch(`/api/events/${slug}`).then((r) => r.status === 404 && setNotFound(true));
  }, [slug]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 6000);
    return () => clearTimeout(t);
  }, [flash]);

  if (notFound) return <NotFound />;
  if (!event || !pub) return <main className="display" />;

  return (
    <main className="display">
      <ConnectionBadge state={conn} />
      <section className="display-main">
        <h1 className="display-title">{event.name}</h1>

        <div className={`display-latest ${flash && pub.latest?.id === flash ? "flash" : ""}`}>
          <div className="label">さっき流したリクエスト</div>
          {pub.latest ? (
            <>
              <Song song={pub.latest} size="xl" />
              <div className="by">{pub.latest.nickname} さんのリクエスト</div>
            </>
          ) : (
            <div className="muted">まだありません</div>
          )}
        </div>

        <div className="display-columns">
          <div>
            <h2>再生待ち <span className="count">{pub.accepted.length}</span></h2>
            {pub.accepted.length === 0 ? (
              <p className="muted">なし</p>
            ) : (
              <ol className="display-list">
                {pub.accepted.map((r) => (
                  <li key={r.id}>
                    <Song song={r} />
                    <span className="by">{r.nickname}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
          <div>
            <h2>最近流した曲</h2>
            <ul className="display-list">
              {pub.played.slice(1, 8).map((r) => (
                <li key={r.id}>
                  <Song song={r} />
                  <span className="by">
                    {r.nickname}・{r.playedAt ? formatTime(r.playedAt) : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <aside className="display-side">
        {event.status === "open" ? (
          <>
            <div className="label">リクエストはこちら</div>
            <Qr text={guestUrl(slug)} size={260} />
            <p className="muted">DJ の確認待ち: {pub.requestedCount} 件</p>
          </>
        ) : (
          <div className="label">リクエストの受付は終了しました</div>
        )}
      </aside>
    </main>
  );
}
