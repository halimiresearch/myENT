import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rateLimited: vi.fn<(key: string, max: number, windowMs: number) => boolean>(() => false),
  setSession: vi.fn(),
}));

vi.mock('@/lib/ratelimit', () => ({ clientIp: () => '10.0.0.9', rateLimited: mocks.rateLimited }));
vi.mock('@/lib/auth', () => ({ API: 'http://api.test', originOk: () => true, setSession: mocks.setSession }));
vi.mock('@/lib/turnstile', () => ({ turnstileBypass: () => true, turnstileSecret: () => undefined }));

import { POST } from './route';

const json = (data: unknown) => ({ ok: true, status: 200, json: async () => data });

function req(body: unknown) {
  return new Request('http://localhost:3102/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => mocks.rateLimited.mockClear().mockReturnValue(false));
afterEach(() => vi.unstubAllGlobals());

describe('POST /api/auth/login (BFF)', () => {
  it('memakai jendela rate limit 10 menit (600.000 ms), bukan ~100 menit', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) =>
      String(url).endsWith('/auth/login') ? json({ accessToken: 'a', refreshToken: 'r', mustChangePassword: false }) : json({ name: 'Admin' }),
    ));
    const r = await POST(req({ nim: 'admin001', password: 'x' }));
    expect(r.status).toBe(200);
    expect(mocks.rateLimited).toHaveBeenCalledWith('login:10.0.0.9', 20, 600_000);
    expect(mocks.setSession).toHaveBeenCalledWith('a', 'r');
  });

  it('saat limit tercapai: 429 bahasa Indonesia tanpa memanggil backend', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    mocks.rateLimited.mockReturnValue(true);
    const r = await POST(req({ nim: 'x', password: 'y' }));
    expect(r.status).toBe(429);
    expect(await r.json()).toEqual({ message: 'Terlalu banyak percobaan, coba lagi nanti' });
    expect(f).not.toHaveBeenCalled();
  });
});
