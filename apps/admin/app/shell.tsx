'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

function I({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="size-[18px] shrink-0" aria-hidden>
      {children}
    </svg>
  );
}

const icons: Record<string, ReactNode> = {
  dashboard: <I><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></I>,
  calendar: <I><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></I>,
  recap: <I><path d="M8 6h13M8 12h13M8 18h13" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></I>,
  chart: <I><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></I>,
  users: <I><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.2 3.4-5 6.5-5s5.7 1.8 6.5 5" /><circle cx="17.5" cy="9" r="2.5" /><path d="M16 15.2c2.6.3 4.7 1.9 5.5 4.8" /></I>,
  clock: <I><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></I>,
  task: <I><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8.5 12.5l2.5 2.5 4.5-5.5" /></I>,
  book: <I><path d="M4 19V5a2 2 0 012-2h13v16H6a2 2 0 00-2 2zm0 0a2 2 0 002 2h13" /></I>,
  mega: <I><path d="M3 11v3l4 1 2 5h2l-1.5-5.5L19 18V6L8 10H5a2 2 0 00-2 1z" /><path d="M19 6a3 3 0 010 12" /></I>,
  box: <I><path d="M21 8l-9-5-9 5v8l9 5 9-5V8z" /><path d="M3 8l9 5 9-5M12 13v8" /></I>,
  audit: <I><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5M9 13h7M9 17h7" /></I>,
  gear: <I><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 00-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 00-2-1.2L14.2 3h-4l-.4 2.7a7 7 0 00-2 1.2l-2.3-1-2 3.4 2 1.5A7 7 0 005 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-1a7 7 0 002 1.2l.4 2.7h4l.4-2.7a7 7 0 002-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z" /></I>,
  user: <I><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4-6 8-6s7 2 8 6" /></I>,
};

const NAV: { group: string; items: { href: string; label: string; icon: string }[] }[] = [
  {
    group: 'Utama',
    items: [
      { href: '/', label: 'Dashboard', icon: 'dashboard' },
      { href: '/meetings', label: 'Kegiatan', icon: 'calendar' },
      { href: '/recap', label: 'Rekap', icon: 'recap' },
      { href: '/analytics', label: 'Analitik', icon: 'chart' },
    ],
  },
  {
    group: 'Kelola',
    items: [
      { href: '/members', label: 'Anggota', icon: 'users' },
      { href: '/duty', label: 'Piket', icon: 'clock' },
      { href: '/assignments', label: 'Tugas', icon: 'task' },
      { href: '/materials', label: 'Materi', icon: 'book' },
      { href: '/announcements', label: 'Pengumuman', icon: 'mega' },
      { href: '/inventory', label: 'Inventaris', icon: 'box' },
    ],
  },
  {
    group: 'Sistem',
    items: [
      { href: '/audit-logs', label: 'Audit Log', icon: 'audit' },
      { href: '/config', label: 'Konfigurasi', icon: 'gear' },
      { href: '/profile', label: 'Profil', icon: 'user' },
    ],
  },
];

const TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/meetings': 'Kegiatan',
  '/members': 'Anggota',
  '/recap': 'Rekap Kehadiran',
  '/analytics': 'Analitik',
  '/announcements': 'Pengumuman',
  '/inventory': 'Inventaris',
  '/duty': 'Piket',
  '/materials': 'Materi',
  '/assignments': 'Tugas',
  '/audit-logs': 'Audit Log',
  '/config': 'Konfigurasi',
  '/profile': 'Profil',
};

function isActive(path: string, href: string) {
  return href === '/' ? path === '/' : path === href || path.startsWith(href + '/');
}

export default function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [me, setMe] = useState<string | null>(null);

  useEffect(() => { setOpen(false); }, [path]);
  useEffect(() => {
    fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).then((j) => {
      const name = j?.user?.name ?? j?.name ?? null;
      if (typeof name === 'string' && name) setMe(name);
    }).catch(() => {});
  }, []);

  const drawerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const el = drawerRef.current;
    const focusables = () => el ? Array.from(el.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input')) : [];
    const prev = document.activeElement as HTMLElement | null;
    focusables()[0]?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') return setOpen(false);
      if (e.key !== 'Tab') return;
      const f = focusables();
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus();
    };
  }, [open]);

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return NAV;
    return NAV.map((g) => ({ ...g, items: g.items.filter((i) => i.label.toLowerCase().includes(needle)) }))
      .filter((g) => g.items.length);
  }, [q]);

  if (path === '/login' || path.startsWith('/reset')) {
    return <div className="min-h-screen grid place-items-center p-4">{children}</div>;
  }

  const sidebar = (
    <div className="flex h-full flex-col">
      <Link href="/" className="flex items-center gap-2.5 px-2 py-1">
        <span className="inline-flex items-center rounded-xl bg-brand-800 px-2 py-1.5">
          <img src="/assets/ent.svg" alt="Logo UKM Jurnalistik" className="h-6 w-auto" />
        </span>
        <span className="leading-tight">
          <span className="block text-sm font-bold">Jurnalistik</span>
          <span className="block text-[11px] text-gray-500">Admin Panel</span>
        </span>
      </Link>
      <label className="relative mt-4 block">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-4" aria-hidden><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
        </span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Cari menu…"
          className="w-full rounded-xl border border-gray-200 bg-gray-50 py-2 pl-9 pr-3 text-sm outline-none placeholder:text-gray-500 focus:border-brand-200 focus:bg-white focus:ring-2 focus:ring-brand-100"
        />
      </label>
      <nav aria-label="Navigasi utama" className="mt-4 flex-1 space-y-5 overflow-y-auto pb-2">
        {groups.map((g) => (
          <div key={g.group}>
            <p className="px-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500">{g.group}</p>
            <ul className="mt-1 space-y-0.5">
              {g.items.map((i) => {
                const active = isActive(path, i.href);
                return (
                  <li key={i.href}>
                    <Link
                      href={i.href}
                      aria-current={active ? 'page' : undefined}
                      className={`flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm transition ${
                        active ? 'bg-brand-700 font-medium text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'
                      }`}
                    >
                      {icons[i.icon]}
                      {i.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {!groups.length && <p className="px-2 text-sm text-gray-500">Menu tidak ditemukan.</p>}
      </nav>
      <div className="mt-2 flex items-center gap-2.5 rounded-xl bg-gray-50 px-2.5 py-2.5">
        <span aria-hidden className="grid place-items-center size-8 rounded-full bg-brand-100 text-xs font-bold text-brand-700">
          {(me ?? 'A').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
        </span>
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-sm font-semibold">{me ?? 'Pengurus'}</span>
          <span className="block text-[11px] text-gray-500">UKM Jurnalistik</span>
        </span>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen text-gray-900">
      <a href="#main" className="sr-only">Lewati ke konten</a>
      {/* Desktop */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 bg-white p-4 lg:block" aria-label="Sidebar">
        {sidebar}
      </aside>
      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} aria-hidden />
          <aside ref={drawerRef} role="dialog" aria-modal="true" className="absolute inset-y-0 left-0 w-72 bg-white p-4 shadow-xl" aria-label="Sidebar seluler">
            {sidebar}
          </aside>
        </div>
      )}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 border-b border-gray-100 bg-[#f2f3f9]/90 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
            <button type="button" onClick={() => setOpen(true)} aria-label="Buka menu" className="rounded-lg p-1.5 hover:bg-gray-200/70 lg:hidden">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-5" aria-hidden><path d="M4 7h16M4 12h16M4 17h16" /></svg>
            </button>
            <p className="text-sm font-semibold">{TITLES[path] ?? 'Admin'}</p>
            <p className="ml-auto hidden text-xs text-gray-600 sm:block">
              {new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>
        </header>
        <main id="main" className="mx-auto max-w-6xl space-y-4 p-4">{children}</main>
      </div>
    </div>
  );
}
