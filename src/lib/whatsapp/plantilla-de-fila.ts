// Qué plantilla —y con qué datos— le toca a cada fila de la cola de WhatsApp
// (WhatsAppReminder) cuando la ventana de 24 h está cerrada. ws1-t4 (auditoría
// BEVADENT, F4/M7).
//
// EL FALLO QUE CIERRA: la cola mandaba TODO como `reminder` y, si la fila colgaba
// de una cita, le armaba los datos de dc_recordatorio_cita. El seguimiento
// post-cita (FOLLOWUP) lleva appointmentId, así que con la plantilla de
// recordatorio aprobada el paciente habría recibido «te recordamos tu cita… el
// [fecha ya pasada]». Ahora cada tipo de fila usa SU plantilla:
//   · FOLLOWUP → `followup` (dc_seguimiento_cita): paciente, clínica, fecha de la visita;
//   · BIRTHDAY → `birthday`, RECALL → `recall`: paciente y clínica. Sus plantillas
//     (MARKETING) están apagadas por bandera en templates-catalog.ts, así que hoy
//     fuera de ventana siguen bloqueándose igual que antes;
//   · todo lo demás → `reminder`, como siempre (con datos solo si cuelga de una cita).
//
// El tipo elegido también es con el que queda registrado el envío en el Inbox.
//
// PURO: sin Prisma ni red.

import type { WhatsAppSendKind } from "./system-message";

export interface FilaParaPlantilla {
  /** `WhatsAppReminder.type`: APPT_AUTO, FOLLOWUP, BIRTHDAY, RECALL… */
  type: string | null | undefined;
  /** Inicio de la cita de la que cuelga la fila, si cuelga de una. */
  startsAt: Date | null | undefined;
  doctor: { firstName: string; lastName: string } | null | undefined;
  /** Nombre del paciente ya resuelto ("" si no se encontró). */
  firstName: string;
  clinicName: string;
  timezone: string;
}

export interface PlantillaDeFila {
  kind: WhatsAppSendKind;
  /** Valores de {{1}}…{{n}} EN ORDEN, o null si no hay de dónde sacarlos. */
  params: string[] | null;
}

function fechaLarga(d: Date, timezone: string): string {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(d);
}

export function plantillaDeFila(f: FilaParaPlantilla): PlantillaDeFila {
  // Meta rechaza las variables vacías: sin nombre se manda una fórmula genérica.
  const paciente = f.firstName || "paciente";
  const tipo = (f.type ?? "").toUpperCase();

  if (tipo === "FOLLOWUP") {
    return {
      kind: "followup",
      params: f.startsAt ? [paciente, f.clinicName, fechaLarga(f.startsAt, f.timezone)] : null,
    };
  }
  if (tipo === "BIRTHDAY") return { kind: "birthday", params: [paciente, f.clinicName] };
  if (tipo === "RECALL") return { kind: "recall", params: [paciente, f.clinicName] };

  // Recordatorio: {{1}} paciente, {{2}} clínica, {{3}} fecha, {{4}} hora, {{5}} doctor.
  // Solo se puede armar si la fila cuelga de una cita.
  if (!f.startsAt) return { kind: "reminder", params: null };
  return {
    kind: "reminder",
    params: [
      paciente,
      f.clinicName,
      fechaLarga(f.startsAt, f.timezone),
      new Intl.DateTimeFormat("es-MX", {
        timeZone: f.timezone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(f.startsAt),
      f.doctor ? `Dr/a. ${f.doctor.firstName} ${f.doctor.lastName}`.trim() : "tu doctor(a)",
    ],
  };
}
