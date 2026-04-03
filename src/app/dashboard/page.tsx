export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatCurrency, getInitials, avatarColor } from "@/lib/utils";
import { RevenueChart } from "@/components/dashboard/revenue-chart";

export const metadata: Metadata = { title: "Dashboard — MediFlow" };

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  PENDING:     { label: "Pendiente",  cls: "text-amber-700 bg-amber-50 border-amber-200"       },
  CONFIRMED:   { label: "Confirmada", cls: "text-emerald-700 bg-emerald-50 border-emerald-200" },
  IN_PROGRESS: { label: "En curso",   cls: "text-brand-700 bg-brand-50 border-brand-200"       },
  COMPLETED:   { label: "Completada", cls: "text-slate-600 bg-slate-100 border-slate-200"      },
  CANCELLED:   { label: "Cancelada",  cls: "text-rose-700 bg-rose-50 border-rose-200"          },
};

export default async function DashboardPage() {
  const user     = await getCurrentUser();
  const clinicId = user.clinicId;

  const today    = new Date(); today.setHours(0,0,0,0);
  const todayEnd = new Date(today); todayEnd.setHours(23,59,59,999);
  const firstOfMonth   = new Date(today.getFullYear(), today.getMonth(), 1);
  const firstLastMonth = new Date(today.getFullYear(), today.getMonth()-1, 1);
  const lastLastMonth  = new Date(today.getFullYear(), today.getMonth(), 0);

  // Run queries sequentially to avoid overwhelming the connection pool
  const todayAppts = await prisma.appointment.findMany({
    where: { clinicId, date: { gte: today, lte: todayEnd } },
    include: { patient: true, doctor: true },
    orderBy: { startTime: "asc" },
  });

  const monthPatients = await prisma.patient.count({
    where: { clinicId, createdAt: { gte: firstOfMonth } },
  });

  const monthRev = await prisma.invoice.aggregate({
    where: { clinicId, status: { in: ["PAID","PARTIAL"] }, createdAt: { gte: firstOfMonth } },
    _sum: { paid: true },
  });

  const recentPatients = await prisma.patient.findMany({
    where: { clinicId },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  // Build week chart data (last 7 days)
  const weekData = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const end = new Date(d); end.setHours(23,59,59,999);
    const agg = await prisma.invoice.aggregate({
      where: { clinicId, paidAt: { gte: d, lte: end } },
      _sum: { paid: true },
    });
    weekData.push({ day: ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"][d.getDay()], amount: agg._sum.paid ?? 0 });
  }

  const confirmed = todayAppts.filter(a => a.status === "CONFIRMED").length;
  const pending   = todayAppts.filter(a => a.status === "PENDING").length;
  const monthRevAmt = monthRev._sum.paid ?? 0;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Buenos días" : hour < 18 ? "Buenas tardes" : "Buenas noches";

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-extrabold">
          {greeting}, {["DOCTOR","SUPER_ADMIN"].includes(user.role) ? "Dr/a." : ""} {user.firstName} 👋
        </h1>
        <p className="text-sm text-muted-foreground">
          {new Date().toLocaleDateString("es-MX", { weekday:"long", day:"numeric", month:"long", year:"numeric" })}
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { icon:"📅", label:"Citas hoy",       value: String(todayAppts.length), sub:`${confirmed} confirmadas · ${pending} pendientes`, bg:"bg-brand-50"   },
          { icon:"👥", label:"Pacientes nuevos", value: String(monthPatients),     sub:"Este mes",                                         bg:"bg-emerald-50" },
          { icon:"💰", label:"Ingresos del mes", value: formatCurrency(monthRevAmt), sub:"Pagos recibidos",                                bg:"bg-amber-50"   },
          { icon:"🏥", label:"Plan activo",      value: user.clinic.plan,          sub:"14 días de prueba",                                bg:"bg-violet-50"  },
        ].map(k => (
          <div key={k.label} className="rounded-xl border border-border bg-white p-5 shadow-card">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl mb-3 ${k.bg}`}>{k.icon}</div>
            <div className="text-2xl font-extrabold mb-0.5">{k.value}</div>
            <div className="text-xs font-semibold text-muted-foreground">{k.label}</div>
            <div className="text-xs text-muted-foreground/70 mt-0.5">{k.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-5 mb-5">
        <div className="lg:col-span-2 rounded-xl border border-border bg-white p-5 shadow-card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold">📅 Agenda de hoy</h2>
            <Link href="/dashboard/appointments" className="text-xs text-brand-600 font-semibold hover:underline">Ver todo →</Link>
          </div>
          {todayAppts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No hay citas para hoy.<br/>
              <Link href="/dashboard/appointments" className="text-brand-600 hover:underline mt-1 inline-block">Agendar cita →</Link>
            </div>
          ) : todayAppts.map(appt => {
            const s = STATUS_LABEL[appt.status] ?? STATUS_LABEL.PENDING;
            return (
              <div key={appt.id} className="flex items-center gap-3 py-3 border-b border-border/60 last:border-0">
                <span className="text-xs font-mono font-bold text-muted-foreground w-11 flex-shrink-0">{appt.startTime}</span>
                <div className={`w-8 h-8 rounded-full ${avatarColor(appt.patientId)} flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0`}>
                  {getInitials(appt.patient?.firstName ?? "P", appt.patient?.lastName ?? "")}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{appt.patient?.firstName} {appt.patient?.lastName}</div>
                  <div className="text-xs text-muted-foreground">{appt.type} · Dr/a. {appt.doctor?.firstName} {appt.doctor?.lastName}</div>
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border flex-shrink-0 ${s.cls}`}>{s.label}</span>
              </div>
            );
          })}
        </div>
        <div className="rounded-xl border border-border bg-white p-5 shadow-card">
          <h2 className="text-sm font-bold mb-4">💰 Ingresos últimos 7 días</h2>
          <RevenueChart data={weekData} />
        </div>
      </div>

      <div className="rounded-xl border border-border bg-white shadow-card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-bold">👥 Pacientes recientes</h2>
          <Link href="/dashboard/patients" className="text-xs text-brand-600 font-semibold hover:underline">Ver todos →</Link>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {["Paciente","Teléfono","Registro"].map(h => (
                <th key={h} className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {recentPatients.length === 0 ? (
              <tr><td colSpan={3} className="px-5 py-10 text-center text-muted-foreground text-sm">
                Aún no hay pacientes. <Link href="/dashboard/patients" className="text-brand-600 hover:underline">Agrega el primero →</Link>
              </td></tr>
            ) : recentPatients.map(p => (
              <tr key={p.id} className="border-b border-border/60 hover:bg-muted/20 transition-colors">
                <td className="px-5 py-3">
                  <Link href={`/dashboard/patients/${p.id}`} className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full ${avatarColor(p.id)} flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0`}>
                      {getInitials(p.firstName, p.lastName)}
                    </div>
                    <div>
                      <div className="font-semibold hover:text-brand-600 transition-colors">{p.firstName} {p.lastName}</div>
                      <div className="text-xs text-muted-foreground">{p.email ?? "Sin email"}</div>
                    </div>
                  </Link>
                </td>
                <td className="px-5 py-3 text-muted-foreground">{p.phone ?? "—"}</td>
                <td className="px-5 py-3 text-muted-foreground text-xs">
                  {new Date(p.createdAt).toLocaleDateString("es-MX", { day:"numeric", month:"short", year:"numeric" })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
