// Secret terpusat. JWT, HMAC file, dan HMAC QR WAJIB beda key — bocor 1 ≠ jebol semua.
// FILE_HMAC_SECRET / QR_HMAC_SECRET wajib di production; fallback JWT_SECRET hanya di non-production.
// Jangan fallback ke 'dev' — gagal cepat dengan pesan jelas (PRD §18).
export function requireJwtSecret(): string {
  const s = process.env.JWT_SECRET ?? '';
  if (s.length < 32) throw new Error('JWT_SECRET wajib min 32 karakter (set di env, lihat .env.example)');
  return s;
}

function pick(name: string): string {
  const s = process.env[name] ?? '';
  if (s.length >= 32) return s;
  if (s.length > 0) throw new Error(`${name} diisi tapi < 32 karakter`);
  // B-12: production wajib kunci terpisah (satu bocor ≠ jebol semua); fallback hanya non-production.
  if (process.env.NODE_ENV === 'production')
    throw new Error(`${name} wajib di production (min 32 karakter, lihat .env.prod.example)`);
  return requireJwtSecret();
}

export function requireFileSecret(): string {
  return pick('FILE_HMAC_SECRET');
}

export function requireQrSecret(): string {
  return pick('QR_HMAC_SECRET');
}
