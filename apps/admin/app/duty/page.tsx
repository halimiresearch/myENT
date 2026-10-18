'use client';
import { useState } from 'react';
import { api } from '@/lib/client';
import { Btn, Card, Err, PageHeader, field } from '@/lib/ui';

export default function Duty() {
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ startDate: '', days: '7', perDay: '1', division: '' });
  const gen = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const r = await api<{ meetings: number }>('duty/roster', {
        method: 'POST',
        body: JSON.stringify({
          startDate: new Date(form.startDate).toISOString(),
          days: Number(form.days),
          perDay: Number(form.perDay),
          division: form.division || undefined,
        }),
      });
      alert(`${r.meetings} kegiatan piket (DRAFT) dibuat`);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Piket" sub="Generate roster piket otomatis sebagai kegiatan DRAFT" />
      <Err msg={err} />
      <Card className="p-4">
        <form onSubmit={gen} className="grid gap-2 md:grid-cols-5">
          <input type="date" className={field} value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} required />
          <input type="number" min={1} max={90} className={field} placeholder="Hari" value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })} />
          <input type="number" min={1} max={5} className={field} placeholder="Orang/hari" value={form.perDay} onChange={(e) => setForm({ ...form, perDay: e.target.value })} />
          <input className={field} placeholder="Divisi (kosong = semua)" value={form.division} onChange={(e) => setForm({ ...form, division: e.target.value })} />
          <Btn primary disabled={busy}>{busy ? 'Memproses…' : 'Generate roster'}</Btn>
        </form>
        <p className="mt-3 text-sm text-gray-500">Roster menghasilkan kegiatan DRAFT. Publish dari halaman Kegiatan. Presensi + rekap reuse alur biasa (rekap % mengecualikan piket).</p>
      </Card>
    </div>
  );
}
