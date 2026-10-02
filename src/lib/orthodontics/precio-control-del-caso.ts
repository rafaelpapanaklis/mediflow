// Ortodoncia — precio de CADA control de un caso en «Pago por control» (ws1-t12, ticket 3 de BEVADENT, 6b).
// Puro: sin Prisma ni React.
//
// Cada técnica de la clínica puede tener su «precio por control» (Configuración → Técnicas y precios). El caso
// COPIA ese precio al abrirse (columna `controlPriceMxn`, sql/ws1-t12-precio-control-por-caso.sql) y cada
// control se factura con él. Un caso sin precio propio —los que ya existían, o una técnica sin precio de
// control— se factura con «Control de ortodoncia» del catálogo, igual que siempre. Cambiar después la tabla de
// técnicas no toca los casos abiertos; cambiar la técnica DE UN CASO sí le pone el precio de la nueva.

import { TIPO_CITA_CONTROL_ORTO } from "./agenda-constants";
import { PRECIO_MAXIMO } from "./precios-por-tecnica";

export type OrigenDelPrecioDeControl = "caso" | "catalogo";

export interface PrecioDeControl {
  /** Lo que se cobra por el control (MXN). */
  precio: number;
  /** Concepto de la factura: el nombre que la clínica le puso a su control en el catálogo, o el de siempre. */
  nombre: string;
  origen: OrigenDelPrecioDeControl;
}

/** Un precio de caso usable: número finito, mayor que cero y razonable, a centavos. */
export function precioDeCasoValido(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : v && typeof v === "object" ? Number(String(v)) : NaN;
  if (!Number.isFinite(n) || n <= 0 || n > PRECIO_MAXIMO) return null;
  return Math.round(n * 100) / 100;
}

/**
 * Con qué se cobra un control: el precio del caso si tiene; si no, el del catálogo tal cual (mismo comportamiento
 * de antes de ws1-t12). null = no hay de dónde sacar precio: el control no se factura y se avisa.
 */
export function elegirPrecioDeControl(
  delCaso: number | null,
  catalogo: { name: string; basePrice: number } | null,
): PrecioDeControl | null {
  const propio = precioDeCasoValido(delCaso);
  if (propio !== null) {
    const nombre = catalogo?.name?.trim() || TIPO_CITA_CONTROL_ORTO;
    return { precio: propio, nombre, origen: "caso" };
  }
  if (!catalogo) return null;
  return { precio: catalogo.basePrice, nombre: catalogo.name, origen: "catalogo" };
}

/**
 * Lo que se propone en el alta en «Pago por control»: la colocación con el pago inicial de la técnica (o el de
 * «Colocación de aparatología» del catálogo) y el control con el de la técnica (o el del catálogo).
 */
export function preciosDeLaTecnicaParaElAlta(
  tecnica: { pagoInicial: number | null; precioControl: number | null } | null | undefined,
  catalogo: { colocacion: number | null; control: number | null },
): {
  colocacion: number | null;
  colocacionDeLaTecnica: boolean;
  control: number | null;
  controlDeLaTecnica: boolean;
} {
  const inicial = precioDeCasoValido(tecnica?.pagoInicial ?? null);
  const control = precioDeCasoValido(tecnica?.precioControl ?? null);
  return {
    colocacion: inicial ?? catalogo.colocacion,
    colocacionDeLaTecnica: inicial !== null,
    control: control ?? catalogo.control,
    controlDeLaTecnica: control !== null,
  };
}

/**
 * ¿Cambió de verdad la técnica del caso? Tipo base distinto, o nombre propio distinto (vacío = el del tipo).
 * Guardar la aparatología sin tocar la técnica NO cuenta: un caso que ya existía conserva su precio.
 */
export function cambioLaTecnica(
  antes: { base: string; label: string | null | undefined },
  despues: { base: string; label: string | null | undefined },
): boolean {
  const n = (x: string | null | undefined) => (x ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  return antes.base !== despues.base || n(antes.label) !== n(despues.label);
}
