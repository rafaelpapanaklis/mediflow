import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  fetchActiveDoctors,
  fetchAppointmentsForDay,
  fetchPendingValidation,
  fetchResources,
  fetchWaitlistCount,
} from "@/lib/agenda/server";
import {
  dayRangeUtc,
  isValidDateISO,
  todayInTz,
  type ClinicTimeConfig,
} from "@/lib/agenda/time-utils";
import type { AgendaDayResponse } from "@/lib/agenda/types";
import { AgendaPageClient } from "./agenda-page-client";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams?: { date?: string; highlight?: string; doctorId?: string };
}

export default async function AgendaPage({ searchParams }: PageProps) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

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
    },
  });
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

  const range = dayRangeUtc(dayISO, timeConfig);

  const [appointments, doctors, resources, pendingValidation, waitlistCount] =
    await Promise.all([
      fetchAppointmentsForDay(dayISO, timeConfig, {
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
      from: range.startUtc.toISOString(),
      to: range.endUtc.toISOString(),
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
