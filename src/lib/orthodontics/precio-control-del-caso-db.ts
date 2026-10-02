// Ortodoncia — precio por control de CADA caso (ws1-t12, ticket 3 de BEVADENT, 6b). Ver precio-control-del-caso.ts.
//
// Columna nueva `orthodontic_treatment_plans."controlPriceMxn"` (sql/ws1-t12-precio-control-por-caso.sql),
// NO declarada en schema.prisma a propósito (mismo motivo que "billingMode" y "techniqueLabel": decenas de
// `findMany` sin `select` tirarían P2022 mientras el SQL no esté pegado). Va por SQL crudo con su sonda, que
// pregunta a information_schema (nunca falla ni deja errores en los logs de Postgres) y recuerda la respuesta
// en globalThis: `next dev` recarga módulos y una variable del módulo se perdería. «Sí» se recuerda siempre;
// «no», 10 minutos.
//
// Sin la columna: ningún caso tiene precio propio y todos los controles se cobran con el del catálogo, como antes.

import { prisma } from "@/lib/prisma";
import { buscarPrecioControlOrto } from "./catalog-procedures";
import { cargarModoDeCobro } from "./billing-mode-db";
import { normalizarOrthoBillingMode } from "./billing-mode";
import { leerTecnicasDeLaClinica } from "./tecnicas-de-la-clinica-db";
import { tecnicaDelCaso } from "./tecnicas-de-la-clinica";
import { elegirPrecioDeControl, precioDeCasoValido, type PrecioDeControl } from "./precio-control-del-caso";

const RECORDAR_AUSENCIA_MS = 10 * 60 * 1000;
const CLAVE = Symbol.for("dalecontrol.orto.controlPriceMxn");
type Sonda = { existe: boolean; at: number };
const memoria = globalThis as unknown as Record<symbol, Sonda | undefined>;

export async function columnaPrecioControlExiste(forzar = false): Promise<boolean> {
  const s = memoria[CLAVE];
  if (!forzar && s && (s.existe || Date.now() - s.at < RECORDAR_AUSENCIA_MS)) return s.existe;
  try {
    const filas = await prisma.$queryRaw<{ existe: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'orthodontic_treatment_plans' AND column_name = 'controlPriceMxn'
      ) AS existe`;
    const existe = filas[0]?.existe === true;
    memoria[CLAVE] = { existe, at: Date.now() };
    return existe;
  } catch (e) {
    console.warn("[ortodoncia:precio-control] no se pudo comprobar la columna:", e);
    return false;
  }
}

/** Solo para pruebas. */
export function _olvidarSondaPrecioControl(): void {
  memoria[CLAVE] = undefined;
}

/** El precio por control propio del caso, o null (sin columna, sin precio, sin clínica o con error). Nunca lanza. */
export async function leerPrecioControlDelCaso(clinicId: string, planId: string): Promise<number | null> {
  // Regla dura (c): sin clínica no se consulta.
  if (!clinicId || !planId) return null;
  if (!(await columnaPrecioControlExiste())) return null;
  try {
    const filas = await prisma.$queryRaw<{ controlPriceMxn: unknown }[]>`
      SELECT "controlPriceMxn" FROM "orthodontic_treatment_plans"
       WHERE "id" = ${planId} AND "clinicId" = ${clinicId}`;
    return precioDeCasoValido(filas[0]?.controlPriceMxn ?? null);
  } catch (e) {
    console.warn("[ortodoncia:precio-control] no se pudo leer el precio del caso:", e);
    return null;
  }
}

/**
 * Pone (o quita, con null) el precio por control del caso. No lanza: sin la columna el caso se cobra con el del
 * catálogo y solo avisa por consola. Devuelve si quedó guardado.
 */
export async function guardarPrecioControlDelCaso(clinicId: string, planId: string, precio: number | null): Promise<boolean> {
  if (!clinicId || !planId) return false;
  const valor = precio === null ? null : precioDeCasoValido(precio);
  if (precio !== null && valor === null) return false;
  if (!(await columnaPrecioControlExiste())) {
    if (valor !== null) console.warn("[ortodoncia:precio-control] columna controlPriceMxn aún sin aplicar (sql/ws1-t12-precio-control-por-caso.sql) — el caso se cobra con el precio del catálogo");
    return false;
  }
  try {
    await prisma.$executeRaw`
      UPDATE "orthodontic_treatment_plans" SET "controlPriceMxn" = ${valor}::numeric
       WHERE "id" = ${planId} AND "clinicId" = ${clinicId}`;
    return true;
  } catch (e) {
    console.warn("[ortodoncia:precio-control] no se pudo guardar el precio del caso:", e);
    return false;
  }
}

/**
 * Con qué se factura un control de ESTE caso: su precio propio o, si no tiene, «Control de ortodoncia» del
 * catálogo. Lanza solo si el catálogo lanza (igual que `buscarPrecioControlOrto`): quien llama ya lo atrapa.
 */
export async function precioDeControlDelCaso(clinicId: string, planId: string): Promise<PrecioDeControl | null> {
  if (!clinicId) return null;
  const delCaso = await leerPrecioControlDelCaso(clinicId, planId);
  // Con precio propio, el catálogo solo da el nombre del concepto: si falla, se cobra igual.
  const catalogo = delCaso !== null ? await buscarPrecioControlOrto(clinicId).catch(() => null) : await buscarPrecioControlOrto(clinicId);
  return elegirPrecioDeControl(delCaso, catalogo);
}

/**
 * Al abrir un caso o cambiarle la técnica: copia al caso el precio por control de su técnica (null = sin precio
 * propio, se cobra con el del catálogo). Solo en «Pago por control»: en «Precio total» el control no se cobra
 * aparte. Nunca lanza. Devuelve el antes y el después para la bitácora (`cambio: false` si no se tocó nada).
 */
export async function fijarPrecioControlSegunTecnica(args: {
  clinicId: string;
  planId: string;
  base: string;
  label: string | null;
  /** El modo del caso si quien llama ya lo sabe (al abrirlo); si no, se lee. */
  billingMode?: string | null;
  /** true al abrir el caso (no hay «antes» que leer). */
  nuevo?: boolean;
}): Promise<{ cambio: boolean; antes: number | null; despues: number | null }> {
  const sinCambio = { cambio: false, antes: null, despues: null };
  try {
    if (!args.clinicId || !args.planId) return sinCambio;
    if (!(await columnaPrecioControlExiste())) return sinCambio;
    const modo = normalizarOrthoBillingMode(args.billingMode !== undefined ? args.billingMode : await cargarModoDeCobro(args.clinicId, args.planId));
    if (modo !== "PAGO_POR_CONTROL") return sinCambio;
    const { tecnicas } = await leerTecnicasDeLaClinica(args.clinicId);
    const despues = precioDeCasoValido(tecnicaDelCaso(tecnicas, { base: args.base, label: args.label })?.precioControl ?? null);
    const antes = args.nuevo ? null : await leerPrecioControlDelCaso(args.clinicId, args.planId);
    if (antes === despues) return { cambio: false, antes, despues };
    const ok = await guardarPrecioControlDelCaso(args.clinicId, args.planId, despues);
    return ok ? { cambio: true, antes, despues } : { cambio: false, antes, despues: antes };
  } catch (e) {
    console.warn("[ortodoncia:precio-control] no se pudo fijar el precio del caso:", e);
    return sinCambio;
  }
}
