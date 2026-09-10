/**
 * DaleControl INSTITUCIONAL — LOS BLOQUEOS DE AGENDA contra la base (H-19).
 *
 * SERVIDOR: importa prisma. Lo puro (el solape, el alcance por sede o
 * sillón, los parsers) vive en agenda-bloqueos-core.ts.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 EL DOBLE CANDADO
 *
 *   · PERMISO — `agenda.view` para leer (cualquiera que abre la rejilla
 *     tiene que ver por qué un hueco está cerrado) y `sillones.manage`
 *     para crear y retirar. Ninguna key nueva: cerrar un día o sacar un
 *     sillón de servicio es exactamente la misma familia que capturar el
 *     horario de un sillón, y `sillones.manage` solo lo lleva DIRECCION
 *     por defecto — que es de quien es la decisión de cerrar la escuela un
 *     martes.
 *   · ALCANCE — el de la SEDE (`eduCampusCovers`): quien solo entra al
 *     campus norte no cierra el sur. Y el `institutionId` de la sesión en
 *     TODAS las consultas, como siempre.
 *
 * ⚠️ UN BLOQUEO NO CANCELA LAS CITAS QUE YA ESTÁN. Se dice aquí, se dice
 * en el core y se dice en el SQL, porque es lo primero que alguien va a
 * querer «arreglar»: bloquear es cerrar el hueco para lo que VENGA. Lo que
 * ya estaba agendado se reagenda a mano, con su aviso al paciente. Un
 * bloqueo que cancela en cascada borra la tarde de alguien sin que nadie
 * lo decida — y en este producto una cita se cancela con motivo y con
 * recordatorio, no en silencio.
 * ═══════════════════════════════════════════════════════════════════════
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { EduPadronError } from "@/lib/edu/padron";
import { eduCleanId } from "@/lib/edu/agenda-core";
import { eduCampusCovers, type EduClinicaContext } from "@/lib/edu/visibility";
import {
  EDU_BLOCK_MAX_ROWS,
  eduBlockParseKind,
  eduBlockParseRango,
  eduBlockParseRangoLocal,
  eduBlockParseReason,
  type EduAgendaBlockKind,
  type EduBloqueoVista,
} from "@/lib/edu/agenda-bloqueos-core";
import { eduAudit, type EduAuditActor } from "@/lib/edu/auditoria";

export interface EduBloqueoContext extends EduClinicaContext, EduAuditActor {}

function requireInstitution(ctx: { institutionId?: string }): string {
  const id = ctx?.institutionId;
  if (!id || typeof id !== "string") {
    throw new EduPadronError("Tu sesión no trae instituto. Vuelve a entrar.", 401);
  }
  return id;
}

/**
 * Lo que sale por la API. Es `EduBloqueoVista` (el tipo client-safe del
 * core) MÁS la fecha en que se capturó.
 *
 * 🔴 EXTIENDE, no repite: las pantallas importan `EduBloqueoVista` desde el
 * core —este archivo trae prisma y no puede cruzar al navegador— y dos
 * declaraciones paralelas del mismo objeto se separan en el primer campo
 * nuevo, sin que el compilador diga nada.
 */
export interface EduBloqueoRow extends EduBloqueoVista {
  createdAt: string;
}

/**
 * La zona del INSTITUTO, para un bloqueo que no cuelga de ninguna sede.
 *
 * Se lee aquí y no se recibe por parámetro para que ninguna pantalla pueda
 * mandar la suya: la zona con la que se cierra la escuela es la de la
 * escuela, no la del navegador que apretó el botón.
 */
async function zonaDelInstituto(institutionId: string): Promise<string> {
  const i = await prisma.eduInstitution.findFirst({
    where: { id: institutionId },
    select: { timezone: true },
  });
  return i?.timezone || "UTC";
}

/**
 * LOS BLOQUEOS que solapan un rango.
 *
 * 🔴 «SOLAPAN», NO «EMPIEZAN DENTRO». Un puente que arranca el viernes y
 * termina el lunes tiene que salir cuando se pregunta por el sábado, y con
 * un filtro de `startsAt` dentro del día no saldría: la agenda del sábado
 * se pintaría abierta. La condición es la del core (`[inicio, fin)` que se
 * cruzan) escrita como `where`.
 */
export async function listEduBloqueos(
  ctx: EduBloqueoContext,
  query: { desde?: unknown; hasta?: unknown; campusId?: unknown; chairId?: unknown },
): Promise<EduBloqueoRow[]> {
  const institutionId = requireInstitution(ctx);

  const desde = new Date(String(query?.desde ?? ""));
  const hasta = new Date(String(query?.hasta ?? ""));
  if (Number.isNaN(desde.getTime()) || Number.isNaN(hasta.getTime())) {
    throw new EduPadronError("Manda el rango («desde» y «hasta») en formato ISO.", 400);
  }

  const where: Prisma.EduAgendaBlockWhereInput = {
    institutionId,
    deletedAt: null,
    startsAt: { lt: hasta },
    endsAt: { gt: desde },
  };

  const campusId = eduCleanId(query?.campusId);
  if (campusId) {
    // Un bloqueo del INSTITUTO (campusId null) alcanza también a esta
    // sede: pedir "los de la sede norte" tiene que devolver el festivo
    // nacional. Con `campusId: x` a secas, la rejilla del norte pintaría
    // el 16 de septiembre abierto.
    where.OR = [{ campusId: null }, { campusId }];
  }
  const chairId = eduCleanId(query?.chairId);
  if (chairId) {
    where.AND = [{ OR: [{ chairId: null }, { chairId }] }];
  }

  const filas = await prisma.eduAgendaBlock.findMany({
    where,
    orderBy: { startsAt: "asc" },
    take: EDU_BLOCK_MAX_ROWS,
    select: {
      id: true,
      kind: true,
      reason: true,
      campusId: true,
      chairId: true,
      startsAt: true,
      endsAt: true,
      createdByName: true,
      createdAt: true,
    },
  });

  return filas.map((b) => ({
    id: b.id,
    kind: b.kind as EduAgendaBlockKind,
    reason: b.reason,
    campusId: b.campusId,
    chairId: b.chairId,
    startsAt: b.startsAt.toISOString(),
    endsAt: b.endsAt.toISOString(),
    createdByName: b.createdByName,
    createdAt: b.createdAt.toISOString(),
  }));
}

/**
 * CREA un bloqueo.
 *
 * 🔴 EL SILLÓN MANDA SOBRE LA SEDE. Si viene `chairId`, la sede se toma
 * DEL SILLÓN y no de lo que mande el cliente: un bloqueo que dijera "campus
 * sur" apuntando a un sillón del norte sería un bloqueo que no alcanza a
 * nada y que la rejilla no puede explicar.
 */
export async function createEduBloqueo(
  ctx: EduBloqueoContext,
  body: {
    kind?: unknown;
    reason?: unknown;
    campusId?: unknown;
    chairId?: unknown;
    startsAt?: unknown;
    endsAt?: unknown;
    /** La forma que teclea una persona: días de calendario. Ver abajo. */
    desdeDia?: unknown;
    desdeHora?: unknown;
    hastaDia?: unknown;
    hastaHora?: unknown;
  },
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<{ id: string }> {
  const institutionId = requireInstitution(ctx);

  const kind = eduBlockParseKind(body?.kind);
  const reason = eduBlockParseReason(body?.reason);

  let campusId = eduCleanId(body?.campusId);
  let chairId = eduCleanId(body?.chairId);
  // La zona con la que se interpretan los DÍAS que teclea la persona. Es la
  // de la SEDE si el bloqueo tiene una, y la del instituto si cierra la
  // escuela entera: «el 15» del campus de Tijuana empieza dos horas después
  // que «el 15» del de Mérida, y un cierre de día completo puesto con la
  // zona equivocada se come la primera cita de la mañana.
  let zona: string | null = null;

  if (chairId) {
    const sillon = await prisma.eduChair.findFirst({
      where: { id: chairId, institutionId },
      select: { id: true, campusId: true, campus: { select: { timezone: true } } },
    });
    if (!sillon) throw new EduPadronError("Ese sillón no existe o no es de tu instituto.", 404);
    chairId = sillon.id;
    campusId = sillon.campusId;
    zona = sillon.campus.timezone || null;
  } else if (campusId) {
    const sede = await prisma.eduCampus.findFirst({
      where: { id: campusId, institutionId },
      select: { id: true, timezone: true },
    });
    if (!sede) throw new EduPadronError("Esa sede no existe o no es de tu instituto.", 404);
    campusId = sede.id;
    zona = sede.timezone || null;
  }

  // ═══════════════════════════════════════════════════════════════════
  // 🔴 DOS FORMAS DE MANDAR EL RANGO, Y LAS DOS SON NECESARIAS
  //
  //   · `desdeDia`/`hastaDia` — la de la PANTALLA. Días de calendario, que
  //     es lo que una persona escribe («del 15 al 17»), convertidos aquí
  //     con la zona de la sede. El navegador no puede hacer esa conversión:
  //     interpretaría el día en la zona del dispositivo.
  //   · `startsAt`/`endsAt` ISO — la que ya documentó la C·base y con la
  //     que se probó la API. Se mantiene: quitarla rompería el QA escrito y
  //     cualquier integración que ya la use.
  // ═══════════════════════════════════════════════════════════════════
  const enDias = body?.desdeDia !== undefined || body?.hastaDia !== undefined;
  const { startsAt, endsAt } = enDias
    ? eduBlockParseRangoLocal(body, zona || (await zonaDelInstituto(institutionId)))
    : eduBlockParseRango(body?.startsAt, body?.endsAt);

  // 🔴 EL ALCANCE DE SEDE. Quien solo entra al campus norte no cierra el
  // sur. Un bloqueo SIN sede (el festivo del instituto entero) solo lo
  // puede poner quien entra a todas: cerrar la escuela completa no es una
  // decisión de un coordinador de sede.
  if (!eduCampusCovers(ctx.campusIds, campusId)) {
    throw new EduPadronError(
      campusId
        ? "No entras a esa sede, así que no puedes cerrarle la agenda."
        : "Un bloqueo de TODO el instituto solo lo pone quien entra a todas las sedes. Elige una sede.",
      403,
    );
  }

  const createdByName = `${ctx.user.firstName} ${ctx.user.lastName}`.trim().slice(0, 160) || "—";

  const creado = await prisma.eduAgendaBlock.create({
    data: {
      institutionId,
      campusId,
      chairId,
      kind,
      reason,
      startsAt,
      endsAt,
      createdById: ctx.eduUserId,
      createdByName,
    },
    select: { id: true },
  });

  await eduAudit(ctx, {
    action: "create",
    entity: "agendaBlock",
    entityId: creado.id,
    after: { kind, reason, startsAt, endsAt, campusId, chairId },
    ...meta,
  });

  return { id: creado.id };
}

/**
 * RETIRA un bloqueo. Baja LÓGICA: la fila se queda con su `deletedAt`.
 *
 * 🔴 NO SE BORRA, y no es simetría por simetría: un bloqueo que existió
 * explica por qué esa tarde no hubo nadie en la clínica. Borrarlo dejaría
 * un hueco en la agenda de hace tres meses sin explicación posible.
 */
export async function retirarEduBloqueo(
  ctx: EduBloqueoContext,
  blockId: string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
  now: Date = new Date(),
): Promise<{ id: string }> {
  const institutionId = requireInstitution(ctx);
  const id = eduCleanId(blockId);
  if (!id) throw new EduPadronError("Falta el bloqueo.", 400);

  const b = await prisma.eduAgendaBlock.findFirst({
    where: { id, institutionId },
    select: { id: true, campusId: true, reason: true, deletedAt: true },
  });
  if (!b) throw new EduPadronError("Ese bloqueo no existe o no es de tu instituto.", 404);
  if (!eduCampusCovers(ctx.campusIds, b.campusId)) {
    throw new EduPadronError("No entras a esa sede, así que no puedes retirar su bloqueo.", 403);
  }

  const res = await prisma.eduAgendaBlock.updateMany({
    where: { id: b.id, institutionId, deletedAt: null },
    data: { deletedAt: now, deletedById: ctx.eduUserId },
  });
  if (res.count === 0) throw new EduPadronError("Ese bloqueo ya estaba retirado.", 409);

  await eduAudit(ctx, {
    action: "delete",
    entity: "agendaBlock",
    entityId: b.id,
    before: { reason: b.reason, deletedAt: null },
    after: { deletedAt: now },
    ...meta,
  });

  return { id: b.id };
}
