import { useState } from "react";
import { Qr } from "../components/Qr";
import { api, guestUrl } from "../lib";

type Created = { slug: string; boothKey: string };

export function Home() {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setCreated(await api<Created>("/events", { method: "POST", body: JSON.stringify({ name }) }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    const origin = window.location.origin;
    const boothUrl = `${origin}/e/${created.slug}/booth#key=${created.boothKey}`;
    return (
      <main className="page narrow">
        <h1>イベントを作成しました</h1>
        <section className="card">
          <h2>ブース（DJ 用）</h2>
          <p className="warn">このURLを知っている人は誰でも DJ 操作ができます。DJ 以外には共有しないでください。</p>
          <CopyField value={boothUrl} />
          <a className="btn primary block" href={boothUrl}>
            ブース画面を開く
          </a>
        </section>
        <section className="card">
          <h2>フロア（リクエスト送信）</h2>
          <div className="center">
            <Qr text={guestUrl(created.slug)} size={200} />
          </div>
          <CopyField value={guestUrl(created.slug)} />
        </section>
        <section className="card">
          <h2>その他の画面</h2>
          <ul className="links">
            <li>
              <a href={`/e/${created.slug}/display`}>バー表示</a>
            </li>
            <li>
              <a href={`/e/${created.slug}/overlay`}>VJ オーバーレイ</a>
            </li>
            <li>
              <a href={`/e/${created.slug}/qr`}>QR コード印刷</a>
            </li>
          </ul>
        </section>
      </main>
    );
  }

  return (
    <main className="page narrow">
      <h1>DVJ Request</h1>
      <p className="muted">フロアからの楽曲リクエストを、DJ・VJ に届けるためのツールです。</p>
      <form className="card form" onSubmit={submit}>
        <label>
          イベント名
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required placeholder="例: Friday Night Session" />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn primary" disabled={busy || name.trim() === ""}>
          イベントを作成
        </button>
      </form>
    </main>
  );
}

function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-field">
      <input readOnly value={value} onFocus={(e) => e.target.select()} />
      <button
        type="button"
        className="btn"
        onClick={async () => {
          await navigator.clipboard?.writeText(value).catch(() => {});
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "コピー済み" : "コピー"}
      </button>
    </div>
  );
}
