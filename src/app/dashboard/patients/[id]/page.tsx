import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { formatDate, formatCurrency, getInitials, avatarColor } from "@/lib/utils";
import { ArrowLeft } from "lucide-react";

export default async function PatientDetailPage({ params }: { params: { id: string } }) {
  const user = await getCurrentUser();

  const patient = await prisma.patient.findFirst({
    where: { id: params.id, clinicId: user.clinicId },
    include: {
      appointments: { orderBy: { date: "desc" }, take: 10, include: { doctor: true } },
      records:      { orderBy: { visitDate: "desc" }, take: 5, include: { doctor: true } },
      invoices:     { orderBy: { createdAt: "desc" }, take: 10, include: { payments: true } },
    },
  });

  if (!patient) notFound();

  const totalPaid    = patient.invoices.reduce((s, i) => s + i.paid, 0);
  const totalBalance = patient.invoices.reduce((s, i) => s + i.balance, 0);

  const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
    PENDING:   { label: "Pendiente",  cls: "text-amber-700 bg-amber-50 border-amber-200"      },
    CONFIRMED: { label: "Confirmada", cls: "text-emerald-700 bg-emerald-50 border-emerald-200" },
    COMPLETED: { label: "Completada", cls: "text-slate-600 bg-slate-100 border-slate-200"      },
    CANCELLED: { label: "Cancelada",  cls: "text-rose-700 bg-rose-50 border-rose-200"          },
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Link href="/dashboard/patients" className="p-2 rounded-lg hover:bg-muted transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="flex items-center gap-3">
          <div className={`w-11 h-11 rounded-full ${avatarColor(patient.id)} flex items-center justify-center text-sm font-bold text-white`}>
            {getInitials(patient.firstName, patient.lastName)}
          </div>
          <div>
            <h1 className="text-xl font-extrabold">{patient.firstName} {patient.lastName}</h1>
            <p className="text-sm text-muted-foreground">Expediente #{patient.patientNumber}</p>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        {/* Info */}
        <div className="rounded-xl border border-border bg-white p-5 shadow-card">
          <h2 className="text-sm font-bold mb-4">Información personal</h2>
          <div className="space-y-2.5 text-sm">
            {[
              { label: "Email",    value: patient.email ?? "—" },
              { label: "Teléfono", value: patient.phone ?? "—" },
              { label: "Género",   value: patient.gender === "M" ? "Masculino" : patient.gender === "F" ? "Femenino" : "Otro" },
              { label: "Fecha nac.", value: patient.dob ? formatDate(patient.dob) : "—" },
              { label: "Tipo sangre", value: patient.bloodType ?? "—" },
              { label: "Dirección", value: patient.address ?? "—" },
            ].map(f => (
              <div key={f.label} className="flex justify-between gap-2">
                <span className="text-muted-foreground">{f.label}</span>
                <span className="font-medium text-right">{f.value}</span>
              </div>
            ))}
          </div>
          {patient.allergies.length > 0 && (
            <div className="mt-4 pt-4 border-t border-border">
              <div className="text-xs font-bold text-rose-600 mb-2">⚠️ Alergias</div>
              <div className="flex flex-wrap gap-1">
                {patient.allergies.map(a => (
                  <span key={a} className="text-xs bg-rose-50 text-rose-700 border border-rose-200 px-2 py-0.5 rounded-full">{a}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Appointments */}
        <div className="rounded-xl border border-border bg-white p-5 shadow-card">
          <h2 className="text-sm font-bold mb-4">Citas ({patient.appointments.length})</h2>
          {patient.appointments.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin citas</p>
          ) : (
            <div className="space-y-3">
              {patient.appointments.map(a => {
                const s = STATUS_LABEL[a.status] ?? STATUS_LABEL.PENDING;
                return (
                  <div key={a.id} className="flex items-center gap-2.5">
                    <div className="flex-1">
                      <div className="text-sm font-medium">{a.type}</div>
                      <div className="text-xs text-muted-foreground">{formatDate(a.date)} · {a.startTime}</div>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${s.cls}`}>{s.label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Billing */}
        <div className="rounded-xl border border-border bg-white p-5 shadow-card">
          <h2 className="text-sm font-bold mb-4">Facturación</h2>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-emerald-50 rounded-xl p-3">
              <div className="text-lg font-extrabold text-emerald-700">{formatCurrency(totalPaid)}</div>
              <div className="text-xs text-emerald-600">Pagado</div>
            </div>
            <div className="bg-amber-50 rounded-xl p-3">
              <div className="text-lg font-extrabold text-amber-700">{formatCurrency(totalBalance)}</div>
              <div className="text-xs text-amber-600">Por cobrar</div>
            </div>
          </div>
          {patient.invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin facturas</p>
          ) : (
            <div className="space-y-2">
              {patient.invoices.map(inv => (
                <div key={inv.id} className="flex justify-between text-sm">
                  <span className="font-mono text-xs text-muted-foreground">{inv.invoiceNumber}</span>
                  <span className="font-bold">{formatCurrency(inv.total)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Notes */}
      {patient.notes && (
        <div className="mt-5 rounded-xl border border-border bg-white p-5 shadow-card">
          <h2 className="text-sm font-bold mb-2">Notas</h2>
          <p className="text-sm text-muted-foreground">{patient.notes}</p>
        </div>
      )}
    </div>
  );
}
