// La cita APARTADA que caduca (WS1-T5 · anticipo por WhatsApp).
//
// Cuando la clínica pide anticipo, el bot crea la cita SCHEDULED con
// `holdExpiresAt`: el hueco queda apartado solo hasta ese instante. Si el pago
// no se acredita a tiempo, el hueco se libera SOLO — sin esperar a ningún cron —
// porque todas las consultas que deciden si un hueco está libre descartan la
// cita apartada ya vencida. Esa regla vive aquí y en ningún otro sitio:
//
//   · `apartadoVencido(cita)`      — para las que traen las citas y filtran en memoria.
//   · `sinApartadoVencido(ahora)`  — para las que preguntan a Prisma directamente.
//
// La base cierra la otra mitad: la constraint appt_doctor_no_overlap no admite
// now(), así que el trigger appt_liberar_apartado_vencido (sql/anticipo-whatsapp.sql)
// cancela la cita vencida en el momento en que otra cita pisa su hueco. El cron
// solo marca el anticipo como vencido y le avisa al paciente.
//
// Una cita que la recepción confirma a mano (CONFIRMED) deja de caducar: la
// regla solo mira las SCHEDULED. Así «la confirmé por teléfono» gana al plazo.
//
// PURO: sin Prisma en runtime (solo el tipo), sin React.

import type { Prisma } from "@prisma/client";

/** Motivo con el que queda cancelada una cita cuyo anticipo no llegó a tiempo. */
export const MOTIVO_APARTADO_LIBERADO = "Anticipo no pagado a tiempo: el horario se liberó";

export interface CitaConApartado {
  status: string;
  holdExpiresAt?: Date | string | null;
}

/**
 * ¿Es una cita apartada cuyo plazo ya venció? Esa ya NO ocupa su hueco, aunque
 * nadie la haya cancelado todavía. Mismo criterio que el trigger (`<=`).
 */
export function apartadoVencido(cita: CitaConApartado, ahora: Date = new Date()): boolean {
  if (cita.status !== "SCHEDULED" || !cita.holdExpiresAt) return false;
  const vence =
    cita.holdExpiresAt instanceof Date
      ? cita.holdExpiresAt.getTime()
      : new Date(cita.holdExpiresAt).getTime();
  return Number.isFinite(vence) && vence <= ahora.getTime();
}

/**
 * Filtro de Prisma que deja FUERA las citas apartadas y vencidas. Va siempre
 * dentro de un `AND: [...]` para no pisar un `OR` que ya tenga la consulta.
 *
 * Se escribe con OR y no con `NOT`: `NOT { status, holdExpiresAt <= ahora }`
 * sobre una fila con `holdExpiresAt` NULL da NULL en SQL, y esa fila —la cita
 * normal de siempre— desaparecería de la consulta.
 */
export function sinApartadoVencido(ahora: Date = new Date()): Prisma.AppointmentWhereInput {
  return {
    OR: [
      { holdExpiresAt: null },
      { holdExpiresAt: { gt: ahora } },
      { status: { not: "SCHEDULED" } },
    ],
  };
}
