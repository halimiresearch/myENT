import { NextRequest, NextResponse } from 'next/server';
import { API, originOk, setSession } from '@/lib/auth';
import { clientIp, rateLimited } from '@/lib/ratelimit';
import { turnstileBypass, turnstileSecret } from '@/lib/turnstile';

async function turnstileOk(token: string | undefined, ip?: string | null) {
  if (turnstileBypass()) return true;
  const secret = turnstileSecret();
  if (!secret) return false;
  if (!token) return false;
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret, response: token, ...(ip ? { remoteip: ip } : {}) }),
    signal: AbortSignal.timeout(10_000),
  }).then((x) => x.json()).catch(() => null);
  return r?.success === true;
}

export async function POST(req: NextRequest) {
  if (!originOk(req)) return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
  const ip = clientIp(req);
  // Backend sudah lockout per-akun; ini lapis per-IP (Turnstile tetap wajib).
  if (rateLimited(`login:${ip}`, 20, 10 * 60_000))
    return NextResponse.json({ message: 'Terlalu banyak percobaan, coba lagi nanti' }, { status: 429 });
  const body = await req.json();
  if (!(await turnstileOk(body['cf-turnstile-response'], ip)))
    return NextResponse.json({ message: 'Verifikasi manusia gagal' }, { status: 403 });
  const { 'cf-turnstile-response': _, ...login } = body;
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(login),
  });
  const data = await r.json();
  if (!r.ok) return NextResponse.json(data, { status: r.status });
  if (data.twoFactorRequired) return NextResponse.json(data);
  if (!data.accessToken || !data.refreshToken) return NextResponse.json(data, { status: 200 });
  await setSession(data.accessToken, data.refreshToken);
  const me = await fetch(`${API}/auth/me`, { headers: { authorization: `Bearer ${data.accessToken}` }, signal: AbortSignal.timeout(10_000) }).then((x) => x.json()).catch(() => null);
  return NextResponse.json({ mustChangePassword: data.mustChangePassword, user: me });
}
