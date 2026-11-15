import { prisma } from "@/lib/prisma";

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
    return Boolean(row?.phoneNumberId && row?.whatsappToken);
  } catch {
    return false;
  }
}
