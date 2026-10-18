'use client';
import { useEffect, useState } from 'react';
import { api, dl } from '@/lib/client';
import { Btn, Card, Empty, Err, Loading, PageHeader, Pager, Thead, field } from '@/lib/ui';

const COLS = ['name', 'present', 'permitted', 'sick', 'dispensation', 'absent', 'percentage'];
const LIMIT = 20;

export default function Recap() {
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [first, setFirst] = useState(true);
  const [q, setQ] = useState({ search: '', sortBy: 'name', order: 'asc', from: '', to: '' });
  const toISO = (s: string) => {
    if (!s) return undefined;
    const d = new Date(s);
    return isNaN(+d) ? undefined : d.toISOString();
  };
  const load = (p = page) => {
    if (busy) return;
    setBusy(true);
    setErr('');
    const params = new URLSearchParams({ limit: `${LIMIT}`, page: `${p}`, search: q.search, sortBy: q.sortBy, order: q.order });
    const f = toISO(q.from);
    const t = toISO(q.to);
    if (f) params.set('from', f);
    if (t) params.set('to', t);
    api<{ data: any[]; total: number }>(`attendance/recap?${params}`)
      .then((r) => {
        setRows(r.data);
        setTotal(r.total);
        setPage(p);
      })
      .catch((e) => setErr(e.message))
      .finally(() => { setBusy(false); setFirst(false); });
  };
  useEffect(() => {
    load(1);
  }, []);

  function exp() {
    const params = new URLSearchParams({ search: q.search, sortBy: q.sortBy, order: q.order });
    const f = toISO(q.from);
    const t = toISO(q.to);
    if (f) params.set('from', f);
    if (t) params.set('to', t);
    const s = params.toString();
    dl(`/api/attendance/recap/export.xlsx${s ? `?${s}` : ''}`, 'rekap.xlsx').catch((e) => setErr(e.message));
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Rekap (${total})`}
        sub="Rekap kehadiran per anggota"
        actions={<Btn onClick={exp}>Export XLSX</Btn>}
      />
      <Err msg={err} />
      <Card className="p-4">
        <div className="flex flex-wrap gap-2">
          <input className={`${field} w-full sm:w-56`} placeholder="Cari nama/NIM" aria-label="Cari nama/NIM" value={q.search} onChange={(e) => setQ({ ...q, search: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && load()} />
          <select className={field} aria-label="Urut kolom" value={q.sortBy} onChange={(e) => setQ({ ...q, sortBy: e.target.value })}>
            {COLS.map((c) => <option key={c}>{c}</option>)}
          </select>
          <select className={field} aria-label="Urutan" value={q.order} onChange={(e) => setQ({ ...q, order: e.target.value })}>
            <option>asc</option><option>desc</option>
          </select>
          <input className={field} type="date" aria-label="Dari tanggal" value={q.from} onChange={(e) => setQ({ ...q, from: e.target.value })} />
          <input className={field} type="date" aria-label="Sampai tanggal" value={q.to} onChange={(e) => setQ({ ...q, to: e.target.value })} />
          <Btn onClick={() => load(1)}>Terapkan</Btn>
        </div>
      </Card>
      <Card className="p-4">
        {first ? <Loading /> : rows.length === 0 ? <Empty /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <Thead cols={['Nama', 'NIM', 'Hadir', 'Izin', 'Sakit', 'Disp', 'Alpha', '%']} />
              <tbody>
                {rows.map((r) => (
                  <tr key={r.user.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60">
                    <td className="py-2.5 pr-2 font-medium">{r.user.name}</td>
                    <td className="py-2.5 pr-2 text-gray-500">{r.user.nim}</td>
                    <td className="py-2.5 pr-2">{r.present}</td>
                    <td className="py-2.5 pr-2">{r.permitted}</td>
                    <td className="py-2.5 pr-2">{r.sick}</td>
                    <td className="py-2.5 pr-2">{r.dispensation}</td>
                    <td className="py-2.5 pr-2">{r.absent}</td>
                    <td className="py-2.5 font-semibold">{r.percentage ?? '–'}{r.percentage !== null && '%'}</td>
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
