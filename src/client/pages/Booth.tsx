import { useEffect, useState } from "react";
import { ANONYMOUS_NAME } from "../../shared/rules";
import type { EventInfo, RequestStatus, SongRequest } from "../../shared/types";
import { downloadQr, Qr } from "../components/Qr";
import { Song } from "../components/Song";
import { ConnectionBadge } from "../components/StatusBar";
import { api, formatTime, guestUrl, load, save } from "../lib";
import { useEventSocket } from "../useEventSocket";
import { Loading, NotFound } from "./Guest";

type Tab = RequestStatus;

const TABS: { key: Tab; label: string }[] = [
  { key: "requested", label: "未判断" },
  { key: "accepted", label: "再生待ち" },
  { key: "played", label: "流した" },
  { key: "rejected", label: "流せない" },
];

const ACTIONS: Record<RequestStatus, { to: RequestStatus; label: string; kind: string }[]> = {
  requested: [
    { to: "accepted", label: "流せる", kind: "primary" },
    { to: "rejected", label: "流せない", kind: "danger" },
    { to: "played", label: "流した", kind: "" },
  ],
  accepted: [
    { to: "played", label: "流した", kind: "primary" },
    { to: "requested", label: "戻す", kind: "ghost" },
  ],
  played: [{ to: "accepted", label: "戻す", kind: "ghost" }],
  rejected: [{ to: "requested", label: "戻す", kind: "ghost" }],
};

function keyStorageName(slug: string) {
  return `dvj:booth:${slug}`;
}

/** URL の #key=... を読み取り、保存してアドレスバーから消す */
function takeKeyFromHash(slug: string): string | null {
  const m = window.location.hash.match(/key=([^&]+)/);
  if (m) {
    const key = decodeURIComponent(m[1]);
    save(keyStorageName(slug), key);
    history.replaceState(null, "", window.location.pathname);
    return key;
  }
  return load(keyStorageName(slug));
}

function sortFor(tab: Tab, list: SongRequest[]): SongRequest[] {
  const copy = [...list];
  if (tab === "played") return copy.sort((a, b) => (b.playedAt ?? 0) - (a.playedAt ?? 0));
  if (tab === "rejected") return copy.sort((a, b) => b.updatedAt - a.updatedAt);
  return copy.sort((a, b) => a.createdAt - b.createdAt);
}

export function Booth({ slug }: { slug: string }) {
  const [key, setKey] = useState<string | null>(() => takeKeyFromHash(slug));
  const [authError, setAuthError] = useState(false);
  const [event, setEvent] = useState<EventInfo | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [requests, setRequests] = useState<SongRequest[]>([]);
  const [tab, setTab] = useState<Tab>("requested");
  const [showQr, setShowQr] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upsert = (r: SongRequest) =>
    setRequests((prev) => (prev.some((p) => p.id === r.id) ? prev.map((p) => (p.id === r.id ? r : p)) : [...prev, r]));

  const conn = useEventSocket({
    slug,
    role: "booth",
    boothKey: key,
    onMessage: (msg) => {
      switch (msg.type) {
        case "snapshot":
          setEvent(msg.event);
          setRequests(msg.requests ?? []);
          break;
        case "event":
          setEvent(msg.event);
          break;
        case "request":
          upsert(msg.request as SongRequest);
          break;
        case "auth_error":
          save(keyStorageName(slug), null);
          setKey(null);
          setAuthError(true);
          break;
      }
    },
  });

  useEffect(() => {
    api<EventInfo>(`/events/${slug}`)
      .then(setEvent)
      .catch(() => setNotFound(true));
  }, [slug]);

  const change = async (id: string, status: RequestStatus) => {
    setError(null);
    try {
      upsert(await api<SongRequest>(`/events/${slug}/requests/${id}`, { method: "PATCH", key, body: JSON.stringify({ status }) }));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const toggleOpen = async () => {
    if (!event) return;
    const next = event.status === "open" ? "closed" : "open";
    if (next === "closed" && !confirm("リクエストの受付を終了しますか？")) return;
    try {
      setEvent(await api<EventInfo>(`/events/${slug}`, { method: "PATCH", key, body: JSON.stringify({ status: next }) }));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (notFound) return <NotFound />;
  if (!key) return <KeyForm slug={slug} failed={authError} onSubmit={(k) => (save(keyStorageName(slug), k), setAuthError(false), setKey(k))} />;
  if (!event) return <Loading />;

  const counts = Object.fromEntries(TABS.map((t) => [t.key, requests.filter((r) => r.status === t.key).length])) as Record<Tab, number>;
  const visible = sortFor(
    tab,
    requests.filter((r) => r.status === tab),
  );
  const url = guestUrl(slug);

  return (
    <main className="page booth">
      <ConnectionBadge state={conn} />
      <header className="booth-header">
        <div>
          <div className="muted small">ブース</div>
          <h1>{event.name}</h1>
        </div>
        <div className="booth-actions">
          <button className="btn" onClick={() => setShowQr((v) => !v)}>
            QR
          </button>
          <button className={`btn ${event.status === "open" ? "" : "danger"}`} onClick={toggleOpen}>
            {event.status === "open" ? "受付中" : "受付終了"}
          </button>
        </div>
      </header>

      {showQr && (
        <section className="card qr-panel">
          <Qr text={url} size={200} />
          <div className="qr-panel-side">
            <p className="small break">{url}</p>
            <button className="btn" onClick={() => downloadQr(url, `request-${slug}.png`)}>
              PNG を保存
            </button>
            <a className="btn" href={`/e/${slug}/qr`} target="_blank" rel="noreferrer">
              印刷用ページ
            </a>
            <a className="btn" href={`/e/${slug}/display`} target="_blank" rel="noreferrer">
              バー表示
            </a>
            <a className="btn" href={`/e/${slug}/overlay`} target="_blank" rel="noreferrer">
              VJ オーバーレイ
            </a>
          </div>
        </section>
      )}

      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} className={`tab ${tab === t.key ? "active" : ""}`} onClick={() => setTab(t.key)}>
            {t.label}
            <span className="count">{counts[t.key]}</span>
          </button>
        ))}
      </nav>

      {error && <p className="error">{error}</p>}

      {visible.length === 0 ? (
        <p className="muted empty">リクエストはありません</p>
      ) : (
        <ul className="list">
          {visible.map((r) => (
            <li key={r.id} className="item booth-item">
              <div className="booth-item-body">
                <Song song={r} size="lg" />
                <div className="meta">
                  <span>{r.nickname ?? ANONYMOUS_NAME}</span>
                  <span className="mono" title="端末 ID">#{r.clientId.slice(0, 4)}</span>
                  <span>{formatTime(r.status === "played" && r.playedAt ? r.playedAt : r.createdAt)}</span>
                </div>
              </div>
              <div className="booth-item-actions">
                {ACTIONS[r.status].map((a) => (
                  <button key={a.to} className={`btn ${a.kind}`} onClick={() => change(r.id, a.to)}>
                    {a.label}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function KeyForm({ slug, failed, onSubmit }: { slug: string; failed: boolean; onSubmit: (key: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <main className="page narrow">
      <h1>ブース</h1>
      <form
        className="card form"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) onSubmit(value.trim());
        }}
      >
        {failed && <p className="error">ブースキーが正しくありません</p>}
        <p className="muted small">イベント作成時に発行されたブース URL から開くか、ブースキーを入力してください。（イベント: {slug}）</p>
        <label>
          ブースキー
          <input value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" />
        </label>
        <button className="btn primary">開く</button>
      </form>
    </main>
  );
}
