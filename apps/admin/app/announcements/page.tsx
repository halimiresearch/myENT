'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { Btn, Card, Empty, Err, Loading, PageHeader, Thead, field } from '@/lib/ui';

export default function Announce() {
  const [rows, setRows] = useState<any[]>([]);
  const [err, setErr] = useState('');
  const [first, setFirst] = useState(true);
  const [form, setForm] = useState({ title: '', body: '', division: '', cohort: '' });
  const load = () => api<{ data: any[] }>('audit-logs?action=announcement.create&limit=20').then((r) => setRows(r.data)).catch((e) => setErr(e.message)).finally(() => setFirst(false));
  useEffect(() => {
    load();
  }, []);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!confirm(`Kirim ke ${form.division || 'semua anggota aktif'}?`)) return;
    try {
      await api('announcements', {
        method: 'POST',
        body: JSON.stringify({ title: form.title, body: form.body, division: form.division || undefined, cohortYear: form.cohort ? Number(form.cohort) : undefined }),
      });
      setForm({ title: '', body: '', division: '', cohort: '' });
      load();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Pengumuman" sub="Broadcast push ke anggota via FCM" />
      <Err msg={err} />
      <Card className="max-w-xl p-4">
        <form onSubmit={send} className="grid gap-2">
          <input className={field} placeholder="Judul" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required minLength={3} />
          <textarea className={`${field} min-h-24`} placeholder="Isi" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
          <div className="grid gap-2 sm:grid-cols-2">
            <input className={field} placeholder="Divisi target (kosong = semua)" value={form.division} onChange={(e) => setForm({ ...form, division: e.target.value })} />
            <input className={field} placeholder="Angkatan (kosong = semua)" value={form.cohort} onChange={(e) => setForm({ ...form, cohort: e.target.value })} />
          </div>
          <Btn primary>Kirim broadcast</Btn>
        </form>
      </Card>
      <Card className="p-4">
        <h2 className="mb-2 text-sm font-semibold">Terkirim</h2>
        {first ? <Loading /> : rows.length === 0 ? <Empty /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <Thead cols={['Waktu', 'Judul', 'Penerima']} />
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60">
                    <td className="py-2.5 pr-2 text-gray-500">{new Date(a.createdAt).toLocaleString('id-ID')}</td>
                    <td className="py-2.5 pr-2 font-medium">{(a.newValue as any)?.title}</td>
                    <td className="py-2.5">{(a.newValue as any)?.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
