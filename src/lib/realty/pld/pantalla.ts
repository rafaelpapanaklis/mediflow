// ═══════════════════════════════════════════════════════════════════════
// DaleControl INMUEBLES · PLD — EL ENSAMBLADOR DE LA PANTALLA.
//
// Una sola función que la página de servidor llama y ya. Junta parámetros,
// operaciones, expedientes y calendario, y devuelve el objeto completo.
//
// ── 🔴 SIN PARÁMETROS, LA PANTALLA NO SE CAE ──────────────────────────
// Si nadie ha capturado la UMA del año o el bloque de umbrales, esto
// devuelve `umbrales: null` y la lista de lo que falta. La pantalla sigue
// SIRVIENDO: se pueden integrar expedientes, subir papeles y ver la
// bitácora — nada de eso depende de un número. Lo único que desaparece es
// la comparación contra el umbral, que es justo lo que no se puede
// inventar.
//
// ── POR QUÉ SE CARGAN LAS OPERACIONES ANTES QUE LOS EXPEDIENTES ───────
// El riesgo de un expediente depende de si esa persona tiene operaciones
// por encima del umbral o con efectivo prohibido. Esas señales salen de
// cargarOperaciones(), así que el orden importa: primero las operaciones,
// que devuelven los dos conjuntos de contactIds, y con ellos se arman los
// expedientes.
// ═══════════════════════════════════════════════════════════════════════
import "server-only";
import { prisma } from "@/lib/prisma";
import type { RealtyContext } from "@/lib/realty-auth";
import { hasRealtyPermission } from "@/lib/realty/permissions";
import { fromCents } from "@/lib/realty/calc/money";
import type {
  ContactoLite,
  ExpedienteRow,
  FaltantePld,
  PantallaCumplimiento,
  TableroPld,
  UmbralesVigentes,
} from "./contrato";
import { armarCalendario, MESES_CALENDARIO } from "./avisos";
import { listarExpedientes } from "./expedientes";
import { cargarOperaciones } from "./operaciones";
import { getPldParams } from "./parametros";
import { umbralesEnPesos, type PldParams } from "./umbrales";

/**
 * Cuántos días antes de que caduque un papel se considera "por vencer".
 *
 * ⚠️ Esto NO es un valor de la ley y por eso SÍ puede vivir en código: es
 * cuánta antelación quiere el tablero para avisar. Cambiarlo no cambia
 * ninguna obligación, solo el color de una tarjeta.
 */
const DIAS_POR_VENCER = 30;

/** Los umbrales resueltos, en pesos, listos para pintar. */
export function umbralesParaPantalla(p: PldParams): UmbralesVigentes {
  const en = umbralesEnPesos(p);
  return {
    year: p.year,
    umaDiaria: fromCents(p.umaDiariaCents),
    identificacionUma: p.identificacionUma,
    avisoUma: p.avisoUma,
    efectivoUma: p.efectivoUma,
    identificacion: fromCents(en.identificacionCents),
    aviso: fromCents(en.avisoCents),
    efectivo: fromCents(en.efectivoCents),
    diaLimiteAviso: p.diaLimiteAviso,
    horasAvisoUrgente: p.horasAvisoUrgente,
    aniosConservacion: p.aniosConservacion,
    porVerificar: p.porVerificar,
    fuente: p.fuente,
    nota: p.nota,
  };
}

/**
 * La ventana de operaciones que se carga: los meses del calendario más uno
 * de colchón. Traerse la historia completa de una inmobiliaria con años de
 * cartera no le sirve a nadie en esta pantalla.
 */
function desdeDelCalendario(hoy: Date): Date {
  const d = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1));
  d.setUTCMonth(d.getUTCMonth() - (MESES_CALENDARIO + 1));
  return d;
}

export async function getPantallaCumplimiento(
  ctx: RealtyContext,
): Promise<PantallaCumplimiento> {
  const hoy = new Date();
  const timeZone = ctx.account.timezone || "America/Mexico_City";
  const puedeGestionar = hasRealtyPermission(
    { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride },
    "pld.manage",
  );

  const resueltos = await getPldParams(hoy);
  const params: PldParams | null = resueltos.ok ? resueltos.params : null;
  const faltantes: FaltantePld[] = resueltos.faltantes.map((f) => ({
    kind: String(f.kind),
    stateCode: f.stateCode,
    etiqueta: f.etiqueta,
    comoResolver: f.comoResolver,
  }));

  // 1. Operaciones — de aquí salen las señales que suben el riesgo.
  const { operaciones, rebasa, efectivo } = await cargarOperaciones(ctx, params, {
    desde: desdeDelCalendario(hoy),
  });

  // 2. Expedientes, ya con esas señales encima.
  const expedientes = await listarExpedientes(ctx, { rebasa, efectivo }, hoy);

  // 3. Calendario del corte.
  const periodos = await armarCalendario(ctx, params, operaciones, hoy);

  // 4. Contactos a los que todavía se les puede abrir expediente.
  const contactos = await listarContactos(ctx, expedientes);

  return {
    umbrales: params ? umbralesParaPantalla(params) : null,
    faltantes,
    avisos: resueltos.avisos,
    tablero: contarTablero(expedientes, operaciones, periodos, hoy),
    expedientes,
    operaciones,
    periodos,
    contactos,
    puedeGestionar,
    timeZone,
  };
}

/**
 * Clientes y prospectos de la cuenta, marcando cuáles ya tienen expediente.
 *
 * Se traen TODOS (con tope) y no solo los que no lo tienen: el selector
 * enseña los que ya tienen para que se pueda saltar a su expediente en vez
 * de intentar crear uno duplicado que el índice único rechazaría.
 */
async function listarContactos(
  ctx: RealtyContext,
  expedientes: ExpedienteRow[],
): Promise<ContactoLite[]> {
  const conExpediente = new Set(expedientes.map((e) => e.contactId));
  const filas = await prisma.realtyContact.findMany({
    where: { accountId: ctx.accountId },
    select: { id: true, name: true, phone: true },
    orderBy: { name: "asc" },
    take: 500,
  });
  return filas.map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    conExpediente: conExpediente.has(c.id),
  }));
}

/**
 * Los contadores del tablero.
 *
 * Se cuentan sobre lo que YA se trajo, no con `count()` sueltos: los
 * números de las tarjetas y los de las listas de abajo tienen que ser el
 * mismo número. Dos consultas distintas con filtros parecidos es como se
 * consigue que la tarjeta diga 3 y la lista enseñe 4.
 */
export function contarTablero(
  expedientes: ExpedienteRow[],
  operaciones: PantallaCumplimiento["operaciones"],
  periodos: PantallaCumplimiento["periodos"],
  hoy: Date,
): TableroPld {
  const limitePorVencer = hoy.getTime() + DIAS_POR_VENCER * 86_400_000;

  let documentosPorVencer = 0;
  for (const e of expedientes) {
    for (const d of e.documents) {
      if (d.archivedAt || !d.expiresAt) continue;
      const t = new Date(d.expiresAt).getTime();
      // Los YA vencidos no cuentan aquí: esos salen como expediente VENCIDO,
      // y sumarlos en las dos tarjetas contaría el mismo problema dos veces.
      if (t >= hoy.getTime() && t <= limitePorVencer) documentosPorVencer += 1;
    }
  }

  return {
    expedientesIncompletos: expedientes.filter((e) => e.estado === "INCOMPLETO").length,
    expedientesVencidos: expedientes.filter((e) => e.estado === "VENCIDO").length,
    operacionesSinExpediente: operaciones.filter(
      (o) => o.requiereExpediente && o.estadoExpediente !== "COMPLETO",
    ).length,
    pepDetectados: expedientes.filter((e) => e.pep !== "NO").length,
    documentosPorVencer,
    efectivoEnBandera: operaciones.filter((o) => o.efectivoProhibido).length,
    // Una alerta cuenta como abierta mientras no se cierre, haya vencido o
    // no: una alerta de 24 horas que ya se pasó no deja de ser urgente.
    alertas24h: operaciones.filter((o) => o.urgentFlaggedAt && !o.urgentDoneAt).length,
    proximoCorte:
      periodos
        .filter((p) => p.status === "PENDIENTE")
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0] ?? null,
  };
}
