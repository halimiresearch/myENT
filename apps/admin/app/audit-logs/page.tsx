'use client';
import { useEffect, useState } from 'react';
import { api, dl } from '@/lib/client';
import { Btn, Card, Empty, Err, Loading, PageHeader, Pager, Thead, field } from '@/lib/ui';

const LIMIT = 20;

// oldValue/newValue: objek → daftar kunci berubah; skalar → lama → baru.
function diff(a: any) {
  const o = a.oldValue;
  const n = a.newValue;
  if (o == null && n == null) return '';
  if (typeof o === 'object' && typeof n === 'object' && o && n) {
    const keys = [...new Set([...Object.keys(o), ...Object.keys(n)])];
    const changed = keys.filter((k) => JSON.stringify(o[k]) !== JSON.stringify(n[k]));
    if (!changed.length) return '';
    return changed.map((k) => `${k}: ${JSON.stringify(o[k]) ?? '–'} → ${JSON.stringify(n[k]) ?? '–'}`).join('; ');
  }
  return `${JSON.stringify(o) ?? '–'} → ${JSON.stringify(n) ?? '–'}`;
}

export default function AuditLogs() {
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [first, setFirst] = useState(true);
  const [err, setErr] = useState('');
  const [q, setQ] = useState({ actor: '', action: '', from: '', to: '' });
  const load = (p = page) => {
    setErr('');
    const params = new URLSearchParams({ limit: `${LIMIT}`, page: `${p}` });
    if (q.actor) params.set('actor', q.actor);
    if (q.action) params.set('action', q.action);
    if (q.from) params.set('from', q.from);
    if (q.to) params.set('to', q.to);
    api<{ data: any[]; total: number }>(`audit-logs?${params}`)
      .then((r) => {
        setRows(r.data);
        setTotal(r.total);
        setPage(p);
        setFirst(false);
      })
      .catch((e) => {
        setErr(e.message);
        setFirst(false);
      });
  };
  useEffect(() => {
    load(1);
  }, []);

  function exp() {
    const params = new URLSearchParams();
    if (q.actor) params.set('actor', q.actor);
    if (q.action) params.set('action', q.action);
    if (q.from) params.set('from', q.from);
    if (q.to) params.set('to', q.to);
    const s = params.toString();
    dl(`/api/audit-logs/export.xlsx${s ? `?${s}` : ''}`, 'audit-log.xlsx').catch((e) => setErr(e.message));
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Audit Log"
        sub="Jejak aktivitas administratif (append-only)"
        actions={<Btn onClick={exp}>Export XLSX</Btn>}
      />
      <Err msg={err} />
      <Card className="p-4">
        <div className="flex flex-wrap gap-2">
          <input className={`${field} w-full sm:w-48`} placeholder="Aktor ID" value={q.actor} onChange={(e) => setQ({ ...q, actor: e.target.value })} />
          <input className={`${field} w-full sm:w-48`} placeholder="Aksi" value={q.action} onChange={(e) => setQ({ ...q, action: e.target.value })} />
          <input className={field} type="date" value={q.from} onChange={(e) => setQ({ ...q, from: e.target.value })} />
          <input className={field} type="date" value={q.to} onChange={(e) => setQ({ ...q, to: e.target.value })} />
          <Btn onClick={() => load(1)}>Terapkan</Btn>
        </div>
      </Card>
      <Card className="p-4">
        {first ? <Loading /> : rows.length === 0 ? <Empty /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <Thead cols={['Waktu', 'Aktor', 'Aksi', 'Entity', 'Perubahan', 'Alasan']} />
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60">
                    <td className="py-2.5 pr-2 text-gray-500">{new Date(a.createdAt).toLocaleString('id-ID')}</td>
                    <td className="py-2.5 pr-2 font-medium">{a.actor?.name ?? ''} <span className="font-normal text-gray-500">({a.actor?.nim ?? a.actorId ?? 'sistem'})</span></td>
                    <td className="py-2.5 pr-2 font-medium">{a.action}</td>
                    <td className="py-2.5 pr-2 text-gray-500" title={a.entityId}>{a.entity}/{String(a.entityId).slice(0, 8)}</td>
                    <td className="py-2.5 pr-2 text-gray-500">{diff(a)}</td>
                    <td className="py-2.5">{a.reason ?? ''}</td>
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
