'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Err } from '@/lib/ui';

declare global {
  interface Window {
    turnstile?: { getResponse: () => string; reset: () => void };
  }
}

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';

export default function Login() {
  const [nim, setNim] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [mustChange, setMustChange] = useState(false);
  const [need2fa, setNeed2fa] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (!SITE_KEY || document.getElementById('cf-script')) return;
    const s = document.createElement('script');
    s.id = 'cf-script';
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    s.async = true;
    document.body.appendChild(s);
    return () => {
      document.getElementById('cf-script')?.remove();
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      const token = window.turnstile?.getResponse() ?? '';
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nim, password, 'cf-turnstile-response': token }),
      });
      const d = await r.json();
      if (!r.ok) return setErr(d.message ?? 'Gagal login');
      if (d.twoFactorRequired) return setNeed2fa(d.pendingToken);
      if (d.mustChangePassword) return setMustChange(true);
      gate(d.user?.role);
    } finally {
      window.turnstile?.reset();
      setBusy(false);
    }
  }

  async function forgot() {
    if (busy || !nim.trim()) {
      if (!nim.trim()) setErr('Isi NIM dulu untuk reset via email');
      return;
    }
    setBusy(true);
    setErr('');
    setInfo('');
    try {
      await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nim: nim.trim() }),
      });
      setInfo('Bila NIM terdaftar dan ada email, tautan reset (1 jam) terkirim.');
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      const r = await fetch('/api/auth/2fa/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pendingToken: need2fa, code }),
      });
      const d = await r.json();
      if (!r.ok) return setErr(d.message ?? 'Kode salah');
      if (d.mustChangePassword) {
        setNeed2fa('');
        return setMustChange(true);
      }
      gate(d.user?.role);
    } finally {
      window.turnstile?.reset();
      setBusy(false);
    }
  }

  async function gate(role: string) {
    if (role !== 'OFFICER' && role !== 'ADMIN') {
      await fetch('/api/auth/logout', { method: 'POST' });
      return setErr('Hanya pengurus yang dapat masuk Web Admin');
    }
    router.push('/');
  }

  async function change(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      const np = (document.getElementById('np') as HTMLInputElement).value;
      const r = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ oldPassword: password, newPassword: np }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        return setErr(d.message ?? 'Gagal');
      }
      router.push('/');
    } finally {
      window.turnstile?.reset();
      setBusy(false);
    }
  }

  const input = 'w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm outline-none placeholder:text-gray-500 focus:border-brand-200 focus:ring-2 focus:ring-brand-100';
  const btn = 'w-full rounded-xl bg-brand-700 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-800 disabled:opacity-50';

  return (
    <div className="grid w-full max-w-4xl overflow-hidden rounded-3xl bg-white shadow-xl md:grid-cols-2">
      {/* Form */}
      <div className="p-8 sm:p-10">
        <span className="inline-flex items-center rounded-2xl bg-brand-800 px-3 py-2">
          <img src="/assets/ent.svg" alt="Logo UKM Jurnalistik" className="h-8 w-auto" />
        </span>
        <h1 className="mt-6 text-2xl font-bold tracking-tight">Selamat datang kembali!</h1>
        <p className="mt-1 text-sm text-gray-500">
          {need2fa ? 'Verifikasi dua langkah untuk melanjutkan.' : mustChange ? 'Amankan akunmu dengan password baru.' : 'Masuk untuk mengelola UKM Jurnalistik.'}
        </p>
        <div className="mt-5">
          <Err msg={err} />
          {info && <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700 ring-1 ring-inset ring-emerald-200">{info}</p>}
        </div>
        {need2fa ? (
          <form onSubmit={verify} className="flex flex-col gap-3">
            <div>
              <label htmlFor="code" className="mb-1 block text-sm font-medium">Kode authenticator <span className="text-rose-500">*</span></label>
              <input id="code" className={input} placeholder="123456" aria-label="Kode 2FA" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
            <button className={btn} disabled={busy}>Verifikasi</button>
          </form>
        ) : !mustChange ? (
          <form onSubmit={submit} className="flex flex-col gap-3">
            <div>
              <label htmlFor="nim" className="mb-1 block text-sm font-medium">NIM <span className="text-rose-500">*</span></label>
              <input id="nim" className={input} placeholder="Masukkan NIM" aria-label="NIM" autoComplete="username" value={nim} onChange={(e) => setNim(e.target.value)} />
            </div>
            <div>
              <label htmlFor="password" className="mb-1 block text-sm font-medium">Password <span className="text-rose-500">*</span></label>
              <div className="relative">
                <input
                  id="password" className={`${input} pr-11`} type={show ? 'text' : 'password'}
                  placeholder="Masukkan password" aria-label="Password" autoComplete="current-password"
                  value={password} onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Sembunyikan password' : 'Tampilkan password'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-600"
                >
                  {show ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="size-5" aria-hidden><path d="M3 3l18 18" /><path d="M10.6 5.1A9.8 9.8 0 0112 5c7 0 10 7 10 7a17 17 0 01-2.9 3.6M6.6 6.6A16.6 16.6 0 002 12s3 7 10 7a9.6 9.6 0 004.4-1.1" /><path d="M9.9 9.9a3 3 0 004.2 4.2" /></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="size-5" aria-hidden><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>
                  )}
                </button>
              </div>
            </div>
            {SITE_KEY ? (
              <div className="cf-turnstile" data-sitekey={SITE_KEY} />
            ) : (
              <p className="text-xs text-amber-700">Turnstile belum dikonfigurasi (dev saja).</p>
            )}
            <button className={btn} disabled={busy}>Masuk</button>
            <button type="button" className="text-sm font-medium text-brand-700 hover:text-brand-800 disabled:opacity-50" disabled={busy} onClick={forgot}>Lupa password? Reset via email</button>
          </form>
        ) : (
          <form onSubmit={change} className="flex flex-col gap-3">
            <div>
              <label htmlFor="np" className="mb-1 block text-sm font-medium">Password baru <span className="text-rose-500">*</span></label>
              <input id="np" className={input} type="password" placeholder="Minimal 10 karakter" aria-label="Password baru" minLength={10} autoComplete="new-password" />
            </div>
            <button className={btn} disabled={busy}>Ganti & Masuk</button>
          </form>
        )}
        <p className="mt-6 text-center text-sm text-gray-500">Akses khusus pengurus UKM Jurnalistik.</p>
      </div>
      {/* Panel dekoratif */}
      <div className="relative hidden overflow-hidden bg-brand-800 md:block" aria-hidden>
        <svg viewBox="0 0 400 600" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full">
          <rect width="400" height="600" fill="#0d3059" />
          <circle cx="60" cy="80" r="110" fill="#134179" />
          <circle cx="60" cy="80" r="70" fill="#2e5e96" opacity="0.7" />
          <rect x="230" y="30" width="140" height="140" rx="8" fill="#081f3d" />
          <path d="M250 80l14-14 14 14-14 14z" fill="#f4cb01" />
          <path d="M278 80l14-14 14 14-14 14z" fill="#ffffff" />
          <rect x="250" y="110" width="110" height="8" rx="4" fill="#8fb4dd" />
          <rect x="250" y="124" width="110" height="8" rx="4" fill="#8fb4dd" opacity="0.6" />
          <path d="M90 230l28-40 28 40z" fill="#8fb4dd" />
          <path d="M90 262l28-40 28 40z" fill="#8fb4dd" opacity="0.6" />
          <path d="M200 300l10-22 10 22-10 22z" fill="#f4cb01" />
          <circle cx="330" cy="240" r="90" fill="#134179" />
          <path d="M240 240h180" stroke="#2e5e96" strokeWidth="10" />
          <path d="M250 262h170" stroke="#2e5e96" strokeWidth="6" opacity="0.7" />
          <rect x="40" y="330" width="70" height="90" fill="#8fb4dd" opacity="0.85" />
          <path d="M40 330l70 90M40 330v90h70" stroke="#134179" strokeWidth="2" opacity="0.5" />
          <path d="M150 320l8 16 17 2-12 12 3 17-16-8-16 8 3-17-12-12 17-2z" fill="#f4cb01" />
          <circle cx="200" cy="470" r="90" fill="#134179" />
          <path d="M200 380a90 90 0 0190 90H200z" fill="#081f3d" opacity="0.6" />
          <rect x="290" y="420" width="110" height="180" fill="#8fb4dd" opacity="0.85" />
          <path d="M60 520q15-15 30 0t30 0 30 0 30 0" stroke="#8fb4dd" strokeWidth="4" fill="none" />
          <path d="M60 540q15-15 30 0t30 0 30 0 30 0" stroke="#8fb4dd" strokeWidth="4" fill="none" opacity="0.6" />
          <g fill="#ffffff" opacity="0.85">
            <circle cx="330" cy="480" r="3" /><circle cx="345" cy="480" r="3" /><circle cx="360" cy="480" r="3" />
            <circle cx="330" cy="495" r="3" /><circle cx="345" cy="495" r="3" /><circle cx="360" cy="495" r="3" />
            <circle cx="330" cy="510" r="3" /><circle cx="345" cy="510" r="3" /><circle cx="360" cy="510" r="3" />
          </g>
          <circle cx="70" cy="540" r="45" fill="none" stroke="#f4cb01" strokeWidth="3" opacity="0.8" />
          <circle cx="70" cy="540" r="28" fill="none" stroke="#f4cb01" strokeWidth="2" opacity="0.5" />
        </svg>
      </div>
    </div>
  );
}
