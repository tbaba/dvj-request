# 設計メモ（MVP）

## 1. 技術スタック

| 層 | 採用 |
|---|---|
| 言語 | TypeScript（フロント・サーバー・型定義を共有） |
| フロント | React + Vite（PWA）。ロールごとに画面を分ける |
| API | Hono on Cloudflare Workers |
| リアルタイム | Durable Objects（1イベント＝1インスタンス）+ WebSocket（Hibernation API） |
| 永続化 | Durable Object 内蔵の SQLite ストレージ |
| 通知 | 画面を開いている間のみ（WebSocket）。Web Push は使わない |

## 2. ロールと画面

| ロール | 端末 | URL | 権限 |
|---|---|---|---|
| フロア（Guest） | スマホ | `/e/:slug` | リクエスト送信、自分のリクエストの状態閲覧 |
| ブース（DJ） | スマホ / ブースのディスプレイ | `/e/:slug/booth#key=…` | 全リクエスト閲覧、状態変更、非表示、ブロック |
| バー表示（Display） | バーカウンターのディスプレイ | `/e/:slug/display` | 閲覧のみ（公開情報） |
| VJ | VJ ソフト / PC | `/e/:slug/overlay`、`/api/...` | 閲覧のみ（公開情報） |

- アカウントは作らない。イベント作成時に発行される **ブースキー** を知っている人だけが DJ 操作をできる。
- ブースキーは URL の `#` 以降（フラグメント）に置き、サーバーのログに残らないようにする。
- フロアの人は匿名で使う。端末ごとに `clientId`（UUID）を localStorage に保存し、ニックネームは任意入力。

### イベント単位

- リクエストのリストはイベントごとに独立している。別のイベントのリクエストは見えない。
- どの DJ が流したかは記録しない。ブースキーを持つ人は全員同じ権限で操作する。

### QR コード

- フロアの送信画面（`/e/:slug`）の URL を QR コードにする。
- ブース画面に QR コードを表示し、PNG のダウンロードと印刷用ページ（`/e/:slug/qr`）を用意する。
- バー表示にも常に QR コードを出す。
- QR コードはブラウザ側で生成する（サーバー処理は不要）。

### 公開範囲

バー表示と VJ に出すのは、**DJ が「流せる」と判断したもの（`accepted` / `playing` / `played`）だけ**。
未判断（`pending`）と「流せない」（`rejected`）は出さない。未判断の件数だけは表示する。

## 3. リクエストの状態遷移

```
                 ┌─(DJ: 流せる)─▶ accepted ─(DJ: 再生開始)─┐
pending(未判断) ─┤                                        ├─▶ playing ─(DJ: 終了 / 次の曲を再生開始)─▶ played
                 ├─(DJ: 再生開始)──────────────────────────┘
                 └─(DJ: 流せない)─▶ rejected
```

- `pending`：届いたばかりで、DJ がまだ判断していない
- `accepted`：DJ が「流せる」と判断した。バー表示に **「再生待ち」** として出る
- `rejected`：DJ が「流せない」と判断した
- `playing`：今流している。常に1件だけで、新しく `playing` にすると前の曲は自動で `played` になる
- `played`：流し終わった
- 判断ミスを直せるよう、`pending` / `accepted` / `rejected` の間は相互に戻せる
- `rejected` をリクエストした本人にどう見せるかは **要検討**（「流せません」と明示するか、`pending` のまま見せるか）

## 4. データモデル

```ts
type Event = {
  slug: string;            // URL 用。短いランダム文字列
  name: string;
  boothKeyHash: string;    // ブースキーのハッシュ
  status: "open" | "closed";
  createdAt: number;
};

type SongRequest = {
  id: string;
  title?: string;
  artist?: string;
  tieIn?: string;          // タイアップ作品
  nickname?: string;       // 未入力なら「名無しさん」
  clientId: string;        // 匿名の端末 ID（DJ にのみ見える）
  status: "pending" | "accepted" | "rejected" | "playing" | "played";
  createdAt: number;
  decidedAt?: number;      // 流せる / 流せないを判断した時刻
  playingAt?: number;
  playedAt?: number;
};
```

入力チェック：`title` / `artist` / `tieIn` のうち、空白を除いて **2つ以上** 入力されていること。各項目は100文字まで。

## 5. API

REST：
| メソッド | パス | 用途 | 認証 |
|---|---|---|---|
| POST | `/api/events` | イベント作成（slug とブースキーを返す） | なし（後で制限を検討） |
| GET | `/api/events/:slug` | イベント情報 | なし |
| POST | `/api/events/:slug/requests` | リクエスト送信 | なし（回数制限あり） |
| GET | `/api/events/:slug/requests?mine=:clientId` | 自分のリクエスト一覧 | なし |
| GET | `/api/events/:slug/requests` | 全件 | ブースキー |
| PATCH | `/api/events/:slug/requests/:id` | 状態変更 | ブースキー |
| GET | `/api/events/:slug/now-playing` | VJ 用：現在の曲 | なし |
| GET | `/api/events/:slug/public` | バー表示用：現在の曲、再生待ち（accepted）、履歴、未判断件数 | なし |

WebSocket：`/api/events/:slug/ws?role=guest|booth|display|vj`
- 接続直後にロールに応じた **スナップショット** を送り、以降は差分イベントを送る。
- メッセージ種別：`snapshot` / `request.created` / `request.updated` / `public.updated`
- ロールごとに受け取る範囲を絞る（guest は自分の分だけ、display / vj は公開情報だけ）。

VJ 向け `now-playing` のレスポンス例：
```json
{ "id": "…", "title": "…", "artist": "…", "tieIn": "…", "nickname": "…", "playingAt": 1762800000000 }
```

## 6. VJ 連携

1. JSON API と WebSocket（TouchDesigner などから直接使う）
2. `/e/:slug/overlay`：透過背景で「〇〇さんからのリクエスト」を表示する HTML。Web Render TOP や OBS（→ NDI / Spout / Syphon）で取り込む
3. （第2段階）OSC ブリッジ：ブースの PC で動く Node 製 CLI。WebSocket で受け取って OSC に変換する

## 7. いたずら対策（MVP）

- 回数制限：同じ `clientId` から **3分に1件**、未処理（`pending` / `accepted`）は **3件まで**
- DJ は `clientId` 単位でブロックできる（ブロックされた人の送信は成功したように見せて破棄する）
- 公開範囲を絞る（§2）

## 8. 画面（MVP）

- **フロア**：入力フォーム（3項目＋ニックネーム）、自分のリクエスト一覧（状態をリアルタイム表示、`playing` になったら強調表示とバイブレーション）
- **ブース**：タブで「未判断」「再生待ち」「流せない」「履歴」を切り替える。未判断のカードには「流せる」「流せない」「今すぐ再生」、再生待ちのカードには「再生開始」ボタン。現在の曲と QR コードも表示。大画面と暗い場所での使用を前提にする
- **バー表示**：Now Playing（リクエスト者名つき）、再生待ちリスト（`accepted` のみ）、直近の履歴、未判断の件数、リクエスト用 QR コード
- **QR 印刷用**（`/e/:slug/qr`）：イベント名と QR コードだけを大きく出す、印刷向けのページ
- **オーバーレイ**：Now Playing が変わったときに一定時間だけアニメーション表示

## 9. 第2段階の候補

- 同じ曲のリクエストをまとめる（「+3人」表示）
- OSC ブリッジ
- イベント終了後の履歴の CSV 出力
- 楽曲検索 API による入力補完
