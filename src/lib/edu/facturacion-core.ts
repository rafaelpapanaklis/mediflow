/**
 * DaleControl INSTITUCIONAL — FACTURACIÓN CFDI, la parte PURA.
 *
 * Módulo client-safe: sin prisma, sin "server-only", sin red. Lo importan
 * la pantalla (que es "use client"), las páginas de servidor y el módulo
 * de datos (facturacion.ts). Todo lo que se puede probar sin base de datos
 * vive aquí.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * LAS TRES REGLAS DE ESTE ARCHIVO
 *
 * 1. 🔴 EL AMBIENTE NO ES UNA CONSTANTE. En ningún sitio de este vertical
 *    se lee `process.env.FACTURAPI_ENV` (que es lo que hace el dental).
 *    El ambiente es un DATO del instituto —EduFiscalConfig.environment— y
 *    se pasa como argumento a las funciones de aquí. Una constante
 *    obligaría a que el instituto y el dental estuvieran siempre en el
 *    mismo ambiente, y a que la interfaz mintiera el día que no lo
 *    estuvieran.
 *
 * 2. 🔴 LOS IMPORTES SALEN DEL COBRO CONGELADO. `eduConceptosDeCobro`
 *    recibe las LÍNEAS del cobro (EduChargeItem, que ya guardan el precio
 *    congelado desde la Ola 5) y no toca el tarifario. Y antes de timbrar
 *    nada, `eduCuadreDelCobro` comprueba que la suma de las líneas sea
 *    EXACTAMENTE el total del cobro: un CFDI por un monto distinto al
 *    cobrado no se emite, se rechaza.
 *
 * 3. 🔴 EL DINERO VA EN CENTAVOS hasta el último momento. Solo
 *    `eduItemsFacturapi` convierte a pesos, porque el API de Facturapi
 *    habla en pesos. Dividir antes es cómo se acumulan medios centavos
 *    hasta que el XML no cuadra con el recibo.
 * ═══════════════════════════════════════════════════════════════════════
 */
import {
  FORMAS_PAGO_SAT,
  REGIMENES_FISCALES,
  USOS_CFDI,
} from "@/lib/cfdi-catalogs";
import type { EduPaymentMethod } from "@/lib/edu/types";

// ═══════════════════════════════════════════════════════════════════════
// 1 · LOS TRES ENUMS, ESPEJO DE PRISMA
//
// Se escriben como uniones de string y NO se importan de @prisma/client a
// propósito: este archivo entra al bundle del navegador y el cliente de
// Prisma no. El candado contra la desincronización es un chequeo de TIPOS
// en __tests__/edu-facturacion.test.ts, igual que el de EduRole.
// ═══════════════════════════════════════════════════════════════════════

export type EduFiscalEnv = "TEST" | "LIVE";
export const EDU_FISCAL_ENVS: EduFiscalEnv[] = ["TEST", "LIVE"];

export type EduInvoiceStatus = "STAMPING" | "VALID" | "CANCELLED" | "FAILED";
export const EDU_INVOICE_STATUSES: EduInvoiceStatus[] = [
  "STAMPING",
  "VALID",
  "CANCELLED",
  "FAILED",
];

export type EduTaxMode = "EXENTO" | "IVA16";
export const EDU_TAX_MODES: EduTaxMode[] = ["EXENTO", "IVA16"];

/**
 * 🔴 CÓMO SE LEE EL AMBIENTE EN PANTALLA, y por qué el texto es así de
 * explícito. El timbrado que hoy tiene DaleControl corre en PRUEBAS: un
 * documento de prueba se ve idéntico a uno fiscal —tiene UUID, tiene PDF,
 * tiene XML— y la única forma de que nadie se lo entregue a un paciente
 * creyendo que sirve para deducir es que la pantalla lo diga con todas sus
 * letras, en cada factura y no solo una vez en la configuración.
 */
export const EDU_FISCAL_ENV_LABELS: Record<EduFiscalEnv, string> = {
  TEST: "Pruebas",
  LIVE: "En vivo (SAT)",
};

export const EDU_FISCAL_ENV_DETAILS: Record<EduFiscalEnv, string> = {
  TEST: "Facturapi timbra con sus certificados de prueba. El documento NO llega al SAT y NO tiene validez fiscal: no se le puede entregar a un paciente como comprobante deducible.",
  LIVE: "Se timbra ante el SAT con el certificado (CSD) del instituto. El comprobante tiene validez fiscal y cancelarlo pasa por el SAT.",
};

export const EDU_INVOICE_STATUS_LABELS: Record<EduInvoiceStatus, string> = {
  STAMPING: "Timbrando",
  VALID: "Timbrada",
  CANCELLED: "Cancelada",
  FAILED: "No se timbró",
};

export const EDU_INVOICE_STATUS_DESCRIPTIONS: Record<EduInvoiceStatus, string> = {
  STAMPING:
    "Se reservó el cobro y se está pidiendo el timbre. Si se queda así, la llamada se cortó a media red y NO sabemos si el timbre salió: hay que revisarlo en Facturapi antes de volver a facturar ese cobro.",
  VALID: "Tiene folio fiscal (UUID). Se puede descargar y se puede cancelar.",
  CANCELLED: "Se canceló con su motivo. No se borró nada: el XML y el UUID siguen aquí, y el cobro se puede volver a facturar.",
  FAILED: "El timbrado se rechazó y no se emitió ningún comprobante. El cobro quedó libre para intentarlo otra vez.",
};

export const EDU_TAX_MODE_LABELS: Record<EduTaxMode, string> = {
  EXENTO: "Exento de IVA",
  IVA16: "IVA 16 % incluido en el precio",
};

export const EDU_TAX_MODE_DETAILS: Record<EduTaxMode, string> = {
  EXENTO:
    "Servicios de medicina y odontología prestados por profesionales: exentos por el artículo 15 de la Ley del IVA. Es el default de una clínica de escuela.",
  IVA16:
    "El precio del tarifario YA lleva el IVA dentro y se desglosa al timbrar. El total de la factura sigue siendo exactamente lo que se le cobró al paciente.",
};

// ═══════════════════════════════════════════════════════════════════════
// 2 · MOTIVOS DE CANCELACIÓN DEL SAT (c_MotivoCancelacion)
//
// ⚠️ FALTA EL "01" A PROPÓSITO. El 01 ("comprobante emitido con errores
// CON relación") obliga a mandar el UUID del CFDI que lo SUSTITUYE, y ese
// CFDI todavía no existe cuando alguien pulsa "Cancelar". Ofrecerlo aquí
// sería un botón que el SAT rechaza siempre. Para corregir una factura con
// errores: se cancela con 02 y se emite otra — el cobro queda libre en
// cuanto se cancela (ver el índice único de EduInvoice).
// ═══════════════════════════════════════════════════════════════════════

export interface EduCancelMotive {
  clave: string;
  label: string;
  detail: string;
}

export const EDU_CANCEL_MOTIVES: EduCancelMotive[] = [
  {
    clave: "02",
    label: "Comprobante emitido con errores, sin relación",
    detail: "Lo normal: el CFDI salió mal (RFC, uso, importes) y no hay otro que lo sustituya.",
  },
  {
    clave: "03",
    label: "No se llevó a cabo la operación",
    detail: "Se facturó algo que al final no se hizo ni se cobró.",
  },
  {
    clave: "04",
    label: "Operación nominativa relacionada en una factura global",
    detail: "El acto ya quedó incluido en una factura global del periodo.",
  },
];

export function esEduCancelMotive(raw: unknown): raw is string {
  return typeof raw === "string" && EDU_CANCEL_MOTIVES.some((m) => m.clave === raw);
}

// ═══════════════════════════════════════════════════════════════════════
// 3 · LOS DATOS FISCALES: NORMALIZAR Y VALIDAR
//
// Se valida AQUÍ y no solo en el navegador porque el navegador se puede
// saltar. Y se normaliza (mayúsculas, sin guiones, sin espacios de más)
// porque un RFC con un guion es un RFC que Facturapi rechaza y que además
// nunca vuelve a encontrar el buscador.
// ═══════════════════════════════════════════════════════════════════════

/** Largo máximo de una razón social; el mismo del schema. */
export const EDU_MAX_LEGAL_NAME = 200;

/**
 * RFC normalizado, o null si no lo es.
 *
 * Acepta los dos largos (12 = persona moral, 13 = persona física) y los
 * genéricos XAXX010101000 (público en general) y XEXX010101000
 * (extranjero), que son RFC válidos y encajan en el mismo patrón.
 *
 * ⚠️ Esto NO comprueba que el RFC exista en el SAT. Eso lo hace el
 * timbrado, y la lista negra EFOS la consulta el servidor. Aquí solo se
 * atrapa el error de dedo antes de gastar un timbre.
 */
export function normalizeEduRfc(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw
    .toUpperCase()
    .replace(/[\s.\-_]/g, "")
    .trim();
  if (v.length < 12 || v.length > 13) return null;
  return /^[A-ZÑ&]{3,4}\d{6}[A-Z\d]{3}$/.test(v) ? v : null;
}

/** Código postal del domicilio fiscal: exactamente cinco dígitos. */
export function normalizeEduZip(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  return /^\d{5}$/.test(v) ? v : null;
}

/**
 * Razón social. Se colapsan los espacios de más (un doble espacio pegado
 * al copiar de la Constancia hace que el SAT no reconozca el nombre) y se
 * recorta al largo de la columna. NO se pasa a mayúsculas: hay razones
 * sociales que el SAT guarda con minúsculas y forzarlas sería inventar.
 */
export function normalizeEduLegalName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.replace(/\s+/g, " ").trim();
  if (v.length < 3) return null;
  return v.slice(0, EDU_MAX_LEGAL_NAME);
}

export function esEduTaxRegime(raw: unknown): raw is string {
  return typeof raw === "string" && REGIMENES_FISCALES.some((r) => r.clave === raw);
}

export function esEduUsoCfdi(raw: unknown): raw is string {
  return typeof raw === "string" && USOS_CFDI.some((u) => u.clave === raw);
}

export function esEduFormaPago(raw: unknown): raw is string {
  return typeof raw === "string" && FORMAS_PAGO_SAT.some((f) => f.clave === raw);
}

/** Clave del catálogo c_ClaveProdServ: ocho dígitos, sin excepciones. */
export function esEduProductKey(raw: unknown): raw is string {
  return typeof raw === "string" && /^\d{8}$/.test(raw);
}

export function esEduTaxMode(raw: unknown): raw is EduTaxMode {
  return raw === "EXENTO" || raw === "IVA16";
}

export function esEduFiscalEnv(raw: unknown): raw is EduFiscalEnv {
  return raw === "TEST" || raw === "LIVE";
}

export function esEduInvoiceStatus(raw: unknown): raw is EduInvoiceStatus {
  return (
    raw === "STAMPING" || raw === "VALID" || raw === "CANCELLED" || raw === "FAILED"
  );
}

/** Correo opcional del receptor. Devuelve null si viene vacío o inservible. */
export function normalizeEduTaxEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  if (v.length > 160) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? v : null;
}

/** Los datos fiscales de un receptor, ya validados. */
export interface EduReceptorFiscal {
  rfc: string;
  legalName: string;
  taxRegime: string;
  zipCode: string;
  email: string | null;
  usoCfdi: string;
}

/**
 * Valida los datos de un receptor de una sola vez y devuelve, o bien el
 * receptor limpio, o bien QUÉ campo está mal, con un texto para una
 * persona. Un solo punto: si cada pantalla validara por su cuenta, el
 * endpoint acabaría aceptando lo que el modal rechaza (o al revés).
 *
 * ⚠️ Devuelve un objeto PLANO con los dos campos y no una unión
 * discriminada (`{ok:true,…} | {ok:false,…}`), que era lo natural: este
 * repo compila con `strict: false`, y ahí TypeScript no estrecha la
 * unión con un `if (!r.ok)` — el acceso a `r.error` no compila. Un tipo
 * plano cuesta un `!` en quien lo usa y funciona en los dos modos.
 */
export interface EduReceptorParse {
  ok: boolean;
  /** Solo cuando ok === true. */
  receptor: EduReceptorFiscal | null;
  /** Solo cuando ok === false. */
  error: string | null;
}

export function parseEduReceptor(
  input: Record<string, unknown>,
  defaults: { usoCfdi: string },
): EduReceptorParse {
  const rfc = normalizeEduRfc(input.rfc);
  if (!rfc) {
    return {
      ok: false,
      receptor: null,
      error:
        "El RFC no tiene forma de RFC. Son 12 caracteres (empresa) o 13 (persona), sin guiones ni espacios.",
    };
  }
  const legalName = normalizeEduLegalName(input.legalName);
  if (!legalName) {
    return {
      ok: false,
      receptor: null,
      error:
        "Falta la razón social. Cópiala EXACTAMENTE como aparece en la Constancia de Situación Fiscal, sin el régimen de capital (sin «S.A. de C.V.»).",
    };
  }
  if (!esEduTaxRegime(input.taxRegime)) {
    return { ok: false, receptor: null, error: "Elige el régimen fiscal del receptor." };
  }
  const zipCode = normalizeEduZip(input.zipCode);
  if (!zipCode) {
    return { ok: false, receptor: null, error: "El código postal del domicilio fiscal son cinco dígitos." };
  }
  const usoCfdi = esEduUsoCfdi(input.usoCfdi) ? input.usoCfdi : defaults.usoCfdi;
  if (!esEduUsoCfdi(usoCfdi)) {
    return { ok: false, receptor: null, error: "Elige el uso del CFDI." };
  }
  return {
    ok: true,
    error: null,
    receptor: {
      rfc,
      legalName,
      taxRegime: input.taxRegime as string,
      zipCode,
      email: normalizeEduTaxEmail(input.email),
      usoCfdi,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 4 · LA FORMA DE PAGO DEL SAT
//
// 🔴 NO SE ADIVINA. Si no se puede deducir del pago registrado, esta
// función devuelve null y el modal OBLIGA a elegirla. Un default silencioso
// ("pongo 03, transferencia") es un dato falso en un documento fiscal, y
// además es el que el SAT usa para cruzar contra los depósitos.
// ═══════════════════════════════════════════════════════════════════════

const FORMA_POR_METODO: Record<EduPaymentMethod, string | null> = {
  CASH: "01", // Efectivo
  // 🔴 Tarjeta LEGADA. El SAT distingue crédito (04) de débito (28) y las
  // filas viejas del vertical guardaron un solo "CARD" sin decir cuál.
  // Se PROPONE crédito, que es lo más común en una terminal de clínica, y
  // el modal lo deja cambiar: proponer no es decidir, y quien cobró tiene
  // el voucher a la vista. Los pagos NUEVOS ya no caen aquí: se cobran con
  // CARD_DEBIT o CARD_CREDIT y la clave sale exacta.
  CARD: "04",
  CARD_DEBIT: "28", // Tarjeta de débito
  CARD_CREDIT: "04", // Tarjeta de crédito
  TRANSFER: "03", // Transferencia electrónica de fondos
  CHECK: "02", // Cheque nominativo
  // "Otro" no se traduce: puede ser un vale, una beca, una compensación.
  // Que lo diga quien cobró.
  OTHER: null,
};

export interface EduPagoParaForma {
  method: EduPaymentMethod;
  isRefund: boolean;
  paidAt: string | Date;
  /** Centavos POSITIVOS del pago. Es lo que decide en un pago mixto. */
  amountCents: number;
}

/**
 * La forma de pago SUGERIDA en un pago MIXTO: la del método con MAYOR
 * monto neto (las devoluciones no cuentan). Sin pagos, o si el que gana
 * es "Otro", devuelve null y el modal obliga a elegirla.
 *
 * 🔴 Cambió de "el último pago" a "el de mayor monto" cuando el vertical
 * empezó a admitir hasta tres formas en una operación. Es la regla del
 * SAT para un CFDI con pago mixto —la forma de pago es la del importe
 * mayor— y además la de sentido común: con $900 en efectivo y $100 con
 * tarjeta, decir "tarjeta" porque se registró de segunda sería describir
 * mal la operación en un documento fiscal.
 *
 * Empate exacto entre dos métodos: gana el MÁS RECIENTE, que es la regla
 * anterior aplicada solo al desempate — arbitraria pero estable, y así el
 * mismo cobro sugiere siempre lo mismo.
 */
export function eduSugerirFormaPago(pagos: EduPagoParaForma[]): string | null {
  if (!Array.isArray(pagos)) return null;

  // Por método: cuánto suma y cuál fue su pago más reciente.
  const porMetodo = new Map<EduPaymentMethod, { total: number; ultimo: number }>();
  for (const p of pagos) {
    if (!p || p.isRefund) continue;
    const monto = Number.isFinite(p.amountCents) ? Number(p.amountCents) : 0;
    if (monto <= 0) continue;
    const cuando = new Date(p.paidAt).getTime();
    const previo = porMetodo.get(p.method);
    porMetodo.set(p.method, {
      total: (previo?.total ?? 0) + monto,
      ultimo: Math.max(previo?.ultimo ?? Number.NEGATIVE_INFINITY, Number.isFinite(cuando) ? cuando : 0),
    });
  }

  let ganador: EduPaymentMethod | null = null;
  let mejor = { total: 0, ultimo: Number.NEGATIVE_INFINITY };
  // forEach y no `for…of`: el target del repo no permite iterar un Map.
  porMetodo.forEach((dato, method) => {
    if (dato.total > mejor.total || (dato.total === mejor.total && dato.ultimo > mejor.ultimo)) {
      ganador = method;
      mejor = dato;
    }
  });
  if (!ganador) return null;
  return FORMA_POR_METODO[ganador] ?? null;
}

// ═══════════════════════════════════════════════════════════════════════
// 5 · LOS CONCEPTOS: DEL COBRO CONGELADO AL CFDI
// ═══════════════════════════════════════════════════════════════════════

/** Unidad de medida del SAT para un servicio (c_ClaveUnidad). */
export const EDU_UNIDAD_SAT = "E48";

/** Una línea del cobro, tal como la guardó la Ola 5. */
export interface EduLineaDeCobro {
  description: string;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
  totalCents: number;
}

/** Un concepto del CFDI, congelado en la factura. */
export interface EduConceptoCfdi {
  description: string;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
  totalCents: number;
  productKey: string;
  unitKey: string;
}

/**
 * Los conceptos que se van a timbrar, copiados de las líneas del cobro.
 *
 * 🔴 No se consulta el tarifario ni el catálogo: `description` y
 * `unitPriceCents` son los que se congelaron al cobrar. Lo ÚNICO que se
 * añade es la clave del SAT, que es una propiedad del instituto y no del
 * cobro (el catálogo de procedimientos de la escuela no la guarda).
 */
export function eduConceptosDeCobro(
  lineas: EduLineaDeCobro[],
  productKey: string,
): EduConceptoCfdi[] {
  const clave = esEduProductKey(productKey) ? productKey : "85121600";
  return lineas.map((l) => ({
    description: (l.description || "Servicio odontológico").slice(0, 160),
    quantity: l.quantity,
    unitPriceCents: l.unitPriceCents,
    discountCents: l.discountCents,
    totalCents: l.totalCents,
    productKey: clave,
    unitKey: EDU_UNIDAD_SAT,
  }));
}

/** Centavos a pesos con dos decimales exactos (para el payload de Facturapi). */
export function eduCentsToPesos(cents: number): number {
  return Math.round(cents) / 100;
}

/**
 * El payload de `items` que entiende Facturapi.
 *
 * Los impuestos van SIEMPRE explícitos: sin `taxes`, Facturapi desglosa
 * IVA 16 % por su cuenta (es su default documentado), y un honorario
 * odontológico exento saldría con IVA. Ése es el bug que ya se pagó en el
 * dental y que aquí no se puede repetir.
 *
 * `tax_included: true` en IVA16 no es un detalle: el precio del tarifario
 * de la escuela ES el precio final que paga el paciente. Si el IVA se
 * sumara encima, el CFDI saldría por más de lo cobrado.
 */
export function eduItemsFacturapi(conceptos: EduConceptoCfdi[], taxMode: EduTaxMode) {
  const taxes =
    taxMode === "EXENTO"
      ? [{ type: "IVA", factor: "Exento", rate: 0 }]
      : [{ type: "IVA", rate: 0.16 }];
  return conceptos.map((c) => ({
    quantity: c.quantity,
    product: {
      description: c.description,
      product_key: c.productKey,
      unit_key: c.unitKey,
      price: eduCentsToPesos(c.unitPriceCents),
      tax_included: taxMode !== "EXENTO",
      taxes,
    },
    discount: eduCentsToPesos(c.discountCents),
  }));
}

// ═══════════════════════════════════════════════════════════════════════
// 6 · 🔴 EL CUADRE: NO SE TIMBRA UN MONTO QUE NO SE COBRÓ
//
// El CFDI se emite por los CONCEPTOS. Si la suma de las líneas no da el
// total del cobro, timbrar emitiría un comprobante por un importe distinto
// del que el paciente pagó. No se corrige solo, no se redondea: se
// RECHAZA, y se dice cuál es la diferencia.
// ═══════════════════════════════════════════════════════════════════════

export interface EduCobroParaCuadre {
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
}

export interface EduCuadre {
  ok: boolean;
  /** Lo que suman las líneas. */
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  /** Texto para una persona cuando no cuadra. null si cuadra. */
  error: string | null;
}

function pesos(cents: number): string {
  const signo = cents < 0 ? "−" : "";
  const abs = Math.abs(Math.round(cents));
  return `${signo}$${(abs / 100).toLocaleString("es-MX", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function eduCuadreDelCobro(
  cobro: EduCobroParaCuadre,
  lineas: EduLineaDeCobro[],
): EduCuadre {
  let subtotalCents = 0;
  let discountCents = 0;
  let totalCents = 0;
  for (const l of lineas) {
    subtotalCents += l.quantity * l.unitPriceCents;
    discountCents += l.discountCents;
    totalCents += l.totalCents;
  }

  const base: Omit<EduCuadre, "ok" | "error"> = { subtotalCents, discountCents, totalCents };

  if (lineas.length === 0) {
    return { ...base, ok: false, error: "El cobro no tiene conceptos: no hay nada que timbrar." };
  }
  // Aritmética entera: la igualdad es EXACTA. No hay tolerancia que dar,
  // y darla sería la puerta a timbrar un peso de más "porque redondea".
  if (totalCents !== cobro.totalCents) {
    return {
      ...base,
      ok: false,
      error: `Los conceptos del cobro suman ${pesos(totalCents)} y el cobro dice ${pesos(
        cobro.totalCents,
      )}. No se timbra: el CFDI saldría por un importe distinto del que se cobró.`,
    };
  }
  if (subtotalCents - discountCents !== totalCents) {
    return {
      ...base,
      ok: false,
      error: `Las líneas no cuadran solas: ${pesos(subtotalCents)} menos ${pesos(
        discountCents,
      )} de descuento no da ${pesos(totalCents)}.`,
    };
  }
  if (totalCents <= 0) {
    return { ...base, ok: false, error: "No se puede timbrar un comprobante por $0.00." };
  }
  return { ...base, ok: true, error: null };
}

// ═══════════════════════════════════════════════════════════════════════
// 7 · EL AVISO DEL AMBIENTE
//
// 🔴 Es la advertencia central de esta ola: hoy el timbrado corre en
// PRUEBAS. Ninguna pantalla puede decir que una factura tiene validez
// fiscal si no la tiene, y el dato sale de la CONFIGURACIÓN del instituto,
// no de una constante del código.
// ═══════════════════════════════════════════════════════════════════════

export interface EduFiscalNotice {
  level: "pruebas" | "vivo" | "sin-configurar" | "apagado";
  title: string;
  detail: string;
}

export function eduFiscalNotice(config: {
  environment: EduFiscalEnv;
  isEnabled: boolean;
} | null): EduFiscalNotice {
  if (!config) {
    return {
      level: "sin-configurar",
      title: "Todavía no hay datos fiscales del instituto",
      detail:
        "Sin RFC, razón social, régimen y código postal no se puede emitir ni un comprobante de prueba. Se capturan en Facturación → Datos fiscales.",
    };
  }
  if (!config.isEnabled) {
    return {
      level: "apagado",
      title: "La facturación está apagada",
      detail:
        "Los datos fiscales están capturados pero nadie puede emitir. Enciéndela en Facturación → Datos fiscales cuando la escuela esté lista.",
    };
  }
  if (config.environment === "LIVE") {
    return {
      level: "vivo",
      title: "Timbrado EN VIVO ante el SAT",
      detail:
        "Lo que se emita aquí es un comprobante fiscal real: lo recibe el SAT, el paciente lo puede deducir y cancelarlo pasa por el SAT.",
    };
  }
  return {
    level: "pruebas",
    title: "Ambiente de PRUEBAS: estas facturas NO tienen validez fiscal",
    detail:
      "Facturapi timbra con sus certificados de prueba. El documento se ve igual que uno real —tiene folio fiscal, PDF y XML— pero no llega al SAT y NO le sirve al paciente para deducir. No se lo entregues como comprobante.",
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 8 · FILTROS Y LÍMITES DE LA PANTALLA
// ═══════════════════════════════════════════════════════════════════════

/** Tope de filas por consulta. Mismo criterio que la caja de la Ola 5. */
export const EDU_INVOICE_MAX_ROWS = 200;

export interface EduInvoiceFilters {
  /** Folio, UUID, RFC o nombre del receptor. */
  q: string;
  /** null = todos los estados. */
  status: EduInvoiceStatus | null;
}

export const EDU_INVOICE_EMPTY_FILTERS: EduInvoiceFilters = { q: "", status: null };

function primero(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v[0] ?? "";
  return v ?? "";
}

export function parseEduInvoiceFilters(
  params: Record<string, string | string[] | undefined> | undefined,
): EduInvoiceFilters {
  if (!params) return { ...EDU_INVOICE_EMPTY_FILTERS };
  const q = primero(params.q).trim().slice(0, 80);
  const rawStatus = primero(params.estado).trim().toUpperCase();
  return { q, status: esEduInvoiceStatus(rawStatus) ? rawStatus : null };
}

export function eduHasInvoiceFilters(f: EduInvoiceFilters): boolean {
  return Boolean(f.q) || f.status !== null;
}

// ═══════════════════════════════════════════════════════════════════════
// 9 · LO QUE VIAJA A LA PANTALLA
//
// Ni una de estas formas lleva la Live Secret Key, el `facturapiOrgId` ni
// el XML completo: son objetos que se serializan a un componente "use
// client" y todo lo que entra ahí acaba en el HTML.
// ═══════════════════════════════════════════════════════════════════════

export interface EduFiscalConfigView {
  rfc: string;
  legalName: string;
  taxRegime: string;
  zipCode: string;
  environment: EduFiscalEnv;
  isEnabled: boolean;
  /** true = ya hay organización creada en Facturapi. */
  hasOrg: boolean;
  csdUploadedAt: string | null;
  taxMode: EduTaxMode;
  defaultUsoCfdi: string;
  defaultProductKey: string;
  folioPrefix: string;
  updatedByName: string | null;
  updatedAt: string;
}

/** Lo que Facturapi dice que le falta a la organización para timbrar en vivo. */
export interface EduFiscalReadiness {
  /** null = no se pudo consultar (Facturapi caído, sin llave de cuenta). */
  productionReady: boolean | null;
  pendingSteps: { type: string; description: string | null }[];
  certificateExpiresAt: string | null;
  /** Por qué no se pudo consultar. null si sí se pudo. */
  unavailableReason: string | null;
}

export interface EduInvoiceRow {
  id: string;
  folio: string;
  status: EduInvoiceStatus;
  environment: EduFiscalEnv;
  chargeId: string;
  chargeFolio: string;
  patientId: string;
  patientName: string;
  patientFolio: string;
  receptorRfc: string;
  receptorLegalName: string;
  usoCfdi: string;
  paymentForm: string;
  taxMode: EduTaxMode;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  conceptos: EduConceptoCfdi[];
  uuid: string | null;
  stampedAt: string | null;
  issuedAt: string;
  issuedByName: string;
  cancelledAt: string | null;
  cancelledByName: string | null;
  cancelMotive: string | null;
  cancelReason: string | null;
  errorMessage: string | null;
  /** true = el XML está guardado en la base (no depende de Facturapi). */
  hasXml: boolean;
  /** true = hay un documento en Facturapi del que bajar PDF/XML. */
  hasDocument: boolean;
}

export interface EduInvoicesPage {
  rows: EduInvoiceRow[];
  truncated: boolean;
  /** Suma de las TIMBRADAS y vivas. Las canceladas y las fallidas no suman. */
  totals: { vivas: number; totalCents: number; canceladas: number };
}

/** Un cobro candidato a facturarse, para el selector del modal. */
export interface EduCobroFacturable {
  id: string;
  folio: string;
  patientId: string;
  patientName: string;
  patientFolio: string;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  chargedAt: string;
  /** Folio de la factura VIVA de este cobro, si ya tiene una. */
  facturaFolio: string | null;
  /** El estado de esa factura viva (para decir "se está timbrando"). */
  facturaStatus: EduInvoiceStatus | null;
}

/** El descriptivo de una clave SAT, para pintarla sin que parezca un código. */
export function eduDescribeUsoCfdi(clave: string): string {
  return USOS_CFDI.find((u) => u.clave === clave)?.descripcion ?? clave;
}

export function eduDescribeFormaPago(clave: string): string {
  return FORMAS_PAGO_SAT.find((f) => f.clave === clave)?.descripcion ?? clave;
}

export function eduDescribeRegimen(clave: string): string {
  return REGIMENES_FISCALES.find((r) => r.clave === clave)?.descripcion ?? clave;
}

export function eduDescribeCancelMotive(clave: string | null): string {
  if (!clave) return "—";
  return EDU_CANCEL_MOTIVES.find((m) => m.clave === clave)?.label ?? clave;
}

/**
 * El siguiente folio interno a partir del último. Puro para poder probarlo:
 * el relleno con ceros es lo que hace que el orden alfabético de Postgres
 * coincida con el numérico (sin él "F-9" iría después de "F-10"), igual que
 * el folio del cobro de la Ola 5 y el del paciente de la Ola 2.
 */
export function eduNextInvoiceFolio(prefix: string, ultimo: string | null): string {
  const p = (prefix || "F").toUpperCase().slice(0, 6);
  const m = ultimo?.match(new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d{1,6})$`));
  const n = m ? Number(m[1]) + 1 : 1;
  return `${p}-${String(n).padStart(4, "0")}`;
}
