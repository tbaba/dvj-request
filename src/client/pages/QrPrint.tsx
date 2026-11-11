import { useEffect, useState } from "react";
import type { EventInfo } from "../../shared/types";
import { Qr } from "../components/Qr";
import { fetchEvent, guestUrl } from "../lib";
import { NotFound } from "./Guest";

/** 印刷して店内に貼るためのページ */
export function QrPrint({ slug }: { slug: string }) {
  const [event, setEvent] = useState<EventInfo | null>(null);
  const [notFound, setNotFound] = useState(false);
  useEffect(() => {
    fetchEvent(slug)
      .then(setEvent)
      .catch(() => setNotFound(true));
  }, [slug]);
  if (notFound) return <NotFound />;
  return (
    <main className="print">
      <h1>{event?.name ?? ""}</h1>
      <p className="print-lead">楽曲リクエスト受付中</p>
      <Qr text={guestUrl(slug)} size={360} />
      <p className="print-note">タイトル・アーティスト・タイアップ作品のうち2つを入力して送ってください</p>
      <p className="print-url">{guestUrl(slug)}</p>
      <button className="btn no-print" onClick={() => window.print()}>
        印刷する
      </button>
    </main>
  );
}
