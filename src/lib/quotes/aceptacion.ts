// ═══════════════════════════════════════════════════════════════════════════
// Aceptación PARCIAL de un presupuesto y CARGOS desde él (ws1-t6, ticket 3 de
// BEVADENT, 7c y 7d). Reglas puras, sin I/O; las comparten la API, la liga
// pública y las dos pantallas (panel y paciente), y tienen pruebas.
//
// El caso que lo pidió (precisión 2 del cliente): «Cotización por $10,000 con
// aceptación solo de una resina de $1,500 no debe producir deuda por
// $10,000». Antes «Generar factura» creaba UNA factura por el total del
// presupuesto, aceptara el paciente lo que aceptara.
//
// ── Las reglas ─────────────────────────────────────────────────────────────
//
// 1. ACEPTAR es por concepto. Se guarda una copia de cada concepto (nombre,
//    cantidad, precio, descuento, importe) y si se aceptó o no: lo que el
//    paciente firmó y a qué precio, aunque el tarifario cambie después.
//    Aceptado TOTAL = todos los conceptos; PARCIAL = al menos uno, no todos.
//    Sin conceptos aceptados no hay aceptación: eso es «Rechazar».
//
// 2. El DESCUENTO GLOBAL del presupuesto se reparte entre los conceptos en
//    proporción a su importe, en centavos exactos (el residuo, de a un
//    centavo, a los de mayor resto). Aceptado todo, la suma es exactamente el
//    descuento del presupuesto; aceptado una parte, le toca la parte
//    proporcional (un 10 % sobre $10,000 sigue siendo un 10 % sobre $1,500).
//
// 3. Lo NO aceptado no es deuda: nunca entra a un cargo, ni a «por cargar».
//
// 4. CARGAR es elegir HOY qué conceptos aceptados se cobran (lo que se hizo
//    hoy) y/o un ABONO (el inicial pactado, una cuota). Cada cargo es una
//    factura PENDIENTE normal. Un concepto se carga UNA vez; la suma de todos
//    los cargos vivos nunca pasa del total aceptado. Si antes se cobraron
//    abonos, el concepto que ya no cabe se carga solo por lo que falta («se
//    descuenta lo ya abonado»): el paciente nunca debe más de lo que aceptó.
//    Una factura CANCELADA deja de contar y su concepto vuelve a «por cargar».
// ═══════════════════════════════════════════════════════════════════════════

/** Un concepto del presupuesto tal como sale de la base (Decimal → number aparte). */
export interface ConceptoDePresupuesto {
  id: string;
  name: string;
  toothFdi: string | null;
  quantity: unknown;
  unitPrice: unknown;
  discount?: unknown;
  lineTotal?: unknown;
}

export interface PresupuestoParaAceptar {
  discountAmount: unknown;
  items: ConceptoDePresupuesto[];
}

/** Lo que queda guardado de cada concepto al aceptar (tabla quote_item_acceptance). */
export interface RenglonAceptado {
  quoteItemId: string;
  aceptado: boolean;
  nombre: string;
  toothFdi: string | null;
  cantidad: number;
  precio: number;
  /** Descuento DE LÍNEA del concepto, como estaba en el presupuesto. */
  descuento: number;
  /** cantidad × precio − descuento (piso 0). */
  importe: number;
  /** Su parte del descuento GLOBAL del presupuesto. 0 si no se aceptó. */
  descuentoGlobal: number;
}

export type ViaAceptacion = "panel" | "liga";

function num(x: unknown): number {
  const v = Number(x);
  return isFinite(v) ? v : 0;
}

export function round2(n: number): number {
  return Math.round((num(n) + Number.EPSILON) * 100) / 100;
}

const cents = (n: number) => Math.round(round2(n) * 100);
const pesos = (c: number) => c / 100;

/** Lo que el concepto suma una vez aceptado: importe − su parte del descuento global. */
export function netoDe(r: Pick<RenglonAceptado, "importe" | "descuentoGlobal">): number {
  return round2(Math.max(0, r.importe - r.descuentoGlobal));
}

/* ── 1. Qué conceptos se aceptan ──────────────────────────────────────── */

/**
 * Valida la selección que manda el panel o la liga. `undefined`/`null` =
 * «todos» (lo de siempre: un cliente viejo que no manda casillas acepta el
 * presupuesto completo). Rechaza ids que no son de este presupuesto en vez de
 * ignorarlos: una casilla que no corresponde es un error, no un silencio.
 */
export function elegirConceptos(
  items: ReadonlyArray<{ id: string }>,
  raw: unknown,
): { ok: true; ids: string[]; error?: undefined } | { ok: false; error: string; ids?: undefined } {
  const todos = items.map((i) => i.id);
  if (raw === undefined || raw === null) return { ok: true, ids: todos };
  if (!Array.isArray(raw) || raw.some((x) => typeof x !== "string")) {
    return { ok: false, error: "Selección de conceptos inválida" };
  }
  const pedidos = Array.from(new Set(raw as string[]));
  const ajenos = pedidos.filter((id) => todos.indexOf(id) === -1);
  if (ajenos.length > 0) return { ok: false, error: "Algún concepto no es de este presupuesto" };
  if (pedidos.length === 0) {
    return { ok: false, error: "Marca al menos un concepto. Si no acepta ninguno, usa «Rechazar»." };
  }
  // En el orden del presupuesto, no en el de los clics.
  return { ok: true, ids: todos.filter((id) => pedidos.indexOf(id) !== -1) };
}

/**
 * Reparte `totalCentavos` entre pesos proporcionales (`bases`, en centavos)
 * con residuo mayor: la suma es EXACTAMENTE el total.
 */
export function repartirProporcional(totalCentavos: number, bases: number[]): number[] {
  const suma = bases.reduce((s, b) => s + Math.max(0, b), 0);
  if (totalCentavos <= 0 || suma <= 0) return bases.map(() => 0);
  const exactos = bases.map((b) => (Math.max(0, b) * totalCentavos) / suma);
  const piso = exactos.map((x) => Math.floor(x));
  let falta = totalCentavos - piso.reduce((s, x) => s + x, 0);
  const orden = exactos
    .map((x, i) => ({ i, resto: x - Math.floor(x) }))
    .sort((a, b) => b.resto - a.resto || a.i - b.i);
  for (let k = 0; falta > 0 && k < orden.length; k++, falta--) piso[orden[k].i] += 1;
  return piso;
}

/**
 * Arma los renglones a guardar: TODOS los conceptos, con `aceptado` según la
 * selección y su copia de precio. El descuento global se reparte solo entre
 * los aceptados (regla 2).
 */
export function armarAceptacion(p: PresupuestoParaAceptar, idsAceptados: string[]): RenglonAceptado[] {
  const base = p.items.map((it) => {
    const cantidad = Math.max(1, Math.floor(num(it.quantity)) || 1);
    const precio = round2(Math.max(0, num(it.unitPrice)));
    const bruto = round2(cantidad * precio);
    const descuento = round2(Math.min(Math.max(0, num(it.discount)), bruto));
    return {
      quoteItemId: it.id,
      aceptado: idsAceptados.indexOf(it.id) !== -1,
      nombre: it.name,
      toothFdi: it.toothFdi ?? null,
      cantidad,
      precio,
      descuento,
      importe: round2(bruto - descuento),
      descuentoGlobal: 0,
    };
  });
  const subtotalC = base.reduce((s, r) => s + cents(r.importe), 0);
  const aceptadosC = base.filter((r) => r.aceptado).reduce((s, r) => s + cents(r.importe), 0);
  const descuentoC = Math.min(cents(Math.max(0, num(p.discountAmount))), subtotalC);
  // Aceptado todo → el descuento entero; una parte → su proporción.
  const descuentoAceptadoC = aceptadosC === subtotalC
    ? descuentoC
    : subtotalC > 0 ? Math.round((descuentoC * aceptadosC) / subtotalC) : 0;
  const partes = repartirProporcional(
    descuentoAceptadoC,
    base.map((r) => (r.aceptado ? cents(r.importe) : 0)),
  );
  return base.map((r, i) => ({ ...r, descuentoGlobal: pesos(partes[i]) }));
}

export interface ResumenAceptacion {
  alcance: "total" | "parcial";
  aceptados: number;
  conceptos: number;
  /** Σ importes aceptados (antes del descuento global). */
  subtotal: number;
  descuento: number;
  /** Lo que el paciente aceptó pagar. */
  total: number;
  /** Lo que NO aceptó (importe con su parte de descuento): informativo, NO es deuda. */
  noAceptado: number;
}

export function resumirAceptacion(renglones: RenglonAceptado[], totalPresupuesto: number): ResumenAceptacion {
  const acept = renglones.filter((r) => r.aceptado);
  const subtotal = pesos(acept.reduce((s, r) => s + cents(r.importe), 0));
  const descuento = pesos(acept.reduce((s, r) => s + cents(r.descuentoGlobal), 0));
  const total = pesos(acept.reduce((s, r) => s + cents(netoDe(r)), 0));
  return {
    alcance: acept.length === renglones.length ? "total" : "parcial",
    aceptados: acept.length,
    conceptos: renglones.length,
    subtotal,
    descuento,
    total,
    noAceptado: round2(Math.max(0, num(totalPresupuesto) - total)),
  };
}

/* ── 2. Cargos ────────────────────────────────────────────────────────── */

/** Una fila de quote_charges cuya factura sigue viva (no cancelada). */
export interface CargoVivo {
  quoteItemId: string | null;
  invoiceId: string;
  monto: number;
}

export interface EstadoDeCobro {
  totalAceptado: number;
  cargado: number;
  porCargar: number;
  /** Conceptos aceptados ya cargados en una factura viva. */
  cargados: string[];
  /** Conceptos aceptados que todavía no se cargan. */
  pendientes: RenglonAceptado[];
  /** Abonos (inicial / cuotas) ya cargados. */
  abonado: number;
}

export function estadoDeCobro(renglones: RenglonAceptado[], cargos: CargoVivo[]): EstadoDeCobro {
  const acept = renglones.filter((r) => r.aceptado);
  const totalC = acept.reduce((s, r) => s + cents(netoDe(r)), 0);
  const cargadoC = cargos.reduce((s, c) => s + cents(c.monto), 0);
  const ids = new Set(cargos.map((c) => c.quoteItemId).filter((x): x is string => !!x));
  return {
    totalAceptado: pesos(totalC),
    cargado: pesos(cargadoC),
    porCargar: pesos(Math.max(0, totalC - cargadoC)),
    cargados: acept.filter((r) => ids.has(r.quoteItemId)).map((r) => r.quoteItemId),
    pendientes: acept.filter((r) => !ids.has(r.quoteItemId)),
    abonado: pesos(cargos.filter((c) => !c.quoteItemId).reduce((s, c) => s + cents(c.monto), 0)),
  };
}

/** Un renglón de la factura que se va a crear, y de quote_charges. */
export interface LineaDeCargo {
  tipo: "concepto" | "abono";
  quoteItemId: string | null;
  name: string;
  toothFdi: string | null;
  quantity: number;
  unitPrice: number;
  /** Descuento total de la línea: el suyo + su parte del global + lo ya abonado. */
  discount: number;
  /** Lo que suma a la factura. */
  monto: number;
}

export interface PlanDeCargo {
  lineas: LineaDeCargo[];
  total: number;
  /** Cuánto se restó de los conceptos porque ya se había cobrado como abono. */
  descontadoDeAbonos: number;
  /** Lo que quedará por cargar después de este cargo. */
  quedaPorCargar: number;
}

export function planearCargo(
  renglones: RenglonAceptado[],
  cargos: CargoVivo[],
  pedido: { itemIds?: unknown; abono?: unknown; etiquetaAbono: string },
): { ok: true; plan: PlanDeCargo; error?: undefined } | { ok: false; error: string; plan?: undefined } {
  const estado = estadoDeCobro(renglones, cargos);
  const rawIds = pedido.itemIds ?? [];
  if (!Array.isArray(rawIds) || rawIds.some((x) => typeof x !== "string")) {
    return { ok: false, error: "Selección de conceptos inválida" };
  }
  const ids = Array.from(new Set(rawIds as string[]));
  const porId = new Map(renglones.map((r) => [r.quoteItemId, r]));
  for (const id of ids) {
    const r = porId.get(id);
    if (!r) return { ok: false, error: "Algún concepto no es de este presupuesto" };
    if (!r.aceptado) return { ok: false, error: `«${r.nombre}» no lo aceptó el paciente: no se puede cargar` };
    if (estado.cargados.indexOf(id) !== -1) {
      return { ok: false, error: `«${r.nombre}» ya está cargado en otra factura` };
    }
  }
  const abonoRaw = pedido.abono == null || pedido.abono === "" ? 0 : Number(pedido.abono);
  if (!isFinite(abonoRaw) || abonoRaw < 0) return { ok: false, error: "El abono debe ser un importe positivo" };
  const abonoC = cents(abonoRaw);
  if (ids.length === 0 && abonoC === 0) {
    return { ok: false, error: "Elige al menos un concepto o escribe un abono" };
  }

  // Conceptos en el orden del presupuesto.
  const elegidos = renglones.filter((r) => ids.indexOf(r.quoteItemId) !== -1);
  const porCargarC = cents(estado.porCargar);
  const conceptosC = elegidos.reduce((s, r) => s + cents(netoDe(r)), 0);
  // Regla 4: lo ya abonado se descuenta de los conceptos que ya no caben.
  let excesoC = Math.max(0, conceptosC - porCargarC);
  const descontadoC = excesoC;
  const extras = elegidos.map(() => 0);
  for (let i = elegidos.length - 1; i >= 0 && excesoC > 0; i--) {
    const tomar = Math.min(excesoC, cents(netoDe(elegidos[i])));
    extras[i] = tomar;
    excesoC -= tomar;
  }
  const conceptosNetoC = conceptosC - descontadoC;
  if (abonoC > porCargarC - conceptosNetoC) {
    const cabe = pesos(Math.max(0, porCargarC - conceptosNetoC));
    return {
      ok: false,
      error: cabe > 0
        ? `El abono pasa de lo aceptado: como máximo ${cabe.toFixed(2)}`
        : "Ya no queda nada por cargar de este presupuesto",
    };
  }

  const lineas: LineaDeCargo[] = elegidos.map((r, i) => {
    const bruto = round2(r.cantidad * r.precio);
    const discount = round2(Math.min(bruto, r.descuento + r.descuentoGlobal + pesos(extras[i])));
    return {
      tipo: "concepto",
      quoteItemId: r.quoteItemId,
      name: r.nombre,
      toothFdi: r.toothFdi,
      quantity: r.cantidad,
      unitPrice: r.precio,
      discount,
      monto: round2(bruto - discount),
    };
  });
  if (abonoC > 0) {
    lineas.push({
      tipo: "abono",
      quoteItemId: null,
      name: pedido.etiquetaAbono,
      toothFdi: null,
      quantity: 1,
      unitPrice: pesos(abonoC),
      discount: 0,
      monto: pesos(abonoC),
    });
  }
  const totalC = lineas.reduce((s, l) => s + cents(l.monto), 0);
  if (totalC <= 0) return { ok: false, error: "El cargo quedaría en $0: no hay nada que cobrar" };
  return {
    ok: true,
    plan: {
      lineas,
      total: pesos(totalC),
      descontadoDeAbonos: pesos(descontadoC),
      quedaPorCargar: pesos(Math.max(0, porCargarC - totalC)),
    },
  };
}

/**
 * Presupuesto aceptado ANTES de esta función (o sin el SQL): no hay renglones
 * guardados y se trata como aceptado completo, igual que hoy.
 */
export function aceptacionImplicita(p: PresupuestoParaAceptar): RenglonAceptado[] {
  return armarAceptacion(p, p.items.map((i) => i.id));
}

/**
 * Factura de antes (la de «Generar factura» por el total, en `quotes.invoiceId`)
 * sin filas en quote_charges: cuenta como si hubiera cargado TODOS los
 * conceptos aceptados. Así un presupuesto ya facturado no se vuelve a cargar.
 */
export function cargosDeFacturaVieja(renglones: RenglonAceptado[], invoiceId: string): CargoVivo[] {
  return renglones
    .filter((r) => r.aceptado)
    .map((r) => ({ quoteItemId: r.quoteItemId, invoiceId, monto: netoDe(r) }));
}

/** Conceptos para invoiceFieldsFromQuote (descuento por línea, sin descuento global). */
export function conceptosParaFactura(plan: PlanDeCargo) {
  return {
    discountAmount: 0,
    items: plan.lineas.map((l) => ({
      name: l.name,
      toothFdi: l.toothFdi,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discount: l.discount,
    })),
  };
}

/** Resumen de aceptación y cobro que lleva cada presupuesto ACEPTADO en GET /api/quotes. */
export interface CobroDePresupuesto {
  /** false = sin el SQL: la pantalla se pinta como siempre. */
  encendida: boolean;
  alcance: "total" | "parcial";
  via: ViaAceptacion | null;
  aceptados: string[];
  totalAceptado: number;
  noAceptado: number;
  cargado: number;
  porCargar: number;
  cargados: string[];
  cargos: Array<{ invoiceId: string; invoiceNumber: string; status: string; monto: number; tipo: "concepto" | "abono"; quoteItemId: string | null }>;
  /** Nombre, importe neto y si se aceptó, por concepto (lo que firmó). */
  renglones: Array<{ quoteItemId: string; aceptado: boolean; nombre: string; neto: number }>;
}
