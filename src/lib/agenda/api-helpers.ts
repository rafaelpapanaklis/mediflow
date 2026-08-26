import "server-only";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Role, ClinicCategory } from "@prisma/client";
import type { ClinicTimeConfig } from "./time-utils";
import { effectiveAgendaWindow, type ScheduleDay } from "./clinic-hours";

export interface ClinicSession {
  user: {
    id: string;
    role: Role;
    clinicId: string;
    displayName: string;
    // Override granular del set default del role. Necesario para que los
    // endpoints de agenda puedan llamar denyIfMissingPermission(session.user, ...)
    // con el set efectivo correcto. Vacío = aplicar default del role.
    permissionsOverride: string[];
  };
  clinic: {
    id: string;
    name: string;
    category: ClinicCategory;
    timezone: string;
    defaultSlotMinutes: number;
    agendaDayStart: number;
    agendaDayEnd: number;
    waConnected: boolean;
    trialEndsAt: Date | null;
    // Junto con trialEndsAt alimenta isInTrial/isPlanExpired (plan-status): la
    // fecha sola no dice si la clínica paga o está en trial.
    subscriptionStatus: string | null;
    // Horario configurado en Ajustes (P1-13): lo usan scheduleViolation (aviso
    // de fuera-de-horario/día cerrado) y effectiveAgendaWindow (eje del panel).
    schedules: ScheduleDay[];
  };
  // OJO: dayStart/dayEnd de timeConfig ya son la ventana EFECTIVA
  // (unión agendaDayStart/End ∪ ClinicSchedule) — ver clinic-hours.ts.
  timeConfig: ClinicTimeConfig;
}

export async function loadClinicSession(): Promise<ClinicSession | NextResponse> {
  let user;
  try {
    user = await getCurrentUser();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const clinic = await prisma.clinic.findUnique({
    where: { id: user.clinicId },
    select: {
      id: true,
      name: true,
      category: true,
      timezone: true,
      defaultSlotMinutes: true,
      agendaDayStart: true,
      agendaDayEnd: true,
      waConnected: true,
      trialEndsAt: true,
      subscriptionStatus: true,
      schedules: {
        select: { dayOfWeek: true, enabled: true, openTime: true, closeTime: true },
        orderBy: { dayOfWeek: "asc" },
      },
    },
  });

  if (!clinic) {
    return NextResponse.json({ error: "clinic_not_found" }, { status: 404 });
  }

  const displayName =
    `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() ||
    user.email ||
    "";

  // P1-13: el eje/validación de la agenda respeta el horario de Ajustes.
  // Unión (nunca más angosto que el 8–20 histórico) — ver clinic-hours.ts.
  const window = effectiveAgendaWindow(clinic, clinic.schedules);

  return {
    user: {
      id: user.id,
      role: user.role,
      clinicId: user.clinicId,
      displayName,
      permissionsOverride: user.permissionsOverride ?? [],
    },
    clinic,
    timeConfig: {
      timezone: clinic.timezone,
      slotMinutes: clinic.defaultSlotMinutes,
      dayStart: window.dayStart,
      dayEnd: window.dayEnd,
    },
  };
}

export function requireRole(
  session: ClinicSession,
  allowed: Role[],
): NextResponse | null {
  if (!allowed.includes(session.user.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return null;
}

/**
 * Detecta el error de overlap del DB constraint EXCLUDE.
 * Postgres retorna SQLSTATE 23P01.
 */
export function isOverlapError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: string; meta?: { code?: string } };
  if (e.code === "P2010") return e.meta?.code === "23P01";
  if (e.code === "23P01") return true;
  return false;
}
