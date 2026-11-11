# dvj-request

バー営業の時にブースに行くことなくリクエストを送ることができるシステム。
フロアの客がスマホから楽曲リクエストを送り、DJ が「流せる／流せない／流した」を判断し、バーカウンターのディスプレイと VJ に状況を表示する。

設計の詳細は [docs/design.md](docs/design.md)。

## 画面

| URL | 用途 |
|---|---|
| `/` | イベント作成 |
| `/e/:slug` | フロア：リクエスト送信（QR コードの行き先） |
| `/e/:slug/booth#key=…` | ブース：リクエストの判断（DJ 用。イベント作成時に URL が発行される） |
| `/e/:slug/display` | バー表示：さっき流した曲、再生待ち、QR コード |
| `/e/:slug/overlay` | VJ オーバーレイ（透過背景） |
| `/e/:slug/qr` | QR コード印刷用 |

## リクエストの状態

| 状態 | 意味 |
|---|---|
| `requested` | 未判断 |
| `accepted` | DJ が「流せる」と判断（バー表示に「再生待ち」で出る） |
| `rejected` | DJ が「流せない」と判断（本人には告知しない） |
| `played` | 流した（本人の画面に通知、VJ に送信） |

## 開発

```sh
npm install
npm run dev        # http://localhost:5173（Worker と Durable Object もローカルで動く）
npm test           # ユニットテスト
npm run typecheck
```

## デプロイ（Cloudflare）

```sh
npx wrangler login
npm run deploy
```

無料プランで動く（Durable Objects は SQLite ストレージ版を使用）。

## VJ 連携

### オーバーレイ

`/e/:slug/overlay` を TouchDesigner の Web Render TOP、または OBS のブラウザソース（→ NDI / Spout / Syphon）で取り込む。
DJ が「流した」にすると「〇〇さんからのリクエスト」が表示される。

| パラメータ | 内容 |
|---|---|
| `?duration=10` | 表示する秒数（既定 10） |
| `?persist=1` | 最後に流したリクエストを常に表示 |

### API

```sh
# 最後に流したリクエスト（なければ null）
curl https://<host>/api/events/<slug>/latest
```

```json
{
  "id": "…",
  "title": "残酷な天使のテーゼ",
  "artist": "高橋洋子",
  "tieIn": "新世紀エヴァンゲリオン",
  "nickname": "たろう",
  "status": "played",
  "createdAt": 1794362470804,
  "playedAt": 1794362470959
}
```

- `GET /api/events/:slug/public`：再生待ち・最近流した曲・未判断件数
- WebSocket `wss://<host>/api/events/:slug/ws?role=vj`：接続時に `snapshot`、以降 `public`（状態変更）と `played`（流した瞬間）が届く

いずれも認証不要で、DJ が「流せる」と判断したもの以外は含まれない。
