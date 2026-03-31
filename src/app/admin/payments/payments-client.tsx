"use client";

import { useState } from "react";
import Link from "next/link";
import { formatCurrency } from "@/lib/utils";
import toast from "react-hot-toast";

const PLAN_PRICES: Record<string, number> = { BASIC: 49, PRO: 99, CLINIC: 249 };
const BANK_INFO = {
  nombre: "Efthymios Rafail Papanaklis",
  clabe:  "012910015008025244",
  banco:  "BBVA",
};

interface Props { clinics: any[] }

export function AdminPaymentsClient({ clinics }: Props) {
  const [activating, setActivating] = useState<string | null>(null);
  const [tab, setTab] = useState<"pending" | "all">("pending");

  const expiredClinics = clinics.filter(c => c.trialEndsAt && new Date(c.trialEndsAt) < new Date());
  const activeClinics  = clinics.filter(c => c.trialEndsAt && new Date(c.trialEndsAt) > new Date());

  async function activatePlan(clinicId: string, plan: string, months: number) {
    setActivating(clinicId);
    try {
      const newExpiry = new Date();
      newExpiry.setMonth(newExpiry.getMonth() + months);
      const res = await fetch(`/api/admin/clinics/${clinicId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, trialEndsAt: newExpiry.toISOString() }),
      });
      if (!res.ok) throw new Error();
      toast.success(`Plan ${plan} activado por ${months} mes${months > 1 ? "es" : ""}`);
    } catch {
      toast.error("Error al activar");
    } finally {
      setActivating(null);
    }
  }

  const displayList = tab === "pending" ? expiredClinics : clinics;

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <nav className="bg-slate-900 border-b border-slate-700 px-6 h-14 flex items-center gap-4">
        <Link href="/admin" className="flex items-center gap-2 font-extrabold text-brand-400">
          <div className="w-6 h-6 rounded-lg bg-brand-600 flex items-center justify-center text-[11px] font-extrabold text-white">M</div>
          MediFlow Admin
        </Link>
        <div className="flex items-center gap-1 ml-4">
          {[{href:"/admin",label:"Dashboard"},{href:"/admin/clinics",label:"Clínicas"},{href:"/admin/payments",label:"Pagos"},{href:"/admin/settings",label:"Config"}].map(item => (
            <Link key={item.href} href={item.href} className="px-3 py-1.5 rounded-lg text-sm font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition-colors">{item.label}</Link>
          ))}
        </div>
      </nav>

      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-xl font-extrabold">Gestión de Pagos</h1>
          <p className="text-slate-400 text-sm">Activa planes después de verificar transferencias SPEI</p>
        </div>

        {/* Bank info */}
        <div className="bg-slate-900 border border-brand-700 rounded-xl p-5 mb-6">
          <div className="text-xs font-bold text-brand-400 uppercase tracking-wide mb-3">📋 Datos bancarios para transferencias SPEI</div>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div><div className="text-slate-400 text-xs mb-1">Nombre</div><div className="font-semibold text-white">{BANK_INFO.nombre}</div></div>
            <div><div className="text-slate-400 text-xs mb-1">CLABE</div><div className="font-mono font-bold text-brand-400 text-lg tracking-wide">{BANK_INFO.clabe}</div></div>
            <div><div className="text-slate-400 text-xs mb-1">Banco</div><div className="font-semibold text-white">{BANK_INFO.banco}</div></div>
          </div>
          <div className="mt-3 text-xs text-slate-500">
            Cuando una clínica haga transferencia, busca la referencia (generalmente el nombre de la clínica) y activa el plan manualmente abajo.
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[
            { label: "Pagos pendientes",   value: expiredClinics.length, color: "text-amber-400" },
            { label: "Clínicas activas",   value: activeClinics.length,  color: "text-emerald-400" },
            { label: "MRR estimado",       value: formatCurrency(clinics.reduce((s, c) => s + (PLAN_PRICES[c.plan] ?? 49), 0), "MXN"), color: "text-violet-400" },
          ].map(k => (
            <div key={k.label} className="bg-slate-900 border border-slate-700 rounded-xl p-4">
              <div className={`text-2xl font-extrabold ${k.color}`}>{k.value}</div>
              <div className="text-xs text-slate-400">{k.label}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-slate-900 border border-slate-700 rounded-xl p-1 w-fit mb-4">
          <button onClick={() => setTab("pending")} className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${tab === "pending" ? "bg-amber-600 text-white" : "text-slate-400 hover:text-white"}`}>
            ⚠️ Pagos pendientes ({expiredClinics.length})
          </button>
          <button onClick={() => setTab("all")} className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${tab === "all" ? "bg-brand-600 text-white" : "text-slate-400 hover:text-white"}`}>
            Todas las clínicas ({clinics.length})
          </button>
        </div>

        {/* Clinic list */}
        <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700">
                {["Clínica","Contacto","Plan actual","Vencimiento","Activar plan"].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayList.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-500">
                  {tab === "pending" ? "✅ Sin pagos pendientes" : "Sin clínicas"}
                </td></tr>
              ) : displayList.map(clinic => {
                const expired    = clinic.trialEndsAt && new Date(clinic.trialEndsAt) < new Date();
                const daysLeft   = clinic.trialEndsAt ? Math.ceil((new Date(clinic.trialEndsAt).getTime() - Date.now()) / 86400000) : null;
                const owner      = clinic.users[0];
                const isLoading  = activating === clinic.id;

                return (
                  <tr key={clinic.id} className={`border-b border-slate-800 transition-colors ${expired ? "bg-rose-950/20" : "hover:bg-slate-800/40"}`}>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-white">{clinic.name}</div>
                      <div className="text-[10px] text-slate-500">{clinic.specialty} · {clinic._count.patients} pacientes</div>
                    </td>
                    <td className="px-4 py-3">
                      {owner && (
                        <>
                          <div className="text-xs text-slate-300">{owner.firstName} {owner.lastName}</div>
                          <div className="text-[10px] text-slate-500">{owner.email}</div>
                          {owner.phone && <div className="text-[10px] text-slate-500">{owner.phone}</div>}
                        </>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-bold">{clinic.plan}</span>
                      <div className="text-[10px] text-slate-500">{formatCurrency(PLAN_PRICES[clinic.plan] ?? 49, "MXN")}/mes</div>
                    </td>
                    <td className="px-4 py-3">
                      {expired ? (
                        <span className="text-[10px] font-bold text-rose-400">⚠️ Expirado</span>
                      ) : (
                        <span className="text-[10px] font-bold text-amber-400">⏳ {daysLeft} días</span>
                      )}
                      <div className="text-[10px] text-slate-600">{clinic.trialEndsAt ? new Date(clinic.trialEndsAt).toLocaleDateString("es-MX") : "—"}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1.5">
                        {["BASIC","PRO","CLINIC"].map(plan => (
                          <div key={plan} className="flex gap-1">
                            <button onClick={() => activatePlan(clinic.id, plan, 1)} disabled={isLoading}
                              className="text-[10px] font-bold px-2 py-1 rounded-lg bg-emerald-900/40 text-emerald-400 border border-emerald-700 hover:bg-emerald-900/70 transition-colors disabled:opacity-50">
                              {plan} 1 mes
                            </button>
                            <button onClick={() => activatePlan(clinic.id, plan, 12)} disabled={isLoading}
                              className="text-[10px] font-bold px-2 py-1 rounded-lg bg-violet-900/40 text-violet-400 border border-violet-700 hover:bg-violet-900/70 transition-colors disabled:opacity-50">
                              {plan} 12 meses
                            </button>
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
