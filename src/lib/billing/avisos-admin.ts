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

const fechaMx = (segundos: number): string =>
  new Date(segundos * 1000).toLocaleString("es-MX", { timeZone: "America/Mexico_City", dateStyle: "long", timeStyle: "short" });

/**
 * El cupón del cliente se quitó y NO se repuso porque otra petición está haciendo (o ya hizo) el cambio de plan
 * (dos pestañas, o el cambio llegó a Stripe y la respuesta se perdió). Hay que revisar cómo quedó.
 */
export function avisoCuponNoRepuestoPorCambio(a: {
  clinicaId: string;
  clinicaNombre: string | null | undefined;
  clienteStripe: string;
  cupon: string | null;
  codigoPromocional: string | null;
  razon: "idempotencia" | "plan-ya-en-destino";
  planDestino: string;
}): AvisoAdmin {
  const nombre = a.clinicaNombre ?? a.clinicaId;
  return {
    asunto: `Revisa el cupón del cliente en Stripe (cambio de plan en paralelo): ${nombre}`,
    lineas: [
      a.razon === "idempotencia"
        ? "Dos peticiones de subir de plan chocaron: Stripe rechazó una por una clave en curso. NO se repuso el cupón del cliente porque la otra petición está terminando el cambio."
        : `El plan de la suscripción ya está en ${a.planDestino} aunque esta petición falló (el cambio llegó a Stripe y la respuesta se perdió, o lo hizo otra pestaña). NO se repuso el cupón del cliente.`,
      `Clínica: ${a.clinicaNombre ?? "(sin nombre)"} (${a.clinicaId})`,
      `Cliente de Stripe: ${a.clienteStripe}`,
      `Cupón que se le quitó: ${a.cupon ?? "(desconocido)"}${a.codigoPromocional ? ` · código promocional: ${a.codigoPromocional}` : ""}`,
      "Qué revisar: que la factura nueva haya salido a precio de lista y que el cliente no tenga un cupón puesto. El detalle queda en la bitácora de la clínica (pago-pendiente-descuento-cliente-no-repuesto-otro-cambio).",
    ],
  };
}

/** Se cobró menos de lo mostrado (un descuento que no se quitó): hay que revisar la factura. */
export function avisoCobroMenorQueLoMostrado(a: {
  clinicaId: string;
  clinicaNombre: string | null | undefined;
  facturaId: string | null;
  cobradoMxn: number;
  esperadoMxn: number;
  planDestino: string;
}): AvisoAdmin {
  const nombre = a.clinicaNombre ?? a.clinicaId;
  return {
    asunto: `Subida de plan cobrada por debajo del precio de lista: ${nombre}`,
    lineas: [
      `La factura de la subida a ${a.planDestino} salió por ${a.cobradoMxn} MXN y lo mostrado a la clínica era ${a.esperadoMxn} MXN.`,
      `Clínica: ${a.clinicaNombre ?? "(sin nombre)"} (${a.clinicaId})`,
      `Factura: ${a.facturaId ?? "(sin id)"}`,
      "Qué revisar: en Stripe, si el cliente o la suscripción siguen con algún cupón (por ejemplo, dos pestañas a la vez) y quitárselo.",
    ],
  };
}

/** Se repuso un cupón que tenía fecha de fin: Stripe lo cuenta desde hoy, hay que ajustar la fecha a mano. */
export function avisoCuponConFinRepuesto(a: {
  clinicaId: string;
  clinicaNombre: string | null | undefined;
  clienteStripe: string;
  cupon: string | null;
  codigoPromocional: string | null;
  finOriginal: number;
}): AvisoAdmin {
  const nombre = a.clinicaNombre ?? a.clinicaId;
  return {
    asunto: `Ajusta la fecha de fin de un cupón repuesto en Stripe: ${nombre}`,
    lineas: [
      "Se volvió a poner el cupón del cliente (no se le quita a la clínica lo que tenía), pero Stripe lo cuenta desde hoy: si tiene duración, le reinicia los meses.",
      `Clínica: ${a.clinicaNombre ?? "(sin nombre)"} (${a.clinicaId})`,
      `Cliente de Stripe: ${a.clienteStripe}`,
      `Cupón: ${a.cupon ?? "(desconocido)"}${a.codigoPromocional ? ` · código promocional: ${a.codigoPromocional}` : ""}`,
      `Fecha de fin ORIGINAL: ${fechaMx(a.finOriginal)} (México). Ajusta el descuento nuevo para que termine ese día.`,
    ],
  };
}
