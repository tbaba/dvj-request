import QRCode from "qrcode";
import { useEffect, useState } from "react";

export function Qr({ text, size = 240, className }: { text: string; size?: number; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toDataURL(text, { width: size * 2, margin: 1, errorCorrectionLevel: "M" })
      .then(setSrc)
      .catch(() => setSrc(null));
  }, [text, size]);
  if (!src) return <div className={className} style={{ width: size, height: size }} />;
  return <img className={`qr ${className ?? ""}`} src={src} width={size} height={size} alt={`QRコード: ${text}`} />;
}

export async function downloadQr(text: string, filename: string) {
  const url = await QRCode.toDataURL(text, { width: 1024, margin: 2 });
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
}
