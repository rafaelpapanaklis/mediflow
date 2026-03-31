import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/utils";

export const metadata: Metadata = { title: "Super Admin — MediFlow" };

export default async function AdminPage() {
  const [totalClinics, activeClinics, pendingPayments, recentClinics] = await Promise.all([
    prisma.clinic.count(),
    prisma.clinic.count({ where: { plan: { not: "BASIC" } } }),
    prisma.clinic.count({ where: { trialEndsAt: { lt: new Date() } } }),
    prisma.clinic.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { _count: { select: { patients: true, users: true } } },
    }),
  ]);

  const mrr = recentClinics.reduce((s, c) => {
    if (c.plan === "PRO")    return s + 99;
    if (c.plan === "CLINIC") return s + 249;
    return s + 49;
  }, 0);

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Admin navbar */}
      <nav className="bg-slate-900 border-b border-slate-700 px-6 h-14 flex items-center gap-4">
        <div className="flex items-center gap-2 font-extrabold text-brand-400">
          <div className="w-6 h-6 rounded-lg bg-brand-600 flex items-center justify-center text-[11px] font-extrabold text-white">M</div>
          MediFlow Admin
        </div>
        <div className="flex items-center gap-1 ml-4">
          {[
            { href: "/admin",           label: "Dashboard"  },
            { href: "/admin/clinics",   label: "Clínicas"   },
            { href: "/admin/payments",  label: "Pagos"      },
            { href: "/admin/settings",  label: "Config"     },
          ].map(item => (
            <Link key={item.href} href={item.href}
              className="px-3 py-1.5 rounded-lg text-sm font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition-colors">
              {item.label}
            </Link>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-slate-500">Admin autenticado · Sesión 8h</span>
          <form action="/api/admin/logout" method="POST">
            <button className="text-xs font-semibold text-slate-400 hover:text-white transition-colors px-3 py-1.5 rounded-lg border border-slate-700 hover:border-slate-500">
              Cerrar sesión
            </button>
          </form>
        </div>
      </nav>

      <div className="p-6">
        <h1 className="text-xl font-extrabold mb-6">Dashboard global</h1>

        {/* KPIs */}
        <div className="grid grid-cols-4 gap-4 mb-8">
          {[
            { label: "Total clínicas",     value: totalClinics,    icon: "🏥", color: "text-brand-400"   },
            { label: "Clínicas activas",   value: activeClinics,   icon: "✅", color: "text-emerald-400" },
            { label: "Trial expirado",     value: pendingPayments, icon: "⚠️", color: "text-amber-400"   },
            { label: "MRR estimado",       value: formatCurrency(mrr, "MXN"), icon: "💰", color: "text-violet-400" },
          ].map(k => (
            <div key={k.label} className="bg-slate-900 border border-slate-700 rounded-xl p-5">
              <div className="text-2xl mb-2">{k.icon}</div>
              <div className={`text-2xl font-extrabold ${k.color}`}>{k.value}</div>
              <div className="text-xs text-slate-400 mt-0.5">{k.label}</div>
            </div>
          ))}
        </div>

        {/* Recent clinics */}
        <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
            <h2 className="text-sm font-bold">Clínicas recientes</h2>
            <Link href="/admin/clinics" className="text-xs text-brand-400 hover:underline">Ver todas →</Link>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700">
                {["Clínica","Especialidad","Plan","Pacientes","Usuarios","Registro","Estado"].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentClinics.map(clinic => {
                const expired = clinic.trialEndsAt && new Date(clinic.trialEndsAt) < new Date();
                return (
                  <tr key={clinic.id} className="border-b border-slate-800 hover:bg-slate-800/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-white">{clinic.name}</div>
                      <div className="text-[10px] text-slate-500">{clinic.slug}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-300">{clinic.specialty}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        clinic.plan === "CLINIC" ? "bg-violet-900/50 text-violet-400 border border-violet-700" :
                        clinic.plan === "PRO"    ? "bg-brand-900/50 text-brand-400 border border-brand-700" :
                        "bg-slate-700 text-slate-300 border border-slate-600"
                      }`}>{clinic.plan}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-300">{clinic._count.patients}</td>
                    <td className="px-4 py-3 text-slate-300">{clinic._count.users}</td>
                    <td className="px-4 py-3 text-slate-400 text-xs">{new Date(clinic.createdAt).toLocaleDateString("es-MX")}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                        expired ? "bg-rose-900/50 text-rose-400 border-rose-700" : "bg-emerald-900/50 text-emerald-400 border-emerald-700"
                      }`}>{expired ? "Trial expirado" : "Activo"}</span>
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
