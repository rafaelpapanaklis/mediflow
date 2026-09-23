// El interruptor del pago en línea del portal del paciente (ws1-t2).
//
// Rafael: «que se pueda apagar con interruptor pero por default que se encienda
// una vez se conecte la cuenta de mercadopago; si la clínica no tiene cuenta de
// mercadopago entonces claramente no aparezca la opción de pagar».
//
// La columna es `clinic_mercadopago."portalPaymentsEnabled"` (DEFAULT true;
// `guardarConexion` la crea en true en la PRIMERA conexión y NO la toca al
// reconectar: si la clínica lo apagó, se queda apagado). Aquí se decide:
//   · si el portal ofrece —y la ruta del portal ACEPTA— pagar con Mercado Pago;
//   · qué links se cierran cuando la clínica lo apaga.
//
// Solo el PORTAL. Los links que la recepción manda por WhatsApp o correo
// (src/lib/factura-mp/) siguen igual con el interruptor apagado: el interruptor
// es «¿el paciente puede pagar solo desde el portal?», no «¿la clínica cobra con
// Mercado Pago?».
//
// Todo pasa por las mismas dependencias de factura-mp (`DepsFacturaMp`), así
// que las pruebas lo conducen con la misma base en memoria.

import { cobroMpDisponible, depsReales, type DepsFacturaMp } from "@/lib/factura-mp/servicio.server";

function deps(over?: Partial<DepsFacturaMp>): DepsFacturaMp {
  return over ? { ...depsReales, ...over } : depsReales;
}

/**
 * ¿El portal de esta clínica cobra con Mercado Pago? Tiene que poder cobrar
 * facturas (cuenta conectada, plataforma lista, tabla de links: el criterio de
 * factura-mp) Y tener el interruptor encendido.
 *
 * Si la columna todavía no existe (el código llegó antes que su SQL) cuenta
 * como ENCENDIDO: es lo que dice su DEFAULT, y así nadie pierde el cobro en
 * línea por el orden del despliegue.
 */
export async function cobroMpEnPortal(clinicId: string, over?: Partial<DepsFacturaMp>): Promise<boolean> {
  const d = deps(over);
  if (!clinicId) return false;
  if (!(await cobroMpDisponible(clinicId, d))) return false;
  try {
    const fila = await d.db.clinicMercadoPago.findFirst({
      where: { clinicId },
      select: { portalPaymentsEnabled: true },
    });
    return fila?.portalPaymentsEnabled !== false;
  } catch (e) {
    if ((e as { code?: string })?.code === "P2022") return true;
    throw e;
  }
}

/**
 * La clínica apagó el pago del portal: los links PENDING que nacieron EN EL
 * PORTAL (sin `createdById`: el paciente no es un usuario del panel) quedan
 * REPLACED y se cierran en Mercado Pago, para que el paciente que tenga uno
 * abierto no pague por ahí. Con `invoiceId`, solo los de esa factura.
 *
 * Los que creó la recepción (llevan su usuario) NO se tocan: son su envío.
 *
 * Nunca lanza: apagar el interruptor ya quedó guardado. Si Mercado Pago no
 * contesta, el link vive hasta su fecha y, si alguien lo paga, el webhook lo
 * registra igual: el dinero nunca se pierde.
 */
export async function cerrarLinksDelPortal(
  args: { clinicId: string; invoiceId?: string },
  over?: Partial<DepsFacturaMp>,
): Promise<number> {
  const d = deps(over);
  // clinicId vacío no filtra nada (Prisma descarta la clave): se corta antes.
  if (!args.clinicId) return 0;
  const where = {
    clinicId: args.clinicId,
    status: "PENDING",
    createdById: null,
    ...(args.invoiceId ? { invoiceId: args.invoiceId } : {}),
  };
  try {
    const abiertos = await d.db.invoicePaymentLink.findMany({ where, select: { id: true, mpPreferenceId: true } });
    if (abiertos.length === 0) return 0;
    await d.db.invoicePaymentLink.updateMany({
      where: { ...where, id: { in: abiertos.map((l) => l.id) } },
      data: { status: "REPLACED" },
    });
    const cred = await d.credencial(args.clinicId);
    for (const l of abiertos) {
      if (!cred || !l.mpPreferenceId) continue;
      try {
        await d.expirarPreferencia(cred.accessToken, l.mpPreferenceId);
      } catch (e) {
        console.error(`[portal-mp] no se pudo cerrar la preferencia ${l.mpPreferenceId}: ${(e as Error).message}`);
      }
    }
    return abiertos.length;
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code !== "P2021" && code !== "P2022") {
      console.error(`[portal-mp] no se pudieron cerrar los links del portal (${args.clinicId}): ${(e as Error).message}`);
    }
    return 0;
  }
}
