'use client';
import { useState } from 'react';
import { api } from '@/lib/client';
import { Btn, Card, PageHeader, field } from '@/lib/ui';

export default function Profile() {
  const [oldP, setOldP] = useState('');
  const [newP, setNewP] = useState('');
  const [msg, setMsg] = useState('');
  const [secret, setSecret] = useState('');
  const [otpUrl, setOtpUrl] = useState('');
  const [setupPw, setSetupPw] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  async function ganti(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    setBusy(true);
    try {
      await api('auth/change-password', { method: 'POST', body: JSON.stringify({ oldPassword: oldP, newPassword: newP }) });
      setOldP('');
      setNewP('');
      setMsg('Password diganti.');
    } catch (e: any) {
      setMsg(e.message ?? 'Gagal');
    } finally {
      setBusy(false);
    }
  }

  async function keluar() {
    try {
      await api('auth/logout', { method: 'POST', body: JSON.stringify({}) });
    } catch {
      /* tetap keluar lokal */
    }
    location.href = '/login';
  }

  return (
    <div className="max-w-md space-y-4">
      <PageHeader title="Profil" sub="Keamanan akunmu" />
      {msg && <p role="status" className="rounded-xl bg-brand-100 px-3 py-2 text-sm text-brand-700">{msg}</p>}
      <Card className="p-4">
        <h2 className="mb-2 text-sm font-semibold">Ganti Password</h2>
        <form onSubmit={ganti} className="grid gap-2">
          <input className={field} type="password" placeholder="Password lama" value={oldP} onChange={(e) => setOldP(e.target.value)} required />
          <input className={field} type="password" placeholder="Password baru (min 10)" value={newP} onChange={(e) => setNewP(e.target.value)} required minLength={10} />
          <Btn primary disabled={busy}>Ganti password</Btn>
        </form>
      </Card>
      <Card className="p-4">
        <h2 className="mb-2 text-sm font-semibold">2FA (aplikasi authenticator)</h2>
        {!secret ? (
          <form
            className="grid gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                const r = await api<{ secret: string; otpauthUrl: string }>('auth/2fa/setup', { method: 'POST', body: JSON.stringify({ password: setupPw }) });
                setSecret(r.secret);
                setOtpUrl(r.otpauthUrl);
                setMsg('');
              } catch (e: any) {
                setMsg(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <input className={field} type="password" placeholder="Password saat ini" aria-label="Password saat ini" value={setupPw} onChange={(e) => setSetupPw(e.target.value)} required />
            <Btn disabled={busy}>Mulai setup 2FA</Btn>
          </form>
        ) : (
          <div className="grid gap-2">
            <p className="break-all text-sm">Secret: <code className="rounded bg-gray-100 px-1">{secret}</code></p>
            <p className="break-all text-xs text-gray-500">{otpUrl}</p>
            <p className="text-sm text-gray-500">Masukkan ke aplikasi authenticator, lalu verifikasi kode 6 digit:</p>
            <input className={field} placeholder="123456" aria-label="Kode 2FA" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} />
            <Btn
              primary
              onClick={async () => {
                try {
                  await api('auth/2fa/enable', { method: 'POST', body: JSON.stringify({ code }) });
                  setMsg('2FA aktif.');
                  setSecret('');
                  setOtpUrl('');
                  setSetupPw('');
                } catch {
                  setMsg('Kode salah.');
                }
              }}
            >
              Aktifkan
            </Btn>
          </div>
        )}
      </Card>
      <button className="w-full rounded-xl bg-rose-600 py-2 text-sm font-medium text-white transition hover:bg-rose-700" onClick={() => confirm('Keluar?') && keluar()}>Keluar</button>
    </div>
  );
}
