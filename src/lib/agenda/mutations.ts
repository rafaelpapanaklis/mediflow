import type {
  AgendaAppointmentDTO,
  AppointmentStatus,
  ResourceDTO,
  DoctorColumnDTO,
  ResourceKind,
  WaitlistEntryDTO,
  WaitlistPriority,
} from "./types";

export interface ApiError {
  status: number;
  error: string;
  reason?: string;
  issues?: unknown;
  count?: number;
  sample?: string[];
  conflictingAppointment?: {
    id: string;
    patientName?: string | null;
    doctorId: string;
    resourceId: string | null;
    startsAt: string;
    endsAt: string;
    status: string;
  };
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err: ApiError = {
      status: res.status,
      error: body.error ?? "request_failed",
      reason: body.reason,
      issues: body.issues,
      count: body.count,
      sample: body.sample,
      conflictingAppointment: body.conflictingAppointment,
    };
    throw err;
  }
  return (await res.json()) as T;
}

/* ─────── Appointment status ─────── */

export async function patchAppointmentStatus(
  id: string,
  status: AppointmentStatus,
): Promise<AgendaAppointmentDTO> {
  const res = await fetch(`/api/appointments/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  const body = await jsonOrThrow<{ appointment: AgendaAppointmentDTO }>(res);
  return body.appointment;
}

/* ─────── Appointment batch validate ─────── */

export interface BatchValidateResult {
  processed: number;
  failed: Array<{ id: string; error: string }>;
}

export async function batchValidateAppointments(
  action: "confirm" | "reject",
  appointmentIds: string[],
  rejectReason?: string,
): Promise<BatchValidateResult> {
  const res = await fetch(`/api/appointments/batch-validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action,
      appointmentIds,
      rejectReason,
      notifyPatients: false,
    }),
  });
  return jsonOrThrow<BatchValidateResult>(res);
}

/* ─────── Appointment reschedule (drag-to-reschedule M6) ─────── */

export interface RescheduleAppointmentInput {
  startsAt?: string;
  endsAt?: string;
  doctorId?: string;
  resourceId?: string | null;
  reason?: string | null;
  overrideReason?: string | null;
}

export async function rescheduleAppointment(
  id: string,
  input: RescheduleAppointmentInput,
): Promise<AgendaAppointmentDTO> {
  const res = await fetch(`/api/appointments/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await jsonOrThrow<{ appointment: AgendaAppointmentDTO }>(res);
  return body.appointment;
}

/* ─────── Resources CRUD ─────── */

export interface CreateResourceInput {
  name: string;
  kind: ResourceKind;
  color: string | null;
}

export async function createResource(
  input: CreateResourceInput,
): Promise<ResourceDTO> {
  const res = await fetch(`/api/agenda/resources`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await jsonOrThrow<{ resource: Omit<ResourceDTO, "orderIndex"> & { orderIndex: number } }>(res);
  return body.resource;
}

export interface UpdateResourceInput {
  name?: string;
  kind?: ResourceKind;
  color?: string | null;
  isActive?: boolean;
}

export async function updateResource(
  id: string,
  input: UpdateResourceInput,
): Promise<ResourceDTO> {
  const res = await fetch(`/api/agenda/resources/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await jsonOrThrow<{ resource: ResourceDTO }>(res);
  return body.resource;
}

export async function deleteResource(id: string): Promise<void> {
  const res = await fetch(`/api/agenda/resources/${id}`, { method: "DELETE" });
  await jsonOrThrow<{ ok: true }>(res);
}

export async function reorderResources(orderedIds: string[]): Promise<void> {
  const res = await fetch(`/api/agenda/resources/reorder`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderedIds }),
  });
  await jsonOrThrow<{ ok: true }>(res);
}

/* ─────── Doctor patch (sólo color y activeInAgenda) ─────── */

export interface UpdateDoctorInput {
  color?: string;
  activeInAgenda?: boolean;
}

interface DoctorPatchResponse {
  doctor: {
    id: string;
    color: string;
    agendaActive: boolean;
  };
}

export async function updateDoctor(
  id: string,
  input: UpdateDoctorInput,
): Promise<DoctorPatchResponse["doctor"]> {
  const res = await fetch(`/api/agenda/doctors/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await jsonOrThrow<DoctorPatchResponse>(res);
  return body.doctor;
}

/* ─────── Waitlist ─────── */

export async function fetchWaitlist(): Promise<WaitlistEntryDTO[]> {
  const res = await fetch(`/api/waitlist?status=active`, { cache: "no-store" });
  const body = await jsonOrThrow<{ entries: WaitlistEntryDTO[] }>(res);
  return body.entries;
}

export interface UpdateWaitlistInput {
  status?: "PENDING" | "FULFILLED" | "DISCARDED";
  appointmentId?: string;
  priority?: WaitlistPriority;
  reason?: string | null;
  notes?: string | null;
  preferredWindow?: string | null;
}

export async function updateWaitlist(
  id: string,
  input: UpdateWaitlistInput,
): Promise<void> {
  const res = await fetch(`/api/waitlist/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  await jsonOrThrow<{ entry: unknown }>(res);
}

export interface CreateWaitlistEntryInput {
  patientId: string;
  reason?: string | null;
  priority?: WaitlistPriority;
  preferredDoctorId?: string;
  preferredWindow?: string;
  notes?: string;
}

export async function createWaitlistEntry(
  input: CreateWaitlistEntryInput,
): Promise<WaitlistEntryDTO> {
  const res = await fetch(`/api/waitlist`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await jsonOrThrow<{ entry: WaitlistEntryDTO }>(res);
  return body.entry;
}
