import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { requirePermissionOrRedirect } from "@/lib/auth/require-permission";
import { hasPermission } from "@/lib/auth/permissions";
import {
  fetchActiveDoctors,
  fetchAppointmentsForRange,
  fetchPendingValidation,
  fetchResources,
  fetchWaitlistCount,
} from "@/lib/agenda/server";
import {
  isValidDateISO,
  todayInTz,
  type ClinicTimeConfig,
} from "@/lib/agenda/time-utils";
import {
  effectiveAgendaWindow,
  paintedAgendaWindow,
  scheduleDayOfISO,
} from "@/lib/agenda/clinic-hours";
import { prisma } from "@/lib/prisma";
import { viewRangeUtc } from "@/lib/agenda/date-ranges";
import type { AgendaDayResponse } from "@/lib/agenda/types";
import { AgendaPageClient } from "./agenda-page-client";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams?: { date?: string; highlight?: string; doctorId?: string };
}

export default async function AgendaPage({ searchParams }: PageProps) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Gate de página (P1-3/P2): igual que el resto de pantallas sensibles.
  requirePermissionOrRedirect(user, "agenda.view");

  // Booleans de permiso para que la UI esconda/deshabilite lo que la API
  // rechaza (crear / editar-mover / cancelar citas).
  const agendaPermissions = {
    canCreate: hasPermission(user, "agenda.create"),
    canEdit: hasPermission(user, "agenda.edit"),
    canCancel: hasPermission(user, "agenda.delete"),
  };

  // getCurrentUser ya hace include: { clinic: true } — leemos la config
  // directo del session sin un segundo query a prisma.clinic.
  const clinic = user.clinic;
  if (!clinic) redirect("/login");

  // P1-13: la ventana EFECTIVA (unión con el 8–20 histórico) — la MISMA que
  // /api/appointments y /api/agenda/range. Es la que lee y la que valida;
  // ensancharla nunca esconde nada. Lo que el eje DIBUJA sale más abajo de
  // paintedAgendaWindow, que sí se ciñe al horario real del día.
  const schedules = await prisma.clinicSchedule.findMany({
    where: { clinicId: clinic.id },
    select: { dayOfWeek: true, enabled: true, openTime: true, closeTime: true },
    orderBy: { dayOfWeek: "asc" },
  });
  const window = effectiveAgendaWindow(clinic, schedules);

  const timeConfig: ClinicTimeConfig = {
    timezone: clinic.timezone,
    slotMinutes: clinic.defaultSlotMinutes,
    dayStart: window.dayStart,
    dayEnd: window.dayEnd,
  };

  const dateParam = searchParams?.date;
  const dayISO = dateParam && isValidDateISO(dateParam)
    ? dateParam
    : todayInTz(clinic.timezone);

  const doctorIdScope = user.role === "DOCTOR" ? user.id : undefined;

  // Día calendario completo en tz `[00:00, 24:00)` — misma semántica
  // que /api/agenda/range. Antes la SSR usaba `[dayStart, dayEnd)` y el
  // refetch del cliente usaba 24h desplazadas → contadores y render se
  // desincronizaban (Bug B). Ahora ambos comparten el mismo helper.
  const range = viewRangeUtc("day", dayISO, clinic.timezone);

  const [appointments, doctors, resources, pendingValidation, waitlistCount] =
    await Promise.all([
      fetchAppointmentsForRange(range.fromUtc, range.toUtc, {
        clinicId: clinic.id,
        clinicCategory: clinic.category,
        doctorIdScope,
        // Visibilidad por paciente: esta SSR pinta la agenda del día, así que
        // sin viewer los pacientes restringidos saldrían con nombre completo
        // hasta el primer refetch del cliente.
        viewer: { userId: user.id, role: user.role, clinicId: clinic.id },
      }),
      fetchActiveDoctors(clinic.id, clinic.category),
      fetchResources(clinic.id),
      fetchPendingValidation(dayISO, timeConfig, clinic.id, clinic.category, {
        userId: user.id,
        role: user.role,
        clinicId: clinic.id,
      }),
      fetchWaitlistCount(clinic.id),
    ]);

  // Lo que el eje PINTA de arranque: el horario real de ESTE día, ensanchado
  // para cubrir sus citas fuera de horario. La ventana efectiva de arriba
  // sigue siendo la que leyó los datos y la que valida; esto es solo el
  // dibujo, y va en el payload para que la SSR ya pinte la altura correcta en
  // vez de encogerse en el primer render del cliente (que lo recalcula igual
  // al cambiar de día, de vista o al llegar citas nuevas).
  const painted = paintedAgendaWindow({
    fallback: window,
    schedules,
    visibleDays: [scheduleDayOfISO(dayISO, clinic.timezone)],
    appointments,
    onlyDayISO: dayISO,
    timezone: clinic.timezone,
  });

  const payload: AgendaDayResponse = {
    range: {
      from: range.fromUtc.toISOString(),
      to: range.toUtc.toISOString(),
    },
    timezone: clinic.timezone,
    slotMinutes: clinic.defaultSlotMinutes,
    dayStart: painted.dayStart,
    dayEnd: painted.dayEnd,
    // Solo enabled + horas por día (el horario de atención, público en la
    // página de reserva de la clínica): con esto el cliente recalcula el eje
    // al navegar sin volver al servidor. NUNCA la fila Clinic entera.
    schedules,
    appointments,
    doctors,
    resources,
    pendingValidation,
    waitlistCount,
  };

  return (
    <AgendaPageClient
      initialPayload={payload}
      initialDayISO={dayISO}
      clinicCategory={clinic.category}
      clinicName={clinic.name}
      highlightId={searchParams?.highlight ?? null}
      // Solo el escalar del régimen fiscal (la fila Clinic NUNCA se serializa al
      // navegador): el cobro inline del panel de detalle timbra con él ya
      // resuelto, sin que un fetch en vuelo pueda decidir el régimen fiscal.
      clinicTaxMode={clinic.cfdiTaxMode ?? "exempt"}
      permissions={agendaPermissions}
    />
  );
}
