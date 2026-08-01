import { prisma } from "@/lib/prisma";
import { nextPatientNumber, withPatientNumberRetry } from "@/lib/patients/next-patient-number";
import { normalizeLast10 } from "./booking-parse";

// Re-exporta los parsers/formateadores puros (parseDateInput, isCancelWord,
// isAffirmative, etc.) para los call sites previos que los importaban de aquí
// (webhook de WhatsApp, booking). La lógica pura vive en ./booking-parse.
export * from "./booking-parse";

/**
 * Helper IMPURO del flujo de agenda del bot (T4): busca un paciente por teléfono
 * (últimos 10 dígitos, como el webhook) dentro de la clínica; si no existe lo
 * crea con source=WHATSAPP. patientNumber se genera de forma concurrency-safe
 * con row-lock de la clínica (idéntico a /api/public/book). Scopeado por
 * clinicId. Devuelve { id } o null si falla.
 */
export async function findOrCreateWhatsAppPatient(
  clinicId: string,
  phoneRaw: string,
  fullName: string,
): Promise<{ id: string } | null> {
  const last10 = normalizeLast10(phoneRaw);
  if (last10.length >= 10) {
    const existing = await prisma.patient.findFirst({
      where: { clinicId, phone: { contains: last10 } },
      select: { id: true },
    });
    if (existing) return existing;
  }

  const parts = fullName.trim().split(/\s+/);
  const firstName = parts[0] || "Paciente";
  const lastName = parts.slice(1).join(" ") || "WhatsApp";

  try {
    // El retry envuelve al $transaction (no al revés): una tx abortada por P2002
    // ya no admite queries, así que cada intento abre transacción nueva.
    return await withPatientNumberRetry(() => prisma.$transaction(async (tx) => {
      // Serializa creates concurrentes por clínica (igual que /api/public/book).
      await tx.$executeRaw`SELECT 1 FROM clinics WHERE id = ${clinicId} FOR UPDATE`;
      const patientNumber = await nextPatientNumber(clinicId, tx);
      return tx.patient.create({
        data: {
          clinicId,
          patientNumber,
          firstName,
          lastName,
          phone: phoneRaw,
          source: "WHATSAPP",
          // Contacto nuevo que apenas pide su PRIMERA cita por WhatsApp: entra
          // como prospecto hasta ser atendido (lifecycle del CRM).
          lifecycleStage: "prospect",
        },
        select: { id: true },
      });
    }));
  } catch (err) {
    console.error("[bot/booking] patient create failed", err);
    return null;
  }
}
