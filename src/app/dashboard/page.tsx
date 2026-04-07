export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/utils";

export const metadata: Metadata = { title: "Dashboard — MediFlow" };

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  PENDING:     { label:"Pendiente",  cls:"text-amber-700 bg-amber-50 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300" },
  CONFIRMED:   { label:"Confirmada", cls:"text-emerald-700 bg-emerald-50 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300" },
  IN_PROGRESS: { label:"En curso",   cls:"text-brand-700 bg-brand-50 border-brand-200" },
  COMPLETED:   { label:"Completada", cls:"text-slate-600 bg-slate-100 border-slate-200" },
  CANCELLED:   { label:"Cancelada",  cls:"text-rose-700 bg-rose-50 border-rose-200 dark:bg-rose-900/30 dark:text-rose-300" },
};

function TrendBadge({ value }: { value: number }) {
  if (value === 0) return <span className="text-xs text-muted-foreground">Sin cambio</span>;
  const up = value > 0;
  return <span className={`text-xs font-semibold ${up ? "text-emerald-600" : "text-rose-600"}`}>{up?"↑":"↓"} {Math.abs(value)}% vs mes anterior</span>;
}

export default async function DashboardPage() {
  const user     = await getCurrentUser();
  const clinicId = user.clinicId;
  const now      = new Date();
  const today    = new Date(now); today.setHours(0,0,0,0);
  const todayEnd = new Date(now); todayEnd.setHours(23,59,59,999);
  const firstMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const firstPrev  = new Date(now.getFullYear(), now.getMonth()-1, 1);
  const lastPrev   = new Date(now.getFullYear(), now.getMonth(), 0); lastPrev.setHours(23,59,59,999);
  const nextWeek   = new Date(now); nextWeek.setDate(nextWeek.getDate()+7);

  const [todayAppts, monthAppts, prevAppts, monthPatients, prevPatients, monthRevenue, prevRevenue,
         pendingInvoices, pendingCount, unconfirmed, nextWeekAppts, allInventory, doctorStats, activeDoctor, paidCount] =
    await Promise.all([
      prisma.appointment.findMany({ where:{ clinicId, date:{gte:today,lte:todayEnd} },
        include:{ patient:{select:{id:true,firstName:true,lastName:true}}, doctor:{select:{id:true,firstName:true,lastName:true,color:true}} },
        orderBy:{ startTime:"asc" } }),
      prisma.appointment.count({ where:{ clinicId, date:{gte:firstMonth}, status:{not:"CANCELLED"} } }),
      prisma.appointment.count({ where:{ clinicId, date:{gte:firstPrev,lte:lastPrev}, status:{not:"CANCELLED"} } }),
      prisma.patient.count({ where:{ clinicId, createdAt:{gte:firstMonth} } }),
      prisma.patient.count({ where:{ clinicId, createdAt:{gte:firstPrev,lte:lastPrev} } }),
      prisma.invoice.aggregate({ where:{ clinicId, status:{in:["PAID","PARTIAL"]}, updatedAt:{gte:firstMonth} }, _sum:{paid:true} }),
      prisma.invoice.aggregate({ where:{ clinicId, status:{in:["PAID","PARTIAL"]}, updatedAt:{gte:firstPrev,lte:lastPrev} }, _sum:{paid:true} }),
      prisma.invoice.aggregate({ where:{ clinicId, status:{in:["PENDING","PARTIAL"]} }, _sum:{balance:true} }),
      prisma.invoice.count({ where:{ clinicId, status:{in:["PENDING","PARTIAL"]} } }),
      prisma.appointment.count({ where:{ clinicId, date:{gte:today}, status:"PENDING" } }),
      prisma.appointment.findMany({ where:{ clinicId, date:{gt:todayEnd,lte:nextWeek}, status:{not:"CANCELLED"} },
        include:{ patient:{select:{firstName:true,lastName:true}}, doctor:{select:{firstName:true,lastName:true,color:true}} },
        orderBy:[{date:"asc"},{startTime:"asc"}], take:8 }),
      prisma.inventoryItem.findMany({ where:{ clinicId }, orderBy:{ quantity:"asc" }, take:10,
        select:{id:true,name:true,quantity:true,minQuantity:true,unit:true,emoji:true} }),
      prisma.appointment.groupBy({ by:["doctorId"], where:{ clinicId, date:{gte:firstMonth}, status:{not:"CANCELLED"} }, _count:{id:true} }),
      prisma.user.count({ where:{ clinicId, isActive:true, role:{in:["DOCTOR","ADMIN"]} } }),
      prisma.invoice.count({ where:{ clinicId, status:{in:["PAID","PARTIAL"]}, updatedAt:{gte:firstMonth} } }),
    ]);

  const currentRev    = monthRevenue._sum.paid ?? 0;
  const prevRev       = prevRevenue._sum.paid ?? 0;
  const revenueChange = prevRev > 0 ? Math.round(((currentRev-prevRev)/prevRev)*100) : 0;
  const apptChange    = prevAppts > 0 ? Math.round(((monthAppts-prevAppts)/prevAppts)*100) : 0;
  const patientChange = prevPatients > 0 ? Math.round(((monthPatients-prevPatients)/prevPatients)*100) : 0;
  const workingDays   = Math.min(now.getDate(), 22);
  const occupancy     = activeDoctor*workingDays*8 > 0 ? Math.min(100, Math.round((monthAppts/(activeDoctor*workingDays*8))*100)) : 0;
  const avgTicket     = paidCount > 0 ? Math.round(currentRev/paidCount) : 0;
  const lowAlerts     = allInventory.filter(i => i.quantity <= i.minQuantity);
  const doctorIds     = doctorStats.map(d => d.doctorId);
  const doctors       = await prisma.user.findMany({ where:{id:{in:doctorIds}}, select:{id:true,firstName:true,lastName:true,color:true} });
  const doctorMap     = Object.fromEntries(doctors.map(d => [d.id, d]));
  const monthName     = now.toLocaleDateString("es-MX", { month:"long" });
  const todayCompleted = todayAppts.filter(a=>a.status==="COMPLETED").length;
  const todayPending   = todayAppts.filter(a=>a.status==="PENDING").length;
  const todayConfirmed = todayAppts.filter(a=>a.status==="CONFIRMED").length;

  return (
    <div className="flex-1 min-w-0 space-y-5 p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground capitalize">{now.toLocaleDateString("es-MX",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {unconfirmed > 0 && (
            <Link href="/dashboard/appointments" className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-full hover:bg-amber-100">
              ⚠️ {unconfirmed} sin confirmar
            </Link>
          )}
          {lowAlerts.length > 0 && (
            <Link href="/dashboard/inventory" className="text-xs font-semibold text-red-700 bg-red-50 border border-red-200 px-3 py-1.5 rounded-full hover:bg-red-100">
              📦 {lowAlerts.length} insumos bajos
            </Link>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label:`Ingresos ${monthName}`, value:formatCurrency(currentRev), sub:`Ticket promedio: ${formatCurrency(avgTicket)}`, trend:revenueChange, icon:"💰" },
          { label:`Citas ${monthName}`, value:monthAppts.toString(), sub:`Ocupación: ${occupancy}%`, trend:apptChange, icon:"📅" },
          { label:"Pacientes nuevos", value:monthPatients.toString(), sub:`Este ${monthName}`, trend:patientChange, icon:"👤" },
          { label:"Saldo pendiente", value:formatCurrency(pendingInvoices._sum.balance??0), sub:`${pendingCount} facturas`, trend:0, icon:"⏳" },
        ].map(k => (
          <div key={k.label} className="bg-card border border-border rounded-2xl p-4 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide leading-tight">{k.label}</span>
              <span className="text-xl">{k.icon}</span>
            </div>
            <div className="text-2xl font-bold">{k.value}</div>
            <div className="text-xs text-muted-foreground">{k.sub}</div>
            <TrendBadge value={k.trend} />
          </div>
        ))}
      </div>

      {/* Today + Doctor breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-card border border-border rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-sm">Citas de hoy ({todayAppts.length})</h2>
            <div className="flex gap-3 text-xs">
              {todayCompleted>0 && <span className="text-emerald-600 font-semibold">{todayCompleted} completas</span>}
              {todayConfirmed>0 && <span className="text-brand-600 font-semibold">{todayConfirmed} confirm.</span>}
              {todayPending>0 && <span className="text-amber-600 font-semibold">{todayPending} pendientes</span>}
            </div>
          </div>
          {todayAppts.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground"><div className="text-3xl mb-2">📋</div><p className="text-sm">No hay citas hoy</p></div>
          ) : (
            <div className="space-y-1">
              {todayAppts.map(a => {
                const s = STATUS_LABEL[a.status] ?? STATUS_LABEL.PENDING;
                return (
                  <Link key={a.id} href={`/dashboard/patients/${a.patientId}`}
                    className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-muted/50 transition-colors">
                    <span className="w-12 text-center text-xs font-mono text-muted-foreground shrink-0">{a.startTime}</span>
                    <div style={{width:8,height:8,borderRadius:"50%",background:a.doctor.color,flexShrink:0}} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate">{a.patient.firstName} {a.patient.lastName}</div>
                      <div className="text-xs text-muted-foreground">Dr/a. {a.doctor.firstName} {a.doctor.lastName} · {a.type}</div>
                    </div>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border shrink-0 ${s.cls}`}>{s.label}</span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        <div className="bg-card border border-border rounded-2xl p-4">
          <h2 className="font-bold text-sm mb-3 capitalize">Doctores — {monthName}</h2>
          {doctorStats.length === 0 ? (
            <div className="py-6 text-center text-muted-foreground text-sm">Sin citas este mes</div>
          ) : (
            <div className="space-y-4">
              {[...doctorStats].sort((a,b)=>b._count.id-a._count.id).map(d => {
                const doc = doctorMap[d.doctorId]; if(!doc) return null;
                const pct = monthAppts > 0 ? Math.round((d._count.id/monthAppts)*100) : 0;
                return (
                  <div key={d.doctorId}>
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <div className="flex items-center gap-1.5">
                        <div style={{width:10,height:10,borderRadius:"50%",background:doc.color,flexShrink:0}} />
                        <span className="font-semibold">{doc.firstName} {doc.lastName}</span>
                      </div>
                      <span className="font-bold text-muted-foreground">{d._count.id}</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{width:`${pct}%`,background:doc.color}} />
                    </div>
                  </div>
                );
              })}
              <div className="pt-2 border-t border-border text-xs text-muted-foreground space-y-1">
                <div className="flex justify-between"><span>Total citas</span><span className="font-bold">{monthAppts}</span></div>
                <div className="flex justify-between"><span>Ocupación</span><span className="font-bold">{occupancy}%</span></div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Next 7 days + Inventory */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-sm">Próximos 7 días ({nextWeekAppts.length})</h2>
            <Link href="/dashboard/appointments" className="text-xs text-brand-600 font-semibold hover:underline">Ver agenda →</Link>
          </div>
          {nextWeekAppts.length === 0 ? (
            <div className="py-6 text-center text-muted-foreground text-sm">No hay citas próximas</div>
          ) : (
            <div className="space-y-2">
              {nextWeekAppts.map(a => (
                <div key={a.id} className="flex items-center gap-3 py-1.5 border-b border-border/50 last:border-0">
                  <div className="text-xs text-muted-foreground w-24 shrink-0 leading-tight">
                    <div className="font-semibold capitalize">{new Date(a.date).toLocaleDateString("es-MX",{weekday:"short",day:"numeric"})}</div>
                    <div>{a.startTime}</div>
                  </div>
                  <div style={{width:8,height:8,borderRadius:"50%",background:a.doctor.color,flexShrink:0}} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">{a.patient.firstName} {a.patient.lastName}</div>
                    <div className="text-xs text-muted-foreground">{a.doctor.firstName} {a.doctor.lastName}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-card border border-border rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-sm">Inventario</h2>
            <Link href="/dashboard/inventory" className="text-xs text-brand-600 font-semibold hover:underline">Gestionar →</Link>
          </div>
          {lowAlerts.length === 0 ? (
            <div className="py-6 text-center"><div className="text-3xl mb-2">✅</div><p className="text-sm text-muted-foreground">Todos los insumos en nivel normal</p></div>
          ) : (
            <div className="space-y-2">
              {lowAlerts.map(item => {
                const critical = item.quantity === 0;
                return (
                  <div key={item.id} className={`flex items-center justify-between p-3 rounded-xl border ${critical ? "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20" : "border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20"}`}>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-lg">{item.emoji}</span>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate">{item.name}</div>
                        <div className={`text-xs font-semibold ${critical?"text-red-600 dark:text-red-400":"text-amber-600 dark:text-amber-400"}`}>
                          {critical ? "⚠️ Sin stock" : `${item.quantity} ${item.unit} · mín: ${item.minQuantity}`}
                        </div>
                      </div>
                    </div>
                    <Link href="/dashboard/inventory" className={`text-xs font-semibold px-2 py-1 rounded-full shrink-0 ml-2 ${critical?"bg-red-100 text-red-700 dark:bg-red-900/40":"bg-amber-100 text-amber-700 dark:bg-amber-900/40"}`}>
                      Reponer
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
