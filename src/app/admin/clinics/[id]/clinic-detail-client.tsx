"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Eye, Edit, Shield, Clock, Users, FileText, CreditCard, Activity } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import toast from "react-hot-toast";

const PLAN_PRICES: Record<string, number> = { BASIC: 49, PRO: 99, CLINIC: 249 };
const BANK_INFO = { nombre: "Efthymios Rafail Papanaklis", clabe: "012910015008025244", banco: "BBVA" };

interface Props {
  clinic:         any;
  recentActivity: any[];
  totalRevenue:   number;
  totalInvoices:  number;
}

export function AdminClinicDetailClient({ clinic, recentActivity, totalRevenue, totalInvoices }: Props) {
  const [saving, setSaving]   = useState(false);
  const [note, setNote]       = useState("");
  const [notes, setNotes]     = useState<string[]>([]);
  const [editPlan, setEditPlan] = useState(clinic.plan);
  const [tab, setTab]         = useState("overview");

  const expired   = clinic.trialEndsAt && new Date(clinic.trialEndsAt) < new Date();
  const daysLeft  = clinic.trialEndsAt ? Math.ceil((new Date(clinic.trialEndsAt).getTime() - Date.now()) / 86400000) : null;
  const owner     = clinic.users[0];

  async function updatePlan() {
    setSaving(true);
    try {
      const newExpiry = new Date();
      newExpiry.setMonth(newExpiry.getMonth() + 1);
      await fetch(`/api/admin/clinics/${clinic.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: editPlan, trialEndsAt: newExpiry.toISOString() }),
      });
      toast.success("Plan actualizado y extendido 1 mes");
    } catch {
      toast.error("Error al actualizar");
    } finally {
      setSaving(false);
    }
  }

  async function extendTrial(days: number) {
    setSaving(true);
    try {
      const base = expired ? new Date() : (clinic.trialEndsAt ? new Date(clinic.trialEndsAt) : new Date());
      base.setDate(base.getDate() + days);
      await fetch(`/api/admin/clinics/${clinic.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trialEndsAt: base.toISOString() }),
      });
      toast.success(`+${days} días agregados`);
    } catch {
      toast.error("Error");
    } finally {
      setSaving(false);
    }
  }

  async function suspendClinic() {
    if (!confirm("¿Suspender esta clínica? El doctor verá una pantalla de pago.")) return;
    setSaving(true);
    try {
      await fetch(`/api/admin/clinics/${clinic.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trialEndsAt: new Date("2000-01-01").toISOString() }),
      });
      toast.success("Clínica suspendida");
    } catch {
      toast.error("Error");
    } finally {
      setSaving(false);
    }
  }

  function addNote() {
    if (!note.trim()) return;
    setNotes(prev => [`${new Date().toLocaleString("es-MX")} — ${note}`, ...prev]);
    setNote("");
    toast.success("Nota agregada");
  }

  const TABS = [
    { id: "overview",  label: "Resumen",       icon: Activity },
    { id: "account",   label: "Cuenta",         icon: Users    },
    { id: "billing",   label: "Facturación",    icon: CreditCard },
    { id: "activity",  label: "Actividad",      icon: Clock    },
    { id: "notes",     label: "Notas internas", icon: FileText },
  ];

  return (
      <div className="p-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Link href="/admin/clinics" className="p-2 rounded-lg hover:bg-slate-800 transition-colors">
            <ArrowLeft className="w-4 h-4 text-slate-400" />
          </Link>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-extrabold">{clinic.name}</h1>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                expired ? "bg-rose-900/50 text-rose-400 border-rose-700" : "bg-emerald-900/50 text-emerald-400 border-emerald-700"
              }`}>{expired ? "Expirado" : `${daysLeft}d activo`}</span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-brand-900/50 text-brand-400 border-brand-700">{clinic.plan}</span>
            </div>
            <p className="text-slate-400 text-sm">{clinic.specialty} · {clinic.city}, {clinic.country} · {clinic.slug}.mediflow.app</p>
          </div>
          {/* View as clinic button */}
          <a
            href={`/api/admin/impersonate?clinicId=${clinic.id}`}
            target="_blank"
            className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white text-sm font-bold rounded-xl hover:bg-violet-700 transition-colors"
          >
            <Eye className="w-4 h-4" />
            Ver como clínica
          </a>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-5 gap-3 mb-6">
          {[
            { label: "Pacientes",    value: clinic._count.patients,     color: "text-brand-400"   },
            { label: "Citas",        value: clinic._count.appointments, color: "text-emerald-400" },
            { label: "Expedientes",  value: clinic._count.records,      color: "text-violet-400"  },
            { label: "Facturas",     value: totalInvoices,              color: "text-amber-400"   },
            { label: "Ingresos",     value: formatCurrency(totalRevenue, "MXN"), color: "text-green-400" },
          ].map(k => (
            <div key={k.label} className="bg-slate-900 border border-slate-700 rounded-xl p-4 text-center">
              <div className={`text-2xl font-extrabold ${k.color}`}>{k.value}</div>
              <div className="text-xs text-slate-400 mt-0.5">{k.label}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-slate-900 border border-slate-700 rounded-xl p-1 w-fit mb-6">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${tab === t.id ? "bg-brand-600 text-white" : "text-slate-400 hover:text-white"}`}>
              <t.icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          ))}
        </div>

        {/* TAB: OVERVIEW */}
        {tab === "overview" && (
          <div className="grid grid-cols-2 gap-5">
            {/* Clinic info */}
            <div className="bg-slate-900 border border-slate-700 rounded-xl p-5">
              <h2 className="text-sm font-bold mb-4 text-slate-200">Datos de la clínica</h2>
              <div className="space-y-2.5 text-sm">
                {[
                  { label: "Nombre",       val: clinic.name },
                  { label: "Slug/URL",     val: `${clinic.slug}.mediflow.app` },
                  { label: "Especialidad", val: clinic.specialty },
                  { label: "País",         val: clinic.country },
                  { label: "Ciudad",       val: clinic.city ?? "—" },
                  { label: "Teléfono",     val: clinic.phone ?? "—" },
                  { label: "Email",        val: clinic.email ?? "—" },
                  { label: "Registro",     val: new Date(clinic.createdAt).toLocaleDateString("es-MX") },
                ].map(r => (
                  <div key={r.label} className="flex justify-between py-1.5 border-b border-slate-800">
                    <span className="text-slate-400">{r.label}</span>
                    <span className="font-semibold text-slate-200">{r.val}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Plan management */}
            <div className="space-y-4">
              <div className="bg-slate-900 border border-slate-700 rounded-xl p-5">
                <h2 className="text-sm font-bold mb-4 text-slate-200">Gestión de plan</h2>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Plan actual</label>
                    <select value={editPlan} onChange={e => setEditPlan(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-600 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600/50">
                      <option value="BASIC">BASIC — $49/mes</option>
                      <option value="PRO">PRO — $99/mes</option>
                      <option value="CLINIC">CLINIC — $249/mes</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Vencimiento actual</label>
                    <div className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm">
                      {clinic.trialEndsAt ? new Date(clinic.trialEndsAt).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" }) : "Sin fecha"}
                      {daysLeft !== null && <span className={`ml-2 font-bold ${expired ? "text-rose-400" : "text-emerald-400"}`}>({expired ? "Expirado" : `${daysLeft} días restantes`})</span>}
                    </div>
                  </div>
                  <button onClick={updatePlan} disabled={saving}
                    className="w-full py-2 bg-emerald-600 text-white text-sm font-bold rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors">
                    {saving ? "Guardando…" : "Activar plan + 1 mes"}
                  </button>
                  <div className="grid grid-cols-3 gap-2">
                    {[7, 14, 30].map(days => (
                      <button key={days} onClick={() => extendTrial(days)} disabled={saving}
                        className="py-1.5 bg-brand-900/50 text-brand-400 border border-brand-700 text-xs font-bold rounded-lg hover:bg-brand-900 disabled:opacity-50 transition-colors">
                        +{days} días
                      </button>
                    ))}
                  </div>
                  <button onClick={suspendClinic} disabled={saving}
                    className="w-full py-2 bg-rose-900/40 text-rose-400 border border-rose-700 text-sm font-bold rounded-lg hover:bg-rose-900/70 disabled:opacity-50 transition-colors">
                    ⚠️ Suspender clínica
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB: ACCOUNT */}
        {tab === "account" && (
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-5">
            <h2 className="text-sm font-bold mb-4 text-slate-200">Usuarios de la clínica</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700">
                  {["Nombre","Email","Teléfono","Rol","Estado","Registro"].map(h => (
                    <th key={h} className="text-left px-3 py-2.5 text-[11px] font-bold text-slate-400 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {clinic.users.map((u: any) => (
                  <tr key={u.id} className="border-b border-slate-800 hover:bg-slate-800/40">
                    <td className="px-3 py-3 font-semibold text-white">{u.firstName} {u.lastName}</td>
                    <td className="px-3 py-3 text-slate-300">{u.email}</td>
                    <td className="px-3 py-3 text-slate-400">{u.phone ?? "—"}</td>
                    <td className="px-3 py-3">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-brand-900/50 text-brand-400 border border-brand-700">{u.role}</span>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${u.isActive ? "bg-emerald-900/50 text-emerald-400 border-emerald-700" : "bg-rose-900/50 text-rose-400 border-rose-700"}`}>
                        {u.isActive ? "Activo" : "Inactivo"}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-slate-400 text-xs">{new Date(u.createdAt).toLocaleDateString("es-MX")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* TAB: BILLING */}
        {tab === "billing" && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: "Plan",          val: clinic.plan,                              color: "text-brand-400"   },
                { label: "Ingresos totales", val: formatCurrency(totalRevenue, "MXN"),  color: "text-emerald-400" },
                { label: "Total facturas", val: totalInvoices,                           color: "text-violet-400"  },
              ].map(k => (
                <div key={k.label} className="bg-slate-900 border border-slate-700 rounded-xl p-4">
                  <div className={`text-2xl font-extrabold ${k.color}`}>{k.val}</div>
                  <div className="text-xs text-slate-400">{k.label}</div>
                </div>
              ))}
            </div>
            <div className="bg-slate-900 border border-brand-700 rounded-xl p-5">
              <div className="text-xs font-bold text-brand-400 uppercase tracking-wide mb-3">Datos para recibir pago</div>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div><div className="text-slate-400 text-xs mb-1">Nombre</div><div className="font-semibold">{BANK_INFO.nombre}</div></div>
                <div><div className="text-slate-400 text-xs mb-1">CLABE</div><div className="font-mono font-bold text-brand-400 text-lg">{BANK_INFO.clabe}</div></div>
                <div><div className="text-slate-400 text-xs mb-1">Banco</div><div className="font-semibold">{BANK_INFO.banco}</div></div>
              </div>
              <div className="mt-3 text-xs text-slate-500">
                Envía estos datos al cliente cuando necesite renovar su plan.
              </div>
            </div>
          </div>
        )}

        {/* TAB: ACTIVITY */}
        {tab === "activity" && (
          <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-700">
              <h2 className="text-sm font-bold">Actividad reciente</h2>
              <p className="text-xs text-slate-400">Últimos expedientes clínicos creados</p>
            </div>
            {recentActivity.length === 0 ? (
              <div className="px-5 py-10 text-center text-slate-500 text-sm">Sin actividad reciente</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700">
                    {["Fecha","Doctor","Tipo","Notas"].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-[11px] font-bold text-slate-400 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {recentActivity.map((r: any) => (
                    <tr key={r.id} className="border-b border-slate-800 hover:bg-slate-800/40">
                      <td className="px-4 py-3 text-slate-300 text-xs">{new Date(r.createdAt).toLocaleDateString("es-MX")}</td>
                      <td className="px-4 py-3 text-slate-300">Dr/a. {r.doctor?.firstName} {r.doctor?.lastName}</td>
                      <td className="px-4 py-3">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-brand-900/50 text-brand-400 border border-brand-700">
                          {r.specialtyData?.type ?? "Consulta"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs">{r.subjective?.slice(0, 50) ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* TAB: NOTES */}
        {tab === "notes" && (
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-5">
            <h2 className="text-sm font-bold mb-4 text-slate-200">Notas internas</h2>
            <p className="text-xs text-slate-500 mb-4">Solo visible para ti como administrador. No se guarda en la DB en esta versión — usa esto para notas temporales de sesión.</p>
            <div className="flex gap-2 mb-4">
              <input
                className="flex-1 bg-slate-800 border border-slate-600 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600/50 placeholder:text-slate-500"
                placeholder="Ej: Cliente pagó el 15/03, activar PRO por 1 año…"
                value={note}
                onChange={e => setNote(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addNote()}
              />
              <button onClick={addNote} className="px-4 py-2 bg-brand-600 text-white text-sm font-bold rounded-lg hover:bg-brand-700 transition-colors">
                Agregar
              </button>
            </div>
            {notes.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-6">Sin notas aún</p>
            ) : (
              <div className="space-y-2">
                {notes.map((n, i) => (
                  <div key={i} className="flex items-start gap-2 bg-slate-800 rounded-lg px-3 py-2.5">
                    <span className="text-brand-400 text-xs mt-0.5">📝</span>
                    <span className="text-xs text-slate-300">{n}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
  );
}
