// Estado de la conexión de WhatsApp de una clínica.
//
// SERVER ONLY (toca Prisma). El clinicId lo pone siempre el llamador desde una
// fuente de confianza (la clínica dueña del phone_number_id o del recordatorio),
// nunca el cliente.

import { prisma } from "@/lib/prisma";

/**
 * Apaga `waConnected` cuando Meta dice que la sesión murió (190 / HTTP 401).
 *
 * Sin esto, la cola sigue intentando con un token revocado en cada tick: cada
 * recordatorio se marca FAILED, nadie se entera y la clínica cree que sus
 * mensajes salen. Con `waConnected=false` el panel enseña "desconectado" y el
 * pre-check del worker deja de gastar llamadas.
 *
 * El `where` incluye `waConnected: true` para que sea idempotente: si ya estaba
 * apagada, no escribe ni vuelve a avisar en los logs.
 *
 * Best-effort: nunca lanza. Se llama desde caminos (webhook, cron) donde un
 * fallo aquí no debe tumbar lo que ya se estaba haciendo.
 */
export async function markWhatsAppDisconnected(
  clinicId: string,
  reason: string,
): Promise<void> {
  try {
    const res = await prisma.clinic.updateMany({
      where: { id: clinicId, waConnected: true },
      data: { waConnected: false },
    });
    if (res.count > 0) {
      console.warn(
        `[whatsapp/connection] waConnected=false en la clínica ${clinicId}: ${reason}`,
      );
    }
  } catch (e) {
    console.error("[whatsapp/connection] no se pudo apagar waConnected:", e);
  }
}
