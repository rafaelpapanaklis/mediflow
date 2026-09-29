import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  aplicarPermisos,
  clasificarFila,
  CATEGORIAS_MOVIMIENTO,
  LLAVES_CLINICAS_EN_PACIENTE,
  REGLAS_CATEGORIA_POR_ACCION,
  PREFIJO_ACCION_ODONTOGRAMA,
  ENTIDADES_DEDUCIBLES,
  ENTIDADES_EXCLUIDAS,
  entidadesDeCategoria,
  redactarMovimiento,
  type CategoriaMovimiento,
  type PermisosDeVista,
} from "./catalogo";
import type { FiltroMovimientos, MovimientoVista, PaginaDeMovimientos } from "./consultar-tipos";
export type { FiltroMovimientos, MovimientoVista, PaginaDeMovimientos } from "./consultar-tipos";
import {
  columnaProbablementeAusente,
  esColumnaPatientIdAusente,
  marcarColumnaAusente,
} from "./fila";

/**
 * Lista los movimientos de UN paciente desde `audit_logs`.
 *
 * Una fila es del paciente si:
 *   1. trae su `patientId` (columna nueva; ver fila.ts), o
 *   2. es una fila del propio paciente (entityType='patient' y entityId = él), o
 *   3. es de una entidad que se sabe de él (cita, factura, nota, receta…) —así
 *      salen también las filas de antes de que existiera la columna, sin
 *      backfill (un UPDATE sobre audit_logs lo frena el trigger de NOM-024).
 *
 * Sin la columna (aún sin correr el SQL) el punto 1 se lee de
 * `changes._mov.after.patientId`, solo de los últimos DIAS_SIN_COLUMNA días
 * porque ahí no hay índice: es un modo degradado y temporal.
 *
 * Las lecturas (`action='view'`) no son movimientos: son la bitácora de accesos.
 * clinicId es un ARREGLO (sedes vinculadas que comparten al paciente); jamás
 * puede venir vacío: un `IN ()` vacío o un `undefined` no deben devolver nada.
 */

export const DIAS_SIN_COLUMNA = 90;
export const TAMANO_PAGINA_MAXIMO = 100;
export const TAMANO_PAGINA_DEFECTO = 25;
/** Tope de filas de una descarga (CSV/PDF). Una ficha de años no llega, pero un tope evita un export sin fondo. */
export const TOPE_DESCARGA = 5000;

interface FilaCruda {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  changes: unknown;
  createdAt: Date;
  actorType: string | null;
  firstName: string | null;
  lastName: string | null;
}

export function normalizarPagina(page: unknown, pageSize: unknown): { page: number; pageSize: number } {
  const p = Math.floor(Number(page));
  const s = Math.floor(Number(pageSize));
  return {
    page: Number.isFinite(p) && p >= 1 ? Math.min(p, 100000) : 1,
    pageSize: Number.isFinite(s) && s >= 1 ? Math.min(s, TAMANO_PAGINA_MAXIMO) : TAMANO_PAGINA_DEFECTO,
  };
}

export function categoriaValida(v: unknown): CategoriaMovimiento | null {
  return typeof v === "string" && (CATEGORIAS_MOVIMIENTO as readonly string[]).indexOf(v) !== -1
    ? (v as CategoriaMovimiento)
    : null;
}

/** «2026-09-29» → Date a las 00:00 UTC del día; null si no es una fecha. */
export function fechaDeFiltro(v: unknown, finDelDia = false): Date | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T${finDelDia ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function timestampUtc(d: Date): Prisma.Sql {
  // Instante exacto: con una columna timestamptz no depende de la zona de la sesión.
  return Prisma.sql`${d.toISOString()}::timestamptz`;
}

function dondePertenece(f: FiltroMovimientos, conColumna: boolean, ahora: Date): Prisma.Sql {
  const pid = f.patientId;
  const ramas: Prisma.Sql[] = [
    Prisma.sql`(a."entityType" = 'patient' AND a."entityId" = ${pid})`,
  ];
  if (conColumna) {
    ramas.push(Prisma.sql`a."patientId" = ${pid}`);
  } else {
    const desde = new Date(ahora.getTime() - DIAS_SIN_COLUMNA * 86400000);
    ramas.push(
      Prisma.sql`(a."changes" -> '_mov' -> 'after' ->> 'patientId' = ${pid} AND a."createdAt" >= ${timestampUtc(desde)})`,
    );
  }
  for (const e of ENTIDADES_DEDUCIBLES) {
    ramas.push(
      Prisma.sql`(a."entityType" = ${e.entityType} AND a."entityId" IN (SELECT t."id" FROM ${Prisma.raw(`"${e.tabla}"`)} t WHERE t."patientId" = ${pid} AND t."clinicId" IN (${Prisma.join(f.clinicIds)})))`,
    );
  }
  return Prisma.sql`(${Prisma.join(ramas, " OR ")})`;
}

/**
 * La categoría de una fila, en SQL. Es el MISMO orden que `clasificarFila`:
 * 1) la que la fila dice de sí misma, 2) las filas del paciente que en realidad
 * son clínicas (odontograma, cuestionario, referencia), 3) la de su entidad.
 * Un test compara las dos para que no se separen.
 */
export function sqlCategoria(): Prisma.Sql {
  // Todo parámetro suelto lleva su tipo (`::text`, `::int`): dentro de un CASE o
  // como argumento de función Postgres no puede inferirlo y contesta «could not
  // determine data type of parameter $n» (500 en el filtro «Tipo», ws1-t9).
  const guardada = Prisma.sql`a."changes" -> '_mov' -> 'after' ->> 'categoria'`;
  const clinicasEnPaciente = LLAVES_CLINICAS_EN_PACIENTE.map(
    (k) => Prisma.sql`jsonb_exists(a."changes", ${k}::text)`,
  );
  const porAccion = REGLAS_CATEGORIA_POR_ACCION.map((r) => {
    const cond = r.prefijos.map((p) => Prisma.sql`left(a."action", ${p.length}::int) = ${p}::text`);
    return Prisma.sql`WHEN ${Prisma.join(cond, " OR ")} THEN ${r.categoria}::text`;
  });
  const porEntidad = CATEGORIAS_MOVIMIENTO.filter((c) => c !== "otros").map(
    (c) => Prisma.sql`WHEN a."entityType" IN (${Prisma.join(entidadesDeCategoria(c))}) THEN ${c}::text`,
  );
  return Prisma.sql`(CASE
    WHEN ${guardada} IN (${Prisma.join(CATEGORIAS_MOVIMIENTO.slice())}) THEN ${guardada}
    WHEN a."entityType" = 'patient' AND (
      left(a."action", ${PREFIJO_ACCION_ODONTOGRAMA.length}::int) = ${PREFIJO_ACCION_ODONTOGRAMA}::text
      OR ${Prisma.join(clinicasEnPaciente, " OR ")}
    ) THEN 'expediente'::text
    ${Prisma.join(porAccion, " ")}
    ${Prisma.join(porEntidad, " ")}
    ELSE 'otros'::text END)`;
}

function dondeCompleto(f: FiltroMovimientos, conColumna: boolean, ahora: Date): Prisma.Sql {
  const partes: Prisma.Sql[] = [
    Prisma.sql`a."clinicId" IN (${Prisma.join(f.clinicIds)})`,
    Prisma.sql`a."action" <> 'view'`,
    Prisma.sql`a."action" NOT LIKE '%.pdf'`,
    Prisma.sql`a."entityType" NOT IN (${Prisma.join(ENTIDADES_EXCLUIDAS.slice())})`,
    dondePertenece(f, conColumna, ahora),
  ];
  if (f.categoria) partes.push(Prisma.sql`${sqlCategoria()} = ${f.categoria}::text`);
  if (f.desde) partes.push(Prisma.sql`a."createdAt" >= ${timestampUtc(f.desde)}`);
  if (f.hasta) partes.push(Prisma.sql`a."createdAt" <= ${timestampUtc(f.hasta)}`);
  return Prisma.join(partes, " AND ");
}

function nombreDelActor(f: FilaCruda): string {
  if (f.actorType === "admin") return "Soporte DaleControl";
  const n = `${f.firstName ?? ""} ${f.lastName ?? ""}`.trim();
  return n || "Alguien del equipo";
}

async function correr(
  f: FiltroMovimientos,
  conColumna: boolean,
  limite: number,
  desplazamiento: number,
): Promise<{ filas: FilaCruda[]; total: number }> {
  const donde = dondeCompleto(f, conColumna, new Date());
  const filas = await prisma.$queryRaw<FilaCruda[]>`
    SELECT a."id", a."entityType", a."entityId", a."action", a."changes", a."createdAt", a."actorType",
           u."firstName", u."lastName"
    FROM "audit_logs" a
    LEFT JOIN "users" u ON u."id" = a."userId"
    WHERE ${donde}
    ORDER BY a."createdAt" DESC, a."id" DESC
    LIMIT ${limite} OFFSET ${desplazamiento}`;
  const cuenta = await prisma.$queryRaw<Array<{ n: bigint | number }>>`
    SELECT COUNT(*) AS n FROM "audit_logs" a WHERE ${donde}`;
  return { filas, total: Number(cuenta[0]?.n ?? 0) };
}

async function conFallbackDeColumna(
  f: FiltroMovimientos,
  limite: number,
  desplazamiento: number,
): Promise<{ filas: FilaCruda[]; total: number; degradado: boolean }> {
  if (!columnaProbablementeAusente()) {
    try {
      return { ...(await correr(f, true, limite, desplazamiento)), degradado: false };
    } catch (e) {
      if (!esColumnaPatientIdAusente(e)) throw e;
      marcarColumnaAusente();
    }
  }
  return { ...(await correr(f, false, limite, desplazamiento)), degradado: true };
}

function aVista(fila: FilaCruda, permisos: PermisosDeVista): MovimientoVista {
  const cat = clasificarFila({ entityType: fila.entityType, action: fila.action, changes: fila.changes });
  const texto = redactarMovimiento({ entityType: fila.entityType, action: fila.action, changes: fila.changes });
  const visto = aplicarPermisos(cat, texto, permisos);
  return {
    id: fila.id,
    fecha: new Date(fila.createdAt).toISOString(),
    actor: nombreDelActor(fila),
    categoria: visto.categoria,
    texto: visto.texto,
    oculto: visto.oculto,
  };
}

/** Una página de movimientos, ya redactada y con los permisos aplicados. */
export async function listarMovimientosDelPaciente(
  f: FiltroMovimientos,
  permisos: PermisosDeVista,
): Promise<PaginaDeMovimientos> {
  if (!f.patientId || f.clinicIds.length === 0) {
    return { items: [], total: 0, page: 1, pageSize: TAMANO_PAGINA_DEFECTO, paginas: 1, degradado: false };
  }
  const { page, pageSize } = normalizarPagina(f.page, f.pageSize);
  const { filas, total, degradado } = await conFallbackDeColumna(f, pageSize, (page - 1) * pageSize);
  return {
    items: filas.map((r) => aVista(r, permisos)),
    total,
    page,
    pageSize,
    paginas: Math.max(1, Math.ceil(total / pageSize)),
    degradado,
  };
}

/** Todo lo que cabe en una descarga (hasta TOPE_DESCARGA), más nuevo primero. */
export async function listarMovimientosParaDescarga(
  f: FiltroMovimientos,
  permisos: PermisosDeVista,
): Promise<{ items: MovimientoVista[]; total: number; recortado: boolean }> {
  if (!f.patientId || f.clinicIds.length === 0) return { items: [], total: 0, recortado: false };
  const { filas, total } = await conFallbackDeColumna(f, TOPE_DESCARGA, 0);
  return { items: filas.map((r) => aVista(r, permisos)), total, recortado: total > filas.length };
}
