import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
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

  // getCurrentUser ya hace include: { clinic: true } — leemos la config
  // directo del session sin un segundo query a prisma.clinic.
  const clinic = user.clinic;
  if (!clinic) redirect("/login");

  const timeConfig: ClinicTimeConfig = {
    timezone: clinic.timezone,
    slotMinutes: clinic.defaultSlotMinutes,
    dayStart: clinic.agendaDayStart,
    dayEnd: clinic.agendaDayEnd,
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
      }),
      fetchActiveDoctors(clinic.id, clinic.category),
      fetchResources(clinic.id),
      fetchPendingValidation(dayISO, timeConfig, clinic.id, clinic.category),
      fetchWaitlistCount(clinic.id),
    ]);

  const payload: AgendaDayResponse = {
    range: {
      from: range.fromUtc.toISOString(),
      to: range.toUtc.toISOString(),
    },
    timezone: clinic.timezone,
    slotMinutes: clinic.defaultSlotMinutes,
    dayStart: clinic.agendaDayStart,
    dayEnd: clinic.agendaDayEnd,
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
    />
  );
}
