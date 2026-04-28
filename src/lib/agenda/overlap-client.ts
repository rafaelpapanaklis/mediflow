import type { AgendaAppointmentDTO, AppointmentStatus } from "./types";

const INACTIVE: AppointmentStatus[] = ["CANCELLED", "NO_SHOW"];

function isActive(s: AppointmentStatus): boolean {
  return !INACTIVE.includes(s);
}

function overlapRange(
  aStart: number, aEnd: number,
  bStart: number, bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export interface OverlapCandidate {
  excludeId?: string;
  doctorId: string;
  resourceId: string | null;
  startsAt: string;
  endsAt: string;
}

export interface OverlapConflict {
  conflictWith: AgendaAppointmentDTO;
  reason: "doctor" | "resource";
}

export function findOverlap(
  candidate: OverlapCandidate,
  allAppointments: AgendaAppointmentDTO[],
): OverlapConflict | null {
  const candStart = new Date(candidate.startsAt).getTime();
  const candEnd = new Date(candidate.endsAt).getTime();
  if (candEnd <= candStart) return null;

  for (const a of allAppointments) {
    if (a.id === candidate.excludeId) continue;
    if (!isActive(a.status)) continue;
    if (a.overrideReason) continue;

    const aStart = new Date(a.startsAt).getTime();
    const aEnd = a.endsAt ? new Date(a.endsAt).getTime() : aStart;
    if (!overlapRange(candStart, candEnd, aStart, aEnd)) continue;

    if (a.doctor?.id === candidate.doctorId) {
      return { conflictWith: a, reason: "doctor" };
    }
    if (
      candidate.resourceId != null &&
      a.resourceId === candidate.resourceId
    ) {
      return { conflictWith: a, reason: "resource" };
    }
  }
  return null;
}

export function findAllOverlaps(
  candidate: OverlapCandidate,
  allAppointments: AgendaAppointmentDTO[],
): OverlapConflict[] {
  const candStart = new Date(candidate.startsAt).getTime();
  const candEnd = new Date(candidate.endsAt).getTime();
  const out: OverlapConflict[] = [];
  if (candEnd <= candStart) return out;

  for (const a of allAppointments) {
    if (a.id === candidate.excludeId) continue;
    if (!isActive(a.status)) continue;
    if (a.overrideReason) continue;

    const aStart = new Date(a.startsAt).getTime();
    const aEnd = a.endsAt ? new Date(a.endsAt).getTime() : aStart;
    if (!overlapRange(candStart, candEnd, aStart, aEnd)) continue;

    if (a.doctor?.id === candidate.doctorId) {
      out.push({ conflictWith: a, reason: "doctor" });
      continue;
    }
    if (
      candidate.resourceId != null &&
      a.resourceId === candidate.resourceId
    ) {
      out.push({ conflictWith: a, reason: "resource" });
    }
  }
  return out;
}

export function buildOccupiedSlotSet(
  appointments: AgendaAppointmentDTO[],
  filter: {
    doctorId?: string;
    resourceId?: string | null;
    excludeId?: string;
  },
  dayStartUtcMs: number,
  slotMinutes: number,
  totalSlots: number,
): Set<number> {
  const occupied = new Set<number>();
  for (const a of appointments) {
    if (a.id === filter.excludeId) continue;
    if (!isActive(a.status)) continue;
    if (a.overrideReason) continue;

    const matchDoctor =
      filter.doctorId == null || a.doctor?.id === filter.doctorId;
    const matchResource =
      filter.resourceId == null || a.resourceId === filter.resourceId;
    if (!matchDoctor || !matchResource) continue;

    const aStartMs = new Date(a.startsAt).getTime();
    const aEndMs = new Date(a.endsAt ?? a.startsAt).getTime();
    const fromSlot = Math.floor((aStartMs - dayStartUtcMs) / 60000 / slotMinutes);
    const toSlot = Math.ceil((aEndMs - dayStartUtcMs) / 60000 / slotMinutes);

    for (let i = Math.max(0, fromSlot); i < Math.min(totalSlots, toSlot); i++) {
      occupied.add(i);
    }
  }
  return occupied;
}
