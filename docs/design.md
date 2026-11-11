# 設計メモ（MVP）

想定規模：30人程度の小さなクラブ、DJ バー。1イベントあたりのリクエストは多くて数百件。

## 1. 技術スタック

| 層 | 採用 |
|---|---|
| 言語 | TypeScript（フロント・サーバー・型定義を共有） |
| フロント | React + Vite。ロールごとに画面を分ける |
| API | Hono on Cloudflare Workers（静的ファイルも同じ Worker から配信） |
| リアルタイム | Durable Objects（1イベント＝1インスタンス）+ WebSocket（Hibernation API） |
| 永続化 | Durable Object 内蔵の SQLite ストレージ |
| 通知 | 画面を開いている間のみ（WebSocket）。Web Push は使わない |

この規模なら Cloudflare の無料枠に収まる。

## 2. ロールと画面

| ロール | 端末 | URL | 権限 |
|---|---|---|---|
| 主催者 | 任意 | `/` | イベントを作成する |
| フロア（Guest） | スマホ | `/e/:slug` | リクエスト送信、自分のリクエストの状態閲覧 |
| ブース（DJ） | スマホ / ブースのディスプレイ | `/e/:slug/booth#key=…` | 全リクエスト閲覧、状態変更、受付終了 |
| バー表示（Display） | バーカウンターのディスプレイ | `/e/:slug/display` | 閲覧のみ（公開情報） |
| VJ | VJ ソフト / PC | `/e/:slug/overlay`、`/api/...` | 閲覧のみ（公開情報） |
| QR 印刷 | 任意 | `/e/:slug/qr` | 閲覧のみ |

- アカウントは作らない。イベント作成時に発行される **ブースキー** を知っている人だけが DJ 操作をできる。
- ブースキーは URL の `#` 以降（フラグメント）に置く。ブース画面を開くとブラウザに保存し、アドレスバーからは消す。
- どの DJ が流したかは記録しない。ブースキーを持つ人は全員同じ権限。
- フロアの人は匿名。端末ごとに `clientId`（UUID）を localStorage に保存する。ニックネームは任意で、未入力なら「名無しさん」。
- リクエストのリストはイベントごとに独立している。

### QR コード

- フロアの送信画面（`/e/:slug`）の URL を QR コードにする。ブラウザ側で生成する。
- ブース画面・バー表示・印刷用ページ（`/e/:slug/qr`）に表示する。

### 公開範囲

バー表示と VJ に出すのは、**DJ が「流せる」と判断したもの（`accepted`）と、流したもの（`played`）だけ**。
`requested`（未判断）は件数のみ、`rejected` は一切出さない。

## 3. リクエストの状態

| 状態 | 意味 | バー表示 | リクエストした本人の画面 |
|---|---|---|---|
| `requested` | 届いたばかり。DJ が未判断 | 件数のみ | リクエスト済み |
| `accepted` | DJ が「流せる」と判断した | 再生待ち | 再生待ち |
| `rejected` | DJ が「流せない」と判断した | 出さない | **リクエスト済み**（告知しない） |
| `played` | DJ が「流しました」にした | 最近流した曲 | 流しました！（画面を開いていれば通知） |

```
requested ─(流せる)─▶ accepted ─(流しました)─▶ played
    │ └──────────(流しました)──────────────────▲
    └─(流せない)─▶ rejected
```

- DJ は判断ミスを直せるよう、どの状態からでも別の状態に戻せる（UI では「戻す」ボタン）。
- 「再生中」という状態は持たない。VJ やバー表示が出す「誰々からのリクエスト」は、**最後に `played` にしたリクエスト**。

## 4. データモデル

```ts
type EventMeta = {
  slug: string;            // URL 用。8文字のランダム文字列
  name: string;
  boothKeyHash: string;    // ブースキーの SHA-256
  status: "open" | "closed";
  createdAt: number;
};

type SongRequest = {
  id: string;
  title: string | null;
  artist: string | null;
  tieIn: string | null;    // タイアップ作品
  nickname: string | null;
  clientId: string;        // 匿名の端末 ID（DJ にのみ見える）
  status: "requested" | "accepted" | "rejected" | "played";
  createdAt: number;
  updatedAt: number;
  playedAt: number | null;
};
```

入力チェック：`title` / `artist` / `tieIn` のうち、前後の空白を除いて **2つ以上** 入力されていること。各項目は100文字、ニックネームは30文字まで。

## 5. API

REST：
| メソッド | パス | 用途 | 認証 |
|---|---|---|---|
| POST | `/api/events` | イベント作成（slug とブースキーを返す） | なし |
| GET | `/api/events/:slug` | イベント情報 | なし |
| PATCH | `/api/events/:slug` | 受付の開始／終了 | ブースキー |
| POST | `/api/events/:slug/requests` | リクエスト送信 | なし（回数制限あり） |
| GET | `/api/events/:slug/requests` | 全件 | ブースキー |
| GET | `/api/events/:slug/requests/mine?clientId=` | 自分のリクエスト | なし |
| PATCH | `/api/events/:slug/requests/:id` | 状態変更 | ブースキー |
| GET | `/api/events/:slug/public` | 再生待ち、最近流した曲、未判断件数 | なし |
| GET | `/api/events/:slug/latest` | VJ 用：最後に流したリクエスト | なし |

ブースキーは `Authorization: Bearer <key>` で送る。

WebSocket：`/api/events/:slug/ws?role=guest|booth|display|vj`（guest は `&clientId=` も付ける）
- 接続直後にロールに応じたスナップショットを送り、以降は変更があるたびに送る。
- booth は接続後、最初のメッセージで `{"type":"auth","key":"…"}` を送る。
- サーバーからのメッセージ：
  - `snapshot`：初期状態
  - `event`：イベント情報の変更（受付終了など）
  - `public`：公開情報の変更（全ロール）
  - `request`：リクエスト1件の変更（booth は全件、guest は自分の分だけ）
  - `played`：リクエストが「流しました」になった（booth 以外）

## 6. VJ 連携

1. JSON API と WebSocket（TouchDesigner などから直接使う）
2. `/e/:slug/overlay`：透過背景で「〇〇さんからのリクエスト」を表示する HTML。「流しました」になったときに一定時間（`?duration=秒`、既定10秒）表示する。`?persist=1` で常時表示
3. （第2段階）OSC ブリッジ

## 7. いたずら対策（MVP）

- 同じ `clientId` から **2分に1件** まで
- 未処理（`requested` / `accepted`）は1人 **3件まで**
- バー表示と VJ には DJ が判断したものしか出さない
- 主催者は受付を終了できる

## 8. 第2段階の候補

- 同じ曲のリクエストをまとめる（「+3人」表示）
- 端末単位のブロック
- OSC ブリッジ
- イベント終了後の履歴の CSV 出力
- イベント作成の制限（管理者トークンなど）
