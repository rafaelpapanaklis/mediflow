// Ortodoncia — el plan de pago se arma AL ABRIR el caso (ws1-t10, 29-sep-2026).
// Puro, sin React ni Prisma: lo prueban los tests en node y lo usan el popup
// de alta (`DrawerNewCase`) y la acción del servidor que crea la factura.
//
// Antes el caso se abría con un «costo de referencia» y el cobro llegaba
// DESPUÉS, con «Abrir plan de pago» en la sección Cobro. Ahora el popup pide
// ahí mismo las condiciones (enganche, número de pagos, fecha del primer pago)
// y, al pulsar «Abrir caso», se crea la factura del tratamiento ligada al caso.
//
// Tres caminos, según cómo cobra ESTE caso y quién lo abre:
//   · Precio total  → factura del tratamiento COMPLETO, a plazos.
//   · Pago por control → factura de COLOCACIÓN (precio del catálogo, editable);
//     los controles se siguen cobrando al firmar cada hoja.
//   · «Crear el plan de pago después», o quien abre no tiene permiso de cobro →
//     el caso se abre SIN factura y Cobro sigue ofreciendo «Abrir plan de pago».

import type { OrthoBillingMode } from "../billing-mode";
import { MAX_PAGOS, MIN_PAGOS, calcularCalendario, normalizarCondiciones, type CondicionesPago } from "@/lib/quotes/condiciones-pago";
import { MAX_COSTO_TOTAL } from "../alta-caso-formulario";

/** Lo que el popup manda al servidor para crear la factura. Solo viaja cuando SÍ hay que crearla. */
export interface PlanDePagoAlAbrir {
  /** El modo de cobro que el popup cree que tiene el caso; el servidor lo compara con el guardado. */
  modoDeCobro: OrthoBillingMode;
  /** Solo «Pago por control»: precio de la colocación. En «Precio total» el precio es el del caso, guardado. */
  precioColocacion: number | null;
  /** Solo «Precio total»: enganche en pesos (0 = sin enganche). */
  enganche: number;
  /** Solo «Precio total»: cuántas mensualidades DESPUÉS del enganche. */
  numPagos: number;
  /** Solo «Precio total»: «aaaa-mm-dd» del primer pago del calendario. */
  primerPago: string | null;
}

/** Con cuántos pagos arranca el campo: la duración estimada en meses, dentro de lo que admite un plan. */
export function pagosPropuestos(duracionMeses: number): number {
  const n = Math.round(Number(duracionMeses));
  if (!Number.isFinite(n)) return MIN_PAGOS;
  return Math.min(MAX_PAGOS, Math.max(MIN_PAGOS, n));
}

/**
 * El enganche que se escribió, en pesos. Vacío = sin enganche (0). `null` = no es un importe
 * que se pueda guardar (letras, negativo, más de 2 decimales). Acepta «12,000» y «$12000.50».
 */
export function leerEnganche(texto: string): number | null {
  const limpio = texto.replace(/[$\s,]/g, "");
  if (limpio === "") return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(limpio)) return null;
  const n = Number(limpio);
  return Number.isFinite(n) && n <= MAX_COSTO_TOTAL ? n : null;
}

/** El precio de la colocación que se escribió (mayor que cero), o `null`. */
export function leerPrecioColocacion(texto: string): number | null {
  const limpio = texto.replace(/[$\s,]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(limpio)) return null;
  const n = Number(limpio);
  return Number.isFinite(n) && n > 0 && n <= MAX_COSTO_TOTAL ? n : null;
}

/** Número de pagos entero dentro de lo que admite un plan (2 a 60), o `null`. */
export function leerNumeroDePagos(texto: string): number | null {
  const limpio = texto.trim();
  if (!/^\d+$/.test(limpio)) return null;
  const n = Number(limpio);
  return n >= MIN_PAGOS && n <= MAX_PAGOS ? n : null;
}

const dinero = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** «$1,333.33» / «$12,000». */
export function pesos(n: number): string {
  return dinero.format(n);
}

/** «2026-10-29» → «29/10/2026». Sin `new Date`: no corre el día. */
export function fechaDdMmAaaa(iso: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "por definir";
}

export interface EstadoDelPlan {
  modo: OrthoBillingMode;
  /** El costo del caso ya leído (`leerCostoTotal`), o null si aún no vale. */
  costoTotal: number | null;
  precioColocacion: string;
  enganche: string;
  numPagos: string;
  primerPago: string;
}

/** Lo que falta o está mal en el plan de pago, dicho para quien llena el popup. Vacío = se puede abrir. */
export function faltantesDelPlanDePago(e: EstadoDelPlan): string[] {
  const faltan: string[] = [];
  if (e.modo === "PAGO_POR_CONTROL") {
    if (leerPrecioColocacion(e.precioColocacion) === null) {
      faltan.push(
        e.precioColocacion.trim() === ""
          ? "el precio de la colocación (o marca «Crear el plan de pago después»)"
          : "un precio de colocación válido (mayor que cero)",
      );
    }
    return faltan;
  }
  const enganche = leerEnganche(e.enganche);
  if (enganche === null) faltan.push("un enganche válido (déjalo vacío si no hay)");
  else if (e.costoTotal !== null && enganche >= e.costoTotal) faltan.push("un enganche menor al costo total");
  if (leerNumeroDePagos(e.numPagos) === null) faltan.push(`el número de pagos (de ${MIN_PAGOS} a ${MAX_PAGOS})`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.primerPago)) faltan.push("la fecha del primer pago");
  return faltan;
}

/** Las condiciones de la factura a plazos, acotadas contra el total (nunca un enganche mayor que el total). */
export function condicionesDelPlan(
  plan: Pick<PlanDePagoAlAbrir, "enganche" | "numPagos" | "primerPago">,
  total: number,
): CondicionesPago {
  return normalizarCondiciones(
    { modo: "plazos", metodo: null, enganche: plan.enganche, numPagos: plan.numPagos, frecuencia: "MONTHLY", primerPago: plan.primerPago },
    total,
  );
}

/**
 * La línea corta bajo el plan: «Enganche $12,000 y 18 pagos de $1,333.33, el primero el 29/10/2026».
 * Sale del MISMO calendario que después ve el paciente en la factura (`calcularCalendario`).
 */
export function vistaPreviaDelPlan(e: EstadoDelPlan): string | null {
  if (e.modo === "PAGO_POR_CONTROL") {
    const precio = leerPrecioColocacion(e.precioColocacion);
    if (precio === null) return null;
    return `Colocación de ${pesos(precio)}. Los controles se cobran al firmar cada hoja.`;
  }
  const total = e.costoTotal;
  const enganche = leerEnganche(e.enganche);
  const pagos = leerNumeroDePagos(e.numPagos);
  if (total === null || enganche === null || pagos === null || enganche >= total) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.primerPago)) return null;
  const condiciones = condicionesDelPlan({ enganche, numPagos: pagos, primerPago: e.primerPago }, total);
  const cal = calcularCalendario(total, condiciones);
  const mensualidades = cal.pagos.filter((p) => !p.esEnganche);
  const primera = mensualidades[0]?.fecha ?? e.primerPago;
  const partes = mensualidades.length === 1
    ? `1 pago de ${pesos(cal.montoTipico)}`
    : `${mensualidades.length} pagos de ${pesos(cal.montoTipico)}${cal.parejo ? "" : " (ajustados al centavo)"}`;
  const inicio = enganche > 0 ? `Enganche ${pesos(enganche)} y ` : "";
  return `${inicio}${partes}, el primero el ${fechaDdMmAaaa(primera)}.`;
}

/**
 * ¿Qué se manda a crear? `null` = el caso se abre SIN factura: quien abre lo pidió
 * («después»), no puede cobrar, o no hay plan (paciente en observación).
 */
export function planDePagoParaEnviar(e: {
  /** El paciente queda en observación: no hay caso con plan, así que no hay factura. */
  enObservacion: boolean;
  /** `billing.create` de quien abre el caso (el servidor lo vuelve a exigir). */
  puedeCobrar: boolean;
  /** Casilla «Crear el plan de pago después». */
  despues: boolean;
  modo: OrthoBillingMode;
  costoTotal: number | null;
  precioColocacion: string;
  enganche: string;
  numPagos: string;
  primerPago: string;
}): PlanDePagoAlAbrir | null {
  if (e.enObservacion || !e.puedeCobrar || e.despues) return null;
  if (faltantesDelPlanDePago(e).length > 0) return null;
  if (e.modo === "PAGO_POR_CONTROL") {
    return { modoDeCobro: e.modo, precioColocacion: leerPrecioColocacion(e.precioColocacion), enganche: 0, numPagos: 0, primerPago: null };
  }
  return {
    modoDeCobro: e.modo,
    precioColocacion: null,
    enganche: leerEnganche(e.enganche) ?? 0,
    numPagos: leerNumeroDePagos(e.numPagos) ?? MIN_PAGOS,
    primerPago: e.primerPago,
  };
}

/** Lo que se dice bajo el botón, según lo que va a pasar con el cobro. */
export function notaDelCobroAlAbrir(e: { enObservacion: boolean; puedeCobrar: boolean; despues: boolean }): string {
  if (e.enObservacion) return "Queda dentro de la ficha del paciente";
  if (!e.puedeCobrar) return "Recepción armará el plan de pago";
  if (e.despues) return "El plan de pago queda pendiente: se arma en Cobro";
  return "Se creará la factura del tratamiento con este plan";
}
