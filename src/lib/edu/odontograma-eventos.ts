/**
 * DaleControl INSTITUCIONAL — EL LIBRO DE MOVIMIENTOS DEL ODONTOGRAMA
 * contra la base (N-3).
 *
 * SERVIDOR: importa prisma. Lo puro (qué acto es cada escritura, el
 * filtrado por hallazgo, la última baja) vive en
 * odontograma-eventos-core.ts.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 QUÉ ARREGLA (N-3)
 *
 * La Ola B cambió el DELETE del odontograma por una baja lógica (H-17) y
 * la auditoría encontró que se deshace sola: remarcar un hallazgo dado de
 * baja REVIVE la misma fila y el `update` escribe `deletedById: null`
 * encima. Queda un hallazgo vivo y NINGUNA huella de quién lo quitó — que
 * es literalmente la pregunta que H-17 existía para contestar.
 *
 * Este libro registra una fila POR ACTO, así que sobrevive a que la fila
 * del hallazgo se reviva mil veces.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ⛔ ESTE ARCHIVO NO ESCRIBE EL ODONTOGRAMA. `src/lib/edu/odontograma.ts`
 * —el upsert, el `setEduOdontogramFinding` y el `setEduOdontogramNote`—
 * no se toca en esta casilla. Lo que hay aquí es el ESCRITOR del libro
 * (`eduOdontoEvent`), pensado para que se le llame desde dentro de la
 * transacción de esas funciones en la Ola C·2, con la `tx` que ya tienen.
 *
 * 🔴 `eduOdontoEvent` NUNCA LANZA, por la misma razón que `eduAudit`: si
 * el libro falla, lo que NO puede pasar es que se caiga la escritura del
 * odontograma. Un alumno que no puede marcar una caries porque el renglón
 * del historial no entró es un paciente esperando en el sillón.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 QUIÉN LO LEE: `odontograma.view` + el alcance CLÍNICO. Es el mismo
 * candado que el odontograma del que habla, y por eso no se inventa
 * ninguna key: el historial de un hallazgo es el hallazgo.
 * ═══════════════════════════════════════════════════════════════════════
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { EduPadronError } from "@/lib/edu/padron";
import { getEduClinicalPatient } from "@/lib/edu/expediente";
import {
  eduFormatDayShort,
  eduFormatTime,
  eduSafeTimeZone,
  eduUtcToZoned,
} from "@/lib/edu/agenda-core";
import type { EduClinicaContext } from "@/lib/edu/visibility";
import {
  EDU_ODONTO_EVENT_LABELS,
  EDU_ODONTO_EVENT_MAX_ROWS,
  type EduOdontogramEventAction,
  type EduOdontoEventRow,
} from "@/lib/edu/odontograma-eventos-core";
import type { EduAuditActor } from "@/lib/edu/auditoria";

export interface EduOdontoEventContext extends EduClinicaContext, EduAuditActor {}

type EduDb = Pick<typeof prisma, "eduOdontogramEvent"> | Prisma.TransactionClient;

export interface EduOdontoEventInput {
  patientId: string;
  entryId?: string | null;
  tooth: number;
  surface: string;
  condition: string;
  action: EduOdontogramEventAction;
  notes?: string | null;
  reason?: string | null;
}

/**
 * EL ESCRITOR del libro. Único, y best-effort (ver el encabezado).
 *
 * Se le pasa `db` para poder llamarlo DENTRO de la transacción que escribe
 * el hallazgo: así el movimiento y el hallazgo entran o no entran juntos.
 * Con el `prisma` por defecto es best-effort de verdad.
 */
export async function eduOdontoEvent(
  ctx: EduOdontoEventContext,
  input: EduOdontoEventInput,
  db: EduDb = prisma,
): Promise<void> {
  try {
    if (!ctx?.institutionId) return;
    await db.eduOdontogramEvent.create({
      data: {
        institutionId: ctx.institutionId,
        patientId: input.patientId,
        entryId: input.entryId ?? null,
        tooth: input.tooth,
        surface: input.surface ?? "",
        condition: input.condition,
        action: input.action,
        notes: input.notes?.slice(0, 1000) ?? null,
        reason: input.reason?.slice(0, 500) ?? null,
        actorUserId: ctx.eduUserId,
        actorName: `${ctx.user.firstName} ${ctx.user.lastName}`.trim().slice(0, 160) || "—",
      },
    });
  } catch (err) {
    console.error("[instituto] no se pudo escribir el movimiento del odontograma:", err);
  }
}

/**
 * EL HISTORIAL del odontograma de un paciente, más reciente primero.
 *
 * 🔴 SE PUEDE FILTRAR POR HALLAZGO CON LAS TRES COLUMNAS COPIADAS, no por
 * `entryId`: si la fila del hallazgo se fue, `entryId` está en null en
 * todos los renglones y el historial se quedaría vacío justo cuando más
 * falta hace.
 */
export async function listEduOdontoEventos(
  ctx: EduOdontoEventContext,
  patientId: string,
  timeZone: string,
  query: { tooth?: unknown; surface?: unknown; condition?: unknown } = {},
  now: Date = new Date(),
): Promise<{ rows: EduOdontoEventRow[]; truncated: boolean }> {
  const institutionId = ctx?.institutionId;
  if (!institutionId) throw new EduPadronError("Tu sesión no trae instituto. Vuelve a entrar.", 401);

  const paciente = await getEduClinicalPatient(ctx, patientId, now);
  if (!paciente) throw new EduPadronError("Ese paciente no existe o no es de tu instituto.", 404);

  const tz = eduSafeTimeZone(timeZone);

  const where: Prisma.EduOdontogramEventWhereInput = {
    institutionId,
    patientId: paciente.id,
  };
  const tooth = Number.parseInt(String(query?.tooth ?? ""), 10);
  if (Number.isInteger(tooth)) where.tooth = tooth;
  if (typeof query?.surface === "string") where.surface = query.surface.trim().slice(0, 4);
  if (typeof query?.condition === "string" && query.condition.trim()) {
    where.condition = query.condition.trim().slice(0, 40);
  }

  // 🔴 UNA DE MÁS PARA PODER DECIR QUE SE CORTÓ (S-12). Con `take: MAX` a
  // secas, doscientos movimientos y doscientos cuarenta se ven idénticos
  // desde aquí, y quien busca el suyo concluye que nunca existió.
  const filas = await prisma.eduOdontogramEvent.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: EDU_ODONTO_EVENT_MAX_ROWS + 1,
    select: {
      id: true,
      createdAt: true,
      actorName: true,
      action: true,
      tooth: true,
      surface: true,
      condition: true,
      notes: true,
      reason: true,
    },
  });

  const truncated = filas.length > EDU_ODONTO_EVENT_MAX_ROWS;

  return {
    truncated,
    rows: filas.slice(0, EDU_ODONTO_EVENT_MAX_ROWS).map((e) => ({
      id: e.id,
      createdAt: e.createdAt.toISOString(),
      createdLabel: `${eduFormatDayShort(eduUtcToZoned(e.createdAt, tz).dayISO)} ${eduFormatTime(
        e.createdAt,
        tz,
      )}`,
      actorName: e.actorName,
      action: e.action,
      actionLabel:
        EDU_ODONTO_EVENT_LABELS[e.action as EduOdontogramEventAction] ?? e.action,
      tooth: e.tooth,
      surface: e.surface,
      condition: e.condition,
      notes: e.notes,
      reason: e.reason,
    })),
  };
}
