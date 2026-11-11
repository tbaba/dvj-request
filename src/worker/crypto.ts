export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomString(length: number, alphabet: string): string {
  const out: string[] = [];
  const bytes = new Uint8Array(length * 2);
  while (out.length < length) {
    crypto.getRandomValues(bytes);
    for (const b of bytes) {
      // 偏りを避けるため alphabet.length の倍数未満だけ使う
      if (b < 256 - (256 % alphabet.length)) out.push(alphabet[b % alphabet.length]);
      if (out.length === length) break;
    }
  }
  return out.join("");
}

/** 読み間違えにくい文字だけを使う */
export const SLUG_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const KEY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
