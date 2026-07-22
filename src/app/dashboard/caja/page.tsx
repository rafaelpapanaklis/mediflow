export const dynamic = "force-dynamic";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canSeePatient, patientVisibilityAnd } from "@/lib/patient-visibility";
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
  const viewer = { userId: user.id, role: user.role, clinicId: user.clinicId };
  requirePermissionOrRedirect(user, "billing.view");
  // Gate de Caja por usuario (CONTRATO CAJA v2): sin permiso → módulo bloqueado.
  if (!canUseCaja(user)) return <ModuleLocked name="Caja" />;

  const [caja, history, invoices, patients, clinic, creditTotal] = await Promise.all([
    getCajaState(user.clinicId),
    getCajaHistory(user.clinicId, 30),
    prisma.invoice.findMany({
      where:   { clinicId: user.clinicId },
      include: { patient: { select: { id: true, firstName: true, lastName: true, rfcPaciente: true, razonSocialPac: true, regimenFiscalPac: true, cpPaciente: true, visibleUserIds: true } }, payments: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.patient.findMany({
      // Visibilidad: el picker de facturación no lista pacientes restringidos.
      where:   { clinicId: user.clinicId, status: "ACTIVE", AND: [...patientVisibilityAnd(viewer)] },
      select:  { id: true, firstName: true, lastName: true, patientNumber: true },
      orderBy: { firstName: "asc" },
    }),
    prisma.clinic.findUnique({
      where:  { id: user.clinicId },
      select: { facturApiEnabled: true, rfcEmisor: true, timezone: true },
    }),
    getClinicCreditTotal(user.clinicId),
  ]);

  // Visibilidad: enmascara al paciente (nombre + identidad fiscal RFC/razón social)
  // en las facturas de restringidos SIN sacarlas del corte — los totales de caja
  // deben cuadrar. El detalle (/api/invoices/[id]) ya da 404 al excluido. Se
  // strippea visibleUserIds para no exponer la lista al cliente.
  const visibleInvoices = invoices.map((inv: any) => {
    const p = inv.patient;
    if (!p) return inv;
    return {
      ...inv,
      patient: canSeePatient(viewer, p.visibleUserIds)
        ? { id: p.id, firstName: p.firstName, lastName: p.lastName, rfcPaciente: p.rfcPaciente, razonSocialPac: p.razonSocialPac, regimenFiscalPac: p.regimenFiscalPac, cpPaciente: p.cpPaciente }
        : { id: null, firstName: "Paciente privado", lastName: "", rfcPaciente: null, razonSocialPac: null, regimenFiscalPac: null, cpPaciente: null },
    };
  });

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
        invoices: visibleInvoices as any,
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
