"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

interface Row {
  id: string;
  name: string;
  email: string | null;
  createdAt: string;
  completedSteps: number;
  totalSteps: number;
  stuckOn: string | null;
  daysSinceSignup: number;
}

interface Step { id: string; label: string }

type Filter = "all" | "completed" | "in_progress" | "not_started";

export function OnboardingClient({ rows, steps }: { rows: Row[]; steps: Step[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (filter === "completed"   && r.completedSteps !== r.totalSteps) return false;
      if (filter === "in_progress" && (r.completedSteps === 0 || r.completedSteps === r.totalSteps)) return false;
      if (filter === "not_started" && r.completedSteps !== 0) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!`${r.name} ${r.email ?? ""}`.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [rows, filter, search]);

  const stats = useMemo(() => {
    const completed   = rows.filter(r => r.completedSteps === r.totalSteps).length;
    const notStarted  = rows.filter(r => r.completedSteps === 0).length;
    const inProgress  = rows.length - completed - notStarted;
    return { completed, inProgress, notStarted };
  }, [rows]);

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold">Onboarding</h1>
        <p className="text-slate-400 text-sm">Progreso de configuración inicial por clínica. Detecta dónde se atoran los nuevos usuarios.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5">
          <div className="text-xs text-slate-400 font-semibold uppercase mb-2">Total clínicas</div>
          <div className="text-3xl font-extrabold">{rows.length}</div>
        </div>
        <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5">
          <div className="text-xs text-slate-400 font-semibold uppercase mb-2">Completaron</div>
          <div className="text-3xl font-extrabold text-emerald-400">{stats.completed}</div>
        </div>
        <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5">
          <div className="text-xs text-slate-400 font-semibold uppercase mb-2">En progreso</div>
          <div className="text-3xl font-extrabold text-amber-400">{stats.inProgress}</div>
        </div>
        <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5">
          <div className="text-xs text-slate-400 font-semibold uppercase mb-2">Sin empezar</div>
          <div className="text-3xl font-extrabold text-rose-400">{stats.notStarted}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 bg-slate-900 border border-slate-700 rounded-xl p-1">
          {([
            { k: "all",          l: "Todos" },
            { k: "completed",    l: "Completados" },
            { k: "in_progress",  l: "En progreso" },
            { k: "not_started",  l: "Sin empezar" },
          ] as { k: Filter; l: string }[]).map(f => (
            <button
              key={f.k}
              onClick={() => setFilter(f.k)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                filter === f.k ? "bg-brand-600 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              {f.l}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar clínica…"
          className="bg-slate-900 border border-slate-700 text-white text-sm rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600/50"
        />
      </div>

      {/* Table */}
      <div className="bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="py-10 text-center text-slate-500 text-sm">Sin resultados</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 text-xs text-slate-400">
                <th className="px-5 py-3 text-left font-bold uppercase tracking-wide">Clínica</th>
                <th className="px-5 py-3 text-left font-bold uppercase tracking-wide">Progreso</th>
                <th className="px-5 py-3 text-left font-bold uppercase tracking-wide">Atorado en</th>
                <th className="px-5 py-3 text-left font-bold uppercase tracking-wide">Días desde registro</th>
                <th className="px-5 py-3 text-right font-bold uppercase tracking-wide">Ver</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const pct = Math.round((r.completedSteps / r.totalSteps) * 100);
                const isStale = r.daysSinceSignup > 7 && r.completedSteps < r.totalSteps;
                return (
                  <tr key={r.id} className="border-b border-slate-800 hover:bg-slate-800/40">
                    <td className="px-5 py-3">
                      <div className="font-semibold text-white">{r.name}</div>
                      {r.email && <div className="text-xs text-slate-500">{r.email}</div>}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-32 h-2 bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${pct === 100 ? "bg-emerald-500" : pct === 0 ? "bg-rose-500" : "bg-amber-500"}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs font-bold text-slate-300">{r.completedSteps}/{r.totalSteps}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-slate-300 text-xs">
                      {r.stuckOn ?? <span className="text-emerald-400 font-bold">Completado ✓</span>}
                    </td>
                    <td className={`px-5 py-3 text-xs ${isStale ? "text-rose-400 font-bold" : "text-slate-400"}`}>
                      {r.daysSinceSignup} días
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Link
                        href={`/admin/clinics/${r.id}`}
                        className="text-xs font-bold text-brand-400 hover:underline"
                      >
                        Ver detalle →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="text-xs text-slate-500">
        Pasos tracked: {steps.map(s => s.label).join(" · ")}
      </div>
    </div>
  );
}
