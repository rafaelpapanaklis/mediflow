// ═══════════════════════════════════════════════════════════════════════════
// Manager de cuenta — lectura para el panel del AFILIADO (server-only).
//
// Espejo exacto de get-for-clinic.ts pero leyendo `Affiliate.accountManagerId`.
// El catálogo de managers es GLOBAL (lo mismo atiende clínicas que afiliados),
// así que aquí no hay lógica propia: se reusa el mismo DTO y el mismo cálculo
// de disponibilidad (src/lib/account-manager/availability.ts). Si algún día
// cambia la regla de "en línea", cambia en un solo lugar.
//
// ⚠️ TOLERANTE A ESQUEMA VIEJO: la columna `affiliates.accountManagerId` se
// aplica A MANO en Supabase, así que entre el push y el SQL puede no existir.
// Toda lectura va en try/catch y degrada a "sin manager asignado", que es un
// estado VÁLIDO: la pantalla de Soporte del afiliado cae al canal general y
// nunca muestra una tarjeta rota.
//
// PRIVACIDAD: devuelve ÚNICAMENTE el manager asignado a ese afiliado. El
// catálogo completo (y los teléfonos de los demás managers) jamás sale de
// /admin.
// ═══════════════════════════════════════════════════════════════════════════

import { prisma } from "@/lib/prisma";
import { formatWhatsappDisplay, type AccountManagerDTO } from "./types";

/**
 * Manager asignado al afiliado, o null (sin asignar / columna aún sin crear /
 * cualquier fallo de BD). NUNCA lanza.
 *
 * Devuelve el DTO "crudo": el estado de presencia lo resuelve quien renderiza
 * llamando a isOnline/formatSchedule/nextAvailableText de ./availability — se
 * evalúa en el SERVIDOR y en la timezone del MANAGER, nunca en la del
 * visitante.
 */
export async function getAccountManagerForAffiliate(
  affiliateId: string,
): Promise<AccountManagerDTO | null> {
  if (!affiliateId) return null;

  try {
    const row = await prisma.affiliate.findUnique({
      where: { id: affiliateId },
      select: {
        accountManager: {
          select: {
            id: true,
            name: true,
            photoUrl: true,
            whatsappE164: true,
            whatsappDisplay: true,
            days: true,
            startMinutes: true,
            endMinutes: true,
            timezone: true,
            status: true,
          },
        },
      },
    });

    const m = row?.accountManager;
    if (!m) return null;

    return {
      id: m.id,
      name: m.name,
      photoUrl: m.photoUrl ?? null,
      whatsappE164: m.whatsappE164,
      // Si el admin no capturó el formateado, se deriva del E.164.
      whatsappDisplay: m.whatsappDisplay || formatWhatsappDisplay(m.whatsappE164),
      days: m.days,
      startMinutes: m.startMinutes,
      endMinutes: m.endMinutes,
      timezone: m.timezone,
      status: m.status,
    };
  } catch (e) {
    // Esperado mientras el SQL no esté aplicado. Se loguea una vez por request
    // y la tarjeta cae al canal general de soporte.
    console.warn("[account-manager] afiliado: lectura degradada a 'sin manager':", e);
    return null;
  }
}
