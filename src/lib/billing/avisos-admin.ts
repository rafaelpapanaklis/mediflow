/**
 * Avisos para quien administra la PLATAFORMA (no para la clínica): se mandan por correo a ADMIN_NOTIFY_EMAIL.
 * Aquí sí se nombra a Stripe: el admin trabaja en su panel. Lo que lee la clínica vive en `mensajes-pago.ts`,
 * y esa regla («sin Stripe, sin inglés») no aplica a este archivo.
 */

export interface AvisoAdmin {
  asunto: string;
  lineas: string[];
}

/** Subir de plan quitó el cupón del cliente de Stripe y no se pudo volver a poner: hay que reponerlo a mano. */
export function avisoCuponNoRepuesto(a: {
  clinicaId: string;
  clinicaNombre: string | null | undefined;
  clienteStripe: string;
  cupon: string | null;
  codigoPromocional: string | null;
}): AvisoAdmin {
  const nombre = a.clinicaNombre ?? a.clinicaId;
  return {
    asunto: `Hay que reponer a mano un cupón del cliente en Stripe: ${nombre}`,
    lineas: [
      "Una subida de plan le quitó el cupón al cliente de Stripe y NO se pudo volver a poner (el plan no cambió).",
      `Clínica: ${a.clinicaNombre ?? "(sin nombre)"} (${a.clinicaId})`,
      `Cliente de Stripe: ${a.clienteStripe}`,
      `Cupón: ${a.cupon ?? "(desconocido)"}${a.codigoPromocional ? ` · código promocional: ${a.codigoPromocional}` : ""}`,
      "Qué hacer: en Stripe, abre ese cliente y aplícale de nuevo ese cupón. El detalle queda en la bitácora de la clínica (pago-pendiente-descuento-cliente-NO-repuesto).",
    ],
  };
}
