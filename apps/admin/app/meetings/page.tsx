'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { Btn, Card, Empty, Err, Loading, PageHeader, Pager, StatusPill, Thead, field } from '@/lib/ui';

const dt = (s: string) => new Date(s).toLocaleString('id-ID');
const LIMIT = 20;

export default function Meetings() {
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [err, setErr] = useState('');
  const [first, setFirst] = useState(true);
  const [form, setForm] = useState({ title: '', startAt: '', endAt: '', openAt: '', closeAt: '' });
  const load = (p = page) => {
    setErr('');
    api<{ data: any[]; total: number }>(`meetings?limit=${LIMIT}&page=${p}`)
      .then((r) => {
        setRows(r.data);
        setTotal(r.total);
        setPage(p);
      })
      .catch((e) => setErr(e.message))
      .finally(() => setFirst(false));
  };
  useEffect(() => {
    load(1);
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api('meetings', {
        method: 'POST',
        body: JSON.stringify({
          title: form.title,
          startAt: new Date(form.startAt).toISOString(),
          endAt: new Date(form.endAt).toISOString(),
          attendanceOpenAt: new Date(form.openAt).toISOString(),
          attendanceCloseAt: new Date(form.closeAt).toISOString(),
        }),
      });
      setForm({ title: '', startAt: '', endAt: '', openAt: '', closeAt: '' });
      load(1);
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function act(id: string, path: string, method = 'PATCH', body?: any) {
    try {
      await api(`meetings/${id}${path}`, { method, body: body ? JSON.stringify(body) : undefined });
      load();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title={`Kegiatan (${total})`} sub="Buat, publish, dan kelola presensi kegiatan" />
      <Err msg={err} />
      <Card className="p-4">
        <form onSubmit={create} className="grid gap-2 md:grid-cols-3">
          <input className={`${field} md:col-span-3`} placeholder="Judul kegiatan" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          <label className="text-xs text-gray-500">Mulai <input type="datetime-local" className={`${field} mt-1 w-full`} value={form.startAt} onChange={(e) => setForm({ ...form, startAt: e.target.value })} required /></label>
          <label className="text-xs text-gray-500">Selesai <input type="datetime-local" className={`${field} mt-1 w-full`} value={form.endAt} onChange={(e) => setForm({ ...form, endAt: e.target.value })} required /></label>
          <div className="flex items-end"><Btn primary>Buat DRAFT</Btn></div>
          <label className="text-xs text-gray-500">Presensi dibuka <input type="datetime-local" className={`${field} mt-1 w-full`} value={form.openAt} onChange={(e) => setForm({ ...form, openAt: e.target.value })} required /></label>
          <label className="text-xs text-gray-500">Presensi ditutup <input type="datetime-local" className={`${field} mt-1 w-full`} value={form.closeAt} onChange={(e) => setForm({ ...form, closeAt: e.target.value })} required /></label>
        </form>
      </Card>
      <Card className="p-4">
        {first ? <Loading /> : rows.length === 0 ? <Empty /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <Thead cols={['Judul', 'Mulai', 'Status', 'Aksi']} />
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60">
                    <td className="py-2.5 pr-2 font-medium"><Link className="text-brand-700 hover:text-brand-800" href={`/meetings/${m.id}`}>{m.title}</Link></td>
                    <td className="py-2.5 pr-2 text-gray-500">{dt(m.startAt)}</td>
                    <td className="py-2.5 pr-2"><StatusPill value={m.status} /></td>
                    <td className="py-2.5">
                      <span className="flex flex-wrap gap-x-3 gap-y-1">
                        {m.status === 'DRAFT' && <button className="font-medium text-emerald-700 hover:text-emerald-900" onClick={() => act(m.id, '', 'PATCH', { status: 'PUBLISHED' })}>Publish</button>}
                        {m.status !== 'CANCELLED' && <button className="font-medium text-rose-600 hover:text-rose-800" onClick={() => confirm('Batalkan?') && act(m.id, '', 'PATCH', { status: 'CANCELLED' })}>Batal</button>}
                        <button className="font-medium text-gray-500 hover:text-gray-700" onClick={() => { const s = prompt('Mulai duplikat (YYYY-MM-DDTHH:mm)', m.startAt.slice(0, 16)); if (s) act(m.id, '/duplicate', 'POST', { startAt: new Date(s).toISOString() }); }}>Duplikat</button>
                        <button className="font-medium text-gray-500 hover:text-gray-600" onClick={() => confirm(`Hapus ${m.title}?`) && act(m.id, '', 'DELETE')}>Hapus</button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager page={page} total={total} limit={LIMIT} onPage={load} />
      </Card>
    </div>
  );
}
