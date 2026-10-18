'use client';
import { use, useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { Btn, Card, Empty, Err, Loading, PageHeader, StatusPill, Thead, field } from '@/lib/ui';

export default function MeetingDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [att, setAtt] = useState<any[]>([]);
  const [reqs, setReqs] = useState<any[]>([]);
  const [kors, setKors] = useState<any[]>([]);
  const [qr, setQr] = useState('');
  const [err, setErr] = useState('');
  const [first, setFirst] = useState(true);
  const [qrErr, setQrErr] = useState('');
  const [loc, setLoc] = useState({ latitude: '', longitude: '', radiusM: '' });
  const [sel, setSel] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [fails, setFails] = useState<any[]>([]);
  const [adj, setAdj] = useState({ userId: '', status: 'PERMITTED', reason: '' });
  const load = () => {
    setErr('');
    setQrErr('');
    // ponytail: limit 100 tanpa pagination (skala UKM). Ceiling: pager saat >100/rapat.
    const p1 = api<{ data: any[] }>(`meetings/${id}/attendance?limit=100`).then((r) => setAtt(r.data)).catch((e) => setErr(e.message));
    const p2 = api<{ data: any[] }>(`meetings/${id}/absence-requests?limit=100`).then((r) => setReqs(r.data)).catch((e) => setErr(e.message));
    const p3 = api<{ data: any[] }>(`meetings/${id}/corrections?limit=100`).then((r) => setKors(r.data)).catch((e) => setErr(e.message));
    api<{ qr: string }>(`meetings/${id}/qr`).then((r) => setQr(r.qr)).catch(() => setQrErr('QR gagal dimuat'));
    Promise.allSettled([p1, p2, p3]).then(() => setFirst(false));
  };
  useEffect(load, [id]);

  async function decide(rid: string, a: 'approve' | 'reject') {
    const note = prompt('Catatan (opsional)', '') ?? '';
    try {
      await api(`absence-requests/${rid}/${a}`, { method: 'PATCH', body: JSON.stringify({ reviewNote: note }) });
      load();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function bulk(action: 'approve' | 'reject') {
    if (busy || !sel.length || !confirm(`${action === 'approve' ? 'Setujui' : 'Tolak'} ${sel.length} request?`)) return;
    setBusy(true);
    setFails([]);
    try {
      const r = await api<{ results: any[] }>('absence-requests/bulk', {
        method: 'POST',
        body: JSON.stringify({ action, ids: sel }),
      });
      const fail = r.results.filter((x: any) => x.status !== 'ok');
      setFails(fail);
      if (fail.length) setErr(`${fail.length} dari ${r.results.length} gagal (lihat daftar)`);
      setSel([]);
      load();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function adjust(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api(`meetings/${id}/attendance/adjust`, { method: 'POST', body: JSON.stringify(adj) });
      setAdj({ userId: '', status: 'PERMITTED', reason: '' });
      load();
    } catch (e: any) {
      setErr((e as Error).message);
    }
  }

  async function decideKor(kid: string, a: 'approve' | 'reject') {
    const note = prompt('Catatan (opsional)', '') ?? '';
    try {
      await api(`corrections/${kid}/${a}`, { method: 'PATCH', body: JSON.stringify({ reviewNote: note }) });
      load();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function saveLoc(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api(`meetings/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          latitude: loc.latitude === '' ? null : Number(loc.latitude),
          longitude: loc.longitude === '' ? null : Number(loc.longitude),
          radiusM: loc.radiusM === '' ? null : Number(loc.radiusM),
        }),
      });
      setErr('');
    } catch (e: any) {
      setErr(e.message);
    }
  }

  const pending = reqs.filter((r) => r.status === 'PENDING').length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Detail Kegiatan"
        sub={`${reqs.filter((r) => r.status === 'PENDING').length} request pending · ${att.length} kehadiran`}
        actions={<span className="flex gap-2">
          <Btn primary onClick={() => bulk('approve')} disabled={busy || !sel.length}>Approve terpilih ({sel.length})</Btn>
          <Btn onClick={() => bulk('reject')} disabled={busy || !sel.length}>Tolak terpilih</Btn>
        </span>}
      />
      <Err msg={err} />
      {first ? (
        <Card className="p-4"><Loading /></Card>
      ) : (
        <>
      {fails.length > 0 && (
        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold text-rose-700">Gagal diproses ({fails.length})</h2>
          <ul className="list-disc pl-5 text-sm text-gray-600">
            {fails.map((f: any) => <li key={f.id}>{reqs.find((r) => r.id === f.id)?.user?.name ?? f.id}: {f.reason}</li>)}
          </ul>
        </Card>
      )}
      <div className="flex flex-wrap gap-4">
        {qr && <Card className="p-3"><img src={qr} alt="QR presensi" className="h-32 w-32" /></Card>}
        {qrErr && <Card className="p-3"><p className="text-xs text-rose-600">{qrErr}</p></Card>}
        <Card className="min-w-72 flex-1 p-4">
          <h2 className="mb-2 text-sm font-semibold">Batas Lokasi</h2>
          <form onSubmit={saveLoc} className="grid gap-2 md:grid-cols-4">
            <input className={field} placeholder="Latitude (kosong = mati)" value={loc.latitude} onChange={(e) => setLoc({ ...loc, latitude: e.target.value })} />
            <input className={field} placeholder="Longitude" value={loc.longitude} onChange={(e) => setLoc({ ...loc, longitude: e.target.value })} />
            <input className={field} placeholder="Radius meter" value={loc.radiusM} onChange={(e) => setLoc({ ...loc, radiusM: e.target.value })} />
            <Btn primary>Simpan lokasi</Btn>
          </form>
        </Card>
      </div>
      <Card className="p-4">
        <h2 className="mb-2 text-sm font-semibold">Request Izin ({pending} pending)</h2>
        {reqs.length === 0 ? <Empty /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <Thead cols={['', 'Nama', 'Alasan', 'Status', 'Aksi']} />
              <tbody>
                {reqs.map((r) => (
                  <tr key={r.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60">
                    <td className="py-2.5 pr-2">{r.status === 'PENDING' && <input type="checkbox" className="size-4 accent-[#134179]" checked={sel.includes(r.id)} onChange={(e) => setSel(e.target.checked ? [...sel, r.id] : sel.filter((x) => x !== r.id))} />}</td>
                    <td className="py-2.5 pr-2 font-medium">{r.user?.name} <span className="font-normal text-gray-500">({r.user?.nim})</span></td>
                    <td className="py-2.5 pr-2 text-gray-500">{r.reasonType}: {r.reasonDetail}</td>
                    <td className="py-2.5 pr-2"><StatusPill value={r.status} /></td>
                    <td className="py-2.5">{r.status === 'PENDING' && (<span className="flex gap-3"><button className="font-medium text-emerald-700 hover:text-emerald-900" onClick={() => decide(r.id, 'approve')}>OK</button><button className="font-medium text-rose-600 hover:text-rose-800" onClick={() => decide(r.id, 'reject')}>Tolak</button></span>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card className="p-4">
        <h2 className="mb-2 text-sm font-semibold">Klaim Koreksi ({kors.filter((r) => r.status === 'PENDING').length} pending)</h2>
        {kors.length === 0 ? <Empty /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <Thead cols={['Nama', 'Klaim', 'Status', 'Aksi']} />
              <tbody>
                {kors.map((r) => (
                  <tr key={r.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60">
                    <td className="py-2.5 pr-2 font-medium">{r.user?.name}</td>
                    <td className="py-2.5 pr-2 text-gray-500">{r.claim}</td>
                    <td className="py-2.5 pr-2"><StatusPill value={r.status} /></td>
                    <td className="py-2.5">{r.status === 'PENDING' && (<span className="flex gap-3"><button className="font-medium text-emerald-700 hover:text-emerald-900" onClick={() => decideKor(r.id, 'approve')}>OK</button><button className="font-medium text-rose-600 hover:text-rose-800" onClick={() => decideKor(r.id, 'reject')}>Tolak</button></span>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card className="p-4">
        <h2 className="mb-2 text-sm font-semibold">Kehadiran ({att.length})</h2>
        {att.length === 0 ? <Empty /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <Thead cols={['Nama', 'Status', 'Source']} />
              <tbody>
                {att.map((a) => (
                  <tr key={a.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60">
                    <td className="py-2.5 pr-2 font-medium">{a.user?.name}</td>
                    <td className="py-2.5 pr-2"><StatusPill value={a.status} /></td>
                    <td className="py-2.5 text-gray-500">{a.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card className="p-4">
        <h2 className="mb-2 text-sm font-semibold">Penyesuaian Manual</h2>
        <form onSubmit={adjust} className="grid gap-2 md:grid-cols-4">
          <input className={field} placeholder="User ID" value={adj.userId} onChange={(e) => setAdj({ ...adj, userId: e.target.value })} required />
          <select className={field} value={adj.status} onChange={(e) => setAdj({ ...adj, status: e.target.value })}>
            {['PRESENT', 'PERMITTED', 'SICK', 'DISPENSATION', 'ABSENT'].map((s) => <option key={s}>{s}</option>)}
          </select>
          <input className={field} placeholder="Alasan (wajib)" value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} required minLength={3} />
          <Btn primary>Sesuaikan</Btn>
        </form>
      </Card>
        </>
      )}
    </div>
  );
}
