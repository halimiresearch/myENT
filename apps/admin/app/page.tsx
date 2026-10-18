'use client';
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '@/lib/client';
import { Avatar, Btn, Card, Empty, Err, PageHeader, Pager, Pill, Stat } from '@/lib/ui';

type Dash = {
  members: number; activeMembers: number; meetings: number;
  activeAssignments: number; pendingRequests: number; monthAttendancePct: number | null;
};
type Absent = { user?: { id: string; nim: string; name: string; division: string | null }; alphas: number };
type Div = { division: string; total: number; percentage: number | null };

const PAGE_SIZE = 6;

export default function Dashboard() {
  const [d, setD] = useState<Dash | null>(null);
  const [abs, setAbs] = useState<Absent[]>([]);
  const [div, setDiv] = useState<Div[]>([]);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    Promise.all([
      api<Dash>('dashboard'),
      api<Absent[]>('analytics/frequent-absentees?limit=10'),
      api<Div[]>('analytics/by-division'),
    ])
      .then(([dash, a, dv]) => { setD(dash); setAbs(a); setDiv(dv); })
      .catch((e: unknown) => {
        const s = (e as { status?: number })?.status;
        if (s === 401) location.href = '/login';
        else setErr(e instanceof Error ? e.message : 'Gagal memuat');
      });
  }, []);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const all = needle
      ? abs.filter((a) => `${a.user?.name ?? ''} ${a.user?.nim ?? ''}`.toLowerCase().includes(needle))
      : abs;
    return { total: all.length, page: all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) };
  }, [abs, q, page]);

  useEffect(() => { setPage(1); }, [q]);

  if (err) return <div><PageHeader title="Dashboard" /><Err msg={err} /></div>;
  if (!d) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-48 rounded-lg bg-gray-200" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-28 rounded-2xl bg-white" />)}
        </div>
        <div className="h-64 rounded-2xl bg-white" />
      </div>
    );
  }

  const pct = d.monthAttendancePct;
  type Tone = 'brand' | 'green' | 'amber' | 'red';
  const stats: { icon: ReactNode; label: string; value: string; sub: string; tone: Tone }[] = [
    { icon: usersIcon, label: 'Anggota Aktif', value: `${d.activeMembers}`, sub: `dari ${d.members} anggota`, tone: 'brand' },
    { icon: calIcon, label: 'Kegiatan', value: `${d.meetings}`, sub: 'total kegiatan', tone: 'brand' },
    { icon: taskIcon, label: 'Tugas Aktif', value: `${d.activeAssignments}`, sub: 'deadline belum lewat', tone: 'green' },
    { icon: clockIcon, label: 'Request Pending', value: `${d.pendingRequests}`, sub: d.pendingRequests ? 'butuh persetujuan' : 'semua sudah diproses', tone: d.pendingRequests ? 'amber' : 'green' },
    { icon: chartIcon, label: 'Hadir Bulan Ini', value: pct === null ? '–' : `${pct}%`, sub: 'kehadiran efektif', tone: pct !== null && pct < 75 ? 'amber' : 'green' },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Dashboard"
        sub="Ringkasan aktivitas UKM Jurnalistik"
        actions={<><Btn href="/recap">Lihat Rekap</Btn><Btn href="/meetings" primary>+ Kegiatan</Btn></>}
      />

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Statistik Cepat</h2>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {stats.map((s) => <Stat key={s.label} {...s} />)}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="p-4 xl:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Perlu Perhatian: Sering Alpha</h2>
            <label className="relative block w-full sm:w-64">
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-4" aria-hidden><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
              </span>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Cari nama atau NIM…"
                className="w-full rounded-xl border border-gray-200 bg-gray-50 py-1.5 pl-9 pr-3 text-sm outline-none placeholder:text-gray-500 focus:border-brand-200 focus:bg-white focus:ring-2 focus:ring-brand-100"
              />
            </label>
          </div>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="py-2 pr-2 font-medium">Anggota</th>
                  <th className="py-2 pr-2 font-medium">Divisi</th>
                  <th className="py-2 pr-2 font-medium">Alpha</th>
                  <th className="py-2 text-right font-medium">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {rows.page.map((a) => (
                  <tr key={a.user?.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60">
                    <td className="py-2.5 pr-2">
                      <span className="flex items-center gap-2.5">
                        <Avatar name={a.user?.name ?? '?'} />
                        <span className="leading-tight">
                          <span className="block font-medium">{a.user?.name}</span>
                          <span className="block text-xs text-gray-500">{a.user?.nim}</span>
                        </span>
                      </span>
                    </td>
                    <td className="py-2.5 pr-2"><Pill tone="brand">{a.user?.division || '–'}</Pill></td>
                    <td className="py-2.5 pr-2"><Pill tone={a.alphas >= 5 ? 'red' : 'amber'}>{a.alphas}×</Pill></td>
                    <td className="py-2.5 text-right"><a href="/members" className="text-brand-700 hover:text-brand-800 text-sm font-medium">Lihat</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.total && <Empty text={q ? 'Tidak cocok dengan pencarian.' : 'Tidak ada yang sering alpha. Bagus!'} />}
          </div>
          <Pager page={page} total={rows.total} limit={PAGE_SIZE} onPage={setPage} />
        </Card>

        <Card className="p-4">
          <h2 className="text-sm font-semibold">Kehadiran per Divisi</h2>
          <ul className="mt-3 space-y-3">
            {div.map((g) => (
              <li key={g.division}>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-medium">{g.division}</span>
                  <span className="text-gray-500">{g.percentage ?? '–'}{g.percentage !== null && '%'}</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-gray-100" role="img" aria-label={`${g.division}: ${g.percentage ?? '–'} persen`}>
                  <div
                    className={`h-full rounded-full ${(g.percentage ?? 0) >= 85 ? 'bg-emerald-500' : (g.percentage ?? 0) >= 75 ? 'bg-amber-400' : 'bg-rose-400'}`}
                    style={{ width: `${Math.min(100, g.percentage ?? 0)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
          {!div.length && <Empty />}
        </Card>
      </div>
    </div>
  );
}

const usersIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" className="size-4" aria-hidden><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.2 3.4-5 6.5-5s5.7 1.8 6.5 5" /></svg>
);
const calIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" className="size-4" aria-hidden><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
);
const taskIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="size-4" aria-hidden><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8.5 12.5l2.5 2.5 4.5-5.5" /></svg>
);
const clockIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" className="size-4" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
);
const chartIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" className="size-4" aria-hidden><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>
);
