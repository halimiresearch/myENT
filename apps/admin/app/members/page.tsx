'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { Avatar, Btn, Card, Empty, Err, Loading, PageHeader, Pager, StatusPill, Thead, field } from '@/lib/ui';

const LIMIT = 20;

export default function Members() {
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [err, setErr] = useState('');
  const [first, setFirst] = useState(true);
  const [q, setQ] = useState('');
  const [form, setForm] = useState({ nim: '', name: '', email: '', password: '', role: 'MEMBER' });
  const [temp, setTemp] = useState<{ name: string; pass: string } | null>(null);
  const load = (p = 1, s = q) => {
    setErr('');
    api<{ data: any[]; total: number }>(`users?limit=${LIMIT}&page=${p}${s ? `&search=${encodeURIComponent(s)}` : ''}`)
      .then((r) => {
        setRows(r.data);
        setTotal(r.total);
        setPage(p);
      })
      .catch((e) => setErr(e.message))
      .finally(() => setFirst(false));
  };
  useEffect(() => {
    load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api('users', { method: 'POST', body: JSON.stringify({ ...form, email: form.email || undefined }) });
      setForm({ nim: '', name: '', email: '', password: '', role: 'MEMBER' });
      load(1);
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function resetPass(u: any) {
    if (!confirm(`Reset password ${u.name}? Sesi-nya dicabut dan wajib ganti saat login berikutnya.`)) return;
    try {
      const r = await api<{ temporaryPassword: string }>('auth/reset-password', { method: 'POST', body: JSON.stringify({ userId: u.id }) });
      setTemp({ name: u.name, pass: r.temporaryPassword });
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function toggleActive(u: any) {
    try {
      await api(`users/${u.id}`, { method: 'PATCH', body: JSON.stringify({ status: u.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }) });
      load(page);
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function csv(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    e.target.value = '';
    if (f.size > 200 * 1024) return setErr('CSV maksimal 200 KB');
    try {
      const text = await f.text();
      const r = await api<{ results: any[] }>('users/import', { method: 'POST', body: JSON.stringify({ csv: text }) });
      const ok = r.results.filter((x: any) => x.status === 'ok').length;
      setErr(`Import: ${ok}/${r.results.length} ok${ok < r.results.length ? ' (lihat konsol)' : ''}`);
      console.log(r.results.filter((x: any) => x.status !== 'ok'));
      load(1);
    } catch (er: any) {
      setErr(er.message);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Anggota (${total})`}
        sub="Kelola akun anggota, pengurus, dan admin"
        actions={<label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50">Import CSV<input type="file" accept=".csv" className="hidden" onChange={csv} /></label>}
      />
      <Err msg={err} />
      {temp && (
        <div className="rounded-xl border border-gold-400/60 bg-gold-100 p-3 text-sm">
          Password sementara untuk <b>{temp.name}</b> (sekali tampil, segera ganti):{' '}
          <code className="rounded bg-white px-2 py-0.5 font-mono font-bold">{temp.pass}</code>{' '}
          <button className="font-medium text-brand-700 hover:text-brand-800" onClick={() => { navigator.clipboard?.writeText(temp.pass).catch(() => {}); }}>Salin</button>{' '}
          <button className="text-gray-500 hover:text-gray-700" onClick={() => setTemp(null)}>Tutup</button>
        </div>
      )}
      <Card className="p-4">
        <div className="flex flex-wrap gap-2">
          <input className={`${field} w-full sm:w-64`} placeholder="Cari nama/NIM" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load(1)} />
          <Btn onClick={() => load(1)}>Cari</Btn>
        </div>
        <form onSubmit={create} className="mt-3 grid gap-2 md:grid-cols-3">
          <input className={field} placeholder="NIM" value={form.nim} onChange={(e) => setForm({ ...form, nim: e.target.value })} required />
          <input className={field} placeholder="Nama" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <input className={field} type="email" placeholder="Email (untuk reset password)" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <input className={field} type="password" placeholder="Password (min 10)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={10} />
          <select className={field} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option>MEMBER</option><option>OFFICER</option><option>ADMIN</option>
          </select>
          <Btn primary>Tambah</Btn>
        </form>
      </Card>
      <Card className="p-4">
        {first ? <Loading /> : rows.length === 0 ? <Empty /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <Thead cols={['Anggota', 'Role', 'Status', 'Aksi']} />
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60">
                    <td className="py-2.5 pr-2">
                      <span className="flex items-center gap-2.5">
                        <Avatar name={u.name} />
                        <span className="leading-tight">
                          <span className="block font-medium">{u.name}</span>
                          <span className="block text-xs text-gray-500">{u.nim}{u.email ? ` · ${u.email}` : ''}</span>
                        </span>
                      </span>
                    </td>
                    <td className="py-2.5 pr-2"><StatusPill value={u.role} /></td>
                    <td className="py-2.5 pr-2"><StatusPill value={u.status} /></td>
                    <td className="py-2.5">
                      <span className="flex gap-3">
                        <button className="font-medium text-brand-700 hover:text-brand-800" onClick={() => resetPass(u)}>Reset</button>
                        <button className="font-medium text-rose-600 hover:text-rose-800" onClick={() => confirm(`${u.status === 'ACTIVE' ? 'Nonaktifkan' : 'Aktifkan'} ${u.name}?`) && toggleActive(u)}>{u.status === 'ACTIVE' ? 'Nonaktifkan' : 'Aktifkan'}</button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager page={page} total={total} limit={LIMIT} onPage={(p) => load(p)} />
      </Card>
    </div>
  );
}
