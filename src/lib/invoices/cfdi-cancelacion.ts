// ═══════════════════════════════════════════════════════════════════════════
// CANCELACIÓN DE CFDI ANTE EL SAT Y NOTA DE CRÉDITO — reglas puras (ws1-t3,
// auditoría CFDI F-02, F-03 y F-16 parte egreso).
//
// Sin red ni base de datos: aquí solo se decide. Lo que habla con Facturapi y
// con la base está en cfdi-cancelacion.server.ts y cfdi-cancelacion-db.ts.
//
// Fuentes (se citan también en el reporte ws1-t3):
//   · CFF art. 29-A, párrafos cuarto a sexto (cancelación, aceptación del
//     receptor, plazo de la declaración anual).
//   · RMF 2026, reglas 2.7.1.34 y 2.7.1.35 (cuándo NO hace falta la aceptación;
//     tres días hábiles para contestar). Fuente secundaria.
//   · SAT, Anexo 20 y Guía de llenado del CFDI 4.0 (CfdiRelacionados: 01 nota de
//     crédito, 04 sustitución; egreso con ClaveProdServ 84111506 y unidad ACT).
//   · Facturapi, guía de cancelaciones: DELETE /v2/invoices/{id}?motive=XX
//     (&substitution=…), estados none/verifying/pending/accepted/rejected/expired.
// ═══════════════════════════════════════════════════════════════════════════

import { round2 } from "@/lib/invoice-totals";

// ── 1 · Motivos del SAT ──────────────────────────────────────────────────────

export type MotivoCancelacion = "01" | "02" | "03" | "04";

export const MOTIVOS_CANCELACION: {
  clave: MotivoCancelacion;
  es: string;
  en: string;
  detalleEs: string;
  detalleEn: string;
}[] = [
  {
    clave: "01",
    es: "01 · Emitido con errores, con relación (se sustituye)",
    en: "01 · Issued with errors, with relation (replaced)",
    detalleEs: "El CFDI salió con un error (forma de pago, uso, datos del receptor…) y se emite otro que lo sustituye. Primero se timbra el nuevo y luego se cancela éste.",
    detalleEn: "The CFDI had an error and a new one replaces it. The new one is stamped first, then this one is cancelled.",
  },
  {
    clave: "02",
    es: "02 · Emitido con errores, sin relación",
    en: "02 · Issued with errors, without relation",
    detalleEs: "El CFDI salió mal y no se va a sustituir por otro (o se emitirá después, sin relacionarlo).",
    detalleEn: "The CFDI was wrong and will not be replaced by a related one.",
  },
  {
    clave: "03",
    es: "03 · No se llevó a cabo la operación",
    en: "03 · The operation did not take place",
    detalleEs: "Se facturó un servicio que al final no se dio ni se cobró.",
    detalleEn: "A service was invoiced that was never provided or charged.",
  },
  {
    clave: "04",
    es: "04 · Operación nominativa relacionada en una factura global",
    en: "04 · Nominative operation included in a global invoice",
    detalleEs: "Solo para una factura a «público en general» (global) que incluyó una operación que después se facturó con nombre.",
    detalleEn: "Only for a global («público en general») invoice that included an operation later invoiced by name.",
  },
];

export function esMotivoCancelacion(x: unknown): x is MotivoCancelacion {
  return x === "01" || x === "02" || x === "03" || x === "04";
}

export const RFC_PUBLICO_GENERAL = "XAXX010101000";
export const RFC_EXTRANJERO = "XEXX010101000";

// ── 2 · Estados ──────────────────────────────────────────────────────────────

/**
 * Estado de la cancelación que guardamos en `cfdi_records."cancellationStatus"`.
 * Los seis de Facturapi más dos nuestros:
 *   enviando  → reservado: una petición está hablando con Facturapi ahora mismo
 *               (candado contra la doble cancelación; caduca a los 10 min).
 *   incierto  → se mandó y la conexión se cortó: NO se sabe si llegó al SAT.
 *               Bloquea reintentar a ciegas hasta que «Consultar estado» lo aclare.
 */
export type EstadoCancelacion =
  | "none" | "verifying" | "pending" | "accepted" | "rejected" | "expired"
  | "enviando" | "incierto";

/**
 * `cfdi_records.status` de un CFDI de ingreso al que ya se le timbró un
 * sustituto (relación 04) y todavía no se cancela ante el SAT. SIGUE VIGENTE
 * ante el SAT; se separa de "valid" para que el índice único «un CFDI de
 * ingreso vigente por factura» (sql/ws1-t4-cfdi-uno-por-factura.sql) deje
 * guardar el sustituto, y para que las sumas de lo timbrado no cuenten dos
 * veces la misma operación.
 */
export const STATUS_SUSTITUIDO = "sustituido";

/** ¿Sigue vigente ante el SAT? */
export function sigueVigente(status: string): boolean {
  return status === "valid" || status === STATUS_SUSTITUIDO;
}

/** Los que impiden pedir otra cancelación (hay una en curso o no se sabe). */
export const ESTADOS_EN_CURSO: EstadoCancelacion[] = ["enviando", "incierto", "verifying", "pending"];

/** Minutos que vale la reserva «enviando» antes de poder reintentar. */
export const RESERVA_CANCELACION_MIN = 10;

/** Lo que hay que escribir en `cfdi_records` según lo que dijo Facturapi. */
export interface EfectoEstado {
  /** cfdi_records.status: "cancelled" solo cuando el SAT ya la aceptó. */
  status: "valid" | "cancelled";
  cancellationStatus: EstadoCancelacion;
}

/**
 * Traduce la respuesta de Facturapi (DELETE o GET) a lo que se guarda.
 *
 * 🔴 Mientras la cancelación esté pendiente el CFDI SIGUE VIGENTE ante el SAT:
 * `status` se queda en "valid" (lo leen el candado de reembolsos/cancelar
 * factura, el de CFDI por pago y el reporte de lo timbrado). Solo `canceled`
 * (o `accepted`) lo pasa a "cancelled".
 */
export function efectoDeEstado(fa: { status: string; cancellationStatus: string }): EfectoEstado {
  const cs = fa.cancellationStatus;
  if (fa.status === "canceled" || cs === "accepted") {
    return { status: "cancelled", cancellationStatus: "accepted" };
  }
  if (cs === "pending" || cs === "verifying" || cs === "rejected" || cs === "expired") {
    return { status: "valid", cancellationStatus: cs };
  }
  return { status: "valid", cancellationStatus: "none" };
}

/**
 * ¿Hay que soltar la factura interna (`invoices.cfdiUuid` → NULL) al quedar
 * cancelado este CFDI? Solo si es el CFDI de la factura COMPLETA (ingreso, sin
 * pago) y la factura todavía apunta a ÉL. Con motivo 01 la factura ya apunta al
 * sustituto, así que no se toca; un egreso o un CFDI por pago tampoco.
 */
export function soltarFacturaAlCancelar(args: {
  tipoComprobante: string;
  paymentId: string | null;
  uuid: string;
  invoiceCfdiUuid: string | null;
}): boolean {
  return args.tipoComprobante === "I"
    && !args.paymentId
    && !!args.invoiceCfdiUuid
    && args.invoiceCfdiUuid === args.uuid;
}

// ── 3 · ¿Pide aceptación del receptor? ───────────────────────────────────────

/** Fecha civil (año, mes, día) de un instante en una zona horaria. */
function fechaEn(d: Date, tz: string): { y: number; m: number; d: number; dow: number } {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
  }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  const dows = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return { y: Number(get("year")), m: Number(get("month")), d: Number(get("day")), dow: dows.indexOf(get("weekday")) };
}

/** Número de día civil (para comparar fechas sin horas). */
function diaCivil(f: { y: number; m: number; d: number }): number {
  return Math.floor(Date.UTC(f.y, f.m - 1, f.d) / 86_400_000);
}

/**
 * El día hábil siguiente a la emisión, como número de día civil. Solo salta
 * sábados y domingos: los días festivos NO se conocen aquí, y eso cae del lado
 * conservador (el plazo real puede ser un día más largo, nunca más corto), así
 * que como mucho avisamos «pedirá aceptación» un día de más.
 */
export function diaHabilSiguiente(emitido: Date, tz: string): number {
  const f = fechaEn(emitido, tz);
  let dia = diaCivil(f);
  let dow = f.dow;
  do {
    dia += 1;
    dow = (dow + 1) % 7;
  } while (dow === 0 || dow === 6);
  return dia;
}

export type RazonSinAceptacion =
  | "monto" | "plazo" | "egreso" | "publicoGeneral" | null;

/**
 * Predicción: ¿la cancelación pedirá que el receptor la acepte?
 * Regla 2.7.1.34 RMF (fuente secundaria): NO hace falta cuando
 *   · el total es de hasta $1,000.00;
 *   · se cancela a más tardar el día hábil siguiente a la emisión;
 *   · es de egreso;
 *   · es a público en general (XAXX010101000) o a extranjero (XEXX010101000).
 * Es solo un AVISO para quien cancela: lo que manda es lo que conteste
 * Facturapi (`pending` = el paciente tiene 3 días hábiles para aceptar).
 */
export function prediccionAceptacion(args: {
  total: number;
  tipoComprobante: string;
  receptorRfc: string | null | undefined;
  emitidoEn: Date;
  ahora: Date;
  timeZone?: string;
}): { requiere: boolean; razon: RazonSinAceptacion } {
  const tz = args.timeZone || "America/Mexico_City";
  if (args.tipoComprobante === "E") return { requiere: false, razon: "egreso" };
  const rfc = String(args.receptorRfc ?? "").trim().toUpperCase();
  if (rfc === RFC_PUBLICO_GENERAL || rfc === RFC_EXTRANJERO) return { requiere: false, razon: "publicoGeneral" };
  if (round2(args.total) <= 1000) return { requiere: false, razon: "monto" };
  const hoy = diaCivil(fechaEn(args.ahora, tz));
  if (hoy <= diaHabilSiguiente(args.emitidoEn, tz)) return { requiere: false, razon: "plazo" };
  return { requiere: true, razon: null };
}

/**
 * CFF art. 29-A, cuarto párrafo: un CFDI se puede cancelar a más tardar en el
 * mes en que se presenta la declaración anual del ejercicio en que se expidió.
 * Se toma MARZO del año siguiente (personas morales), que es el más temprano:
 * para una persona física es abril. Solo es un aviso; si ya pasó, el SAT la
 * rechaza.
 */
export function fueraDePlazoDeCancelacion(emitidoEn: Date, ahora: Date, timeZone = "America/Mexico_City"): boolean {
  const e = fechaEn(emitidoEn, timeZone);
  const a = fechaEn(ahora, timeZone);
  return a.y > e.y + 1 || (a.y === e.y + 1 && a.m > 3);
}

// ── 4 · Validar la solicitud ─────────────────────────────────────────────────

export interface CfdiParaCancelar {
  id: string;
  uuid: string;
  status: string;
  tipoComprobante: string;
  invoiceId: string | null;
  total: number;
  receptorRfc: string | null;
  cancellationStatus: EstadoCancelacion | null;
  cancelRequestedAt: Date | null;
}

export interface SustitutoParaCancelar {
  id: string;
  uuid: string;
  status: string;
  tipoComprobante: string;
  invoiceId: string | null;
  /** UUID al que dice sustituir (relación 04), si se registró. */
  relatedUuid: string | null;
  relationType: string | null;
}

export type ErrorCancelacion =
  | "MOTIVO_INVALIDO" | "RAZON_CORTA" | "NO_VIGENTE" | "EN_CURSO" | "APARTADO"
  | "FALTA_SUSTITUTO" | "SUSTITUTO_INVALIDO" | "MOTIVO_04_SOLO_GLOBAL"
  | "TIENE_EGRESOS_VIGENTES";

export const MENSAJES_ERROR_CANCELACION: Record<ErrorCancelacion, string> = {
  MOTIVO_INVALIDO: "Elige el motivo de cancelación del SAT (01, 02, 03 o 04).",
  RAZON_CORTA: "Escribe con tus palabras por qué se cancela (al menos 5 letras): es lo que se leerá en la bitácora dentro de meses.",
  NO_VIGENTE: "Ese CFDI ya no está vigente: no hay nada que cancelar.",
  EN_CURSO: "Ese CFDI ya tiene una cancelación en curso (o no se sabe si la anterior llegó al SAT). Usa «Consultar estado en el SAT» antes de volver a intentarlo: una segunda cancelación no se puede deshacer.",
  APARTADO: "Ese CFDI se quedó a medio timbrar: no tiene folio fiscal confirmado. Revísalo con soporte antes de cancelarlo.",
  FALTA_SUSTITUTO: "Con el motivo 01 primero se timbra el CFDI que lo sustituye; luego se cancela éste relacionándolo. Usa «Sustituir CFDI».",
  SUSTITUTO_INVALIDO: "El CFDI sustituto no es válido: tiene que ser un CFDI de ingreso vigente de la misma factura, timbrado con relación 04 a éste.",
  MOTIVO_04_SOLO_GLOBAL: "El motivo 04 solo aplica a una factura global (público en general, XAXX010101000). Para este CFDI usa 01, 02 o 03.",
  TIENE_EGRESOS_VIGENTES: "Este CFDI tiene notas de crédito vigentes relacionadas. El SAT no deja cancelarlo así: cancela primero esas notas de crédito.",
};

/**
 * ¿Se puede pedir la cancelación? Devuelve el primer motivo por el que no, o
 * null. Todo se comprueba ANTES de hablar con Facturapi.
 */
export function validarCancelacion(args: {
  motive: unknown;
  reason: unknown;
  cfdi: CfdiParaCancelar;
  sustituto: SustitutoParaCancelar | null;
  egresosVigentes: number;
  ahora: Date;
}): ErrorCancelacion | null {
  const { cfdi } = args;
  if (!esMotivoCancelacion(args.motive)) return "MOTIVO_INVALIDO";
  const razon = typeof args.reason === "string" ? args.reason.trim() : "";
  if (razon.length < 5) return "RAZON_CORTA";
  if (cfdi.status === "apartado" || cfdi.uuid.startsWith("reservando:") || cfdi.uuid.startsWith("timbrando:")) {
    return "APARTADO";
  }
  if (!sigueVigente(cfdi.status)) return "NO_VIGENTE";
  if (cfdi.cancellationStatus && ESTADOS_EN_CURSO.includes(cfdi.cancellationStatus)) {
    const reservaVieja = cfdi.cancellationStatus === "enviando"
      && cfdi.cancelRequestedAt
      && args.ahora.getTime() - cfdi.cancelRequestedAt.getTime() > RESERVA_CANCELACION_MIN * 60_000;
    if (!reservaVieja) return "EN_CURSO";
  }
  if (args.motive === "04" && String(cfdi.receptorRfc ?? "").toUpperCase() !== RFC_PUBLICO_GENERAL) {
    return "MOTIVO_04_SOLO_GLOBAL";
  }
  if (cfdi.tipoComprobante === "I" && args.egresosVigentes > 0) return "TIENE_EGRESOS_VIGENTES";
  if (args.motive === "01") {
    const s = args.sustituto;
    if (!s) return "FALTA_SUSTITUTO";
    if (
      s.id === cfdi.id
      || s.status !== "valid"
      || s.tipoComprobante !== cfdi.tipoComprobante
      || !s.invoiceId || s.invoiceId !== cfdi.invoiceId
      || s.relationType !== "04" || s.relatedUuid !== cfdi.uuid
    ) {
      return "SUSTITUTO_INVALIDO";
    }
  }
  return null;
}

// ── 5 · Sustitución (motivo 01): timbrar el nuevo con relación 04 ─────────────

export type ErrorSustitucion = "NO_ES_DE_ESTA_FACTURA" | "NO_VIGENTE" | "EN_CURSO" | "POR_PAGO";

export const MENSAJES_ERROR_SUSTITUCION: Record<ErrorSustitucion, string> = {
  NO_ES_DE_ESTA_FACTURA: "El CFDI que quieres sustituir no es el CFDI vigente de esta factura.",
  NO_VIGENTE: "El CFDI que quieres sustituir ya no está vigente.",
  EN_CURSO: "Ese CFDI tiene una cancelación en curso: espera a que el SAT conteste antes de sustituirlo.",
  POR_PAGO: "Ese CFDI es de un pago, no de la factura completa. Sustitúyelo desde el pago.",
};

/**
 * ¿Se puede timbrar un CFDI que SUSTITUYA a `viejo` en esta factura? La factura
 * tiene que seguir apuntando a él (`invoices.cfdiUuid`), y él tiene que seguir
 * vigente y sin una cancelación en curso.
 */
export function validarSustitucion(args: {
  invoiceId: string;
  invoiceCfdiUuid: string | null;
  viejo: { uuid: string; status: string; invoiceId: string | null; paymentId: string | null; tipoComprobante: string; cancellationStatus: EstadoCancelacion | null } | null;
}): ErrorSustitucion | null {
  const v = args.viejo;
  if (!v || v.invoiceId !== args.invoiceId || v.tipoComprobante !== "I") return "NO_ES_DE_ESTA_FACTURA";
  if (v.paymentId) return "POR_PAGO";
  if (v.status !== "valid") return "NO_VIGENTE";
  if (args.invoiceCfdiUuid !== v.uuid) return "NO_ES_DE_ESTA_FACTURA";
  if (v.cancellationStatus && ESTADOS_EN_CURSO.includes(v.cancellationStatus)) return "EN_CURSO";
  return null;
}

// ── 6 · Nota de crédito (CFDI de egreso, relación 01) ────────────────────────

/** Guía de llenado del CFDI 4.0: egreso por devoluciones, descuentos o bonificaciones. */
export const CLAVE_SAT_EGRESO = "84111506"; // Servicios de facturación
export const UNIDAD_SAT_EGRESO = "ACT";     // Actividad

/**
 * Regímenes del receptor con los que el SAT acepta el uso G02 «Devoluciones,
 * descuentos o bonificaciones» (catálogo c_UsoCFDI). Una persona física con
 * sueldos (605) NO está: para ella se repite el uso del CFDI original.
 * CONFIRMAR CON CONTADOR.
 */
export const REGIMENES_CON_G02 = ["601", "603", "606", "612", "620", "621", "622", "623", "624", "625", "626"];

export function usoParaEgreso(regimenReceptor: string | null | undefined, usoOriginal: string | null | undefined): string {
  const r = String(regimenReceptor ?? "").trim();
  if (REGIMENES_CON_G02.includes(r)) return "G02";
  const u = String(usoOriginal ?? "").trim();
  return u && u !== "CP01" ? u : "S01";
}

export type ModoIvaCfdi = "exento" | "iva16";

/**
 * El tratamiento de IVA del CFDI original, leído de los conceptos que se
 * mandaron a Facturapi (`cfdi_records.conceptos`). La nota de crédito lleva el
 * MISMO tratamiento: devolver parte de un servicio exento es exento.
 */
export function modoIvaDeConceptos(conceptos: unknown): ModoIvaCfdi {
  const lista = Array.isArray(conceptos) ? conceptos : [];
  for (const c of lista) {
    const taxes = (c as any)?.product?.taxes;
    if (Array.isArray(taxes) && taxes.some((t: any) => t?.type === "IVA" && t?.factor !== "Exento" && Number(t?.rate) > 0)) {
      return "iva16";
    }
  }
  return "exento";
}

/**
 * El concepto único de la nota de crédito. `monto` es lo que se devuelve o se
 * descuenta, CON IVA si lo hay (es lo que el paciente ve): con IVA va
 * `tax_included: true` para que el total del egreso sea exactamente `monto`.
 */
export function conceptoNotaDeCredito(args: { monto: number; modoIva: ModoIvaCfdi; descripcion: string }) {
  const monto = round2(args.monto);
  return {
    quantity: 1,
    product: {
      description: args.descripcion.slice(0, 1000),
      product_key: CLAVE_SAT_EGRESO,
      unit_key: UNIDAD_SAT_EGRESO,
      price: monto,
      tax_included: args.modoIva === "iva16",
      taxes: args.modoIva === "exento"
        ? [{ type: "IVA", factor: "Exento", rate: 0 }]
        : [{ type: "IVA", rate: 0.16 }],
    },
  };
}

export type ErrorNotaCredito =
  | "MONTO_INVALIDO" | "RAZON_CORTA" | "NO_ES_INGRESO" | "NO_VIGENTE" | "EN_CURSO"
  | "EXCEDE_CFDI" | "EXCEDE_PAGADO" | "EXCEDE_SALDO" | "FACTURA_CANCELADA";

export const MENSAJES_ERROR_NOTA: Record<ErrorNotaCredito, string> = {
  MONTO_INVALIDO: "Escribe un monto mayor a $0.",
  RAZON_CORTA: "Escribe el motivo de la nota de crédito (al menos 5 letras): sale en el CFDI y en la bitácora.",
  NO_ES_INGRESO: "La nota de crédito solo se emite sobre un CFDI de ingreso.",
  NO_VIGENTE: "Ese CFDI ya no está vigente.",
  EN_CURSO: "Ese CFDI tiene una cancelación en curso: no se le puede emitir una nota de crédito.",
  EXCEDE_CFDI: "El monto pasa de lo que queda del CFDI (su total menos las notas de crédito que ya tiene).",
  EXCEDE_PAGADO: "No se puede devolver más de lo que el paciente ha pagado en esta factura.",
  EXCEDE_SALDO: "Un descuento sin devolver dinero no puede pasar del saldo pendiente de la factura.",
  FACTURA_CANCELADA: "La factura interna está cancelada.",
};

/** Lo que queda del CFDI para notas de crédito: su total menos los egresos vigentes. */
export function disponibleParaNota(totalCfdi: number, egresosVigentes: number[]): number {
  return round2(Math.max(0, totalCfdi - egresosVigentes.reduce((a, b) => a + b, 0)));
}

export interface FacturaParaNota {
  status: string;
  subtotal: number;
  discount: number;
  total: number;
  paid: number;
  balance: number;
  taxRate: number | null;
  taxIncluded: boolean | null;
}

/**
 * Forma plana a propósito (con `strict: false` TypeScript no estrecha una
 * unión por `ok`): con ok=true vienen los números; con ok=false, `error`.
 */
export type EfectoNota =
  | { ok: true; total: number; discount: number; paid: number; balance: number; status: "PAID" | "PARTIAL" | "PENDING"; error?: undefined }
  | { ok: false; error: ErrorNotaCredito; total?: undefined; discount?: undefined; paid?: undefined; balance?: undefined; status?: undefined };

/**
 * Efecto de la nota de crédito en la factura INTERNA, para que quede
 * coherente con el SAT. La nota baja el importe de la operación:
 *   · total   −= monto (el CFDI vigente menos el egreso = lo que vale la venta);
 *   · descuento += la parte de BASE del monto (con IVA agregado se quita el IVA,
 *     porque `total = (subtotal − descuento) × 1.16`; exento o IVA incluido,
 *     el monto entero) — así el comprobante impreso sigue cuadrando;
 *   · con devolución de dinero, `paid −= monto` (un Payment «refund», igual que
 *     el reembolso de siempre) y el saldo NO cambia; sin devolución
 *     (bonificación sobre saldo), el saldo baja lo mismo que el total.
 *
 * Ejemplo de la auditoría: factura timbrada de $1,600 pagada, devolución de
 * $500 → total $1,100, pagado $1,100, saldo $0 (PAID).
 */
export function efectoNotaEnFactura(
  f: FacturaParaNota,
  monto: number,
  devolverDinero: boolean,
): EfectoNota {
  const m = round2(monto);
  if (!(m > 0) || !isFinite(m)) return { ok: false, error: "MONTO_INVALIDO" };
  if (f.status === "CANCELLED") return { ok: false, error: "FACTURA_CANCELADA" };
  if (devolverDinero && m > round2(f.paid) + 0.001) return { ok: false, error: "EXCEDE_PAGADO" };
  if (!devolverDinero && m > round2(f.balance) + 0.001) return { ok: false, error: "EXCEDE_SALDO" };

  const rate = Number(f.taxRate);
  const ivaAgregado = f.taxIncluded === false && isFinite(rate) && rate > 0;
  const base = ivaAgregado ? round2(m / (1 + rate / 100)) : m;

  const total = round2(Math.max(0, f.total - m));
  const discount = round2(Math.max(0, (f.discount || 0) + base));
  const paid = devolverDinero ? round2(Math.max(0, f.paid - m)) : round2(f.paid);
  const balance = round2(Math.max(0, total - paid));
  const status = paid <= 0 && total > 0 ? "PENDING" : balance > 0.009 ? "PARTIAL" : "PAID";
  return { ok: true, total, discount, paid, balance, status };
}

/**
 * Validación de la nota de crédito antes de timbrar.
 */
export function validarNotaCredito(args: {
  monto: unknown;
  razon: unknown;
  cfdi: { status: string; tipoComprobante: string; total: number; cancellationStatus: EstadoCancelacion | null };
  egresosVigentes: number[];
  factura: FacturaParaNota;
  devolverDinero: boolean;
}): ErrorNotaCredito | null {
  const monto = round2(Number(args.monto));
  if (!isFinite(monto) || monto <= 0) return "MONTO_INVALIDO";
  const razon = typeof args.razon === "string" ? args.razon.trim() : "";
  if (razon.length < 5) return "RAZON_CORTA";
  if (args.cfdi.tipoComprobante !== "I") return "NO_ES_INGRESO";
  if (args.cfdi.status !== "valid") return "NO_VIGENTE";
  if (args.cfdi.cancellationStatus && ESTADOS_EN_CURSO.includes(args.cfdi.cancellationStatus)) return "EN_CURSO";
  if (monto > disponibleParaNota(args.cfdi.total, args.egresosVigentes) + 0.001) return "EXCEDE_CFDI";
  const efecto = efectoNotaEnFactura(args.factura, monto, args.devolverDinero);
  return efecto.ok ? null : efecto.error;
}
