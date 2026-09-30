import "server-only";
import { prisma } from "@/lib/prisma";
import { canSeePatient, type VisibilityViewer } from "@/lib/patient-visibility";
import { hasActiveOrthodonticsModule } from "@/lib/orthodontics/access";
import { cobranzaDelCasoUnificada } from "@/lib/orthodontics/cobranza-caso";
import { normalizarOrthoBillingMode } from "@/lib/orthodontics/billing-mode";
import { cargarModosDeCobro } from "@/lib/orthodontics/billing-mode-db";
import { cargarCargosDeControlPorCasos, vencimientoDeFacturaPrincipal } from "@/lib/orthodontics/cobranza-controles-db";
import { leerCondicionesDeFacturas } from "@/lib/invoices/condiciones-pago-db";
import type { Prisma, ClinicCategory } from "@prisma/client";
import type {
  AgendaAppointmentDTO,
  AppointmentStatus,
  AppointmentSource,
  DoctorColumnDTO,
  ResourceDTO,
  ResourceKind,
} from "./types";
import {
  agendaDayFetchRange,
  periodRangeUtc,
  type ClinicTimeConfig,
  type AdminPeriod,
} from "./time-utils";
import { MOTIVO_APARTADO_LIBERADO, apartadoVencido } from "./apartado";

const APPT_INCLUDE = {
  // visibleUserIds viaja en el MISMO include para poder enmascarar en una sola
  // pasada (sin un query por cita). Ver maskedPatient() abajo.
  patient: { select: { id: true, firstName: true, lastName: true, visibleUserIds: true } },
  doctor:  { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.AppointmentInclude;

// `visibleUserIds` va OPCIONAL a propósito: las rutas de mutación
// (POST/PATCH/status/complete) arman su propio include SIN ese campo y llaman a
// appointmentToDTO igual. Sin viewer no hay enmascarado, así que no lo necesitan.
type ApptWithIncludes = Omit<
  Prisma.AppointmentGetPayload<{ include: typeof APPT_INCLUDE }>,
  "patient"
> & {
  patient: {
    id: string;
    firstName: string;
    lastName: string;
    visibleUserIds?: string[];
  };
};

const NON_MEDICAL_CATEGORIES: ClinicCategory[] = [
  "SPA",
  "MASSAGE",
  "BEAUTY_CENTER",
  "NAIL_SALON",
  "HAIR_SALON",
  "BROW_LASH",
  "LASER_HAIR_REMOVAL",
];

function patientName(p: { firstName: string; lastName: string | null }): string {
  return [p.firstName, p.lastName].filter(Boolean).join(" ").trim();
}

function professionalShortName(
  user: { firstName: string; lastName: string },
  category: ClinicCategory,
): string {
  const first = user.firstName.split(/\s+/)[0] ?? user.firstName;
  return NON_MEDICAL_CATEGORIES.includes(category) ? first : `Dr. ${first}`;
}

/**
 * Visibilidad por paciente en la agenda: a un usuario que NO puede ver a un
 * paciente restringido NO le ocultamos la cita — se rompería la operación del
 * día (el hueco existe, hay que respetarlo) — sino que le enmascaramos QUIÉN es.
 * Sin `id` para no filtrar el identificador; el expediente igual daría 404.
 */
function maskedPatient(
  p: { id: string; firstName: string; lastName: string; visibleUserIds?: string[] },
  viewer: VisibilityViewer | null | undefined,
): { id: string; name: string } {
  if (viewer && !canSeePatient(viewer, p.visibleUserIds)) {
    return { id: null as any, name: "Paciente privado" };
  }
  return { id: p.id, name: patientName(p) };
}

export function appointmentToDTO(
  a: ApptWithIncludes,
  category: ClinicCategory,
  viewer?: VisibilityViewer | null,
): AgendaAppointmentDTO {
  // WS1-T5 — una cita apartada cuyo anticipo venció ya liberó su hueco,
  // aunque el cron todavía no la haya cancelado: la agenda la pinta y la
  // cuenta como CANCELADA, que es lo que la base hará en cuanto alguien pise
  // ese hueco (trigger appt_liberar_apartado_vencido).
  const vencida = apartadoVencido(a);
  return {
    id: a.id,
    startsAt: a.startsAt.toISOString(),
    endsAt: a.endsAt.toISOString(),
    status: (vencida ? "CANCELLED" : a.status) as AppointmentStatus,
    patient: maskedPatient(a.patient, viewer),
    doctor: a.doctor
      ? { id: a.doctor.id, shortName: professionalShortName(a.doctor, category) }
      : undefined,
    reason: a.type ?? undefined,
    isTeleconsult: a.mode === "TELECONSULTATION",
    isWalkIn: false,
    minutesWaiting: undefined,
    resourceId: a.resourceId,
    source: (a.source ?? "STAFF") as AppointmentSource,
    requiresValidation: a.requiresValidation ?? false,
    overrideReason: a.overrideReason ?? null,
    checkedInAt: a.checkedInAt?.toISOString() ?? null,
    startedAt: a.startedAt?.toISOString() ?? null,
    completedAt: a.completedAt?.toISOString() ?? null,
    cancelReason: vencida ? MOTIVO_APARTADO_LIBERADO : a.cancelReason ?? null,
    // ws1-t3 — vencida ya se pinta CANCELLED arriba: el chip de "apartada" no
    // debe seguir mostrándose para una cita que la agenda ya trata como libre.
    holdExpiresAt: vencida ? null : a.holdExpiresAt?.toISOString() ?? null,
  };
}

export interface AgendaQueryFilter {
  clinicId: string;
  clinicCategory: ClinicCategory;
  doctorIdScope?: string;
  doctorId?: string;
  doctorIds?: string[];
  resourceId?: string;
  resourceIds?: string[];
  statuses?: AppointmentStatus[];
  /**
   * Quién está mirando. Si viene, los pacientes restringidos que este usuario
   * no puede ver salen enmascarados ("Paciente privado"). Omitirlo = sin
   * enmascarado (comportamiento previo) — para callers que ya son admin-only.
   */
  viewer?: VisibilityViewer | null;
  /**
   * ws1-t3 — ¿quien mira tiene el módulo de Ortodoncia (`specialties.orthodontics`)?
   * `false` = no se calcula la insignia «mensualidad vencida» de ortodoncia: es
   * dato del módulo y quien no lo tiene no lo ve. Omitirlo = se calcula (el
   * comportamiento de antes), para los callers que no saben del permiso.
   */
  ortoAcceso?: boolean;
}

/**
 * Ajuste 2 (ws1-t3) — el chip «Anticipo pagado» de la tarjeta. UNA consulta
 * aparte (no toca `appointmentToDTO`, que es síncrona y la usan también las
 * rutas de mutación sin este dato), acotada a las citas del rango que se
 * está pintando. Solo columnas de sql/anticipo-whatsapp.sql (ya aplicado):
 * no depende de que se haya pegado sql/anticipo-desde-panel.sql.
 */
async function citasConDepositoPagado(clinicId: string, appointmentIds: string[]): Promise<Set<string>> {
  if (appointmentIds.length === 0) return new Set();
  try {
    const filas = await prisma.appointmentDeposit.findMany({
      where: { clinicId, appointmentId: { in: appointmentIds }, status: "PAID" },
      select: { appointmentId: true },
    });
    return new Set(filas.map((f) => f.appointmentId).filter((id): id is string => !!id));
  } catch (e) {
    // Tabla sin aplicar (P2021/P2022): la agenda se calla, nunca se rompe.
    const code = (e as { code?: string })?.code;
    if (code === "P2021" || code === "P2022") return new Set();
    throw e;
  }
}

function conDepositoPagado(dtos: AgendaAppointmentDTO[], pagados: Set<string>): AgendaAppointmentDTO[] {
  if (pagados.size === 0) return dtos;
  return dtos.map((d) => (pagados.has(d.id) ? { ...d, depositoPagado: true } : d));
}

/**
 * Ortodoncia — R4 (ws1-t5): qué PACIENTES del rango pintado tienen una
 * mensualidad vencida. UNA sola tanda de consultas por RANGO (nunca por
 * tarjeta), acotada a los `patientId` que ya trajo el rango — no a la
 * clínica entera. Reusa `cobranzaDelCaso` (el contrato puro de Ola 0, sin
 * tocarlo) en memoria por caso.
 *
 * Corta temprano y barato para el caso común (clínica sin Ortodoncia, o sin
 * categoría DENTAL): ni una consulta a `orthodonticTreatmentPlan`.
 * `hasActiveOrthodonticsModule` (no `canAccessModule`) para no encender esto
 * en clínicas dentales en trial que no contrataron el módulo — mismo
 * criterio que Ola 0 (`src/lib/orthodontics/access.ts`).
 */
async function pacientesConMensualidadVencida(
  clinicId: string,
  category: ClinicCategory,
  patientIds: string[],
): Promise<Set<string>> {
  if (category !== "DENTAL" || patientIds.length === 0) return new Set();
  try {
    if (!(await hasActiveOrthodonticsModule(clinicId))) return new Set();

    // Ola 2 (ws1-t1): ya no se filtra por `invoiceId: { not: null }` — un caso
    // en modo PAGO_POR_CONTROL puede deber sin haber abierto la factura de
    // colocación/enganche todavía.
    const planes = await prisma.orthodonticTreatmentPlan.findMany({
      where: { clinicId, deletedAt: null, patientId: { in: patientIds } },
      select: { id: true, patientId: true, invoiceId: true },
    });
    if (planes.length === 0) return new Set();

    const invoiceIds = planes.map((p) => p.invoiceId).filter((id): id is string => !!id);
    const modosPorCaso = await cargarModosDeCobro(clinicId, planes.map((p) => p.id));
    const casosPorControl = planes.filter((p) => normalizarOrthoBillingMode(modosPorCaso.get(p.id) ?? null) === "PAGO_POR_CONTROL").map((p) => p.id);
    const [clinica, condicionesResult, invoices, cargosPorCaso] = await Promise.all([
      prisma.clinic.findUnique({ where: { id: clinicId }, select: { timezone: true } }),
      leerCondicionesDeFacturas(prisma, { clinicId, invoiceIds }),
      prisma.invoice.findMany({
        where: { id: { in: invoiceIds }, clinicId },
        select: { id: true, total: true, dueDate: true, createdAt: true, payments: { select: { amount: true, method: true } } },
      }),
      cargarCargosDeControlPorCasos(clinicId, casosPorControl),
    ]);

    const zonaHoraria = clinica?.timezone || "America/Mexico_City";
    const ahora = new Date();
    const invoiceById = new Map(invoices.map((i) => [i.id, i]));
    const vencidos = new Set<string>();

    for (const plan of planes) {
      const invoice = plan.invoiceId ? invoiceById.get(plan.invoiceId) : undefined;
      const resumen = cobranzaDelCasoUnificada({
        modo: modosPorCaso.get(plan.id) ?? null,
        facturaPrincipal: invoice != null && plan.invoiceId
          ? {
              condiciones: condicionesResult.porFactura.get(plan.invoiceId) ?? null,
              totalFactura: invoice.total,
              cobros: invoice.payments,
              invoiceId: plan.invoiceId,
              vencimiento: vencimientoDeFacturaPrincipal(modosPorCaso.get(plan.id) ?? null, invoice.dueDate, invoice.createdAt, zonaHoraria),
            }
          : null,
        cargosControl: cargosPorCaso.get(plan.id) ?? [],
        saldoAFavorPrevio: 0,
        ahora,
        zonaHoraria,
      });
      if (resumen && resumen.vencidas.length > 0) vencidos.add(plan.patientId);
    }
    return vencidos;
  } catch (e) {
    // Núcleo de ortodoncia sin aplicar (P2021/P2022): la agenda se calla,
    // nunca se rompe — mismo criterio que cobranza-db.ts (Ola 0).
    const code = (e as { code?: string })?.code;
    if (code === "P2021" || code === "P2022") return new Set();
    throw e;
  }
}

function conMensualidadVencida(
  dtos: AgendaAppointmentDTO[],
  vencidos: Set<string>,
): AgendaAppointmentDTO[] {
  if (vencidos.size === 0) return dtos;
  return dtos.map((d) =>
    d.patient.id && vencidos.has(d.patient.id) ? { ...d, ortoMensualidadVencida: true } : d,
  );
}

export async function fetchAppointmentsForDay(
  dateISO: string,
  config: ClinicTimeConfig,
  filter: AgendaQueryFilter,
): Promise<AgendaAppointmentDTO[]> {
  // Día NATURAL de la clínica, no la ventana de horario: con `dayRangeUtc` las
  // citas fuera de 08–20 desaparecían de la agenda y del picker de huecos
  // (hallazgos 40 y 32). Misma ventana que ya usa la SSR de /dashboard/agenda.
  const range = agendaDayFetchRange(dateISO, config);

  const where: Prisma.AppointmentWhereInput = {
    clinicId: filter.clinicId,
    startsAt: { gte: range.startUtc, lt: range.endUtc },
  };

  // doctorIdScope (rol DOCTOR) tiene prioridad. Si no, aceptamos
  // doctorIds (multi-select) o doctorId (single, legacy).
  if (filter.doctorIdScope) {
    where.doctorId = filter.doctorIdScope;
  } else if (filter.doctorIds?.length) {
    where.doctorId = { in: filter.doctorIds };
  } else if (filter.doctorId) {
    where.doctorId = filter.doctorId;
  }
  if (filter.resourceIds?.length)     where.resourceId = { in: filter.resourceIds };
  else if (filter.resourceId)         where.resourceId = filter.resourceId;
  if (filter.statuses?.length)        where.status = { in: filter.statuses };

  const rows = await prisma.appointment.findMany({
    where,
    include: APPT_INCLUDE,
    orderBy: { startsAt: "asc" },
  });

  const dtos = rows.map((r) => appointmentToDTO(r, filter.clinicCategory, filter.viewer));
  const [pagados, vencidos] = await Promise.all([
    citasConDepositoPagado(filter.clinicId, dtos.map((d) => d.id)),
    filter.ortoAcceso === false
      ? Promise.resolve(new Set<string>())
      : pacientesConMensualidadVencida(filter.clinicId, filter.clinicCategory, dtos.map((d) => d.patient.id).filter((id): id is string => !!id)),
  ]);
  return conMensualidadVencida(conDepositoPagado(dtos, pagados), vencidos);
}

export async function fetchAppointmentsForRange(
  fromUtc: Date,
  toUtc: Date,
  filter: AgendaQueryFilter,
): Promise<AgendaAppointmentDTO[]> {
  const where: Prisma.AppointmentWhereInput = {
    clinicId: filter.clinicId,
    startsAt: { gte: fromUtc, lt: toUtc },
  };

  if (filter.doctorIdScope) {
    where.doctorId = filter.doctorIdScope;
  } else if (filter.doctorIds?.length) {
    where.doctorId = { in: filter.doctorIds };
  } else if (filter.doctorId) {
    where.doctorId = filter.doctorId;
  }
  if (filter.resourceIds?.length)     where.resourceId = { in: filter.resourceIds };
  else if (filter.resourceId)         where.resourceId = filter.resourceId;
  if (filter.statuses?.length)        where.status = { in: filter.statuses };

  const rows = await prisma.appointment.findMany({
    where,
    include: APPT_INCLUDE,
    orderBy: { startsAt: "asc" },
  });

  const dtos = rows.map((r) => appointmentToDTO(r, filter.clinicCategory, filter.viewer));
  const [pagados, vencidos] = await Promise.all([
    citasConDepositoPagado(filter.clinicId, dtos.map((d) => d.id)),
    filter.ortoAcceso === false
      ? Promise.resolve(new Set<string>())
      : pacientesConMensualidadVencida(filter.clinicId, filter.clinicCategory, dtos.map((d) => d.patient.id).filter((id): id is string => !!id)),
  ]);
  return conMensualidadVencida(conDepositoPagado(dtos, pagados), vencidos);
}

export async function fetchPendingValidation(
  dateISO: string,
  config: ClinicTimeConfig,
  clinicId: string,
  category: ClinicCategory,
  viewer?: VisibilityViewer | null,
): Promise<AgendaAppointmentDTO[]> {
  // Mismo día natural que fetchAppointmentsForDay: si no, una solicitud a las
  // 07:00 salía en la rejilla pero no en el panel de pendientes de validar.
  const range = agendaDayFetchRange(dateISO, config);

  const rows = await prisma.appointment.findMany({
    where: {
      clinicId,
      requiresValidation: true,
      source: { not: "STAFF" },
      status: "SCHEDULED",
      startsAt: { gte: range.startUtc, lt: range.endUtc },
    },
    include: APPT_INCLUDE,
    orderBy: { startsAt: "asc" },
  });

  return rows.map((r) => appointmentToDTO(r, category, viewer));
}

export async function fetchActiveDoctors(
  clinicId: string,
  category: ClinicCategory,
): Promise<DoctorColumnDTO[]> {
  const users = await prisma.user.findMany({
    where: { clinicId, role: "DOCTOR", isActive: true },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      color: true,
      avatarUrl: true,
      agendaActive: true,
    },
    orderBy: { firstName: "asc" },
  });

  return users.map((u) => ({
    id: u.id,
    displayName: `${u.firstName} ${u.lastName}`.trim(),
    shortName: professionalShortName(u, category),
    color: u.color ?? null,
    avatarUrl: u.avatarUrl ?? null,
    activeInAgenda: u.agendaActive,
  }));
}

export async function fetchResources(
  clinicId: string,
  opts?: { kind?: ResourceKind | ResourceKind[]; includeArchived?: boolean },
): Promise<ResourceDTO[]> {
  const rows = await prisma.resource.findMany({
    where: {
      clinicId,
      ...(opts?.includeArchived ? {} : { isActive: true }),
      ...(opts?.kind
        ? { kind: Array.isArray(opts.kind) ? { in: opts.kind } : opts.kind }
        : {}),
    },
    orderBy: [{ orderIndex: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      kind: true,
      color: true,
      orderIndex: true,
      isActive: true,
    },
  });

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind as ResourceDTO["kind"],
    color: r.color,
    orderIndex: r.orderIndex,
    isActive: r.isActive,
  }));
}

export async function fetchWaitlistCount(clinicId: string): Promise<number> {
  return prisma.waitlistEntry.count({
    where: { clinicId, resolvedAt: null },
  });
}

export interface AdminPeriodKpiRow {
  appointments: number;
  completed: number;
  noShows: number;
  revenueMXN: number;
}

export async function aggregateAdminPeriodKpis(
  period: AdminPeriod,
  clinicId: string,
  timezone: string,
): Promise<AdminPeriodKpiRow> {
  const { from, to } = periodRangeUtc(period, timezone);

  const [appts, completed, noShows, invoicedAgg] = await Promise.all([
    prisma.appointment.count({
      where: {
        clinicId,
        startsAt: { gte: from, lt: to },
        status: { notIn: ["CANCELLED"] },
      },
    }),
    prisma.appointment.count({
      where: {
        clinicId,
        startsAt: { gte: from, lt: to },
        status: "COMPLETED",
      },
    }),
    prisma.appointment.count({
      where: {
        clinicId,
        startsAt: { gte: from, lt: to },
        status: "NO_SHOW",
      },
    }),
    prisma.payment.aggregate({
      where: {
        invoice: { clinicId, status: { notIn: ["CANCELLED"] } },
        paidAt: { gte: from, lt: to },
        method: { not: "refund" },
      },
      _sum: { amount: true },
    }).catch(() => ({ _sum: { amount: null as number | null } })),
  ]);

  return {
    appointments: appts,
    completed,
    noShows,
    revenueMXN: Number(invoicedAgg._sum.amount ?? 0),
  };
}
