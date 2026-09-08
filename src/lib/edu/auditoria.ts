/**
 * DaleControl INSTITUCIONAL — LA BITÁCORA contra la base de datos.
 *
 * SERVIDOR: importa prisma. Lo puro (catálogos, diff, cursor) vive en
 * auditoria-core.ts.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 ESTE ARCHIVO TIENE **UN SOLO ESCRITOR**: `eduAudit(...)`.
 *
 * Doce sitios escribiendo la bitácora a mano es cómo se llega a que el
 * decimotercero no la escriba — y una bitácora con huecos no prueba nada,
 * porque "no hay renglón" y "no pasó" se ven exactamente igual desde
 * fuera. Es el mismo argumento que ya sostiene `visibility.ts` (un solo
 * sitio decide quién ve qué) y `permissions.ts`.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 `eduAudit` NUNCA LANZA. Y esto es la decisión más importante del
 * archivo.
 *
 * Si la bitácora falla —la tabla no existe todavía porque el .sql no se
 * aplicó, el pooler se saturó, el JSON no serializa— lo que NO puede
 * pasar es que se caiga la operación que la generó. Un alumno que no
 * puede firmar una nota porque el renglón de auditoría no entró es un
 * paciente esperando en el sillón por un problema de contabilidad.
 *
 * Así que el fallo se registra en el servidor con `console.error` y la
 * operación sigue. La contrapartida hay que decirla en voz alta: la
 * bitácora es best-effort y NO es un libro contable a prueba de fallos.
 * Para el día que haga falta que lo sea, lo que hay que cambiar es
 * llamarla DENTRO de la transacción de cada operación (`tx` en vez de
 * `prisma`), y por eso `eduAudit` acepta un cliente.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 QUIÉN LA LEE: `direccion.panel`. Y NO se inventó una key nueva
 * ("auditoria.view"), por la razón de siempre en este vertical: una key
 * nueva NO le llega a nadie que ya tenga `permissionsOverride` guardado
 * —el override REEMPLAZA al default— así que habría exigido un backfill
 * en SQL contra la base de cada escuela para servir de algo.
 * `direccion.panel` cubre exactamente a quien debe leerla (solo
 * DIRECCION lo lleva por defecto) y a nadie más.
 * ═══════════════════════════════════════════════════════════════════════
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { EduPadronError } from "@/lib/edu/padron";
import { eduCleanId } from "@/lib/edu/agenda-core";
import type { EduRole } from "@/lib/edu/types";
import {
  EDU_AUDIT_ACTION_LABELS,
  EDU_AUDIT_ENTITY_LABELS,
  eduAuditCampos,
  eduAuditCursorDecode,
  eduAuditCursorEncode,
  eduAuditDiff,
  eduAuditIsAction,
  eduAuditIsEntity,
  eduAuditParseTake,
  type EduAuditAction,
  type EduAuditEntity,
  type EduAuditRow,
} from "@/lib/edu/auditoria-core";

/**
 * Lo mínimo que `eduAudit` necesita de la sesión. Es un subconjunto de
 * EduContext (src/lib/edu-auth.ts) para poder llamarlo desde una prueba
 * sin fabricar un EduInstitution y un EduUser completos — el mismo
 * criterio que `EduClinicaContext` de visibility.ts.
 */
export interface EduAuditActor {
  institutionId: string;
  eduUserId: string;
  role: EduRole;
  user: { firstName: string; lastName: string };
}

/** Cliente Prisma o transacción. Ver la nota del encabezado. */
type EduDb = Pick<typeof prisma, "eduAuditLog"> | Prisma.TransactionClient;

export interface EduAuditInput {
  action: EduAuditAction;
  entity: EduAuditEntity;
  entityId?: string | null;
  patientId?: string | null;
  /** La fila ANTES. Se recorta y se diffea contra `after`. */
  before?: Record<string, unknown> | null;
  /** La fila DESPUÉS. */
  after?: Record<string, unknown> | null;
  /** De la petición. Se leen con `eduAuditRequestMeta(request)`. */
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * EL ESCRITOR. Único.
 *
 * 🔴 UN `update` QUE NO CAMBIÓ NADA NO SE REGISTRA. `eduAuditDiff`
 * devuelve `cambios: 0` y aquí se sale sin escribir: llenar la bitácora de
 * renglones vacíos es como se deja de poder leer. Las LECTURAS (`view`) sí
 * se escriben siempre — no tienen diff y son justo lo que la NOM pide.
 *
 * 🔴 EL NOMBRE Y EL ROL VAN CONGELADOS. Dar de baja a alguien o ascenderlo
 * no puede reescribir con qué sombrero hizo algo ayer.
 */
export async function eduAudit(
  actor: EduAuditActor,
  input: EduAuditInput,
  db: EduDb = prisma,
): Promise<void> {
  try {
    if (!actor?.institutionId) return;
    if (!eduAuditIsAction(input.action) || !eduAuditIsEntity(input.entity)) {
      console.error("[instituto] eduAudit con action/entity fuera del catálogo:", input.action, input.entity);
      return;
    }

    const esLectura = input.action === "view";
    const { before, after, cambios } = eduAuditDiff(input.before, input.after);
    if (!esLectura && cambios === 0) return;

    await db.eduAuditLog.create({
      data: {
        institutionId: actor.institutionId,
        actorUserId: actor.eduUserId,
        actorName: `${actor.user.firstName} ${actor.user.lastName}`.trim().slice(0, 160) || "—",
        actorRole: String(actor.role).slice(0, 20),
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ?? null,
        patientId: input.patientId ?? null,
        before: (before ?? undefined) as Prisma.InputJsonValue | undefined,
        after: (after ?? undefined) as Prisma.InputJsonValue | undefined,
        ip: input.ip ?? null,
        userAgent: input.userAgent?.slice(0, 300) ?? null,
      },
    });
  } catch (err) {
    // Ver el encabezado: la bitácora NUNCA tumba la operación que la
    // generó. Se grita en el servidor y se sigue.
    console.error("[instituto] no se pudo escribir la bitácora:", err);
  }
}

/**
 * La IP y el navegador de la petición.
 *
 * 🔴 `x-forwarded-for` PUEDE TRAER VARIAS y la primera es la del cliente;
 * el resto son los proxies por los que pasó. Guardar la cadena entera
 * llena la columna de infraestructura de Vercel y esconde el dato que
 * importa. Se recorta a 60, que es lo que aguanta un IPv6 con su prefijo.
 */
export function eduAuditRequestMeta(request: Request): { ip: string | null; userAgent: string | null } {
  const fwd = request.headers.get("x-forwarded-for") ?? "";
  const ip = fwd.split(",")[0]?.trim() || request.headers.get("x-real-ip") || null;
  return {
    ip: ip ? ip.slice(0, 60) : null,
    userAgent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// LA LECTURA
// ═══════════════════════════════════════════════════════════════════════

export interface EduAuditQuery {
  patientId?: unknown;
  actorUserId?: unknown;
  entity?: unknown;
  action?: unknown;
  cursor?: unknown;
  take?: unknown;
}

export interface EduAuditPage {
  rows: EduAuditRow[];
  nextCursor: string | null;
}

/**
 * La bitácora del instituto, paginada por cursor.
 *
 * 🔴 EL `where` LLEVA SIEMPRE EL `institutionId` DE LA SESIÓN, y por eso
 * esta función lo exige y LANZA si llega vacío: en Prisma un
 * `institutionId: undefined` no devuelve cero filas, BORRA el filtro y una
 * escuela lee la bitácora de otra — que en esta tabla es leer los nombres
 * de sus pacientes.
 *
 * 🔴 SE PIDE UNA DE MÁS (`take + 1`) para saber si hay siguiente página
 * sin un `count` aparte. La fila sobrante no se pinta: su único trabajo es
 * encender el `nextCursor`.
 *
 * ⚠️ EL ALCANCE AQUÍ NO ES `eduPatientScopeWhere`. La bitácora la abre
 * `direccion.panel`, que solo lleva DIRECCION y que ya ve la escuela
 * entera; recortarla por alcance clínico daría una bitácora incompleta
 * —con huecos que parecen "no pasó"— que es peor que ninguna.
 */
export async function listEduAuditLog(
  ctx: { institutionId: string },
  query: EduAuditQuery = {},
): Promise<EduAuditPage> {
  const institutionId = ctx?.institutionId;
  if (!institutionId || typeof institutionId !== "string") {
    throw new EduPadronError("Tu sesión no trae instituto. Vuelve a entrar.", 401);
  }

  const take = eduAuditParseTake(query.take);
  const where: Prisma.EduAuditLogWhereInput = { institutionId };

  const patientId = eduCleanId(query.patientId);
  if (patientId) where.patientId = patientId;
  const actorUserId = eduCleanId(query.actorUserId);
  if (actorUserId) where.actorUserId = actorUserId;
  if (eduAuditIsEntity(query.entity)) where.entity = query.entity;
  if (eduAuditIsAction(query.action)) where.action = query.action;

  const cursor = eduAuditCursorDecode(query.cursor);
  if (cursor) {
    // El MISMO par que el orderBy: (createdAt desc, id desc). Sin el
    // desempate por id, dos renglones del mismo milisegundo —y una fusión
    // escribe varios— harían saltar uno entre página y página.
    where.OR = [
      { createdAt: { lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ];
  }

  const filas = await prisma.eduAuditLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    select: {
      id: true,
      createdAt: true,
      actorName: true,
      actorRole: true,
      action: true,
      entity: true,
      entityId: true,
      patientId: true,
      before: true,
      after: true,
      ip: true,
    },
  });

  const hayMas = filas.length > take;
  const visibles = hayMas ? filas.slice(0, take) : filas;

  return {
    rows: visibles.map((f) => ({
      id: f.id,
      createdAt: f.createdAt.toISOString(),
      actorName: f.actorName,
      actorRole: f.actorRole,
      action: f.action,
      actionLabel:
        EDU_AUDIT_ACTION_LABELS[f.action as EduAuditAction] ?? f.action,
      entity: f.entity,
      entityLabel:
        EDU_AUDIT_ENTITY_LABELS[f.entity as EduAuditEntity] ?? f.entity,
      entityId: f.entityId,
      patientId: f.patientId,
      campos: eduAuditCampos(f.before, f.after),
      ip: f.ip,
    })),
    nextCursor: hayMas
      ? eduAuditCursorEncode(visibles[visibles.length - 1])
      : null,
  };
}
