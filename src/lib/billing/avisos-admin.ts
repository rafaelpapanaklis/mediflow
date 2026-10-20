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

const diaMx = (segundos: number): string =>
  new Date(segundos * 1000).toLocaleDateString("es-MX", { timeZone: "America/Mexico_City", dateStyle: "long" });

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

/**
 * Se repuso un cupón que tenía fecha de fin: Stripe lo cuenta desde hoy y NO permite editar el fin de un descuento
 * del cliente (solo quitarlo o poner otro). La instrucción es lo que sí se puede hacer: quitarlo y ponerle un
 * cupón con duración de N meses (los que le quedaban), o quitarle el cupón en la fecha original.
 */
export function avisoCuponConFinRepuesto(a: {
  clinicaId: string;
  clinicaNombre: string | null | undefined;
  clienteStripe: string;
  cupon: string | null;
  codigoPromocional: string | null;
  finOriginal: number;
  ahora?: Date;
}): AvisoAdmin {
  const nombre = a.clinicaNombre ?? a.clinicaId;
  const ahora = a.ahora ?? new Date();
  const meses = mesesRestantes(a.finOriginal, ahora);
  const fecha = fechaMx(a.finOriginal);
  return {
    asunto: `Ajusta la duración de un cupón repuesto en Stripe: ${nombre}`,
    lineas: [
      "Se volvió a poner el cupón del cliente (no se le quita a la clínica lo que tenía), pero Stripe lo cuenta desde hoy: si tiene duración, le reinicia los meses.",
      `Clínica: ${a.clinicaNombre ?? "(sin nombre)"} (${a.clinicaId})`,
      `Cliente de Stripe: ${a.clienteStripe}`,
      `Cupón: ${a.cupon ?? "(desconocido)"}${a.codigoPromocional ? ` · código promocional: ${a.codigoPromocional}` : ""}`,
      `Fecha de fin ORIGINAL: ${fecha} (México).`,
      meses === null
        ? "Esa fecha ya pasó: el descuento ya no le correspondía. Quítaselo al cliente en Stripe."
        : `Stripe no deja editar la fecha de fin de un descuento del cliente. Opción 1: quítale este descuento al cliente y ponle un cupón con duración de ${meses} ${meses === 1 ? "mes" : "meses"} (los que le quedaban). Opción 2: déjalo y quítale el cupón el ${diaMx(a.finOriginal)}.`,
    ],
  };
}

/** Meses (enteros, hacia arriba) que faltan hasta `fin` (epoch en segundos), o null si ya pasó. */
export function mesesRestantes(fin: number, ahora: Date): number | null {
  const dias = (fin * 1000 - ahora.getTime()) / 86_400_000;
  if (dias <= 0) return null;
  return Math.max(1, Math.ceil(dias / 30));
}

/**
 * Falló el cambio de plan y NO se pudo comprobar si llegó a Stripe (la relectura también falló): se repuso el
 * cupón por prudencia, pero pudo quedar el plan subido con el cupón puesto. Hay que revisarlo.
 */
export function avisoReposicionSinVerificar(a: {
  clinicaId: string;
  clinicaNombre: string | null | undefined;
  clienteStripe: string;
  cupon: string | null;
  codigoPromocional: string | null;
  planDestino: string;
}): AvisoAdmin {
  const nombre = a.clinicaNombre ?? a.clinicaId;
  return {
    asunto: `Revisa el plan y el cupón en Stripe (no se pudo confirmar un cambio de plan): ${nombre}`,
    lineas: [
      `Una subida a ${a.planDestino} falló y tampoco se pudo volver a leer la suscripción para saber si el cambio llegó a Stripe. Por prudencia se volvió a poner el cupón del cliente.`,
      `Clínica: ${a.clinicaNombre ?? "(sin nombre)"} (${a.clinicaId})`,
      `Cliente de Stripe: ${a.clienteStripe}`,
      `Cupón repuesto: ${a.cupon ?? "(desconocido)"}${a.codigoPromocional ? ` · código promocional: ${a.codigoPromocional}` : ""}`,
      `Qué revisar: en Stripe, si la suscripción quedó en ${a.planDestino}. Si sí, quítale el cupón al cliente (la subida se cobra a precio de lista). Si no, no hay nada que hacer. Detalle en la bitácora de la clínica (pago-pendiente-descuento-cliente-reposicion-sin-verificar).`,
    ],
  };
}
