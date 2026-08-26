// ═══════════════════════════════════════════════════════════════════════
// DaleControl INMUEBLES · PLD — EL CALENDARIO DEL CORTE Y LOS AVISOS.
//
// ── 🔴 EL INFORME EN CEROS ────────────────────────────────────────────
// Un mes sin operaciones que avisar TAMBIÉN se reporta. Es el error más
// caro y más fácil de cometer: la inmobiliaria no vendió nada, no tiene
// nada que declarar, y por eso mismo no entra al portal. La sanción es la
// misma que por no presentar un aviso con operaciones.
//
// Por eso el calendario pinta TODOS los periodos, tengan o no operaciones,
// y el que no las tiene sale marcado EN_CEROS con su fecha límite igual de
// visible. Un periodo vacío que no apareciera en pantalla sería la
// omisión que este módulo existe para evitar.
//
// ── 🔴 EL ESTADO "PRESENTADO" LO PONE UNA PERSONA ─────────────────────
// DaleControl no sabe —y no puede saber— si alguien subió el archivo en el
// portal del SAT. `presentedAt` se sella cuando una persona lo marca, con
// su nombre y su acuse. Nunca por un cron, nunca por descargar el archivo.
// Descargar no es presentar.
//
// ── LOS PERIODOS NO SE PRE-CREAN ──────────────────────────────────────
// La fila RealtyPldNotice nace la primera vez que alguien la toca (marca el
// periodo o baja su archivo). El calendario se pinta calculando los meses,
// no leyéndolos: un cron que fuera creando filas vacías cada mes sería otra
// cosa que se puede caer sin que nadie se entere.
// ═══════════════════════════════════════════════════════════════════════
import "server-only";
import { prisma } from "@/lib/prisma";
import type { RealtyContext } from "@/lib/realty-auth";
import type { OperacionRow, PeriodoRow, PldNoticeKind } from "./contrato";
import {
  diasEntre,
  etiquetaPeriodo,
  periodoDeFecha,
  periodosRecientes,
  vencimientoDelPeriodo,
  type PldParams,
} from "./umbrales";

/** Cuántos meses enseña el calendario hacia atrás. */
export const MESES_CALENDARIO = 13;

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/**
 * Arma el calendario: un renglón por mes, con lo que cae en él y en qué
 * estado va su aviso.
 *
 * `operaciones` ya viene evaluada contra el umbral. Solo cuentan para el
 * aviso las que lo REBASAN: una venta chica no se reporta, aunque exista.
 *
 * 🔴 Sin parámetros vigentes NO se inventa una fecha de corte: se devuelve
 * el calendario vacío y la pantalla enseña qué falta capturar. Un
 * vencimiento inventado es peor que ninguno — la inmobiliaria se confiaría.
 */
export async function armarCalendario(
  ctx: RealtyContext,
  params: PldParams | null,
  operaciones: OperacionRow[],
  hoy: Date = new Date(),
): Promise<PeriodoRow[]> {
  if (!params) return [];

  const timeZone = ctx.account.timezone || "America/Mexico_City";
  const periodos = periodosRecientes(hoy, MESES_CALENDARIO, timeZone);

  const filas = await prisma.realtyPldNotice.findMany({
    where: { accountId: ctx.accountId, periodMonth: { in: periodos } },
    select: {
      id: true,
      periodMonth: true,
      kind: true,
      status: true,
      dueDate: true,
      presentedAt: true,
      presentedByName: true,
      acuse: true,
    },
  });
  const porPeriodo = new Map(filas.map((f) => [f.periodMonth, f]));

  return periodos.map((periodMonth) => {
    const delMes = operaciones.filter(
      (o) => o.periodMonth === periodMonth && o.requiereAviso,
    );
    const sinExpediente = delMes.filter((o) => o.estadoExpediente !== "COMPLETO").length;
    const fila = porPeriodo.get(periodMonth);

    // La fecha límite se calcula SIEMPRE con el parámetro vigente, aunque la
    // fila ya exista: si el día de corte cambia por una reforma, el
    // calendario lo refleja sin tener que migrar filas viejas. La `dueDate`
    // guardada se conserva como constancia de con qué plazo se creó.
    const dueDate = vencimientoDelPeriodo(periodMonth, params.diaLimiteAviso);
    const dias = diasEntre(hoy, dueDate);

    // El TIPO lo manda la realidad, no la fila: si el mes no tiene
    // operaciones que avisar, es un informe EN CEROS aunque alguien haya
    // creado la fila como NORMAL antes de cancelar la única venta.
    const kind: PldNoticeKind = delMes.length > 0 ? "NORMAL" : "EN_CEROS";

    return {
      periodMonth,
      etiqueta: etiquetaPeriodo(periodMonth),
      dueDate: dueDate.toISOString(),
      operaciones: delMes.length,
      sinExpediente,
      kind,
      status: fila?.status ?? "PENDIENTE",
      noticeId: fila?.id ?? null,
      presentedAt: iso(fila?.presentedAt ?? null),
      presentedByName: fila?.presentedByName ?? null,
      acuse: fila?.acuse ?? null,
      diasRestantes: dias,
      // Vencido = pasó la fecha Y sigue pendiente. Un aviso presentado tarde
      // ya no urge: urge el que nadie ha presentado.
      vencido: dias < 0 && (fila?.status ?? "PENDIENTE") === "PENDIENTE",
    };
  });
}

/**
 * Crea la fila del periodo si no existía y devuelve su id.
 *
 * 🔴 upsert por el índice COMPLETO (accountId, periodMonth). Un upsert por
 * `periodMonth` solo dejaría que la fila de otra inmobiliaria se pisara.
 */
export async function asegurarAviso(
  ctx: RealtyContext,
  periodMonth: string,
  kind: PldNoticeKind,
  params: PldParams,
): Promise<string> {
  const dueDate = vencimientoDelPeriodo(periodMonth, params.diaLimiteAviso);
  const fila = await prisma.realtyPldNotice.upsert({
    where: { accountId_periodMonth: { accountId: ctx.accountId, periodMonth } },
    create: { accountId: ctx.accountId, periodMonth, kind, dueDate },
    // El `kind` se refresca: el mes pudo haber cambiado de tener
    // operaciones a no tenerlas. Lo que NO se toca es el estado ni el acuse.
    update: { kind },
    select: { id: true },
  });
  return fila.id;
}

/** "AAAA-MM" válido y dentro de un rango sensato. Nada llega crudo a Prisma. */
export function periodoValido(raw: unknown): string | null {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}$/.test(raw)) return null;
  const [y, m] = raw.split("-").map(Number);
  if (m < 1 || m > 12) return null;
  if (y < 2020 || y > 2100) return null;
  return raw;
}

export interface ParcheAviso {
  /** true = marcar presentado, false = deshacer la marca. */
  presentado: boolean;
  acuse?: string | null;
  notas?: string | null;
}

/**
 * Marca un periodo como presentado (o deshace la marca).
 *
 * DESHACER existe a propósito: alguien marca el mes equivocado y tiene que
 * poder corregirlo. Lo que queda es la bitácora, que registra las dos
 * cosas — y `presentedByName`, que dice quién lo marcó la última vez.
 */
export async function marcarAviso(
  ctx: RealtyContext,
  periodMonth: string,
  parche: ParcheAviso,
  params: PldParams,
  kind: PldNoticeKind,
  nombreUsuario: string,
): Promise<{ ok: true; noticeId: string } | { error: string }> {
  const noticeId = await asegurarAviso(ctx, periodMonth, kind, params);
  const ahora = new Date();

  await prisma.realtyPldNotice.updateMany({
    where: { id: noticeId, accountId: ctx.accountId },
    data: parche.presentado
      ? {
          status: "PRESENTADO",
          presentedAt: ahora,
          presentedById: ctx.realtyUserId,
          presentedByName: nombreUsuario,
          acuse: typeof parche.acuse === "string" ? parche.acuse.trim().slice(0, 400) || null : null,
          notes: typeof parche.notas === "string" ? parche.notas.trim().slice(0, 2000) || null : null,
        }
      : {
          status: "PENDIENTE",
          presentedAt: null,
          presentedById: null,
          presentedByName: null,
          acuse: null,
        },
  });

  // Al presentar, las operaciones del mes quedan LIGADAS a ese aviso: así
  // el tablero puede decir "esta operación ya se reportó, y en cuál".
  if (parche.presentado) {
    await ligarOperacionesAlAviso(ctx, periodMonth, noticeId);
  }

  return { ok: true, noticeId };
}

/**
 * Ata las operaciones cerradas del periodo a su aviso.
 *
 * Se hace en dos pasos y no con un `updateMany` sobre una relación anidada
 * porque las filas RealtyPldOperation pueden NO EXISTIR todavía: una
 * operación cuyo efectivo nadie tocó no tiene fila. Se crean las que
 * falten con `createMany` + `skipDuplicates` (el índice único
 * (accountId, dealId) hace el resto) y luego se marcan todas.
 */
async function ligarOperacionesAlAviso(
  ctx: RealtyContext,
  periodMonth: string,
  noticeId: string,
): Promise<void> {
  try {
    const timeZone = ctx.account.timezone || "America/Mexico_City";
    // La ventana se abre generosa (todo el mes en UTC ± un día) y el filtro
    // FINO por periodo se hace en memoria con la zona de la cuenta: un
    // `gte/lt` en UTC dejaría fuera la venta del último día del mes cerrada
    // por la tarde en México.
    const [y, m] = periodMonth.split("-").map(Number);
    const desde = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0));
    desde.setUTCDate(desde.getUTCDate() - 1);
    const hasta = new Date(Date.UTC(y, m, 1, 0, 0, 0));
    hasta.setUTCDate(hasta.getUTCDate() + 1);

    const deals = await prisma.realtyDeal.findMany({
      where: {
        accountId: ctx.accountId,
        status: "CERRADO",
        closedAt: { gte: desde, lt: hasta },
      },
      select: { id: true, closedAt: true },
    });

    const ids = deals
      .filter((d) => d.closedAt && periodoDeFecha(d.closedAt, timeZone) === periodMonth)
      .map((d) => d.id);
    if (ids.length === 0) return;

    await prisma.realtyPldOperation.createMany({
      data: ids.map((dealId) => ({ accountId: ctx.accountId, dealId })),
      skipDuplicates: true,
    });
    await prisma.realtyPldOperation.updateMany({
      where: { accountId: ctx.accountId, dealId: { in: ids } },
      data: { noticeId },
    });
  } catch (e) {
    // Ligar es una comodidad del tablero: si falla, el aviso SIGUE
    // marcado como presentado, que es lo que de verdad importa.
    console.error("[realty-pld] no se pudieron ligar las operaciones al aviso:", e);
  }
}
