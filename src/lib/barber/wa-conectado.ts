import { prisma } from "@/lib/prisma";
import { decryptField } from "@/lib/crypto/envelope";

/* ═══════════════════════════════════════════════════════════════════════
   ¿La barbería tiene WhatsApp conectado? — un sí/no, y nada más.

   La reserva pública y su pantalla final lo usan para NO prometerle al
   cliente un mensaje que no va a salir. Es la misma regla de «conectado»
   que usa getBarberWaConnection (número y token presentes) pero sin las
   consultas extra del panel, y solo devuelve un booleano: ni el número, ni
   el token, ni el estado de verificación viajan al navegador.

   Ante cualquier duda (barbería inexistente, error de base) responde false:
   es preferible NO prometer a prometer de más.
   ═══════════════════════════════════════════════════════════════════════ */
export async function barberiaTieneWhatsApp(barbershopId: string): Promise<boolean> {
  if (!barbershopId) return false;
  try {
    const row = await prisma.barbershop.findUnique({
      where: { id: barbershopId },
      select: { phoneNumberId: true, whatsappToken: true },
    });
    if (!row?.phoneNumberId || !row?.whatsappToken) return false;
    // Un token que no se puede descifrar (llave rotada, otro entorno) no
    // manda nada: no se promete. decryptField (compartido con el dental, no
    // se toca) LANZA en ese caso; el catch de abajo lo vuelve un «no».
    decryptField(row.whatsappToken);
    return true;
  } catch {
    return false;
  }
}
