"use client";

import { useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import toast from "react-hot-toast";
import { useRouter } from "next/navigation";

const PLAN_PRICES: Record<string, number> = { BASIC: 49, PRO: 99, CLINIC: 249 };

interface Props { clinics: any[] }

export function AdminClinicsClient({ clinics: initial }: Props) {
  const router = useRouter();
  const [clinics, setClinics] = useState(initial);
  const [search, setSearch]   = useState("");
  const [filter, setFilter]   = useState("all");
  const [loading, setLoading] = useState<string | null>(null);

  const filtered = clinics.filter(c => {
    const q = search.toLowerCase();
    const matchSearch = c.name.toLowerCase().includes(q) || c.slug.includes(q) || c.users[0]?.email?.toLowerCase().includes(q);
    const expired = c.trialEndsAt && new Date(c.trialEndsAt) < new Date();
    if (filter === "active")  return matchSearch && !expired;
    if (filter === "expired") return matchSearch && expired;
    if (filter === "trial")   return matchSearch && c.trialEndsAt && new Date(c.trialEndsAt) > new Date();
    return matchSearch;
  });

  async function updatePlan(clinicId: string, plan: string) {
    setLoading(clinicId);
    try {
      const res = await fetch(`/api/admin/clinics/${clinicId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      if (!res.ok) throw new Error();
      setClinics(prev => prev.map(c => c.id === clinicId ? { ...c, plan } : c));
      toast.success("Plan actualizado");
    } catch {
      toast.error("Error al actualizar");
    } finally {
      setLoading(null);
    }
  }

  async function extendTrial(clinicId: string, days: number) {
    setLoading(clinicId);
    try {
      const trialEndsAt = new Date();
      trialEndsAt.setDate(trialEndsAt.getDate() + days);
      const res = await fetch(`/api/admin/clinics/${clinicId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trialEndsAt: trialEndsAt.toISOString() }),
      });
      if (!res.ok) throw new Error();
      setClinics(prev => prev.map(c => c.id === clinicId ? { ...c, trialEndsAt: trialEndsAt.toISOString() } : c));
      toast.success(`Trial extendido ${days} días`);
    } catch {
      toast.error("Error");
    } finally {
      setLoading(null);
    }
  }

  async function suspendClinic(clinicId: string) {
    if (!confirm("¿Suspender esta clínica?")) return;
    setLoading(clinicId);
    try {
      const past = new Date("2000-01-01");
      await fetch(`/api/admin/clinics/${clinicId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trialEndsAt: past.toISOString() }),
      });
      setClinics(prev => prev.map(c => c.id === clinicId ? { ...c, trialEndsAt: past.toISOString() } : c));
      toast.success("Clínica suspendida");
    } catch {
      toast.error("Error");
    } finally {
      setLoading(null);
    }
  }

  return (
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-extrabold">Clínicas ({clinics.length})</h1>
            <p className="text-slate-400 text-sm">Gestiona todas las clínicas registradas</p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-3 mb-5">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input className="w-full h-10 bg-slate-800 border border-slate-700 rounded-xl pl-9 pr-4 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-600/50"
              placeholder="Buscar clínica, email…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="flex gap-1 bg-slate-900 border border-slate-700 rounded-xl p-1">
            {[{id:"all",label:"Todas"},{id:"active",label:"Activas"},{id:"trial",label:"En trial"},{id:"expired",label:"Expiradas"}].map(f => (
              <button key={f.id} onClick={() => setFilter(f.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${filter === f.id ? "bg-brand-600 text-white" : "text-slate-400 hover:text-white"}`}>
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700">
                {["Clínica","Contacto","Plan","Pacientes","Tokens IA","Trial / Estado","Acciones"].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(clinic => {
                const expired    = clinic.trialEndsAt && new Date(clinic.trialEndsAt) < new Date();
                const trialDays  = clinic.trialEndsAt ? Math.ceil((new Date(clinic.trialEndsAt).getTime() - Date.now()) / 86400000) : null;
                const owner      = clinic.users[0];
                const isLoading  = loading === clinic.id;

                return (
                  <tr key={clinic.id} className="border-b border-slate-800 hover:bg-slate-800/40 transition-colors">
                    <td className="px-4 py-3">
                      <Link href={`/admin/clinics/${clinic.id}`} className="font-semibold text-white hover:text-brand-400 transition-colors">{clinic.name}</Link>
                      <div className="text-[10px] text-slate-500">{clinic.specialty} · {clinic.country}</div>
                      <div className="text-[10px] text-slate-600 font-mono">{clinic.slug}</div>
                    </td>
                    <td className="px-4 py-3">
                      {owner && (
                        <>
                          <div className="text-xs text-slate-300">{owner.firstName} {owner.lastName}</div>
                          <div className="text-[10px] text-slate-500">{owner.email}</div>
                        </>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={clinic.plan}
                        onChange={e => updatePlan(clinic.id, e.target.value)}
                        disabled={isLoading}
                        className="bg-slate-800 border border-slate-600 text-white text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-600/50"
                      >
                        <option value="BASIC">BASIC — $49/mes</option>
                        <option value="PRO">PRO — $99/mes</option>
                        <option value="CLINIC">CLINIC — $249/mes</option>
                      </select>
                      <div className="text-[10px] text-slate-500 mt-0.5">{formatCurrency(PLAN_PRICES[clinic.plan] ?? 0, "MXN")}/mes</div>
                    </td>
                    <td className="px-4 py-3 text-slate-300">
                      <div className="font-bold">{clinic._count.patients}</div>
                      <div className="text-[10px] text-slate-500">{clinic._count.appointments} citas</div>
                    </td>
                    <td className="px-4 py-3">
                      {(() => {
                        const used  = clinic.aiTokensUsed ?? 0;
                        const limit = clinic.aiTokensLimit ?? 50000;
                        const pct   = limit > 0 ? Math.round((used / limit) * 100) : 0;
                        const color = pct > 90 ? "#ef4444" : pct > 60 ? "#eab308" : "#22c55e";
                        return (
                          <div>
                            <div className="text-xs text-slate-300 font-bold">{used.toLocaleString()}<span className="text-slate-500 font-normal"> / {limit.toLocaleString()}</span></div>
                            <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden mt-1">
                              <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
                            </div>
                            <div className="text-[10px] text-slate-500 mt-0.5">{pct}% usado</div>
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3">
                      {expired ? (
                        <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-rose-900/50 text-rose-400 border border-rose-700">
                          ✗ Expirado
                        </span>
                      ) : trialDays !== null ? (
                        <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-amber-900/50 text-amber-400 border border-amber-700">
                          ⏳ {trialDays}d restantes
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-emerald-900/50 text-emerald-400 border border-emerald-700">
                          ✓ Activo
                        </span>
                      )}
                      <div className="text-[10px] text-slate-600 mt-1">
                        Registro: {new Date(clinic.createdAt).toLocaleDateString("es-MX")}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1.5">
                        <button onClick={() => extendTrial(clinic.id, 30)} disabled={isLoading}
                          className="text-[10px] font-bold px-2 py-1 rounded-lg bg-emerald-900/40 text-emerald-400 border border-emerald-700 hover:bg-emerald-900/70 transition-colors disabled:opacity-50">
                          +30 días
                        </button>
                        <button onClick={() => extendTrial(clinic.id, 14)} disabled={isLoading}
                          className="text-[10px] font-bold px-2 py-1 rounded-lg bg-brand-900/40 text-brand-400 border border-brand-700 hover:bg-brand-900/70 transition-colors disabled:opacity-50">
                          +14 días
                        </button>
                        <button onClick={() => suspendClinic(clinic.id)} disabled={isLoading}
                          className="text-[10px] font-bold px-2 py-1 rounded-lg bg-rose-900/40 text-rose-400 border border-rose-700 hover:bg-rose-900/70 transition-colors disabled:opacity-50">
                          Suspender
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-500">Sin resultados</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
  );
}
