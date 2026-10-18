import { NextRequest, NextResponse } from 'next/server';
import { API, originOk, setSession } from '@/lib/auth';
import { clientIp, rateLimited } from '@/lib/ratelimit';

// Langkah kedua 2FA via BFF agar kuki sesi httpOnly ikut diset.
export async function POST(req: NextRequest) {
  if (!originOk(req)) return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
  // Kode 6 digit mudah di-brute-force; backend juga lockout per-akun (verify2fa).
  if (rateLimited(`2fa:${clientIp(req)}`, 10, 10 * 60_000))
    return NextResponse.json({ message: 'Terlalu banyak percobaan, coba lagi nanti' }, { status: 429 });
  const body = await req.json();
  const r = await fetch(`${API}/auth/2fa/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) return NextResponse.json(data, { status: r.status });
  await setSession(data.accessToken, data.refreshToken);
  const me = await fetch(`${API}/auth/me`, { headers: { authorization: `Bearer ${data.accessToken}` } }).then((x) => x.json());
  return NextResponse.json({ mustChangePassword: data.mustChangePassword, user: me });
}
