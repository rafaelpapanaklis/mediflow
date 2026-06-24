// Carga server-side de las preferencias de recordatorio por cuenta de paciente.
// Lo usa el cron de recordatorios (src/lib/reminders/enqueue.ts).
import { prisma } from "@/lib/prisma";
import { parseNotifPrefs, type NotifPrefs } from "./types";

/**
 * Carga las prefs VÁLIDAS por accountId. Best-effort: si la columna notifPrefs
 * aún no existe en la BD (SQL pendiente), devuelve un Map vacío sin lanzar —
 * el cron sigue usando la config de la clínica. NUNCA rompe los recordatorios.
 */
export async function loadNotifPrefsByAccount(
  accountIds: string[],
): Promise<Map<string, NotifPrefs>> {
  const out = new Map<string, NotifPrefs>();
  const ids = Array.from(new Set(accountIds.filter(Boolean)));
  if (ids.length === 0) return out;
  try {
    const rows = await prisma.patientAccount.findMany({
      where: { id: { in: ids } },
      select: { id: true, notifPrefs: true },
    });
    for (const row of rows) {
      const parsed = parseNotifPrefs(row.notifPrefs);
      if (parsed) out.set(row.id, parsed);
    }
  } catch (err) {
    console.error(
      "[patient-notifications/prefs] loadNotifPrefsByAccount (¿SQL pendiente?):",
      err,
    );
  }
  return out;
}
