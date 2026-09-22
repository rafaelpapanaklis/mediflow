// Anticipo por WhatsApp con Mercado Pago (WS1-T5) — las reglas del dinero.
//
// Aquí se decide, sin tocar base ni red:
//   · cuánto se cobra de anticipo (lo decide SIEMPRE el servidor);
//   · cuánto se manda a Mercado Pago como `marketplace_fee`;
//   · qué se hace con un pago que llega por el webhook.
//
// El dinero se compara en CENTAVOS enteros: 299.999999 no puede pasar por 300.
//
// PURO: sin Prisma, sin fetch, sin React. Lo prueban
// src/lib/anticipos/__tests__/core.test.ts y los tests del servicio.

// ── Configuración de la clínica ─────────────────────────────────────────────

export type ModoAnticipo = "fixed" | "percent" | "total";
export type ModoComision = "fixed" | "percent";

export const MODOS_ANTICIPO: readonly ModoAnticipo[] = ["fixed", "percent", "total"];
export const MODOS_COMISION: readonly ModoComision[] = ["fixed", "percent"];

/**
 * Menor anticipo que se cobra, en pesos. Por debajo, el link no vale la pena
 * (Mercado Pago se come casi todo en comisión) y la cita se agenda sin anticipo,
 * como siempre. Mismo piso que el pago en línea de facturas (online-payment.ts).
 */
export const ANTICIPO_MINIMO_MXN = 10;

/** Plazo para pagar, en minutos: 30 por defecto (encargo), entre 10 y 240. */
export const MINUTOS_DEFAULT = 30;
export const MINUTOS_MIN = 10;
/**
 * Tope de 4 h a propósito: el aviso «se liberó tu horario» es texto libre y
 * solo entra dentro de la ventana de 24 h de Meta, que se abrió con el último
 * mensaje del paciente. Con plazos largos ese aviso quedaría fuera y no saldría.
 */
export const MINUTOS_MAX = 240;

export interface PoliticaAnticipo {
  modo: ModoAnticipo;
  /** Pesos. Para "fixed" y como respaldo de "percent"/"total" sin precio. */
  monto: number;
  /** 1–100, para "percent". */
  porcentaje: number;
  minutos: number;
  comisionModo: ModoComision;
  comisionValor: number;
}

export function redondear2(x: number): number {
  return Math.round(x * 100) / 100;
}

export function aCentavos(pesos: number): number {
  return Math.round(pesos * 100);
}

/**
 * Cuánto se cobra de anticipo para esta cita, en pesos, o null si esta cita va
 * SIN anticipo (el monto que sale queda por debajo del mínimo).
 *
 * `precioServicio` sale del catálogo de la clínica (ProcedureCatalog.basePrice),
 * leído en el servidor — nunca de lo que escriba el paciente. Sin servicio con
 * precio, "percent" y "total" caen al monto fijo.
 */
export function calcularMontoAnticipo(
  politica: Pick<PoliticaAnticipo, "modo" | "monto" | "porcentaje">,
  precioServicio: number | null | undefined,
): number | null {
  const precio =
    typeof precioServicio === "number" && Number.isFinite(precioServicio) && precioServicio > 0
      ? precioServicio
      : null;

  let monto: number;
  if (politica.modo === "percent" && precio !== null && politica.porcentaje > 0) {
    monto = (precio * Math.min(politica.porcentaje, 100)) / 100;
  } else if (politica.modo === "total" && precio !== null) {
    monto = precio;
  } else {
    monto = politica.monto;
  }

  if (!Number.isFinite(monto)) return null;
  monto = redondear2(monto);
  return monto >= ANTICIPO_MINIMO_MXN ? monto : null;
}

/**
 * La comisión de DaleControl en PESOS, lista para `marketplace_fee`.
 *
 * Mercado Pago recibe un monto fijo, no un porcentaje: si la clínica tiene un %
 * configurado se convierte aquí, cobro por cobro. MP descuenta primero SU
 * comisión y la nuestra sale de lo que queda.
 *
 * Devuelve null si la comisión se come el anticipo entero (configuración rota):
 * mejor no generar el link que mandarle a MP un cobro que la clínica no cobra.
 */
export function calcularComision(
  modo: ModoComision,
  valor: number,
  montoAnticipo: number,
): number | null {
  if (!Number.isFinite(valor) || valor <= 0) return 0;
  const fee = modo === "percent" ? (montoAnticipo * valor) / 100 : valor;
  const redondeada = redondear2(fee);
  if (aCentavos(redondeada) >= aCentavos(montoAnticipo)) return null;
  return redondeada;
}

/** Valida lo que la pantalla de Configuración quiere guardar. null = válido. */
export function validarConfiguracion(c: {
  modo: string;
  monto: number;
  porcentaje: number;
  minutos: number;
}): string | null {
  if (!(MODOS_ANTICIPO as readonly string[]).includes(c.modo)) return "Modo de anticipo desconocido.";
  if (!Number.isFinite(c.monto) || c.monto < 0) return "El monto no es válido.";
  if (c.monto > 0 && c.monto < ANTICIPO_MINIMO_MXN) {
    return `El anticipo mínimo es de $${ANTICIPO_MINIMO_MXN}.`;
  }
  if (c.modo === "fixed" && c.monto < ANTICIPO_MINIMO_MXN) {
    return `Escribe el monto fijo del anticipo (mínimo $${ANTICIPO_MINIMO_MXN}).`;
  }
  if (c.modo === "percent" && (!Number.isInteger(c.porcentaje) || c.porcentaje < 1 || c.porcentaje > 100)) {
    return "El porcentaje va de 1 a 100.";
  }
  if (!Number.isInteger(c.minutos) || c.minutos < MINUTOS_MIN || c.minutos > MINUTOS_MAX) {
    return `El plazo para pagar va de ${MINUTOS_MIN} a ${MINUTOS_MAX} minutos.`;
  }
  return null;
}

// ── El link y el webhook ────────────────────────────────────────────────────

const PREFIJO_REF = "anticipo";

/** external_reference y `?ref=` del webhook: «anticipo:<AppointmentDeposit.id>». */
export function refDeAnticipo(depositId: string): string {
  return `${PREFIJO_REF}:${depositId}`;
}

export type EstadoAnticipo = "PENDING" | "PAID" | "EXPIRED" | "FAILED";

/** Lo que el webhook sabe del anticipo antes de decidir. */
export interface AnticipoParaEvaluar {
  id: string;
  amount: number;
  status: string;
  mpCollectorId: string | null;
}

/** Lo que Mercado Pago dice del pago (GET /v1/payments/{id}, con el token de la clínica). */
export interface PagoMp {
  status: string;
  statusDetail: string | null;
  externalReference: string | null;
  transactionAmount: number | null;
  currencyId: string | null;
  collectorId: string | null;
}

export type DecisionPago =
  /** No es de este anticipo o no se puede leer: no se toca nada (y se responde 200). */
  | { accion: "ignorar"; motivo: string }
  /** Existe pero no está aprobado (rechazado, en proceso…): se anota para el «yo pagué». */
  | { accion: "anotar_estado"; estado: string; detalle: string | null }
  /**
   * Entró dinero: se crea el saldo a favor por lo que de verdad pagó. `confirmar`
   * dice si además se intenta confirmar la cita (el servicio lo consigue solo si
   * la cita sigue apartada). `anomalia` != null = alguien debe revisarlo.
   */
  | { accion: "aplicar"; monto: number; confirmar: boolean; anomalia: string | null };

/**
 * Decide qué hacer con un pago. Las reglas duras del encargo:
 *   · Solo `approved` confirma. Ni `pending` ni `in_process`.
 *   · El pago tiene que ser de ESTE anticipo (external_reference exacto) y de la
 *     cuenta que cobró (collector), no de otra.
 *   · El monto que confirma es el que guardó el servidor al crear el link; lo
 *     que cuenta es lo que Mercado Pago dice que se pagó, jamás un importe que
 *     venga del cliente o del cuerpo del webhook.
 *   · Si entró dinero, se registra SIEMPRE (es del paciente): lo raro no
 *     confirma y queda marcado para revisar/devolver.
 */
export function evaluarPago(anticipo: AnticipoParaEvaluar, pago: PagoMp): DecisionPago {
  if (pago.externalReference !== refDeAnticipo(anticipo.id)) {
    return { accion: "ignorar", motivo: "La referencia del pago no es la de este anticipo." };
  }
  if (anticipo.mpCollectorId && pago.collectorId && pago.collectorId !== anticipo.mpCollectorId) {
    return { accion: "ignorar", motivo: "El pago lo cobró otra cuenta de Mercado Pago." };
  }
  if (pago.status !== "approved") {
    return { accion: "anotar_estado", estado: pago.status || "desconocido", detalle: pago.statusDetail };
  }
  if (pago.currencyId !== "MXN" || pago.transactionAmount == null || !(pago.transactionAmount > 0)) {
    return {
      accion: "ignorar",
      motivo: `Pago aprobado sin monto en MXN legible (${pago.currencyId ?? "?"} ${pago.transactionAmount ?? "?"}).`,
    };
  }

  const pagado = redondear2(pago.transactionAmount);

  if (anticipo.status === "PAID") {
    return {
      accion: "aplicar",
      monto: pagado,
      confirmar: false,
      anomalia: "Segundo pago del mismo anticipo: revisar y devolver si no corresponde.",
    };
  }
  if (anticipo.status === "FAILED") {
    return {
      accion: "aplicar",
      monto: pagado,
      confirmar: false,
      anomalia: "Pago sobre un anticipo que no llegó a apartar la cita: revisar/devolver.",
    };
  }
  if (aCentavos(pagado) < aCentavos(anticipo.amount)) {
    return {
      accion: "aplicar",
      monto: pagado,
      confirmar: false,
      anomalia: `Pagó $${pagado.toFixed(2)} y el anticipo era de $${anticipo.amount.toFixed(2)}: la cita NO se confirmó.`,
    };
  }
  // PENDING o EXPIRED: se intenta confirmar. Si el hueco ya se liberó, el
  // servicio deja el dinero como saldo a favor y lo dice.
  return { accion: "aplicar", monto: pagado, confirmar: true, anomalia: null };
}

// ── Textos para el paciente ─────────────────────────────────────────────────

export function formatoPesos(n: number): string {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n);
}

/** «10:42» en la zona de la clínica. */
export function horaCorta(fecha: Date, tz: string): string {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(fecha);
}

/** Línea que el bot añade al «¿Confirmas?» cuando la cita lleva anticipo. */
export function textoAvisoAnticipo(monto: number, minutos: number): string {
  return (
    `💳 Para apartar el horario se pide un anticipo de *${formatoPesos(monto)}*, ` +
    `que queda a tu favor y se descuenta de tu tratamiento. Al confirmar te mando ` +
    `el link de pago; tendrás *${minutos} min* para pagarlo.`
  );
}

/** Respuesta del bot al «sí»: el hueco quedó apartado y aquí está el link. */
export function textoLinkDePago(args: {
  fechaHumana: string;
  hora: string;
  doctor?: string | null;
  monto: number;
  url: string;
  venceA: Date;
  minutos: number;
  tz: string;
}): string {
  const con = args.doctor ? ` con ${args.doctor}` : "";
  return [
    `¡Listo! Te aparté el ${args.fechaHumana} a las ${args.hora}${con}. 🗓️`,
    `Para confirmar la cita, paga el anticipo de *${formatoPesos(args.monto)}* aquí:`,
    args.url,
    `Tienes hasta las *${horaCorta(args.venceA, args.tz)}* (${args.minutos} min). ` +
      `Si no se acredita a tiempo, el horario se libera solo.`,
    `El anticipo queda como saldo a favor y se descuenta de tu tratamiento. ` +
      `En cuanto se acredite te confirmo por aquí. ✅`,
  ].join("\n");
}

export function textoCitaConfirmada(args: {
  monto: number;
  fechaHumana: string;
  hora: string;
  clinica: string;
}): string {
  return (
    `✅ Recibimos tu anticipo de ${formatoPesos(args.monto)}. Tu cita en ${args.clinica} ` +
    `del ${args.fechaHumana} a las ${args.hora} quedó *confirmada*. El anticipo quedó ` +
    `como saldo a favor y se descuenta de tu tratamiento. ¡Te esperamos!`
  );
}

export function textoPagoSinCita(args: { monto: number; clinica: string }): string {
  return (
    `Recibimos tu pago de ${formatoPesos(args.monto)}, pero tu horario ya se había ` +
    `liberado. El dinero quedó como *saldo a favor* en ${args.clinica}. Escribe ` +
    `«agendar» para elegir otro horario, o espera a que alguien del equipo te escriba.`
  );
}

export function textoHorarioLiberado(args: { fechaHumana: string; hora: string }): string {
  return (
    `No se acreditó el anticipo de tu cita del ${args.fechaHumana} a las ${args.hora}, ` +
    `así que el horario se liberó. Si aún la quieres, escribe «agendar» y te busco ` +
    `otro horario. 🙂`
  );
}
