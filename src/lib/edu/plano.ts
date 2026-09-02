/**
 * DaleControl INSTITUCIONAL — EL PLANO DE LA CLÍNICA contra la base.
 *
 * SERVIDOR: importa prisma. Todo lo que DECIDE algo —cómo se arma el plano
 * automático, qué se acepta al guardar, qué se le pasa al mundo 3D— vive en
 * plano-core.ts (puro), y quién ve qué vive en visibility.ts (el punto
 * único). Aquí solo hay consultas y las dos cerraduras de siempre.
 *
 * 🔴 institutionId de la SESIÓN, siempre. Nunca del query ni del body.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 LAS DOS CERRADURAS, Y POR QUÉ SON LAS MISMAS QUE LAS DEL TABLERO
 *
 *  1. el PERMISO — `clinica.view` para mirar el plano y `clinica.edit` para
 *     acomodarlo. Son dos keys porque son dos actos distintos: mover un
 *     sillón de sitio cambia lo que ven los otros treinta docentes y los
 *     ciento veinte estudiantes de la escuela.
 *  2. el ALCANCE — `eduLiveFloorVisibility` (visibility.ts), EL MISMO que
 *     el tablero en vivo, y a propósito: el plano y el tablero enseñan la
 *     misma cosa (qué pasa en cada unidad del piso), así que un segundo
 *     criterio sería un segundo sitio donde discrepar. ALUMNO y CAJA caen
 *     en "none" y esto lanza 403 aunque alguien les encienda la casilla.
 *
 * ⚠️ Y una tercera comprobación que no es de permiso sino de SEDE: el plano
 * que se pide tiene que ser de una sede a la que esa persona entra
 * (`eduCampusCovers`). Un id de una sede ajena no amplía nada.
 * ═══════════════════════════════════════════════════════════════════════
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { EduPadronError } from "@/lib/edu/padron";
import { EDU_MAX_CHAIRS, eduSafeTimeZone } from "@/lib/edu/agenda-core";
import { getEduClinicaViva } from "@/lib/edu/clinica-viva";
import type { EduVivaBoard } from "@/lib/edu/clinica-viva-core";
import {
  EDU_LIVE_FLOOR_NONE_DETAIL,
  eduCampusCovers,
  eduChairScopeWhere,
  eduLiveFloorVisibility,
  eduScopeIsEmpty,
  type EduClinicaContext,
} from "@/lib/edu/visibility";
import {
  eduPlanoAuto,
  eduPlanoEstado3D,
  eduPlanoMetadata,
  eduPlanoRevision,
  eduPlanoValidar,
  type EduPlanoChair,
  type EduPlanoLayout,
  type EduPlanoRevision,
} from "@/lib/edu/plano-core";
import { sanitizeElements, sanitizeMetadata } from "@/lib/floor-plan/sanitize";
import type { Chair3DState } from "@/components/clinic-3d/world-types";

export type { EduPlanoChair, EduPlanoLayout, EduPlanoRevision } from "@/lib/edu/plano-core";

/** La sede a la que pertenece un plano, con lo poco que hace falta pintar. */
export interface EduPlanoCampus {
  id: string;
  name: string;
  code: string;
  timezone: string;
}

/** Todo lo que necesita la pantalla del plano (la vista y el editor). */
export interface EduPlanoSede {
  campus: EduPlanoCampus;
  /** Los sillones ACTIVOS de la sede, en el orden de la escuela. */
  chairs: EduPlanoChair[];
  layout: EduPlanoLayout;
  revision: EduPlanoRevision;
}

/** Lo que devuelve el endpoint que se consulta en bucle. */
export interface EduPlanoEstado {
  /** Lo que lee el visor 3D. Mismo nombre de campo que el payload del dental. */
  chairs: Chair3DState[];
  /** El tablero completo: tarjetas, conteos y el horario de hoy. */
  board: EduVivaBoard;
  campusId: string;
  campusName: string;
  generatedAt: string;
}

function requireInstitution(ctx: EduClinicaContext): string {
  const id = ctx?.institutionId;
  if (!id || typeof id !== "string") {
    throw new EduPadronError("Sesión de instituto no válida.", 401);
  }
  return id;
}

/**
 * ¿Le toca el piso a quien pregunta? La MISMA puerta del tablero en vivo.
 *
 * Se llama ANTES de la primera consulta, igual que allá: un permiso
 * encendido por error no abre esto.
 */
function assertPiso(ctx: EduClinicaContext): void {
  if (eduScopeIsEmpty(eduLiveFloorVisibility(ctx))) {
    throw new EduPadronError(EDU_LIVE_FLOOR_NONE_DETAIL, 403);
  }
}

/** La sede pedida, comprobada contra el tenant y contra el ACCESO. */
async function resolverSede(
  ctx: EduClinicaContext,
  campusId: string,
): Promise<EduPlanoCampus> {
  const institutionId = requireInstitution(ctx);
  const limpio = typeof campusId === "string" ? campusId.trim() : "";
  if (!limpio) {
    throw new EduPadronError("Falta la sede de la que quieres el plano.", 400);
  }

  // 🔴 institutionId en el WHERE: sin él, un id de otra escuela devolvería
  // su sede. Y `eduCampusCovers` después, que es el recorte de la persona.
  const campus = await prisma.eduCampus.findFirst({
    where: { id: limpio, institutionId },
    select: { id: true, name: true, code: true, timezone: true },
  });
  if (!campus) {
    throw new EduPadronError("Esa sede no existe en tu instituto.", 404);
  }
  if (!eduCampusCovers(ctx.campusIds, campus.id)) {
    throw new EduPadronError(
      "No tienes acceso a esa sede. Pídele a la dirección que te la dé en Sedes.",
      403,
    );
  }
  return { ...campus, timezone: eduSafeTimeZone(campus.timezone) };
}

/**
 * ¿Falta aplicar sql/edu-clinica-plano.sql?
 *
 * El código llega a producción antes que el .sql y esta pantalla NO puede
 * quedarse en blanco por eso: sin la tabla se pinta el plano AUTOMÁTICO,
 * que es exactamente lo que ve una sede que todavía no acomodó el suyo. El
 * aviso en el servidor es lo único que distingue "falta el .sql" de "esta
 * sede no lo ha acomodado", que desde fuera se ven igual.
 */
function faltaLaTabla(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: string };
  return e.code === "P2021" || e.code === "P2022" || e.code === "42P01" || e.code === "42703";
}

/** Los sillones de la sede. `soloActivos: false` es para VALIDAR (ver abajo). */
async function sillonesDe(
  institutionId: string,
  campusId: string,
  soloActivos: boolean,
): Promise<EduPlanoChair[]> {
  const where: Prisma.EduChairWhereInput = {
    ...eduChairScopeWhere({ institutionId, campusIds: [campusId] }),
  };
  if (soloActivos) where.isActive = true;

  const filas = await prisma.eduChair.findMany({
    where,
    orderBy: [{ orderIndex: "asc" }, { number: "asc" }],
    take: EDU_MAX_CHAIRS,
    select: { id: true, name: true, number: true },
  });
  return filas.map((c) => ({ id: c.id, name: c.name, number: c.number }));
}

/**
 * EL PLANO DE UNA SEDE: el guardado, o el automático si nadie lo acomodó.
 */
export async function getEduPlanoSede(
  ctx: EduClinicaContext,
  campusId: string,
): Promise<EduPlanoSede> {
  const institutionId = requireInstitution(ctx);
  assertPiso(ctx);

  const campus = await resolverSede(ctx, campusId);
  const chairs = await sillonesDe(institutionId, campus.id, true);

  let fila: {
    elements: unknown;
    metadata: unknown;
    updatedAt: Date;
    updatedBy: { firstName: string; lastName: string } | null;
  } | null = null;
  try {
    fila = await prisma.eduCampusLayout.findFirst({
      where: { campusId: campus.id, institutionId },
      select: {
        elements: true,
        metadata: true,
        updatedAt: true,
        updatedBy: { select: { firstName: true, lastName: true } },
      },
    });
  } catch (err) {
    if (!faltaLaTabla(err)) throw err;
    console.warn(
      "[edu-plano] no se pudo leer el plano (¿falta aplicar sql/edu-clinica-plano.sql?):",
      err instanceof Error ? err.message : err,
    );
    fila = null;
  }

  const layout: EduPlanoLayout = fila
    ? {
        // El saneo es el del dental: un plano guardado hace meses con otra
        // forma se abre igual, descartando lo malformado en vez de reventar.
        elements: sanitizeElements(fila.elements),
        metadata: eduPlanoMetadata(sanitizeMetadata(fila.metadata)),
        auto: false,
        savedAtISO: fila.updatedAt.toISOString(),
        savedBy: fila.updatedBy
          ? [fila.updatedBy.firstName, fila.updatedBy.lastName].filter(Boolean).join(" ").trim() ||
            null
          : null,
      }
    : eduPlanoAuto(chairs);

  return {
    campus,
    chairs,
    layout,
    revision: eduPlanoRevision(layout.elements, chairs),
  };
}

/**
 * GUARDAR el plano de una sede.
 *
 * ⚠️ Se valida contra TODOS los sillones de la sede, activos o no, y no es
 * un descuido: un sillón que se dio de baja DESPUÉS de dibujarlo sigue
 * pegado a su elemento, y exigir que estuviera activo dejaría el plano
 * imposible de guardar hasta desligarlo — con el editor bloqueado justo
 * cuando hay que arreglarlo. La regla que sí se exige es la que importa:
 * que el sillón sea de ESTA sede.
 */
export async function saveEduPlano(
  ctx: EduClinicaContext & { eduUserId?: string },
  input: { campusId: string; elements: unknown; metadata: unknown },
): Promise<EduPlanoSede> {
  const institutionId = requireInstitution(ctx);
  assertPiso(ctx);

  const campus = await resolverSede(ctx, input.campusId);
  const todos = await sillonesDe(institutionId, campus.id, false);

  const veredicto = eduPlanoValidar({
    elements: input.elements,
    chairIds: todos.map((c) => c.id),
  });
  if (!veredicto.ok) {
    throw new EduPadronError(veredicto.error ?? "El plano no se pudo validar.", 400);
  }

  const metadata = eduPlanoMetadata(sanitizeMetadata(input.metadata));
  const elements = veredicto.elements as unknown as Prisma.InputJsonValue;

  try {
    await prisma.eduCampusLayout.upsert({
      // `campusId` es índice ÚNICO completo, que es lo que un upsert de
      // Prisma necesita para tener a qué agarrarse.
      where: { campusId: campus.id },
      create: {
        institutionId,
        campusId: campus.id,
        elements,
        metadata: metadata as unknown as Prisma.InputJsonValue,
        updatedByUserId: ctx.eduUserId ?? null,
      },
      update: {
        elements,
        metadata: metadata as unknown as Prisma.InputJsonValue,
        updatedByUserId: ctx.eduUserId ?? null,
      },
    });
  } catch (err) {
    if (faltaLaTabla(err)) {
      throw new EduPadronError(
        "El plano todavía no se puede guardar: falta aplicar sql/edu-clinica-plano.sql en la base. Avísale a soporte con ese nombre de archivo.",
        503,
      );
    }
    throw err;
  }

  return getEduPlanoSede(ctx, campus.id);
}

/**
 * EL ESTADO VIVO de una sede: lo que se consulta en bucle.
 *
 * 🔴 Reusa `getEduClinicaViva` ENTERO —el motor del dental adaptado, el
 * enmascarado y las dos cerraduras— y solo cambia la forma de la salida.
 * Escribir aquí una segunda lectura del piso sería el segundo sitio donde
 * un sillón puede decir una cosa distinta que el tablero de tarjetas.
 *
 * El recorte a UNA sede se hace estrechando `campusIds` a la sede pedida,
 * que ya quedó comprobada contra el acceso de la persona.
 */
export async function getEduPlanoEstado(
  ctx: EduClinicaContext,
  campusId: string,
  now: Date = new Date(),
): Promise<EduPlanoEstado> {
  assertPiso(ctx);
  const campus = await resolverSede(ctx, campusId);

  const board = await getEduClinicaViva({ ...ctx, campusIds: [campus.id] }, now, {
    horario: true,
  });

  return {
    chairs: eduPlanoEstado3D(board.cards),
    board,
    campusId: campus.id,
    campusName: campus.name,
    generatedAt: board.generatedAt,
  };
}
