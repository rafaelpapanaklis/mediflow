// ═══════════════════════════════════════════════════════════════════════════
// Manager de cuenta — lectura para el panel de la CLÍNICA (server-only).
//
// ⚠️ TOLERANTE A ESQUEMA VIEJO: sql/account-managers.sql se aplica A MANO en
// Supabase DESPUÉS del deploy, así que entre el push y el SQL la tabla
// `account_managers` y la columna `clinics.accountManagerId` NO EXISTEN. Toda
// lectura va en try/catch y degrada a "sin manager asignado" — la pantalla de
// Soporte nunca puede romperse por esto (mismo criterio que el `.catch(() => 0)`
// del contador de fotos).
//
// PRIVACIDAD: devuelve ÚNICAMENTE el manager asignado a esa clínica. El
// catálogo completo (y los teléfonos de los demás managers) jamás sale del
// admin. Ver src/lib/account-manager/types.ts para el DTO exacto que viaja.
// ═══════════════════════════════════════════════════════════════════════════

import { prisma } from "@/lib/prisma";
import { isOnline, formatSchedule, nextAvailableText } from "./availability";
import { formatWhatsappDisplay, type AccountManagerDTO } from "./types";

/** Lo que consume <AccountManagerCard />: DTO + estado ya resuelto en server. */
export interface AccountManagerCardData {
  manager: AccountManagerDTO;
  /** Calculado en el SERVIDOR y en la tz del manager. */
  online: boolean;
  /** "Lun–Vie · 9:00–18:00" */
  scheduleText: string;
  /** "te responde mañana a las 9:00" · "" cuando no hay nada que prometer. */
  nextAvailable: string;
}

/**
 * Manager asignado a la clínica, o null (sin asignar / tabla aún sin crear /
 * cualquier fallo de BD). NUNCA lanza.
 */
export async function getAccountManagerForClinic(
  clinicId: string,
  opts: { locale?: string; now?: Date } = {},
): Promise<AccountManagerCardData | null> {
  if (!clinicId) return null;
  const now = opts.now ?? new Date();
  const locale = opts.locale;

  try {
    const row = await prisma.clinic.findUnique({
      where: { id: clinicId },
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

    const manager: AccountManagerDTO = {
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

    const online = isOnline(manager, now);
    return {
      manager,
      online,
      scheduleText: formatSchedule(manager, locale),
      nextAvailable: online ? "" : nextAvailableText(manager, now, locale),
    };
  } catch (e) {
    // Esperado mientras el SQL no esté aplicado. Se loguea una vez por request
    // y la tarjeta cae al estado "sin manager", que es un estado VÁLIDO.
    console.warn("[account-manager] lectura degradada a 'sin manager':", e);
    return null;
  }
}
