'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { Avatar, Card, Empty, Err, Loading, PageHeader, Thead } from '@/lib/ui';

export default function Analytics() {
  const [trends, setTrends] = useState<any>({ data: [] });
  const [abs, setAbs] = useState<any[]>([]);
  const [div, setDiv] = useState<any[]>([]);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  useEffect(() => {
    Promise.all([
      api<any>('analytics/trends?months=6'),
      api<any[]>('analytics/frequent-absentees?limit=10'),
      api<any[]>('analytics/by-division'),
    ])
      .then(([t, a, d]) => {
        setTrends(t);
        setAbs(a);
        setDiv(d);
      })
      .catch((e) => setErr(e.message ?? 'Gagal memuat'))
      .finally(() => setDone(true));
  }, []);

  if (err) return <div><PageHeader title="Analitik" /><Err msg={err} /></div>;
  if (!done) return <div className="space-y-4"><PageHeader title="Analitik" /><Card className="p-4"><Loading /></Card></div>;

  return (
    <div className="space-y-4">
      <PageHeader title="Analitik" sub={`Tren kehadiran 6 bulan terakhir${trends.truncated ? ' (terpotong)' : ''}`} />
      <Card className="p-4">
        <h2 className="mb-2 text-sm font-semibold">Tren Bulanan</h2>
        {(trends.data ?? []).length === 0 ? <Empty /> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <Thead cols={['Bulan', 'Total', 'Efektif', '%']} />
            <tbody>
              {(trends.data ?? []).map((t: any) => (
                <tr key={t.month} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60">
                  <td className="py-2.5 pr-2 font-medium">{t.month}</td>
                  <td className="py-2.5 pr-2">{t.total}</td>
                  <td className="py-2.5 pr-2">{t.effective}</td>
                  <td className="py-2.5 font-semibold">{t.percentage ?? '–'}{t.percentage !== null && '%'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
      </Card>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold">Sering Alpha</h2>
          {abs.length === 0 ? <Empty /> : (
            <ul className="divide-y divide-gray-50">
              {abs.map((a: any) => (
                <li key={a.user?.id} className="flex items-center gap-2.5 py-2">
                  <Avatar name={a.user?.name ?? '?'} />
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate font-medium">{a.user?.name}</span>
                    <span className="block text-xs text-gray-500">{a.user?.nim} · {a.user?.division || '–'}</span>
                  </span>
                  <span className="text-sm font-bold text-rose-600">{a.alphas}×</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold">Per Divisi</h2>
          {div.length === 0 ? <Empty /> : (
            <ul className="space-y-3">
              {div.map((d: any) => (
                <li key={d.division}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="font-medium">{d.division}</span>
                    <span className="text-gray-500">{d.percentage ?? '–'}{d.percentage !== null && '%'}</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-gray-100">
                    <div
                      className={`h-full rounded-full ${(d.percentage ?? 0) >= 85 ? 'bg-emerald-500' : (d.percentage ?? 0) >= 75 ? 'bg-amber-400' : 'bg-rose-400'}`}
                      style={{ width: `${Math.min(100, d.percentage ?? 0)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
          <h2 className="mb-2 mt-5 text-sm font-semibold">Poin Keaktifan</h2>
          <Points />
        </Card>
      </div>
    </div>
  );
}

function Points() {
  const [rows, setRows] = useState<any[]>([]);
  const [err, setErr] = useState('');
  const [first, setFirst] = useState(true);
  useEffect(() => {
    api<any[]>('points/leaderboard')
      .then(setRows)
      .catch((e) => setErr(e.message ?? 'Gagal memuat'))
      .finally(() => setFirst(false));
  }, []);
  if (first) return <Loading />;
  if (err) return <Err msg={err} />;
  if (!rows.length) return <Empty />;
  return (
    <ul className="divide-y divide-gray-50">
      {rows.map((r: any, i: number) => (
        <li key={r.user.id} className="flex items-center gap-2.5 py-2">
          <span className={`grid size-6 shrink-0 place-items-center rounded-lg text-xs font-bold ${i < 3 ? 'bg-gold-100 text-yellow-800' : 'bg-gray-100 text-gray-500'}`}>{i + 1}</span>
          <span className="min-w-0 flex-1 truncate font-medium">{r.user.name}</span>
          <span className="text-sm font-bold">{r.points}</span>
        </li>
      ))}
    </ul>
  );
}
