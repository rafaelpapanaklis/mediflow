// Ortodoncia — «Procedimientos de esta visita» en la hoja de control. PURO.
//
// Es DINERO y es EXPEDIENTE (NOM-004), así que las reglas viven aquí, con tests,
// y las aplica el servidor: el cliente solo dice QUÉ procedimiento y CUÁNTOS; el
// nombre, el precio y si es incluido o con costo aparte salen SIEMPRE del
// catálogo de la clínica, nunca de lo que mande el navegador.
//
// Dónde se guarda (sin SQL nuevo): en la NOTA del expediente de esa hoja
// (`medical_records.specialtyData.procedimientos`), la misma que se crea al
// firmar. En borrador la nota existe como borrador.

import { esFilaDelControl } from "./procedimiento-ortodoncia-reglas";
import { ORTHO_CATALOG_CATEGORY } from "./catalog-procedures-constantes";

export const CANTIDAD_MAXIMA = 20;

/** Una línea de la hoja: un procedimiento del catálogo con su cantidad. Una por procedimiento. */
export interface LineaDeVisita {
  /** Igual al id del procedimiento del catálogo: una línea por procedimiento y hoja. */
  procedureId: string;
  name: string;
  quantity: number;
  /** Precio unitario del catálogo AL MOMENTO de guardar la hoja. */
  unitPrice: number;
  /** true = incluido en el tratamiento (solo se registra); false = con costo aparte. */
  incluido: boolean;
  /** Factura del extra, si ya se creó. */
  invoiceId?: string | null;
  invoiceNumber?: string | null;
  facturadoAt?: string | null;
}

export type EstadoDeLinea = "incluido" | "por-cobrar" | "facturado";

export function estadoDeLinea(l: Pick<LineaDeVisita, "incluido" | "invoiceId">): EstadoDeLinea {
  if (l.incluido) return "incluido";
  return l.invoiceId ? "facturado" : "por-cobrar";
}

/** Total de una línea con costo aparte (0 si es incluida). */
export function totalDeLinea(l: Pick<LineaDeVisita, "incluido" | "quantity" | "unitPrice">): number {
  return l.incluido ? 0 : Math.round(l.quantity * l.unitPrice * 100) / 100;
}

export interface FilaDeCatalogo {
  id: string;
  name: string;
  code?: string | null;
  category?: string;
  basePrice: number;
  isActive: boolean;
  orthoIncludedInTreatment: boolean | null;
}

/**
 * ¿Se puede elegir en la hoja? Activo, de la categoría Ortodoncia, con el cobro
 * definido (incluido / con costo aparte) y NO el control (su cobro sigue por modo).
 */
export function esElegibleEnLaHoja(f: FilaDeCatalogo): boolean {
  if (!f.isActive) return false;
  if (f.category !== undefined && f.category !== ORTHO_CATALOG_CATEGORY) return false;
  if (typeof f.orthoIncludedInTreatment !== "boolean") return false;
  return !esFilaDelControl({ name: f.name, code: f.code ?? null, category: f.category ?? ORTHO_CATALOG_CATEGORY });
}

export interface Pedido {
  procedureId: string;
  quantity: number;
}

export interface ResultadoDeArmar {
  lineas: LineaDeVisita[];
  error: string | null;
}

/**
 * Arma las líneas de la hoja a partir de lo pedido, el catálogo y lo que la hoja
 * ya tenía. Reglas:
 *  - Cada procedimiento debe existir y ser elegible; el precio y el tipo salen del catálogo.
 *  - Cantidad entera de 1 a `CANTIDAD_MAXIMA`; un procedimiento repetido suma cantidades.
 *  - Una línea YA FACTURADA es intocable: se conserva tal cual aunque el cliente la omita
 *    o cambie su cantidad (no se borra ni se altera una factura ya emitida).
 */
export function armarLineas(args: {
  pedidos: readonly Pedido[];
  catalogo: readonly FilaDeCatalogo[];
  previas: readonly LineaDeVisita[];
}): ResultadoDeArmar {
  const porId = new Map(args.catalogo.map((f) => [f.id, f]));
  const facturadas = new Map(args.previas.filter((l) => !l.incluido && l.invoiceId).map((l) => [l.procedureId, l]));
  const cantidades = new Map<string, number>();
  const orden: string[] = [];
  for (const p of args.pedidos) {
    if (typeof p?.procedureId !== "string" || !p.procedureId) return { lineas: [], error: "Procedimiento inválido" };
    const q = Number(p.quantity);
    if (!Number.isInteger(q) || q < 1 || q > CANTIDAD_MAXIMA) {
      return { lineas: [], error: `La cantidad debe ser un número entero de 1 a ${CANTIDAD_MAXIMA}` };
    }
    if (!cantidades.has(p.procedureId)) orden.push(p.procedureId);
    cantidades.set(p.procedureId, (cantidades.get(p.procedureId) ?? 0) + q);
  }

  const lineas: LineaDeVisita[] = [];
  for (const id of orden) {
    const yaFacturada = facturadas.get(id);
    if (yaFacturada) {
      lineas.push({ ...yaFacturada });
      continue;
    }
    const fila = porId.get(id);
    if (!fila || !esElegibleEnLaHoja(fila)) {
      return { lineas: [], error: "Uno de los procedimientos ya no está disponible: quítalo de la lista" };
    }
    const cantidad = cantidades.get(id)!;
    if (cantidad > CANTIDAD_MAXIMA) return { lineas: [], error: `La cantidad debe ser un número entero de 1 a ${CANTIDAD_MAXIMA}` };
    const previa = args.previas.find((l) => l.procedureId === id);
    lineas.push({
      procedureId: fila.id,
      name: fila.name.trim(),
      quantity: cantidad,
      unitPrice: Math.max(0, Number(fila.basePrice) || 0),
      incluido: fila.orthoIncludedInTreatment === true,
      invoiceId: null,
      invoiceNumber: null,
      facturadoAt: previa?.facturadoAt ?? null,
    });
  }
  // Las ya facturadas que el cliente omitió se conservan (no se borran facturas).
  for (const [id, l] of facturadas) if (!orden.includes(id)) lineas.push({ ...l });
  return { lineas, error: null };
}

/** El texto que queda ESCRITO en la nota firmada del expediente. */
export function textoParaLaNota(lineas: readonly LineaDeVisita[]): string {
  if (lineas.length === 0) return "";
  const renglones = lineas.map(
    (l) => `• ${l.name}${l.quantity > 1 ? ` ×${l.quantity}` : ""} — ${l.incluido ? "incluido en el tratamiento" : "con costo aparte"}`,
  );
  return `Procedimientos de esta visita:\n${renglones.join("\n")}`;
}

/** ¿Hay algo con costo aparte sin factura? (bandera que usa Cobranza para listar pendientes.) */
export function hayPorCobrar(lineas: readonly LineaDeVisita[]): boolean {
  return lineas.some((l) => estadoDeLinea(l) === "por-cobrar");
}

// ── La factura del extra ──────────────────────────────────────────────

/** Marca al inicio de las notas de la factura: identifica el extra de UNA línea de UNA hoja. */
export function marcaDeExtraDeHoja(cardId: string, procedureId: string): string {
  return `[extra-hoja:${cardId}:${procedureId}]`;
}

export function notaDeFacturaDeExtra(cardId: string, l: Pick<LineaDeVisita, "procedureId" | "name" | "quantity">, cardNumber: number | null): string {
  const hoja = cardNumber ? `hoja de control ${cardNumber}` : "hoja de control";
  return `${marcaDeExtraDeHoja(cardId, l.procedureId)} Extra de ortodoncia de la ${hoja}: ${l.name}${l.quantity > 1 ? ` ×${l.quantity}` : ""}.`;
}

/** Lee las líneas guardadas en `specialtyData` de la nota; tolera JSON mal formado. */
export function lineasDeLaNota(specialtyData: unknown): LineaDeVisita[] {
  const bruto = (specialtyData as { procedimientos?: unknown } | null)?.procedimientos;
  if (!Array.isArray(bruto)) return [];
  const out: LineaDeVisita[] = [];
  for (const l of bruto) {
    if (!l || typeof l !== "object") continue;
    const o = l as Record<string, unknown>;
    if (typeof o.procedureId !== "string" || typeof o.name !== "string") continue;
    const quantity = Number(o.quantity);
    const unitPrice = Number(o.unitPrice);
    if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice)) continue;
    out.push({
      procedureId: o.procedureId,
      name: o.name,
      quantity,
      unitPrice,
      incluido: o.incluido === true,
      invoiceId: typeof o.invoiceId === "string" ? o.invoiceId : null,
      invoiceNumber: typeof o.invoiceNumber === "string" ? o.invoiceNumber : null,
      facturadoAt: typeof o.facturadoAt === "string" ? o.facturadoAt : null,
    });
  }
  return out;
}
