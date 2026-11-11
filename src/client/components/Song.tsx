type SongFields = { title: string | null; artist: string | null; tieIn: string | null };

/** タイトル・アーティスト・タイアップ作品の表示（入力されたものだけ） */
export function Song({ song, size = "md" }: { song: SongFields; size?: "md" | "lg" | "xl" }) {
  return (
    <div className={`song song-${size}`}>
      <div className="song-title">{song.title ?? <span className="muted">（タイトル未入力）</span>}</div>
      <div className="song-sub">
        {song.artist && <span>{song.artist}</span>}
        {song.tieIn && <span className="tiein">{song.tieIn}</span>}
      </div>
    </div>
  );
}
