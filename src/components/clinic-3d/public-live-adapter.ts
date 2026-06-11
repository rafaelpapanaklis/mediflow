// ─────────────────────────────────────────────────────────────────────────────
// MODO PÚBLICO — Adapter del payload de /api/live/[slug] al contrato del mundo 3D.
//
// La vista pública del visor 3D (/live/[slug]/3d) NO consume /api/clinic-layout/
// 3d-state (ese es el panel PRIVADO del dueño: con auth, con patientId, con
// canal multijugador). Consume el MISMO endpoint que la vista 2D pública:
// /api/live/[slug], cuyo payload YA viene enmascarado server-side (nombres de
// paciente según liveModeShowPatientNames) y que NUNCA trae patientId ni notes.
// Este módulo traduce ese payload a Chair3DState[] — el shape que consume la
// capa viva del visor (live-layer).
//
// PRIVACIDAD (línea dura): patientId SIEMPRE null aquí. Sin patientId, la capa
// viva no marca avatares como interactuables (getInteractables() = []) → en
// público es IMPOSIBLE abrir un expediente, aun si el visor intentara raycastear.
// Los nombres salen TAL CUAL del API (ya enmascarados o completos según lo que
// la clínica eligió) — este adapter NO decide privacidad, solo la respeta.
//
// Sin three, sin "use client": lógica pura y reutilizable. El visor JAMÁS debe
// crashear por un payload raro → saneamos cada campo defensivamente.
// ─────────────────────────────────────────────────────────────────────────────

import { getChairStatus, getChairAppointment } from "@/lib/floor-plan/live-mode";
import { sanitizeElements } from "@/lib/floor-plan/sanitize";
import { isChairType, type Chair3DState } from "./world-types";
import type { LiveAppointment, LiveApptStatus } from "@/lib/floor-plan/element-types";

/** Forma cruda (parcial) del payload público que nos interesa. Todo opcional. */
interface PublicLiveRaw {
  layout?: { elements?: unknown } | null;
  chairs?: unknown;
  appointments?: unknown;
}

const str = (v: unknown, fallback = ""): string =>
  typeof v === "string" ? v : fallback;

/**
 * Traduce el JSON de /api/live/[slug] a Chair3DState[] (uno por sillón). El
 * estado vivo (libre / proximo / ocupado) se calcula con los MISMOS helpers
 * que el panel del dueño (getChairStatus / getChairAppointment), pero a partir
 * de las citas YA enmascaradas del API público — y sin patientId.
 */
export function adaptPublicLiveChairs(raw: unknown): Chair3DState[] {
  const r: PublicLiveRaw =
    raw && typeof raw === "object" ? (raw as PublicLiveRaw) : {};

  // Sillones del API: [{ id, name, color }]. Descartamos los malformados.
  const chairsRaw: Array<Record<string, unknown>> = Array.isArray(r.chairs)
    ? (r.chairs.filter(
        (c) =>
          !!c &&
          typeof c === "object" &&
          typeof (c as { id?: unknown }).id === "string",
      ) as Array<Record<string, unknown>>)
    : [];
  if (chairsRaw.length === 0) return [];

  // Elementos del layout → mapa resourceId → elementId del sillón colocado.
  // Mismo patrón que /api/clinic-layout/3d-state. sanitizeElements garantiza un
  // array bien formado aun si el layout es legacy/no-array. Recorremos con
  // .forEach (NUNCA for...of sobre Map/Set: target TS sin ES2015).
  const elements = sanitizeElements(r.layout?.elements);
  const elementByResource = new Map<string, number>();
  elements.forEach((el) => {
    if (el.resourceId && isChairType(el.type) && !elementByResource.has(el.resourceId)) {
      elementByResource.set(el.resourceId, el.id);
    }
  });

  // Citas → LiveAppointment[] para los helpers de estado. NUNCA patientId.
  const appointmentsRaw: Array<Record<string, unknown>> = Array.isArray(r.appointments)
    ? (r.appointments.filter(
        (a) => !!a && typeof a === "object",
      ) as Array<Record<string, unknown>>)
    : [];

  const liveAppts: LiveAppointment[] = [];
  appointmentsRaw.forEach((a) => {
    const resourceId = typeof a.resourceId === "string" ? a.resourceId : null;
    if (!resourceId) return;
    const start = new Date(str(a.start));
    const end = new Date(str(a.end));
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;
    liveAppts.push({
      id: str(a.id),
      resourceId,
      // patient YA viene enmascarado (o completo) por el server según la
      // decisión de la clínica. Aquí NO lo tocamos.
      patient: str(a.patient, "Paciente"),
      doctor: str(a.doctor, "—"),
      treatment: str(a.treatment, "Consulta"),
      start,
      end,
      status: typeof a.status === "string" ? (a.status as LiveApptStatus) : undefined,
      // patientId / patientFull / notes: AUSENTES a propósito (privacidad).
    });
  });

  const now = new Date();
  return chairsRaw.map((c): Chair3DState => {
    const resourceId = c.id as string;
    const status = getChairStatus(resourceId, now, liveAppts);
    const active = getChairAppointment(resourceId, now, liveAppts);
    const occupied = status === "ocupado";
    return {
      elementId: elementByResource.get(resourceId) ?? null,
      resourceId,
      name: str(c.name, "Sillón"),
      color: typeof c.color === "string" ? c.color : null,
      status,
      patientName: occupied ? active?.patient ?? null : null,
      doctorName: occupied ? active?.doctor ?? null : null,
      // PRIVACIDAD: patientId SIEMPRE null en público (el API ni lo manda).
      // Sin él, getInteractables() de la capa viva ignora estos avatares y el
      // raycast de interacción nunca encuentra un expediente que abrir.
      patientId: null,
      appointmentEndsAt: occupied && active ? active.end.toISOString() : null,
    };
  });
}
