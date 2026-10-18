import { requireFileSecret, requireQrSecret } from './jwt-secret';

const KEYS = ['JWT_SECRET', 'FILE_HMAC_SECRET', 'QR_HMAC_SECRET', 'NODE_ENV'] as const;
const saved: Record<string, string | undefined> = {};
beforeAll(() => KEYS.forEach((k) => (saved[k] = process.env[k])));
afterEach(() => KEYS.forEach((k) => (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]!))));

const S32 = 'a'.repeat(32);

describe('kunci HMAC file/QR (B-12)', () => {
  it('production: FILE kosong → gagal cepat, bukan fallback JWT_SECRET', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = S32;
    delete process.env.FILE_HMAC_SECRET;
    expect(() => requireFileSecret()).toThrow(/wajib di production/);
  });

  it('production: QR kosong → gagal cepat', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = S32;
    delete process.env.QR_HMAC_SECRET;
    expect(() => requireQrSecret()).toThrow(/wajib di production/);
  });

  it('production: terisi → dipakai', () => {
    process.env.NODE_ENV = 'production';
    process.env.FILE_HMAC_SECRET = 'f'.repeat(32);
    expect(requireFileSecret()).toBe('f'.repeat(32));
  });

  it('non-production: kosong → fallback JWT_SECRET (lokal tetap jalan)', () => {
    process.env.NODE_ENV = 'development';
    process.env.JWT_SECRET = S32;
    delete process.env.FILE_HMAC_SECRET;
    expect(requireFileSecret()).toBe(S32);
  });

  it('diisi tapi < 32 karakter → gagal di semua environment', () => {
    process.env.NODE_ENV = 'development';
    process.env.FILE_HMAC_SECRET = 'pendek';
    expect(() => requireFileSecret()).toThrow(/< 32 karakter/);
  });
});
