export const dynamic = "force-dynamic";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getClinicCreditTotal } from "@/lib/patient-credit";
import { requirePermissionOrRedirect } from "@/lib/auth/require-permission";
import { getCajaState, getCajaHistory } from "@/lib/caja";
import { canUseCaja } from "@/lib/caja-pin";
import { ModuleLocked } from "@/components/dashboard/module-locked";
import { CajaClient } from "./caja-client";

// Caja = corte de caja diario. Reemplaza la página general /dashboard/billing.
// La facturación por-paciente NO cambia; aquí solo LEEMOS invoices/payments.
export default async function CajaPage() {
  const user = await getCurrentUser();
  requirePermissionOrRedirect(user, "billing.view");
  // Gate de Caja por usuario (CONTRATO CAJA v2): sin permiso → módulo bloqueado.
  if (!canUseCaja(user)) return <ModuleLocked name="Caja" />;

  const [caja, history, invoices, patients, clinic, creditTotal] = await Promise.all([
    getCajaState(user.clinicId),
    getCajaHistory(user.clinicId, 30),
    prisma.invoice.findMany({
      where:   { clinicId: user.clinicId },
      include: { patient: { select: { id: true, firstName: true, lastName: true } }, payments: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.patient.findMany({
      where:   { clinicId: user.clinicId, status: "ACTIVE" },
      select:  { id: true, firstName: true, lastName: true, patientNumber: true },
      orderBy: { firstName: "asc" },
    }),
    prisma.clinic.findUnique({
      where:  { id: user.clinicId },
      select: { facturApiEnabled: true, rfcEmisor: true, timezone: true },
    }),
    getClinicCreditTotal(user.clinicId),
  ]);

  const totalPaid    = invoices.filter(i => i.status === "PAID").reduce((s, i) => s + i.paid, 0);
  const totalPending = invoices.filter(i => ["PENDING", "PARTIAL"].includes(i.status)).reduce((s, i) => s + i.balance, 0);
  const totalOverdue = invoices.filter(i => i.status === "OVERDUE").reduce((s, i) => s + i.balance, 0);

  const firstOfMonth = new Date();
  firstOfMonth.setDate(1);
  firstOfMonth.setHours(0, 0, 0, 0);
  const monthInvoices = invoices.filter(i => new Date(i.createdAt) >= firstOfMonth).length;

  return (
    <CajaClient
      caja={caja}
      history={history}
      timezone={clinic?.timezone ?? "America/Mexico_City"}
      hasPin={!!user.cajaPinHash}
      billing={{
        invoices: invoices as any,
        patients,
        totalPaid,
        totalPending,
        totalOverdue,
        monthInvoices,
        creditTotal,
        clinic: { facturApiEnabled: clinic?.facturApiEnabled ?? false, rfcEmisor: clinic?.rfcEmisor ?? null },
      }}
    />
  );
}
