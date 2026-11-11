export const REQUEST_STATUSES = ["requested", "accepted", "rejected", "played"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export type EventStatus = "open" | "closed";

export type EventInfo = {
  slug: string;
  name: string;
  status: EventStatus;
  createdAt: number;
};

/** DJ（ブース）にだけ見える完全な情報 */
export type SongRequest = {
  id: string;
  title: string | null;
  artist: string | null;
  tieIn: string | null;
  nickname: string | null;
  clientId: string;
  status: RequestStatus;
  createdAt: number;
  updatedAt: number;
  playedAt: number | null;
};

/** バー表示・VJ に出す公開情報 */
export type PublicRequest = {
  id: string;
  title: string | null;
  artist: string | null;
  tieIn: string | null;
  /** 未入力の場合は「名無しさん」 */
  nickname: string;
  status: "accepted" | "played";
  createdAt: number;
  playedAt: number | null;
};

/** リクエストした本人に見せる情報。rejected は requested として見せる */
export type GuestRequest = {
  id: string;
  title: string | null;
  artist: string | null;
  tieIn: string | null;
  nickname: string;
  status: "requested" | "accepted" | "played";
  createdAt: number;
  playedAt: number | null;
};

export type PublicState = {
  /** 再生待ち（古い順） */
  accepted: PublicRequest[];
  /** 最近流した曲（新しい順） */
  played: PublicRequest[];
  /** 最後に流したリクエスト */
  latest: PublicRequest | null;
  /** 未判断の件数 */
  requestedCount: number;
};

export type NewRequestInput = {
  title?: string | null;
  artist?: string | null;
  tieIn?: string | null;
  nickname?: string | null;
  clientId: string;
};

export type Role = "guest" | "booth" | "display" | "vj";

export type ServerMessage =
  | {
      type: "snapshot";
      event: EventInfo;
      public: PublicState;
      requests?: SongRequest[];
      mine?: GuestRequest[];
    }
  | { type: "event"; event: EventInfo }
  | { type: "public"; public: PublicState }
  | { type: "request"; request: SongRequest | GuestRequest }
  | { type: "played"; request: PublicRequest }
  | { type: "auth_error" };

export type ClientMessage = { type: "auth"; key: string } | { type: "ping" };
