/**
 * DaleControl INSTITUCIONAL — LOS PRESUPUESTOS · la parte PURA.
 *
 * Módulo PURO y client-safe: sin prisma, sin "server-only", sin
 * `new Date()` escondido (el `now` se pasa siempre). Los estados, la
 * aritmética de las partidas, la vigencia y el token. Lo que toca la base
 * vive en presupuestos.ts.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 POR QUÉ (fila 26 del informe ws2-t1)
 *
 * «No hay `EduQuote`. Las coincidencias de "presupuesto" en src/lib/edu
 * son el PRESUPUESTO DE IA, otra cosa. Lo más parecido es la etapa de
 * autorización PLAN, que es un gate de firma sin partidas ni importe.»
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 TODO EN CENTAVOS ENTEROS. Ni un `number` con decimales en todo el
 * archivo. El dental usa Decimal(10,2) en su `Quote`; aquí no se copia eso
 * porque el resto del dinero del vertical (EduCharge, EduFeeScheduleItem,
 * EduCashSession) ya son centavos, y mezclar dos representaciones es cómo
 * se llega a un presupuesto que no cuadra con el cobro que generó.
 *
 * 🔴 VENCIDO NO ES UN ESTADO GUARDADO: SE DERIVA. Un estado que hay que ir
 * a escribir con un cron es un estado que se queda mal el día que el cron
 * no corre — y este producto ya tuvo esa lección con los recordatorios de
 * WhatsApp, cuyo cron nunca se dio de alta.
 * ═══════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════
// 1 · EL ESTADO
// ═══════════════════════════════════════════════════════════════════════

/**
 * Espejo 1:1 del enum `EduQuoteStatus` de Prisma, escrito como unión de
 * strings para poder importarlo desde componentes "use client" sin
 * arrastrar el runtime de Prisma al navegador. El candado de que no se
 * desincronicen es un chequeo de TIPOS en edu-presupuestos.test.ts.
 */
export type EduQuoteStatus = "BORRADOR" | "PRESENTADO" | "ACEPTADO" | "RECHAZADO" | "CANCELADO";

export const EDU_QUOTE_STATUSES: EduQuoteStatus[] = [
  "BORRADOR",
  "PRESENTADO",
  "ACEPTADO",
  "RECHAZADO",
  "CANCELADO",
];

export const EDU_QUOTE_STATUS_LABELS: Record<EduQuoteStatus, string> = {
  BORRADOR: "Borrador",
  PRESENTADO: "Presentado",
  ACEPTADO: "Aceptado",
  RECHAZADO: "Rechazado",
  CANCELADO: "Cancelado",
};

export const EDU_QUOTE_STATUS_DESCRIPTIONS: Record<EduQuoteStatus, string> = {
  BORRADOR: "Se está armando. Se pueden cambiar las partidas y el descuento.",
  PRESENTADO:
    "Ya se le enseñó al paciente y tiene su liga de aceptación. Las partidas quedan congeladas.",
  ACEPTADO: "El paciente lo aceptó, con fecha y evidencia. Se puede convertir en cobro o en plan.",
  RECHAZADO: "El paciente dijo que no. No se borra: la propuesta existió.",
  CANCELADO: "Lo retiró la escuela, con motivo. Tampoco se borra.",
};

/**
 * A qué estados puede pasar un presupuesto desde donde está, escrito como
 * DATO — mismo patrón que `EDU_PRESCRIPTION_TRANSITIONS`.
 *
 * ACEPTADO no lleva a ningún lado: un presupuesto aceptado que se
 * "des-acepta" dejaría un cobro generado colgando de una aceptación que ya
 * no existe. Lo que se hace es CANCELAR el cobro, que sí tiene su propio
 * camino en caja.
 */
export const EDU_QUOTE_TRANSITIONS: Record<EduQuoteStatus, EduQuoteStatus[]> = {
  BORRADOR: ["PRESENTADO", "CANCELADO"],
  PRESENTADO: ["ACEPTADO", "RECHAZADO", "CANCELADO", "BORRADOR"],
  ACEPTADO: [],
  RECHAZADO: ["CANCELADO"],
  CANCELADO: [],
};

export function eduQuotePuedeTransicionar(desde: EduQuoteStatus, hasta: EduQuoteStatus): boolean {
  return (EDU_QUOTE_TRANSITIONS[desde] ?? []).includes(hasta);
}

export function eduQuoteParseStatus(raw: unknown): EduQuoteStatus | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toUpperCase();
  return (EDU_QUOTE_STATUSES as string[]).includes(v) ? (v as EduQuoteStatus) : null;
}

// ═══════════════════════════════════════════════════════════════════════
// 2 · LA VIGENCIA (el estado que NO se guarda)
// ═══════════════════════════════════════════════════════════════════════

/**
 * ¿Está vencido?
 *
 * 🔴 SOLO UN PRESENTADO PUEDE VENCER. Un borrador sin presentar no vence
 * (nadie lo ha visto), y un aceptado tampoco: la aceptación ocurrió
 * dentro de la vigencia y el reloj deja de importar. Rechazado y
 * cancelado son finales.
 */
export function eduQuoteVencido(
  quote: { status: EduQuoteStatus; validUntil: Date | null },
  now: Date,
): boolean {
  if (quote.status !== "PRESENTADO") return false;
  if (!quote.validUntil) return false;
  return quote.validUntil.getTime() < now.getTime();
}

/** El estado que se PINTA, que incluye el derivado. */
export type EduQuoteEstadoVisible = EduQuoteStatus | "VENCIDO";

export function eduQuoteEstadoVisible(
  quote: { status: EduQuoteStatus; validUntil: Date | null },
  now: Date,
): EduQuoteEstadoVisible {
  return eduQuoteVencido(quote, now) ? "VENCIDO" : quote.status;
}

/**
 * ¿Se puede aceptar por la liga pública?
 *
 * Devuelve el motivo por el que NO, o null si sí. Esta función es la
 * puerta pública del presupuesto y por eso contesta con frases enteras:
 * al otro lado hay un paciente sin sesión, mirando su teléfono.
 */
export function eduQuoteMotivoParaNoAceptar(
  quote: { status: EduQuoteStatus; validUntil: Date | null },
  now: Date,
): string | null {
  if (quote.status === "ACEPTADO") return "Este presupuesto ya lo aceptaste. No hace falta hacerlo otra vez.";
  if (quote.status === "RECHAZADO") return "Este presupuesto quedó rechazado. Pídele uno nuevo a la clínica.";
  if (quote.status === "CANCELADO") return "La clínica retiró este presupuesto. Pídele uno nuevo.";
  if (quote.status === "BORRADOR") return "Este presupuesto todavía no está listo. Pregúntale a la clínica.";
  if (eduQuoteVencido(quote, now)) {
    return "Este presupuesto ya venció. Pídele a la clínica uno actualizado: los precios pueden haber cambiado.";
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════
// 3 · LA ARITMÉTICA
// ═══════════════════════════════════════════════════════════════════════

export const EDU_QUOTE_TITLE_MAX = 160;
export const EDU_QUOTE_NOTES_MAX = 2000;
export const EDU_QUOTE_ITEM_NAME_MAX = 160;
export const EDU_QUOTE_ITEM_NOTES_MAX = 500;
/** Tope de partidas. Un presupuesto de 200 renglones no lo lee nadie. */
export const EDU_QUOTE_MAX_ITEMS = 60;
/** Tope de presupuestos que se listan de un paciente. */
export const EDU_QUOTE_MAX_ROWS = 50;
/** Tope de un importe unitario: $999,999.99. Un dedazo de más se rebota. */
export const EDU_QUOTE_MAX_CENTS = 99_999_999;

export interface EduQuoteItemInput {
  procedureId?: string | null;
  name: string;
  toothFdi?: string | null;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
  phase?: number | null;
  notes?: string | null;
  sortOrder: number;
}

/**
 * El total de UNA partida.
 *
 * 🔴 EL DESCUENTO NUNCA DEJA LA LÍNEA EN NEGATIVO. Un descuento mayor que
 * el importe no es un regalo con vuelto: se topa en cero. Sin esto, una
 * partida con descuento de más restaría del total de las otras y el
 * presupuesto cuadraría por accidente.
 */
export function eduQuoteLineTotal(item: {
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
}): number {
  const bruto = Math.max(0, item.quantity) * Math.max(0, item.unitPriceCents);
  return Math.max(0, bruto - Math.max(0, item.discountCents));
}

export interface EduQuoteTotales {
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
}

/**
 * Los totales del presupuesto.
 *
 * `discountPct`, si viene, MANDA sobre el descuento global en centavos y
 * lo recalcula — es la misma regla que el `Quote` del dental, escrita
 * aquí: el porcentaje es lo que la dirección teclea y lo que se explica,
 * y los centavos son lo que ese porcentaje valió hoy.
 *
 * 🔴 EL REDONDEO DEL PORCENTAJE ES `Math.round` Y ES A FAVOR DE NADIE EN
 * PARTICULAR: se redondea el DESCUENTO, no el total, para que la resta
 * cierre exacta al centavo y el recibo no salga con un peso de diferencia.
 */
export function eduQuoteTotales(
  items: { quantity: number; unitPriceCents: number; discountCents: number }[],
  discountPct: number | null,
  discountCentsGlobal: number,
): EduQuoteTotales {
  const subtotalCents = items.reduce((acc, it) => acc + eduQuoteLineTotal(it), 0);
  let discountCents = Math.max(0, Math.trunc(discountCentsGlobal));
  if (discountPct !== null && Number.isFinite(discountPct)) {
    const pct = Math.min(100, Math.max(0, discountPct));
    discountCents = Math.round((subtotalCents * pct) / 100);
  }
  discountCents = Math.min(discountCents, subtotalCents);
  return { subtotalCents, discountCents, totalCents: subtotalCents - discountCents };
}

// ═══════════════════════════════════════════════════════════════════════
// 4 · LOS PARSERS
// ═══════════════════════════════════════════════════════════════════════

export function eduQuoteParseTitulo(raw: unknown): string {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (v.length < 2) {
    throw new Error("El presupuesto necesita un título («Rehabilitación superior», «Ortodoncia»).");
  }
  return v.slice(0, EDU_QUOTE_TITLE_MAX);
}

export function eduQuoteParseCentavos(raw: unknown, campo: string): number {
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > EDU_QUOTE_MAX_CENTS) {
    throw new Error(
      `${campo} tiene que ser un importe en centavos enteros, entre 0 y ${EDU_QUOTE_MAX_CENTS}.`,
    );
  }
  return n;
}

export function eduQuoteParsePct(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number.parseFloat(String(raw));
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    throw new Error("El descuento global es un porcentaje entre 0 y 100.");
  }
  // Dos decimales: es lo que aguanta la columna NUMERIC(5,2).
  return Math.round(n * 100) / 100;
}

/**
 * Los dientes FDI en CSV, normalizados y validados contra la numeración
 * real (permanentes 11-48, temporales 51-85).
 *
 * Un "99" en el presupuesto es un diente que no existe, y salir impreso
 * en un papel que el paciente se lleva es peor que rebotarlo aquí.
 */
export function eduQuoteParseToothFdi(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string") return null;
  const piezas = raw
    .split(/[,\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
  const ok: string[] = [];
  for (const p of piezas) {
    const n = Number.parseInt(p, 10);
    if (!Number.isInteger(n)) continue;
    const cuadrante = Math.floor(n / 10);
    const pieza = n % 10;
    const permanente = cuadrante >= 1 && cuadrante <= 4 && pieza >= 1 && pieza <= 8;
    const temporal = cuadrante >= 5 && cuadrante <= 8 && pieza >= 1 && pieza <= 5;
    if (!permanente && !temporal) {
      throw new Error(`«${p}» no es un número de diente FDI válido (11-48 o 51-85).`);
    }
    if (!ok.includes(String(n))) ok.push(String(n));
  }
  if (ok.length === 0) return null;
  return ok.join(",").slice(0, 60);
}

/**
 * Las partidas, validadas y con su total ya calculado.
 *
 * 🔴 EL `sortOrder` LO PONE EL SERVIDOR, por la posición en el array. El
 * orden de las partidas ES contenido (las fases de un tratamiento van en
 * orden) y dejárselo al cliente es dejar que dos renglones compartan
 * posición y salgan al azar en el PDF.
 */
export function eduQuoteParseItems(raw: unknown): (EduQuoteItemInput & { lineTotalCents: number })[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("Un presupuesto necesita al menos una partida.");
  }
  if (raw.length > EDU_QUOTE_MAX_ITEMS) {
    throw new Error(`El presupuesto trae ${raw.length} partidas y el tope son ${EDU_QUOTE_MAX_ITEMS}.`);
  }
  return raw.map((r, i) => {
    const it = (r ?? {}) as Record<string, unknown>;
    const name = typeof it.name === "string" ? it.name.trim() : "";
    if (!name) throw new Error(`La partida ${i + 1} no tiene nombre.`);
    const quantity =
      it.quantity === undefined || it.quantity === null
        ? 1
        : Number.parseInt(String(it.quantity), 10);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
      throw new Error(`La cantidad de la partida ${i + 1} tiene que ser un entero entre 1 y 999.`);
    }
    const unitPriceCents = eduQuoteParseCentavos(it.unitPriceCents, `El precio de la partida ${i + 1}`);
    const discountCents =
      it.discountCents === undefined || it.discountCents === null
        ? 0
        : eduQuoteParseCentavos(it.discountCents, `El descuento de la partida ${i + 1}`);
    const phaseRaw = it.phase;
    let phase: number | null = null;
    if (phaseRaw !== undefined && phaseRaw !== null && phaseRaw !== "") {
      const p = Number.parseInt(String(phaseRaw), 10);
      if (!Number.isInteger(p) || p < 1 || p > 20) {
        throw new Error(`La fase de la partida ${i + 1} tiene que ser un entero entre 1 y 20.`);
      }
      phase = p;
    }
    const base = {
      procedureId: typeof it.procedureId === "string" && it.procedureId.trim() ? it.procedureId.trim() : null,
      name: name.slice(0, EDU_QUOTE_ITEM_NAME_MAX),
      toothFdi: eduQuoteParseToothFdi(it.toothFdi),
      quantity,
      unitPriceCents,
      discountCents,
      phase,
      notes:
        typeof it.notes === "string" && it.notes.trim()
          ? it.notes.trim().slice(0, EDU_QUOTE_ITEM_NOTES_MAX)
          : null,
      sortOrder: i,
    };
    return { ...base, lineTotalCents: eduQuoteLineTotal(base) };
  });
}

// ═══════════════════════════════════════════════════════════════════════
// 5 · LA VIGENCIA POR DEFECTO Y EL TEXTO CANÓNICO
// ═══════════════════════════════════════════════════════════════════════

/**
 * Treinta días. Es la vigencia que se propone al presentar si nadie pone
 * una: no es un tope duro (se puede cambiar) y NO se aplica sola a un
 * presupuesto que se guardó sin fecha — `validUntil` null sigue
 * significando "sin vencimiento".
 */
export const EDU_QUOTE_VIGENCIA_DIAS = 30;

export function eduQuoteVigenciaPorDefecto(now: Date): Date {
  return new Date(now.getTime() + EDU_QUOTE_VIGENCIA_DIAS * 24 * 60 * 60 * 1000);
}

/**
 * EL TEXTO CANÓNICO que el paciente tiene delante al aceptar, y del que se
 * saca el hash de la evidencia.
 *
 * 🔴 VERSIONADO DENTRO DEL PROPIO TEXTO (`v1|`), igual que el de los
 * consentimientos y el de las autorizaciones: si mañana cambia lo que se
 * le enseña al paciente, el hash de las aceptaciones viejas sigue
 * verificando contra SU versión. Un hash sobre un texto sin versión es un
 * hash que deja de verificar el día del primer cambio de copy.
 *
 * 🔴 Y LLEVA LOS IMPORTES. El hash existe para poder contestar «¿aceptó
 * ESTE total?», así que el total tiene que estar dentro.
 */
export function eduQuoteTextoCanonico(quote: {
  folio: string;
  title: string;
  totalCents: number;
  items: { name: string; quantity: number; lineTotalCents: number }[];
  validUntil: Date | null;
}): string {
  const lineas = quote.items
    .map((i) => `${i.quantity}x ${i.name} = ${i.lineTotalCents}`)
    .join(";");
  const vig = quote.validUntil ? quote.validUntil.toISOString() : "sin-vencimiento";
  return `v1|${quote.folio}|${quote.title}|${lineas}|total=${quote.totalCents}|vigencia=${vig}`;
}
