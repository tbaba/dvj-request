import { useEffect, useMemo, useRef, useState } from "react";
import type { EventInfo, GuestRequest } from "../../shared/types";
import { Song } from "../components/Song";
import { ConnectionBadge } from "../components/StatusBar";
import { api, getClientId, load, save } from "../lib";
import { useEventSocket } from "../useEventSocket";

const STATUS_LABEL: Record<GuestRequest["status"], string> = {
  requested: "リクエスト済み",
  accepted: "再生待ち",
  played: "流しました！",
};

export function Guest({ slug }: { slug: string }) {
  const clientId = useMemo(getClientId, []);
  const [event, setEvent] = useState<EventInfo | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [mine, setMine] = useState<GuestRequest[]>([]);
  const [toast, setToast] = useState<GuestRequest | null>(null);
  const mineRef = useRef(mine);
  mineRef.current = mine;

  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [tieIn, setTieIn] = useState("");
  const [nickname, setNickname] = useState(() => load("dvj:nickname") ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const conn = useEventSocket({
    slug,
    role: "guest",
    clientId,
    onMessage: (msg) => {
      switch (msg.type) {
        case "snapshot":
          setEvent(msg.event);
          setMine(msg.mine ?? []);
          break;
        case "event":
          setEvent(msg.event);
          break;
        case "request": {
          const r = msg.request as GuestRequest;
          const old = mineRef.current.find((p) => p.id === r.id);
          if (r.status === "played" && old?.status !== "played") {
            setToast(r);
            navigator.vibrate?.([200, 100, 200]);
          }
          setMine((prev) => (prev.some((p) => p.id === r.id) ? prev.map((p) => (p.id === r.id ? r : p)) : [...prev, r]));
          break;
        }
      }
    },
  });

  useEffect(() => {
    api<EventInfo>(`/events/${slug}`)
      .then(setEvent)
      .catch(() => setNotFound(true));
  }, [slug]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(t);
  }, [toast]);

  const filled = [title, artist, tieIn].filter((v) => v.trim() !== "").length;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSent(false);
    try {
      const nick = nickname.trim();
      save("dvj:nickname", nick || null);
      await api(`/events/${slug}/requests`, {
        method: "POST",
        body: JSON.stringify({ title, artist, tieIn, nickname: nick, clientId }),
      });
      setTitle("");
      setArtist("");
      setTieIn("");
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (notFound) return <NotFound />;
  if (!event) return <Loading />;

  const sorted = [...mine].sort((a, b) => b.createdAt - a.createdAt);

  return (
    <main className="page narrow">
      <ConnectionBadge state={conn} />
      {toast && (
        <div className="toast" role="status" onClick={() => setToast(null)}>
          <div className="toast-label">あなたのリクエストを流しました！</div>
          <Song song={toast} />
        </div>
      )}
      <header className="guest-header">
        <div className="muted small">楽曲リクエスト</div>
        <h1>{event.name}</h1>
      </header>

      {event.status === "closed" ? (
        <section className="card">
          <p>リクエストの受付は終了しました。</p>
        </section>
      ) : (
        <form className="card form" onSubmit={submit}>
          <p className="hint">3つのうち2つ以上を入力してください（{filled}/3）</p>
          <label>
            タイトル
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} autoComplete="off" />
          </label>
          <label>
            アーティスト
            <input value={artist} onChange={(e) => setArtist(e.target.value)} maxLength={100} autoComplete="off" />
          </label>
          <label>
            タイアップ作品
            <input
              value={tieIn}
              onChange={(e) => setTieIn(e.target.value)}
              maxLength={100}
              autoComplete="off"
              placeholder="アニメ・ドラマ・ゲームなど"
            />
          </label>
          <label>
            ニックネーム（任意）
            <input value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={30} placeholder="名無しさん" />
          </label>
          {error && <p className="error">{error}</p>}
          {sent && <p className="success">リクエストを送信しました</p>}
          <button className="btn primary" disabled={busy || filled < 2}>
            リクエストを送る
          </button>
        </form>
      )}

      {sorted.length > 0 && (
        <section>
          <h2>あなたのリクエスト</h2>
          <ul className="list">
            {sorted.map((r) => (
              <li key={r.id} className={`item status-${r.status}`}>
                <Song song={r} />
                <span className={`badge badge-${r.status}`}>{STATUS_LABEL[r.status]}</span>
              </li>
            ))}
          </ul>
          <p className="muted small">この画面を開いている間、流れたときにお知らせします。</p>
        </section>
      )}
    </main>
  );
}

export function NotFound() {
  return (
    <main className="page narrow">
      <h1>イベントが見つかりません</h1>
      <p className="muted">URL をもう一度確認してください。</p>
    </main>
  );
}

export function Loading() {
  return (
    <main className="page narrow">
      <p className="muted">読み込み中…</p>
    </main>
  );
}
