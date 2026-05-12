import "server-only";
import { prisma } from "@/lib/prisma";
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
  dayRangeUtc,
  periodRangeUtc,
  type ClinicTimeConfig,
  type AdminPeriod,
} from "./time-utils";

const APPT_INCLUDE = {
  patient: { select: { id: true, firstName: true, lastName: true } },
  doctor:  { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.AppointmentInclude;

type ApptWithIncludes = Prisma.AppointmentGetPayload<{
  include: typeof APPT_INCLUDE;
}>;

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

export function appointmentToDTO(
  a: ApptWithIncludes,
  category: ClinicCategory,
): AgendaAppointmentDTO {
  return {
    id: a.id,
    startsAt: a.startsAt.toISOString(),
    endsAt: a.endsAt.toISOString(),
    status: a.status as AppointmentStatus,
    patient: {
      id: a.patient.id,
      name: patientName(a.patient),
    },
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
}

export async function fetchAppointmentsForDay(
  dateISO: string,
  config: ClinicTimeConfig,
  filter: AgendaQueryFilter,
): Promise<AgendaAppointmentDTO[]> {
  const range = dayRangeUtc(dateISO, config);

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

  return rows.map((r) => appointmentToDTO(r, filter.clinicCategory));
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

  return rows.map((r) => appointmentToDTO(r, filter.clinicCategory));
}

export async function fetchPendingValidation(
  dateISO: string,
  config: ClinicTimeConfig,
  clinicId: string,
  category: ClinicCategory,
): Promise<AgendaAppointmentDTO[]> {
  const range = dayRangeUtc(dateISO, config);

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

  return rows.map((r) => appointmentToDTO(r, category));
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
    prisma.invoice
      .aggregate({
        where: {
          clinicId,
          createdAt: { gte: from, lt: to },
          status: { notIn: ["CANCELLED"] },
        },
        _sum: { paid: true },
      })
      .catch(() => ({ _sum: { paid: null as number | null } })),
  ]);

  return {
    appointments: appts,
    completed,
    noShows,
    revenueMXN: Number(invoicedAgg._sum.paid ?? 0),
  };
}
