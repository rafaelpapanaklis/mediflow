// Seguridad (auditoría «cloudflare», nº9): a qué número salió un recordatorio
// de WhatsApp, para que solo ESE número pueda contestarlo (confirmar, cancelar,
// pedir reagendar).
//
// El worker guarda el destino en `payload.enviadoA` (número completo con código
// de país, ver `claveWhatsApp`) al enviar. Los recordatorios que salieron antes
// de este cambio no lo tienen: para ellos vale el teléfono del paciente de la
// cita y, si no hay cita, `patientPhone` — que es a donde los mandó el worker.
//
// PURO: sin Prisma. Lo usa el webhook.

import { claveRemitente, claveWhatsApp } from "@/lib/whatsapp/bot/booking-parse";

export interface RecordatorioConDestino {
  payload?: unknown;
  patientPhone?: string | null;
  appointment?: { patient?: { phone?: string | null } | null } | null;
}

/** El número (clave completa) al que salió el recordatorio, o "" si no se sabe. */
export function destinoDelRecordatorio(r: RecordatorioConDestino): string {
  const p = r.payload as Record<string, unknown> | null | undefined;
  const guardado = p && typeof p === "object" && typeof p.enviadoA === "string" ? p.enviadoA : "";
  // `enviadoA` ya es una clave completa (E.164 sin «+»): no se vuelve a pasar
  // por `claveWhatsApp`, que le pondría un 52 a una clave extranjera de 10 dígitos.
  if (guardado) return claveRemitente(guardado);
  const telefono = r.appointment?.patient?.phone ?? r.patientPhone ?? "";
  return claveWhatsApp(telefono);
}

/**
 * Los recordatorios que de verdad se le mandaron a `from` (el wa_id de quien
 * escribe). `from` viene de Meta, completo: `claveRemitente`, nunca rellenado con
 * 52 (el danés «4521234567» no contesta el recordatorio de «452 123 4567»).
 */
export function recordatoriosDeEseNumero<T extends RecordatorioConDestino>(lista: T[], from: string): T[] {
  const clave = claveRemitente(from);
  if (!clave) return [];
  return lista.filter((r) => destinoDelRecordatorio(r) === clave);
}
