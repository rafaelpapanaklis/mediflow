import { NextRequest, NextResponse } from "next/server";
import { Prisma, PatientStatus, Gender } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { getAuthContext, buildPatientWhere } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { validateCurpRecord, type CurpStatusValue } from "@/lib/validators/curp";
import { logMutation } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * GET /api/patients
 *
 * Compat: si la request NO incluye `?v=2` ni filtros nuevos, devuelve el
 * array legacy de patients (lo que esperan combobox, modales, etc.).
 *
 * Si llega `?v=2`, devuelve el nuevo shape para la lista de
 * /dashboard/patients:
 *   { patients: PatientRow[], total, stats, hasMore, nextCursor }
 *
 * Query params (v=2):
 *   search       fuzzy match firstName/lastName/email/phone/patientNumber
 *   status       active | inactive | archived
 *   quickFilter  debt | vip | nextAppt | birthdayWeek | noContact6m
 *   ageMin/Max   rango edad en años
 *   gender       MALE,FEMALE,OTHER (multi-comma)
 *   doctorId     primaryDoctor.id
 *   tags         comma-separated, hasSome
 *   hasDebt      true | false
 *   visitFrom/To rango ISO date para última visita
 *   sort         "col:asc" | "col:desc" — col ∈ name|lastVisit|balance|createdAt|nextAppointment|patientNumber
 *   limit        default 30, máx 100
 *   cursor       cuid del último patient de la página previa
 */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const isV2 = sp.get("v") === "2";

  if (!isV2) {
    return legacyHandler(ctx, sp);
  }

  // ─── v2: nuevo shape ───
  return v2Handler(ctx, sp);
}

/* ──────────────────────────────────────────────────────────────────────
 * Handler v2 — nuevo shape para /dashboard/patients lista
 * ────────────────────────────────────────────────────────────────────── */
async function v2Handler(
  ctx: NonNullable<Awaited<ReturnType<typeof getAuthContext>>>,
  sp: URLSearchParams,
) {
  const search = sp.get("search")?.trim() ?? "";
  const statusRaw = sp.get("status");
  const quickFilter = sp.get("quickFilter");
  const ageMin = parseIntOrNull(sp.get("ageMin"));
  const ageMax = parseIntOrNull(sp.get("ageMax"));
  const gendersParam = sp.get("gender") ?? "";
  const genders = gendersParam ? gendersParam.split(",").filter(Boolean) : [];
  const doctorId = sp.get("doctorId");
  const tagsParam = sp.get("tags") ?? "";
  const tags = tagsParam ? tagsParam.split(",").filter(Boolean) : [];
  const hasDebt = sp.get("hasDebt");
  const visitFrom = sp.get("visitFrom");
  const visitTo = sp.get("visitTo");
  const sortParam = sp.get("sort") ?? "createdAt:desc";
  const limit = Math.min(Math.max(parseInt(sp.get("limit") ?? "30", 10) || 30, 1), 100);
  const cursor = sp.get("cursor");

  const status = statusRaw
    ? (statusRaw.toUpperCase() as PatientStatus)
    : null;

  const where: Prisma.PatientWhereInput = buildPatientWhere(ctx, {});
  if (status && ["ACTIVE", "INACTIVE", "ARCHIVED"].includes(status)) {
    where.status = status;
  }
  if (search) {
    where.OR = [
      { firstName: { contains: search, mode: "insensitive" } },
      { lastName: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
      { phone: { contains: search, mode: "insensitive" } },
      { patientNumber: { contains: search, mode: "insensitive" } },
    ];
  }
  if (genders.length > 0) {
    where.gender = { in: genders as Gender[] };
  }
  if (doctorId) {
    where.primaryDoctorId = doctorId;
  }
  if (quickFilter === "vip") {
    where.tags = { hasSome: ["VIP", ...tags] };
  } else if (tags.length > 0) {
    where.tags = { hasSome: tags };
  }

  // Edad → rango fechas dob
  const today = new Date();
  if (ageMin !== null) {
    const maxBirthDate = new Date(today);
    maxBirthDate.setFullYear(today.getFullYear() - ageMin);
    where.dob = { ...((where.dob as Prisma.DateTimeNullableFilter) ?? {}), lte: maxBirthDate };
  }
  if (ageMax !== null) {
    const minBirthDate = new Date(today);
    minBirthDate.setFullYear(today.getFullYear() - ageMax - 1);
    where.dob = { ...((where.dob as Prisma.DateTimeNullableFilter) ?? {}), gte: minBirthDate };
  }

  // Quick filters / sort post-fetch
  let quickPostFetch:
    | "debt"
    | "nextAppt"
    | "birthdayWeek"
    | "noContact6m"
    | null = null;
  if (quickFilter === "debt" || quickFilter === "nextAppt" || quickFilter === "birthdayWeek" || quickFilter === "noContact6m") {
    quickPostFetch = quickFilter;
  }
  const visitFromDate = visitFrom ? new Date(visitFrom) : null;
  const visitToDate = visitTo ? new Date(visitTo) : null;

  const [sortCol, sortDirRaw] = sortParam.split(":");
  const sortDir: "asc" | "desc" = sortDirRaw === "asc" ? "asc" : "desc";
  const sortableInDB = new Set(["name", "createdAt", "patientNumber"]);
  const orderBy: Prisma.PatientOrderByWithRelationInput[] = (() => {
    if (sortCol === "name") return [{ firstName: sortDir }, { lastName: sortDir }];
    if (sortableInDB.has(sortCol)) {
      return [{ [sortCol]: sortDir } as Prisma.PatientOrderByWithRelationInput];
    }
    return [{ createdAt: "desc" }];
  })();

  const useCursor =
    !quickPostFetch &&
    !visitFromDate &&
    !visitToDate &&
    !["balance", "lastVisit", "nextAppointment"].includes(sortCol) &&
    hasDebt !== "false";

  /* ─── 1ª query: lista + relaciones ─── */
  const queryArgs: Prisma.PatientFindManyArgs = {
    where,
    orderBy,
    include: {
      primaryDoctor: {
        select: { id: true, firstName: true, lastName: true, color: true },
      },
      appointments: {
        where: {
          startsAt: { gte: today },
          status: { notIn: ["CANCELLED", "NO_SHOW"] },
        },
        orderBy: { startsAt: "asc" },
        take: 1,
        select: { id: true, startsAt: true, status: true, type: true },
      },
      records: {
        orderBy: { visitDate: "desc" },
        take: 1,
        select: { visitDate: true },
      },
      invoices: {
        where: { balance: { gt: 0 } },
        select: { balance: true },
      },
    },
    take: useCursor ? limit + 1 : 1000,
    ...(useCursor && cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  };

  let rawPatients: Array<Prisma.PatientGetPayload<{
    include: {
      primaryDoctor: { select: { id: true; firstName: true; lastName: true; color: true } };
      appointments: { select: { id: true; startsAt: true; status: true; type: true } };
      records: { select: { visitDate: true } };
      invoices: { select: { balance: true } };
    };
  }>>;
  try {
    rawPatients = (await prisma.patient.findMany(queryArgs)) as typeof rawPatients;
  } catch (err) {
    console.error("[GET /api/patients?v=2]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  /* ─── 2ª query: stats agregadas ─── */
  const baseStatsWhere = buildPatientWhere(ctx, {});
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const prevMonthStart = new Date(monthStart);
  prevMonthStart.setMonth(prevMonthStart.getMonth() - 1);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);
  const weekEnd = new Date(todayStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const [
    totalCount,
    activeCount,
    inactiveCount,
    archivedCount,
    newThisMonth,
    newPrevMonth,
    debtAggregate,
    distinctDebtPatients,
    nextApptToday,
    nextApptWeek,
  ] = await Promise.all([
    prisma.patient.count({ where: baseStatsWhere }),
    prisma.patient.count({ where: { ...baseStatsWhere, status: "ACTIVE" } }),
    prisma.patient.count({ where: { ...baseStatsWhere, status: "INACTIVE" } }),
    prisma.patient.count({ where: { ...baseStatsWhere, status: "ARCHIVED" } }),
    prisma.patient.count({
      where: { ...baseStatsWhere, createdAt: { gte: monthStart } },
    }),
    prisma.patient.count({
      where: {
        ...baseStatsWhere,
        createdAt: { gte: prevMonthStart, lt: monthStart },
      },
    }),
    prisma.invoice.aggregate({
      where: { clinicId: ctx.clinicId, balance: { gt: 0 } },
      _sum: { balance: true },
    }),
    prisma.invoice.findMany({
      where: { clinicId: ctx.clinicId, balance: { gt: 0 } },
      select: { patientId: true },
      distinct: ["patientId"],
    }),
    prisma.appointment.count({
      where: {
        clinicId: ctx.clinicId,
        startsAt: { gte: todayStart, lt: todayEnd },
        status: { notIn: ["CANCELLED", "NO_SHOW"] },
      },
    }),
    prisma.appointment.count({
      where: {
        clinicId: ctx.clinicId,
        startsAt: { gte: todayStart, lt: weekEnd },
        status: { notIn: ["CANCELLED", "NO_SHOW"] },
      },
    }),
  ]);

  const stats = {
    total: totalCount,
    active: activeCount,
    inactive: inactiveCount,
    archived: archivedCount,
    newThisMonth,
    newPrevMonth,
    newPctDelta:
      newPrevMonth > 0
        ? Math.round(((newThisMonth - newPrevMonth) / newPrevMonth) * 100)
        : newThisMonth > 0
        ? 100
        : 0,
    withDebt: distinctDebtPatients.length,
    withDebtAmount: debtAggregate._sum.balance ?? 0,
    nextAppointmentsToday: nextApptToday,
    nextAppointmentsWeek: nextApptWeek,
  };

  /* ─── enriquecer + filtrar/sort post-fetch ─── */
  const SIX_MONTHS_MS = 1000 * 60 * 60 * 24 * 180;
  const enriched = rawPatients.map((p) => {
    const balance = p.invoices.reduce((sum, inv) => sum + (inv.balance ?? 0), 0);
    const nextAppointment = p.appointments[0]
      ? {
          id: p.appointments[0].id,
          startsAt: p.appointments[0].startsAt.toISOString(),
          status: p.appointments[0].status,
          type: p.appointments[0].type,
        }
      : null;
    const lastVisit = p.records[0]?.visitDate
      ? p.records[0].visitDate.toISOString()
      : null;
    const age = p.dob ? calcAge(p.dob) : null;
    const fullName = `${p.firstName} ${p.lastName}`.trim();
    return {
      id: p.id,
      patientNumber: p.patientNumber,
      firstName: p.firstName,
      lastName: p.lastName,
      fullName,
      email: p.email,
      phone: p.phone,
      dob: p.dob ? p.dob.toISOString() : null,
      age,
      gender: p.gender,
      tags: p.tags,
      isVip: p.tags.includes("VIP"),
      status: p.status,
      lastVisit,
      nextAppointment,
      balance,
      assignedDoctor: p.primaryDoctor
        ? {
            id: p.primaryDoctor.id,
            firstName: p.primaryDoctor.firstName,
            lastName: p.primaryDoctor.lastName,
            color: p.primaryDoctor.color,
          }
        : null,
      createdAt: p.createdAt.toISOString(),
    };
  });

  let filtered = enriched;
  if (quickPostFetch === "debt") filtered = filtered.filter((p) => p.balance > 0);
  if (quickPostFetch === "nextAppt") filtered = filtered.filter((p) => p.nextAppointment !== null);
  if (quickPostFetch === "noContact6m") {
    filtered = filtered.filter((p) => {
      if (!p.lastVisit) return true;
      return Date.now() - new Date(p.lastVisit).getTime() > SIX_MONTHS_MS;
    });
  }
  if (quickPostFetch === "birthdayWeek") {
    filtered = filtered.filter((p) => isBirthdayThisWeek(p.dob));
  }
  if (hasDebt === "false") filtered = filtered.filter((p) => p.balance === 0);
  if (visitFromDate || visitToDate) {
    filtered = filtered.filter((p) => {
      if (!p.lastVisit) return false;
      const v = new Date(p.lastVisit);
      if (visitFromDate && v < visitFromDate) return false;
      if (visitToDate && v > visitToDate) return false;
      return true;
    });
  }

  if (sortCol === "balance") {
    filtered.sort((a, b) =>
      sortDir === "asc" ? a.balance - b.balance : b.balance - a.balance,
    );
  } else if (sortCol === "lastVisit") {
    filtered.sort((a, b) => {
      const av = a.lastVisit ? new Date(a.lastVisit).getTime() : 0;
      const bv = b.lastVisit ? new Date(b.lastVisit).getTime() : 0;
      return sortDir === "asc" ? av - bv : bv - av;
    });
  } else if (sortCol === "nextAppointment") {
    filtered.sort((a, b) => {
      const av = a.nextAppointment ? new Date(a.nextAppointment.startsAt).getTime() : Infinity;
      const bv = b.nextAppointment ? new Date(b.nextAppointment.startsAt).getTime() : Infinity;
      return sortDir === "asc" ? av - bv : bv - av;
    });
  }

  let pageSlice: typeof filtered;
  let nextCursor: string | null = null;
  let hasMore = false;
  if (useCursor) {
    const overshoot = filtered.length > limit;
    pageSlice = overshoot ? filtered.slice(0, limit) : filtered;
    nextCursor = overshoot ? pageSlice[pageSlice.length - 1].id : null;
    hasMore = overshoot;
  } else {
    if (cursor) {
      const idx = filtered.findIndex((p) => p.id === cursor);
      if (idx >= 0) filtered = filtered.slice(idx + 1);
    }
    pageSlice = filtered.slice(0, limit);
    hasMore = filtered.length > limit;
    nextCursor = hasMore ? pageSlice[pageSlice.length - 1].id : null;
  }

  return NextResponse.json({
    patients: pageSlice,
    total: stats.total,
    stats,
    hasMore,
    nextCursor,
  });
}

/* ──────────────────────────────────────────────────────────────────────
 * Handler legacy — devuelve array de patients tal cual estaba antes.
 * Lo usan combobox, modales de creación, etc.
 * ────────────────────────────────────────────────────────────────────── */
async function legacyHandler(
  ctx: NonNullable<Awaited<ReturnType<typeof getAuthContext>>>,
  sp: URLSearchParams,
) {
  const search = sp.get("search");
  const status = sp.get("status");
  const limit = Math.min(Math.max(parseInt(sp.get("limit") ?? "100", 10), 1), 500);
  const skip = Math.max(parseInt(sp.get("skip") ?? "0", 10), 0);

  const patients = await prisma.patient.findMany({
    where: buildPatientWhere(ctx, {
      ...(status && { status: status as PatientStatus }),
      ...(search && {
        OR: [
          { firstName: { contains: search, mode: "insensitive" as const } },
          { lastName: { contains: search, mode: "insensitive" as const } },
          { email: { contains: search, mode: "insensitive" as const } },
          { phone: { contains: search, mode: "insensitive" as const } },
          { patientNumber: { contains: search, mode: "insensitive" as const } },
        ],
      }),
    }),
    include: {
      primaryDoctor: { select: { id: true, firstName: true, lastName: true, color: true } },
      appointments: { orderBy: { startsAt: "desc" }, take: 1, select: { startsAt: true, status: true } },
      _count: { select: { appointments: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    skip,
  });

  return NextResponse.json(patients);
}

/* ─── helpers ─── */

function parseIntOrNull(v: string | null): number | null {
  if (!v) return null;
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}
function calcAge(dob: Date): number {
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}
function isBirthdayThisWeek(dobIso: string | null): boolean {
  if (!dobIso) return false;
  const dob = new Date(dobIso);
  const now = new Date();
  const thisYearBday = new Date(now.getFullYear(), dob.getMonth(), dob.getDate());
  const diffDays = (thisYearBday.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  return diffDays >= 0 && diffDays <= 7;
}

/* ─── POST sin cambios estructurales (acepta tags) ─── */
export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const count = await prisma.patient.count({ where: { clinicId: ctx.clinicId } });
  const patientNumber = `P${String(count + 1).padStart(4, "0")}`;

  // NOM-024 identificación: validar coherencia curp/curpStatus/passportNo.
  const curpStatusRaw = body.curpStatus ?? "PENDING";
  const curpStatus: CurpStatusValue =
    curpStatusRaw === "COMPLETE" || curpStatusRaw === "FOREIGN" ? curpStatusRaw : "PENDING";
  const curpCheck = validateCurpRecord({ curp: body.curp, curpStatus, passportNo: body.passportNo });
  if (curpCheck.ok === false) {
    return NextResponse.json({ error: curpCheck.error }, { status: 400 });
  }

  const patient = await prisma.patient.create({
    data: {
      clinicId: ctx.clinicId,
      patientNumber,
      firstName: body.firstName,
      lastName: body.lastName,
      email: body.email ?? null,
      phone: body.phone ?? null,
      dob: body.dob ? new Date(body.dob) : null,
      gender: body.gender ?? "OTHER",
      bloodType: body.bloodType ?? null,
      address: body.address ?? null,
      notes: body.notes ?? null,
      allergies: body.allergies ?? [],
      chronicConditions: body.chronicConditions ?? [],
      tags: body.tags ?? [],
      isChild: body.isChild ?? false,
      primaryDoctorId: body.primaryDoctorId ?? (ctx.isDoctor ? ctx.userId : null),
      curp:        body.curp ? String(body.curp).toUpperCase().trim() : null,
      curpStatus,
      passportNo:  body.passportNo ? String(body.passportNo).trim() : null,
      familyHistory:                  body.familyHistory ?? null,
      personalNonPathologicalHistory: body.personalNonPathologicalHistory ?? null,
    },
  });

  await logMutation({
    req,
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    entityType: "patient",
    entityId: patient.id,
    action: "create",
    after: { firstName: patient.firstName, lastName: patient.lastName, patientNumber: patient.patientNumber },
  });

  revalidatePath("/dashboard/patients");
  revalidatePath("/dashboard/clinical");
  return NextResponse.json(patient, { status: 201 });
}
