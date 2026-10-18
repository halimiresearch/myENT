'use client';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Err } from '@/lib/ui';

// Halaman publik: dibuka dari tautan email reset.
function ResetForm() {
  const q = useSearchParams();
  const router = useRouter();
  const token = q.get('token') ?? '';
  const [np, setNp] = useState('');
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      const r = await fetch('/api/auth/reset-via-email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, newPassword: np }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return setErr(d.message ?? 'Tautan tidak valid atau kedaluwarsa');
      setDone(true);
    } finally {
      setBusy(false);
    }
  }

  const input = 'w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm outline-none placeholder:text-gray-500 focus:border-brand-200 focus:ring-2 focus:ring-brand-100';

  return (
    <div className="w-full max-w-sm rounded-3xl bg-white p-8 shadow-xl">
      <span className="inline-flex items-center rounded-2xl bg-brand-800 px-3 py-2">
        <img src="/assets/ent.svg" alt="Logo UKM Jurnalistik" className="h-8 w-auto" />
      </span>
      <h1 className="mt-6 text-2xl font-bold tracking-tight">Reset password</h1>
      <p className="mt-1 text-sm text-gray-500">Tautan berlaku 1 jam dan sekali pakai.</p>
      <div className="mt-5"><Err msg={err} /></div>
      {!token ? (
        <p className="text-sm text-gray-500">Tautan tidak lengkap. Buka lagi dari email terbarumu.</p>
      ) : done ? (
        <div>
          <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700 ring-1 ring-inset ring-emerald-200">Password berhasil diganti. Silakan masuk.</p>
          <button className="mt-3 w-full rounded-xl bg-brand-700 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-800" onClick={() => router.push('/login')}>Ke halaman masuk</button>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div>
            <label htmlFor="np" className="mb-1 block text-sm font-medium">Password baru <span className="text-rose-500">*</span></label>
            <input id="np" className={input} type="password" placeholder="Minimal 10 karakter" value={np} onChange={(e) => setNp(e.target.value)} required minLength={10} autoComplete="new-password" />
          </div>
          <button className="w-full rounded-xl bg-brand-700 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-800 disabled:opacity-50" disabled={busy}>Ganti password</button>
        </form>
      )}
    </div>
  );
}

export default function Reset() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
