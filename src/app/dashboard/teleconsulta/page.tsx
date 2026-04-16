export const dynamic = "force-dynamic";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";

export default async function TeleconsultaPage() {
  const user = await getCurrentUser();
  const appointments = await prisma.appointment.findMany({
    where: { clinicId: user.clinicId, mode: "TELECONSULTATION" },
    include: {
      patient: { select: { firstName: true, lastName: true } },
      doctor: { select: { firstName: true, lastName: true } },
    },
    orderBy: { date: "desc" },
    take: 50,
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold flex items-center gap-2">📹 Teleconsultas</h1>
          <p className="text-base text-muted-foreground mt-0.5">{appointments.length} teleconsultas registradas</p>
        </div>
        <Link href="/dashboard/appointments?new=1" className="flex items-center gap-2 px-4 py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-semibold text-sm transition-colors">
          + Nueva teleconsulta
        </Link>
      </div>

      <div className="bg-card border border-border rounded-2xl shadow-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {["Paciente","Doctor","Fecha","Hora","Pago","Estado",""].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {appointments.length === 0 ? (
              <tr><td colSpan={7} className="px-5 py-16 text-center text-muted-foreground">
                <div className="text-4xl mb-3">📹</div>
                <div className="text-base font-semibold mb-1">Sin teleconsultas</div>
                <div className="text-sm">Agenda una teleconsulta desde la Agenda</div>
              </td></tr>
            ) : appointments.map(a => (
              <tr key={a.id} className="border-b border-border/60 hover:bg-muted/20 transition-colors">
                <td className="px-4 py-3 font-semibold">{a.patient.firstName} {a.patient.lastName}</td>
                <td className="px-4 py-3 text-muted-foreground">Dr/a. {a.doctor.firstName} {a.doctor.lastName}</td>
                <td className="px-4 py-3 text-muted-foreground">{new Date(a.date).toLocaleDateString("es-MX", { day: "numeric", month: "short" })}</td>
                <td className="px-4 py-3 font-mono">{a.startTime}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${a.paymentStatus === "paid" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"}`}>
                    {a.paymentStatus === "paid" ? "Pagado" : "Pendiente"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${a.status === "COMPLETED" ? "bg-muted text-muted-foreground" : "bg-brand-600/15 text-brand-700"}`}>
                    {a.status === "COMPLETED" ? "Completada" : a.status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {a.paymentStatus === "paid" && a.status !== "COMPLETED" && (
                    <Link href={`/teleconsulta/${a.id}?role=doctor`} target="_blank" className="text-xs font-semibold text-violet-600 hover:underline">
                      Unirse →
                    </Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
