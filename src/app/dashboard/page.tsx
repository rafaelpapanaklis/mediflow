export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatCurrency, getInitials, avatarColor } from "@/lib/utils";
import { RevenueChart } from "@/components/dashboard/revenue-chart";
import { TodayStrip } from "@/components/dashboard/today-strip";

export const metadata: Metadata = { title: "Dashboard — MediFlow" };

export default async function DashboardPage() {
  const user     = await getCurrentUser();
  const clinicId = user.clinicId;
  const isAdmin  = user.role === "ADMIN" || user.role === "SUPER_ADMIN";

  const today    = new Date(); today.setHours(0,0,0,0);
  const todayEnd = new Date(today); todayEnd.setHours(23,59,59,999);
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

  // Role-based appointment filter
  const apptWhere = {
    clinicId,
    date: { gte: today, lte: todayEnd },
    ...(user.role === "DOCTOR" ? { doctorId: user.id } : {}),
  };

  const todayAppts = await prisma.appointment.findMany({
    where:   apptWhere,
    include: {
      patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
      doctor:  { select: { id: true, firstName: true, lastName: true, color: true } },
    },
    orderBy: [{ startTime: "asc" }],
  });

  const monthPatients = await prisma.patient.count({
    where: { clinicId, createdAt: { gte: firstOfMonth } },
  });

  const monthRev = isAdmin ? await prisma.invoice.aggregate({
    where: { clinicId, status: { in: ["PAID","PARTIAL"] }, createdAt: { gte: firstOfMonth } },
    _sum: { paid: true },
  }) : null;

  const recentPatients = await prisma.patient.findMany({
    where: {
      clinicId,
      ...(user.role === "DOCTOR" ? { primaryDoctorId: user.id } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 5,
    include: {
      primaryDoctor: { select: { firstName: true, lastName: true, color: true } },
    },
  });

  // Weekly revenue chart (admin only)
  const weekData = [];
  if (isAdmin) {
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      const end = new Date(d); end.setHours(23,59,59,999);
      const agg = await prisma.invoice.aggregate({
        where: { clinicId, paidAt: { gte: d, lte: end } },
        _sum:  { paid: true },
      });
      weekData.push({ day: ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"][d.getDay()], amount: agg._sum.paid ?? 0 });
    }
  }

  const confirmed   = todayAppts.filter(a => a.status === "CONFIRMED").length;
  const pending     = todayAppts.filter(a => a.status === "PENDING").length;
  const inProgress  = todayAppts.filter(a => a.status === "IN_PROGRESS").length;
  const monthRevAmt = monthRev?._sum.paid ?? 0;

  const hour     = new Date().getHours();
  const greeting = hour < 12 ? "Buenos días" : hour < 18 ? "Buenas tardes" : "Buenas noches";

  // Serialize dates for client components
  const serializedAppts = todayAppts.map(a => ({
    ...a,
    date:      a.date instanceof Date ? a.date.toISOString() : String(a.date),
    createdAt: a.createdAt instanceof Date ? a.createdAt.toISOString() : String(a.createdAt),
    updatedAt: a.updatedAt instanceof Date ? a.updatedAt.toISOString() : String(a.updatedAt),
  }));

  return (
    <div>
      {/* Greeting */}
      <div className="mb-5">
        <h1 className="text-2xl font-extrabold">
          {greeting}, {["DOCTOR","SUPER_ADMIN"].includes(user.role) ? "Dr/a." : ""} {user.firstName} 👋
        </h1>
        <p className="text-base text-muted-foreground mt-0.5">
          {new Date().toLocaleDateString("es-MX", { weekday:"long", day:"numeric", month:"long", year:"numeric" })}
        </p>
      </div>

      {/* KPI cards */}
      <div className={`grid gap-4 mb-5 ${isAdmin ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-2 lg:grid-cols-3"}`}>
        {[
          {
            icon:"📅", label:"Citas hoy", value: String(todayAppts.length),
            sub: inProgress > 0 ? `${inProgress} en curso · ${pending} pendientes` : `${confirmed} confirmadas · ${pending} pendientes`,
            bg:"bg-brand-50 dark:bg-brand-950/30",
          },
          {
            icon:"👥", label: isAdmin ? "Pacientes nuevos" : "Mis pacientes",
            value: isAdmin ? String(monthPatients) : String(recentPatients.length),
            sub: isAdmin ? "Este mes" : "Asignados",
            bg:"bg-emerald-50 dark:bg-emerald-950/30",
          },
          ...(isAdmin ? [{
            icon:"💰", label:"Ingresos del mes",
            value: formatCurrency(monthRevAmt),
            sub: "Pagos recibidos",
            bg:"bg-amber-50 dark:bg-amber-950/30",
          }] : []),
          {
            icon:"✅", label:"Completadas hoy",
            value: String(todayAppts.filter(a => a.status === "COMPLETED").length),
            sub: `de ${todayAppts.length} total`,
            bg:"bg-violet-50 dark:bg-violet-950/30",
          },
        ].map(k => (
          <div key={k.label} className="rounded-2xl border border-border bg-white dark:bg-slate-900 p-5 shadow-card">
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-2xl mb-3 ${k.bg}`}>{k.icon}</div>
            <div className="text-3xl font-extrabold mb-0.5">{k.value}</div>
            <div className="text-base font-semibold text-muted-foreground">{k.label}</div>
            <div className="text-sm text-muted-foreground/70 mt-0.5">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Today's appointments strip with 1-click status change */}
      {todayAppts.length > 0 && <TodayStrip initialAppts={serializedAppts as any} />}

      {/* Bottom grid */}
      <div className={`grid gap-5 ${isAdmin ? "lg:grid-cols-3" : "lg:grid-cols-1"}`}>

        {/* Recent patients */}
        <div className={`bg-white dark:bg-slate-900 rounded-2xl border border-border shadow-card overflow-hidden ${isAdmin ? "lg:col-span-2" : ""}`}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h2 className="text-base font-bold">
              {user.role === "DOCTOR" ? "👥 Mis pacientes recientes" : "👥 Pacientes recientes"}
            </h2>
            <Link href="/dashboard/patients" className="text-sm text-brand-600 font-semibold hover:underline">
              Ver todos →
            </Link>
          </div>
          {recentPatients.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <div className="text-base">Aún no hay pacientes.</div>
              <Link href="/dashboard/patients" className="text-brand-600 hover:underline text-sm mt-1 inline-block">Agregar el primero →</Link>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {["Paciente","Teléfono","Doctor","Registro"].filter((_, i) => isAdmin || i !== 2).map(h => (
                    <th key={h} className="text-left px-5 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentPatients.map(p => (
                  <tr key={p.id} className="border-b border-border/60 hover:bg-muted/20 transition-colors">
                    <td className="px-5 py-3.5">
                      <Link href={`/dashboard/patients/${p.id}`} className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-xl ${avatarColor(p.id)} flex items-center justify-center text-xs font-bold text-white flex-shrink-0`}>
                          {getInitials(p.firstName, p.lastName)}
                        </div>
                        <div>
                          <div className="text-base font-semibold hover:text-brand-600 transition-colors">{p.firstName} {p.lastName}</div>
                          <div className="text-sm text-muted-foreground">{p.email ?? "Sin email"}</div>
                        </div>
                      </Link>
                    </td>
                    <td className="px-5 py-3.5 text-base text-muted-foreground">{p.phone ?? "—"}</td>
                    {isAdmin && (
                      <td className="px-5 py-3.5">
                        {p.primaryDoctor ? (
                          <div className="flex items-center gap-2">
                            <div className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                              style={{ background: p.primaryDoctor.color }} />
                            <span className="text-sm font-semibold">
                              Dr/a. {p.primaryDoctor.firstName} {p.primaryDoctor.lastName}
                            </span>
                          </div>
                        ) : <span className="text-sm text-muted-foreground">Sin asignar</span>}
                      </td>
                    )}
                    <td className="px-5 py-3.5 text-sm text-muted-foreground">
                      {new Date(p.createdAt).toLocaleDateString("es-MX", { day:"numeric", month:"short", year:"numeric" })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Revenue chart — admin only */}
        {isAdmin && weekData.length > 0 && (
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-border shadow-card p-5">
            <h2 className="text-base font-bold mb-4">💰 Ingresos — últimos 7 días</h2>
            <RevenueChart data={weekData} />
          </div>
        )}
      </div>
    </div>
  );
}
