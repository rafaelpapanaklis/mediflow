export const dynamic = "force-dynamic";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canSeePatient, patientVisibilityAnd } from "@/lib/patient-visibility";
import { getClinicCreditTotal } from "@/lib/patient-credit";
import { requirePermissionOrRedirect } from "@/lib/auth/require-permission";
import { getCajaState, getCajaHistory, money, overdueInvoiceWhere, receivableInvoiceWhere } from "@/lib/caja";
import { periodRangeUtc } from "@/lib/agenda/time-utils";
import { DEFAULT_INVOICE_TZ } from "@/lib/invoices/due-date";
import type { Prisma } from "@prisma/client";
import { canUseCaja } from "@/lib/caja-pin";
import { ModuleLocked } from "@/components/dashboard/module-locked";
import { CajaSinPermiso } from "@/components/dashboard/sin-permiso-rediseno/caja-sin-permiso";
import { hasPermission } from "@/lib/auth/permissions";
import { localeFromClinic, serverTForLocale } from "@/i18n/server";
import { isFacturapiLive } from "@/lib/facturapi-env";
import { menuDosNivelesEncendido } from "@/lib/menu-dos-niveles/interruptor";
import { CajaClient } from "./caja-client";

// Caja = corte de caja diario. Reemplaza la página general /dashboard/billing.
// La facturación por-paciente NO cambia; aquí solo LEEMOS invoices/payments.
export default async function CajaPage() {
  const user = await getCurrentUser();
  const viewer = { userId: user.id, role: user.role, clinicId: user.clinicId };
  requirePermissionOrRedirect(user, "billing.view");
  // Gate de Caja por usuario (CONTRATO CAJA v2): sin permiso → módulo bloqueado.
  if (!canUseCaja(user)) {
    // Hallazgo 16 del rediseño (ws1-t8): «Caja no está en tu plan → Ver planes»
    // es falso aquí. La clínica SÍ tiene Caja (billing.view ya pasó arriba); lo
    // que le falta a ESTE usuario es el interruptor `canAccessCaja` de Equipo.
    // Con la bandera `menu-dos-niveles` encendida la pantalla dice eso y ofrece
    // volver a Hoy (o abrir Equipo, si puede editarlo). Con la bandera apagada
    // se queda el ModuleLocked de siempre, tal cual. La regla de quién entra
    // (canUseCaja) no cambia.
    const rediseno = await menuDosNivelesEncendido(user.clinicId);
    if (!rediseno) return <ModuleLocked name="Caja" />;
    const { t } = serverTForLocale(localeFromClinic(user.clinic));
    const puedeEditarEquipo = hasPermission(
      { role: user.role, permissionsOverride: user.permissionsOverride ?? [] },
      "team.edit",
    );
    return <CajaSinPermiso t={t} equipoHref={puedeEditarEquipo ? "/dashboard/team" : undefined} />;
  }

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
      select: { facturApiEnabled: true, rfcEmisor: true, timezone: true, cfdiTaxMode: true },
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

  // KPIs sobre TODA la clínica con aggregate (FIN-04). Antes salían del arreglo
  // de arriba, que trae solo las 100 facturas más recientes: pasadas 100, los
  // números se congelaban sobre esas 100; y "Total cobrado" filtraba PAID, así
  // que los abonos de una PARTIAL no contaban. "Vencido" se deriva de dueDate
  // (overdueInvoiceWhere), nunca del status OVERDUE que nadie escribe. "Hoy" y
  // "este mes" van en la zona de la clínica: Vercel corre en UTC.
  const tz = user.clinic?.timezone || DEFAULT_INVOICE_TZ;
  const todayStart = periodRangeUtc("day", tz).from;
  const monthStart = periodRangeUtc("month", tz).from;
  const issued: Prisma.InvoiceWhereInput = { clinicId: user.clinicId, status: { notIn: ["DRAFT", "CANCELLED"] } };
  // REDISEÑO DE CAJA — el MISMO interruptor por clínica que enciende el menú
  // de dos niveles (`clinic_feature_flags`, bandera `menu-dos-niveles`), no
  // uno propio. Falla cerrado (sin tabla, sin fila o con error → false = la
  // Caja de hoy, tal cual). No añade un viaje a la base: el layout ya la
  // preguntó en esta misma carga y la respuesta vive 60 s en memoria por
  // clínica. Va en este Promise.all (6) y no en el de arriba (ya con 6): menos
  // de 7 consultas por tanda.
  const [paidAgg, pendingAgg, overdueAgg, totalInvoices, monthInvoices, rediseno] = await Promise.all([
    prisma.invoice.aggregate({ _sum: { paid: true },    where: issued }),
    prisma.invoice.aggregate({ _sum: { balance: true }, where: receivableInvoiceWhere(user.clinicId) }),
    prisma.invoice.aggregate({ _sum: { balance: true }, where: overdueInvoiceWhere(user.clinicId, todayStart) }),
    prisma.invoice.count({ where: { clinicId: user.clinicId } }),
    prisma.invoice.count({ where: { clinicId: user.clinicId, createdAt: { gte: monthStart } } }),
    menuDosNivelesEncendido(user.clinicId),
  ]);
  const totalPaid    = money(paidAgg._sum.paid ?? 0);
  const totalPending = money(pendingAgg._sum.balance ?? 0);
  const totalOverdue = money(overdueAgg._sum.balance ?? 0);

  return (
    <CajaClient
      caja={caja}
      history={history}
      timezone={clinic?.timezone ?? "America/Mexico_City"}
      hasPin={!!user.cajaPinHash}
      rediseno={rediseno}
      billing={{
        invoices: visibleInvoices as any,
        patients,
        totalPaid,
        totalPending,
        totalOverdue,
        monthInvoices,
        totalInvoices,
        // Umbral del filtro "Vencidas" en el cliente: el mismo "hoy" de la clínica
        // con el que se calculó el KPI de arriba.
        overdueBefore: todayStart.toISOString(),
        creditTotal,
        clinic: {
          facturApiEnabled: clinic?.facturApiEnabled ?? false,
          rfcEmisor:        clinic?.rfcEmisor ?? null,
          // Impuestos por default del timbrado de esta clínica ("exempt" | "iva16").
          cfdiTaxMode:      clinic?.cfdiTaxMode ?? "exempt",
        },
        // Solo el boolean del ambiente CFDI (jamás la env) para que el modal de
        // timbrado no prometa validez fiscal en pruebas.
        cfdiLive: isFacturapiLive(),
      }}
    />
  );
}
