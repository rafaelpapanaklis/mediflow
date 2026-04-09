export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/utils";

export const metadata: Metadata = { title: "Super Admin — MediFlow" };

const PLAN_PRICES: Record<string, number> = { BASIC: 299, PRO: 499, CLINIC: 799 };

export default async function AdminPage() {
  try {
    return await renderAdminDashboard();
  } catch (err: any) {
    console.error("Admin page error:", err);
    return (
      <div className="max-w-3xl mx-auto px-6 py-12">
        <div className="bg-red-950/50 border border-red-800 rounded-2xl p-6">
          <h1 className="text-xl font-bold text-red-400 mb-3">Error al cargar el panel admin</h1>
          <p className="text-sm text-red-300 mb-4">{err.message ?? "Error desconocido"}</p>
          {err.message?.includes("column") || err.message?.includes("relation") ? (
            <div className="bg-slate-900 border border-slate-700 rounded-xl p-4 text-sm text-slate-300">
              <p className="font-bold mb-2">La base de datos necesita ser migrada.</p>
              <p className="text-slate-400">Ve a tu Supabase SQL Editor y ejecuta el archivo <code className="text-brand-400">sql/migration_multi_category.sql</code></p>
            </div>
          ) : null}
        </div>
      </div>
    );
  }
}

async function renderAdminDashboard() {
  const now    = new Date();
  const month1 = new Date(now.getFullYear(), now.getMonth(), 1);
  const prev1  = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prev7  = new Date(now); prev7.setDate(prev7.getDate() - 7);

  const [allClinics, newClinicsMonth, newClinicsPrev, subInvoices] = await Promise.all([
    prisma.clinic.findMany({
      include: {
        users:  { select: { id:true, email:true, firstName:true, lastName:true, lastLogin:true } },
        _count: { select: { patients:true, appointments:true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.clinic.count({ where: { createdAt: { gte: month1 } } }),
    prisma.clinic.count({ where: { createdAt: { gte: prev1, lt: month1 } } }),
    prisma.subscriptionInvoice.findMany({
      where:   { createdAt: { gte: prev1 } },
      include: { clinic: { select: { name:true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const trialClinics   = allClinics.filter(c => c.trialEndsAt && new Date(c.trialEndsAt) > now);
  const expiredClinics = allClinics.filter(c => c.trialEndsAt && new Date(c.trialEndsAt) < now && c.subscriptionStatus !== "active");
  const activeClinics  = allClinics.filter(c => c.subscriptionStatus === "active");
  const churnRisk      = allClinics.filter(c => {
    const last = c.users[0]?.lastLogin;
    return last && new Date(last) < prev7 && c.subscriptionStatus === "active";
  });
  const inactiveTrial  = trialClinics.filter(c => {
    const last = c.users[0]?.lastLogin;
    return !last || new Date(last) < prev7;
  });

  const mrr          = activeClinics.reduce((s,c) => s + (PLAN_PRICES[c.plan] ?? 0), 0);
  const mrrPotential = mrr + trialClinics.reduce((s,c) => s + (PLAN_PRICES[c.plan] ?? 0), 0);
  const paidMonth    = subInvoices.filter(i => i.status==="paid" && i.createdAt>=month1).reduce((s,i)=>s+i.amount,0);
  const pendingPay   = subInvoices.filter(i => i.status==="pending").reduce((s,i)=>s+i.amount,0);
  const growthRate   = newClinicsPrev > 0 ? Math.round(((newClinicsMonth-newClinicsPrev)/newClinicsPrev)*100) : 0;

  return (
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        <div>
          <h1 className="text-2xl font-extrabold">Dashboard financiero</h1>
          <p className="text-slate-400 text-sm">{now.toLocaleDateString("es-MX",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}</p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5">
            <div className="text-xs text-slate-400 font-semibold uppercase tracking-wide mb-2">MRR Activo</div>
            <div className="text-3xl font-extrabold text-emerald-400">{formatCurrency(mrr)}</div>
            <div className="text-xs text-slate-500 mt-1">{activeClinics.length} clínicas activas</div>
          </div>
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5">
            <div className="text-xs text-slate-400 font-semibold uppercase tracking-wide mb-2">MRR Potencial</div>
            <div className="text-3xl font-extrabold text-blue-400">{formatCurrency(mrrPotential)}</div>
            <div className="text-xs text-slate-500 mt-1">Incluye {trialClinics.length} en trial</div>
          </div>
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5">
            <div className="text-xs text-slate-400 font-semibold uppercase tracking-wide mb-2">Cobrado este mes</div>
            <div className="text-3xl font-extrabold text-white">{formatCurrency(paidMonth)}</div>
            <div className="text-xs text-slate-500 mt-1">{formatCurrency(pendingPay)} pendiente</div>
          </div>
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5">
            <div className="text-xs text-slate-400 font-semibold uppercase tracking-wide mb-2">Nuevas este mes</div>
            <div className="text-3xl font-extrabold text-white">{newClinicsMonth}</div>
            <div className={`text-xs font-semibold mt-1 ${growthRate >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {growthRate >= 0 ? "↑" : "↓"} {Math.abs(growthRate)}% vs mes anterior
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            {label:"Total clínicas",   value:allClinics.length,    color:"text-white"},
            {label:"Activas (pagando)",value:activeClinics.length, color:"text-emerald-400"},
            {label:"En trial",         value:trialClinics.length,  color:"text-blue-400"},
            {label:"Trial expirado",   value:expiredClinics.length,color:"text-red-400"},
          ].map(k => (
            <div key={k.label} className="bg-slate-900 border border-slate-700 rounded-2xl p-5">
              <div className="text-xs text-slate-400 font-semibold uppercase tracking-wide mb-2">{k.label}</div>
              <div className={`text-3xl font-extrabold ${k.color}`}>{k.value}</div>
            </div>
          ))}
        </div>

        {(churnRisk.length > 0 || inactiveTrial.length > 0 || expiredClinics.length > 0) && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {churnRisk.length > 0 && (
              <Link href="/admin/churn" className="bg-red-950/50 border border-red-800 rounded-2xl p-4 hover:bg-red-950 transition-colors">
                <div className="text-red-400 font-bold text-sm mb-1">🔴 Riesgo de churn</div>
                <div className="text-2xl font-extrabold">{churnRisk.length}</div>
                <div className="text-xs text-red-300 mt-1">Activas sin login 7+ días</div>
              </Link>
            )}
            {inactiveTrial.length > 0 && (
              <Link href="/admin/churn" className="bg-amber-950/50 border border-amber-800 rounded-2xl p-4 hover:bg-amber-950 transition-colors">
                <div className="text-amber-400 font-bold text-sm mb-1">⚠️ Trial inactivo</div>
                <div className="text-2xl font-extrabold">{inactiveTrial.length}</div>
                <div className="text-xs text-amber-300 mt-1">En trial pero sin usar la app</div>
              </Link>
            )}
            {expiredClinics.length > 0 && (
              <Link href="/admin/clinics" className="bg-slate-900 border border-slate-700 rounded-2xl p-4 hover:bg-slate-800 transition-colors">
                <div className="text-slate-400 font-bold text-sm mb-1">💤 Trial expirado</div>
                <div className="text-2xl font-extrabold">{expiredClinics.length}</div>
                <div className="text-xs text-slate-400 mt-1">No convirtieron a pago</div>
              </Link>
            )}
          </div>
        )}

        <div className="bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
            <h2 className="font-bold">Pagos de suscripción recientes</h2>
            <Link href="/admin/payments" className="text-xs text-brand-400 hover:underline font-semibold">Ver todos →</Link>
          </div>
          {subInvoices.length === 0 ? (
            <div className="py-10 text-center text-slate-500 text-sm">Sin pagos registrados aún</div>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="text-xs text-slate-400 border-b border-slate-700">
                <th className="px-5 py-3 text-left">Clínica</th>
                <th className="px-5 py-3 text-left">Monto</th>
                <th className="px-5 py-3 text-left">Método</th>
                <th className="px-5 py-3 text-left">Estado</th>
                <th className="px-5 py-3 text-left">Fecha</th>
              </tr></thead>
              <tbody>
                {subInvoices.slice(0,10).map(inv => (
                  <tr key={inv.id} className="border-b border-slate-800 hover:bg-slate-800/50">
                    <td className="px-5 py-3 font-semibold">{inv.clinic.name}</td>
                    <td className="px-5 py-3 text-emerald-400 font-bold">{formatCurrency(inv.amount)}</td>
                    <td className="px-5 py-3 text-slate-400 capitalize">{inv.method ?? "—"}</td>
                    <td className="px-5 py-3">
                      <span className={`text-xs font-bold px-2 py-1 rounded-full ${inv.status==="paid"?"bg-emerald-900/50 text-emerald-400":inv.status==="failed"?"bg-red-900/50 text-red-400":"bg-amber-900/50 text-amber-400"}`}>
                        {inv.status==="paid"?"Pagado":inv.status==="failed"?"Fallido":"Pendiente"}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-400 text-xs">{new Date(inv.createdAt).toLocaleDateString("es-MX")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
            <h2 className="font-bold">Clínicas recientes</h2>
            <Link href="/admin/clinics" className="text-xs text-brand-400 hover:underline font-semibold">Ver todas →</Link>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-slate-400 border-b border-slate-700">
              <th className="px-5 py-3 text-left">Clínica</th>
              <th className="px-5 py-3 text-left">Plan</th>
              <th className="px-5 py-3 text-left">Pacientes</th>
              <th className="px-5 py-3 text-left">Estado</th>
              <th className="px-5 py-3 text-left">Creada</th>
            </tr></thead>
            <tbody>
              {allClinics.slice(0,10).map(clinic => {
                const isActive  = clinic.subscriptionStatus === "active";
                const isTrial   = clinic.trialEndsAt && new Date(clinic.trialEndsAt) > now;
                const isExpired = clinic.trialEndsAt && new Date(clinic.trialEndsAt) < now && !isActive;
                const trialDays = clinic.trialEndsAt ? Math.ceil((new Date(clinic.trialEndsAt).getTime()-now.getTime())/(1000*60*60*24)) : null;
                return (
                  <tr key={clinic.id} className="border-b border-slate-800 hover:bg-slate-800/50">
                    <td className="px-5 py-3">
                      <Link href={`/admin/clinics/${clinic.id}`} className="font-semibold hover:text-brand-400">{clinic.name}</Link>
                      <div className="text-xs text-slate-500">{clinic.users[0]?.email}</div>
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-xs font-bold text-slate-300">{clinic.plan}</span>
                      <div className="text-xs text-slate-500">{formatCurrency(PLAN_PRICES[clinic.plan]??0)}/mes</div>
                    </td>
                    <td className="px-5 py-3 text-slate-300">{clinic._count.patients}</td>
                    <td className="px-5 py-3">
                      {isActive  && <span className="text-xs bg-emerald-900/50 text-emerald-400 px-2 py-1 rounded-full font-bold">Activa</span>}
                      {isTrial   && <span className="text-xs bg-blue-900/50 text-blue-400 px-2 py-1 rounded-full font-bold">Trial {trialDays}d</span>}
                      {isExpired && <span className="text-xs bg-red-900/50 text-red-400 px-2 py-1 rounded-full font-bold">Expirado</span>}
                      {!isActive&&!isTrial&&!isExpired && <span className="text-xs bg-slate-700 text-slate-400 px-2 py-1 rounded-full font-bold">Sin plan</span>}
                    </td>
                    <td className="px-5 py-3 text-slate-400 text-xs">{new Date(clinic.createdAt).toLocaleDateString("es-MX")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
  );
}
