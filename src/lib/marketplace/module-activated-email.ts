import "server-only";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { RUTA_MODULO_ORTODONCIA } from "@/lib/orthodontics/contratar";
import { titulosPrimerosPasos } from "@/lib/orthodontics/primeros-pasos";
import {
  avisarModuloActivado,
  type AvisoModuloActivado,
  type ResultadoAviso,
} from "./module-activated-email-core";

/**
 * Correo «Módulo activado», con la base y el envío reales. La lógica (a quién,
 * un solo correo por activación, qué dice) vive en
 * `./module-activated-email-core`, con tests.
 *
 * Lo llaman el webhook de Stripe (compra) y el interruptor de /admin
 * (cortesía). Nunca lanza.
 */

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.dalecontrol.com";

/** Módulos con pantalla propia y primeros pasos. Los demás abren el panel. */
function destinoDelModulo(moduleKey: string): { ruta: string; primerosPasos: readonly string[] } {
  if (moduleKey === "orthodontics") {
    return { ruta: RUTA_MODULO_ORTODONCIA, primerosPasos: titulosPrimerosPasos() };
  }
  return { ruta: "/dashboard", primerosPasos: [] };
}

export async function notifyModuleActivated(aviso: AvisoModuloActivado): Promise<ResultadoAviso> {
  return avisarModuloActivado(aviso, {
    siteUrl: SITE_URL,
    destinoDelModulo,
    cargarDestino: async (clinicId) => {
      const clinic = await prisma.clinic.findUnique({
        where: { id: clinicId },
        select: {
          name: true,
          email: true,
          timezone: true,
          // Dueño = SUPER_ADMIN activo más antiguo: el mismo destinatario que
          // los correos de plan del webhook.
          users: {
            where: { role: "SUPER_ADMIN", isActive: true },
            orderBy: { createdAt: "asc" },
            take: 1,
            select: { email: true, firstName: true },
          },
        },
      });
      if (!clinic) return null;
      const owner = clinic.users[0];
      return {
        email: owner?.email ?? clinic.email ?? null,
        firstName: owner?.firstName ?? null,
        clinicName: clinic.name,
        timeZone: clinic.timezone ?? null,
      };
    },
    cargarNombreModulo: async (moduleKey) => {
      const mod = await prisma.module.findUnique({ where: { key: moduleKey }, select: { name: true } });
      return mod?.name ?? null;
    },
    // Mismo candado que los correos de plan: la fila única de
    // billing_email_logs. Si ya existe (P2002) o la tabla no está, no se envía.
    reservar: async (llave, clinicId, email) => {
      try {
        await prisma.billingEmailLog.create({
          data: { invoiceId: llave, clinicId, kind: "module_activated", email },
        });
        return true;
      } catch (e) {
        const code = (e as { code?: string } | null)?.code;
        if (code !== "P2002") console.error("[modulo-activado] candado del correo:", code ?? e);
        return false;
      }
    },
    enviar: (correo) => sendEmail(correo),
  });
}
