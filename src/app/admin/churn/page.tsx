export const dynamic = "force-dynamic";
import Link from "next/link";
import { prisma } from "@/lib/prisma";

export default async function ChurnPage() {
  const now   = new Date();
  const prev7 = new Date(now); prev7.setDate(prev7.getDate()-7);
  const prev3 = new Date(now); prev3.setDate(prev3.getDate()-3);

  const allClinics = await prisma.clinic.findMany({
    include: {
      users:  { select: { email:true, firstName:true, lastName:true, lastLogin:true } },
      _count: { select: { patients:true, appointments:true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const churnRisk    = allClinics.filter(c => {
    const last = c.users[0]?.lastLogin;
    return last && new Date(last) < prev7 && c.subscriptionStatus === "active";
  });
  const trialExpiring = allClinics.filter(c => {
    if (!c.trialEndsAt) return false;
    const d = new Date(c.trialEndsAt);
    return d > now && d < prev3;
  });
  const inactiveTrial = allClinics.filter(c => {
    const isTrial = c.trialEndsAt && new Date(c.trialEndsAt) > now;
    const last    = c.users[0]?.lastLogin;
    return isTrial && (!last || new Date(last) < prev7);
  });

  function daysSince(date: Date | null | undefined) {
    if (!date) return "Nunca";
    const d = Math.floor((now.getTime()-new Date(date).getTime())/(1000*60*60*24));
    return d === 0 ? "Hoy" : `Hace ${d}d`;
  }

  function Section({ title, color, clinics, emptyMsg }: { title:string; color:string; clinics:typeof allClinics; emptyMsg:string }) {
    return (
      <div className="bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden">
        <div className={`px-5 py-4 border-b border-slate-700 font-bold ${color}`}>{title} ({clinics.length})</div>
        {clinics.length === 0 ? (
          <div className="py-8 text-center text-slate-500 text-sm">{emptyMsg}</div>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-slate-400 border-b border-slate-700">
              <th className="px-5 py-3 text-left">Clínica</th>
              <th className="px-5 py-3 text-left">Admin</th>
              <th className="px-5 py-3 text-left">Último login</th>
              <th className="px-5 py-3 text-left">Pacientes</th>
              <th className="px-5 py-3 text-left">Trial vence</th>
              <th className="px-5 py-3 text-left">Acción</th>
            </tr></thead>
            <tbody>
              {clinics.map(c => (
                <tr key={c.id} className="border-b border-slate-800 hover:bg-slate-800/50">
                  <td className="px-5 py-3 font-semibold">
                    <Link href={`/admin/clinics/${c.id}`} className="hover:text-brand-400">{c.name}</Link>
                  </td>
                  <td className="px-5 py-3 text-slate-400 text-xs">{c.users[0]?.email}</td>
                  <td className="px-5 py-3">
                    <span className={`text-xs font-semibold ${!c.users[0]?.lastLogin || new Date(c.users[0].lastLogin) < prev7 ? "text-red-400" : "text-slate-300"}`}>
                      {daysSince(c.users[0]?.lastLogin)}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-slate-300">{c._count.patients}</td>
                  <td className="px-5 py-3 text-slate-400 text-xs">
                    {c.trialEndsAt ? new Date(c.trialEndsAt).toLocaleDateString("es-MX") : "—"}
                  </td>
                  <td className="px-5 py-3">
                    <a href={`mailto:${c.users[0]?.email}?subject=Tu clínica en MediFlow&body=Hola ${c.users[0]?.firstName}, notamos que no has usado MediFlow recientemente. ¿Hay algo en que podamos ayudarte?`}
                      className="text-xs bg-brand-600 text-white px-3 py-1 rounded-full hover:bg-brand-700 font-semibold">
                      Contactar
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  }

  return (
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        <h1 className="text-2xl font-extrabold">Control de Churn y Retención</h1>
        <Section title="🔴 Riesgo de churn — activas sin login 7+ días" color="text-red-400"
          clinics={churnRisk} emptyMsg="✅ No hay clínicas activas en riesgo de churn" />
        <Section title="⚠️ Trial por vencer (próximos 3 días)" color="text-amber-400"
          clinics={trialExpiring} emptyMsg="✅ No hay trials por vencer" />
        <Section title="💤 Trial inactivo — nunca usaron la app" color="text-slate-400"
          clinics={inactiveTrial} emptyMsg="✅ Todos los trials están activos" />
      </div>
  );
}
