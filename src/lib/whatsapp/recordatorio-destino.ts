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

import { claveWhatsApp } from "@/lib/whatsapp/bot/booking-parse";

export interface RecordatorioConDestino {
  payload?: unknown;
  patientPhone?: string | null;
  appointment?: { patient?: { phone?: string | null } | null } | null;
}

/** El número (clave completa) al que salió el recordatorio, o "" si no se sabe. */
export function destinoDelRecordatorio(r: RecordatorioConDestino): string {
  const p = r.payload as Record<string, unknown> | null | undefined;
  const guardado = p && typeof p === "object" && typeof p.enviadoA === "string" ? p.enviadoA : "";
  if (guardado) return claveWhatsApp(guardado);
  const telefono = r.appointment?.patient?.phone ?? r.patientPhone ?? "";
  return claveWhatsApp(telefono);
}

/** Los recordatorios que de verdad se le mandaron a `from` (el que escribe). */
export function recordatoriosDeEseNumero<T extends RecordatorioConDestino>(lista: T[], from: string): T[] {
  const clave = claveWhatsApp(from);
  if (!clave) return [];
  return lista.filter((r) => destinoDelRecordatorio(r) === clave);
}
