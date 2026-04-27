import type {
  AgendaAppointmentDTO,
  AppointmentStatus,
  ResourceDTO,
  DoctorColumnDTO,
  ResourceKind,
} from "./types";

export interface ApiError {
  status: number;
  error: string;
  reason?: string;
  issues?: unknown;
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err: ApiError = {
      status: res.status,
      error: body.error ?? "request_failed",
      reason: body.reason,
      issues: body.issues,
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
