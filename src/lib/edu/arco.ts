/**
 * DaleControl INSTITUCIONAL — ARCO (LFPDPPP) contra la base de datos.
 *
 * SERVIDOR: importa prisma. Lo puro (qué campos son PII, la retención de
 * cinco años, las validaciones) vive en arco-core.ts.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 EL DOBLE CANDADO, COMO EN TODO EL VERTICAL
 *
 *   · PERMISO (abre la puerta) — `pacientes.manage` **y ADEMÁS**
 *     `direccion.panel`. Las dos, no una: `pacientes.manage` lo lleva CAJA
 *     por defecto, y anonimizar el expediente de una persona no es una
 *     decisión de mostrador. Con las dos, sólo DIRECCION lo tiene por
 *     defecto — y sin inventar ninguna key nueva, que exigiría un backfill
 *     en SQL contra la base de cada escuela (el override REEMPLAZA al
 *     default, así que una key nueva no le llega a nadie que ya lo tenga
 *     guardado). Es el mismo patrón de dos llaves que ya usan
 *     `pacientes/[id]/antecedentes` y el PATCH de la ficha.
 *   · ALCANCE (decide las filas) — `eduPatientScopeWhere` con el recurso
 *     "patients". Un paciente de otra escuela contesta 404, igual que uno
 *     que no existe.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 NINGUNA DE ESTAS TRES FUNCIONES BORRA UNA FILA. Ni una.
 *
 * La baja pone una fecha, la anonimización sustituye texto y la fusión
 * (fusion.ts) mueve punteros. `deleteMany` no aparece en este archivo, y
 * eso no es una casualidad que haya que volver a comprobar: hay una prueba
 * que lee el fuente y falla si aparece.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 LAS ESCRITURAS VAN CON `updateMany` Y EL ESTADO EN EL `where`, y se
 * mira el `count`. Es la regla de la casa desde la Ola A: dos personas con
 * la misma ficha abierta, la primera anonimiza, la segunda le da a
 * anonimizar y recibiría un 200 alegre sin haber escrito nada. Un 200 que
 * no escribió es la peor respuesta posible, porque la persona se va
 * convencida.
 * ═══════════════════════════════════════════════════════════════════════
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { EduPadronError } from "@/lib/edu/padron";
import { eduCleanId } from "@/lib/edu/agenda-core";
import { eduPatientScopeWhere, eduScopeIsEmpty, eduVisibility } from "@/lib/edu/visibility";
import { hasEduPermission } from "@/lib/edu/permissions";
import {
  EDU_ARCO_CONSERVADO,
  EDU_ARCO_PII_FIELD_NAMES,
  eduArcoAnonymizeData,
  eduArcoMotivoParaNoAnonimizar,
  eduArcoParseReason,
  eduArcoRetentionUntil,
} from "@/lib/edu/arco-core";
import { eduAudit, type EduAuditActor } from "@/lib/edu/auditoria";

export interface EduArcoContext extends EduAuditActor {
  user: {
    firstName: string;
    lastName: string;
    permissionsOverride?: string[] | null;
  };
}

/**
 * LAS DOS LLAVES. Se comprueban aquí y no solo en la ruta: la ruta puede
 * multiplicarse (una para la baja, otra para anonimizar, otra que alguien
 * añada en C·2) y la comprobación que vive en una sola de ellas es la que
 * falta en la cuarta.
 */
export function eduArcoAsegurarPermiso(ctx: EduArcoContext): void {
  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  const puede =
    hasEduPermission(permUser, "pacientes.manage") && hasEduPermission(permUser, "direccion.panel");
  if (!puede) {
    throw new EduPadronError(
      "Los derechos ARCO (baja, anonimización y fusión) piden pacientes.manage Y direccion.panel. Es una decisión de dirección, no de mostrador.",
      403,
    );
  }
}

function requireInstitution(ctx: { institutionId?: string }): string {
  const id = ctx?.institutionId;
  if (!id || typeof id !== "string") {
    throw new EduPadronError("Tu sesión no trae instituto. Vuelve a entrar.", 401);
  }
  return id;
}

/** Las columnas que las tres operaciones necesitan leer del paciente. */
const SELECT_ARCO = {
  id: true,
  folio: true,
  institutionId: true,
  firstName: true,
  lastName: true,
  status: true,
  deletedAt: true,
  deletedById: true,
  anonymizedAt: true,
  mergedIntoId: true,
} satisfies Prisma.EduPatientSelect;

/**
 * Busca el paciente DENTRO DEL ALCANCE. Devuelve null si no le toca — el
 * endpoint lo traduce a 404, que es la misma respuesta que un id que no
 * existe: "no te toca" y "no existe" no se distinguen desde fuera a
 * propósito.
 */
export async function getEduArcoPatient(
  ctx: EduArcoContext,
  patientId: string,
  now: Date = new Date(),
) {
  const institutionId = requireInstitution(ctx);
  const scope = eduVisibility(ctx, "patients");
  if (eduScopeIsEmpty(scope)) return null;
  const id = eduCleanId(patientId);
  if (!id) return null;
  return prisma.eduPatient.findFirst({
    where: { ...eduPatientScopeWhere({ institutionId, scope, now }), id },
    select: SELECT_ARCO,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// 1 · LA BAJA
// ═══════════════════════════════════════════════════════════════════════

/**
 * DA DE BAJA la ficha. Baja LÓGICA, con autor y motivo obligatorio.
 *
 * 🔴 REVERSIBLE A PROPÓSITO (`reactivarEduPatient`, abajo). La baja es la
 * red de seguridad de la anonimización, que no se deshace: obligar a pasar
 * por aquí convierte un clic de más en la única marcha atrás que este
 * flujo tiene.
 *
 * ⚠️ NO toca `status`. `INACTIVE`/`DISCHARGED` siguen significando lo que
 * significaban (en qué punto del embudo está el paciente); `deletedAt` es
 * otra cosa: la ficha sale de las listas. Mezclarlos habría hecho que
 * "dar de alta otra vez" y "deshacer la baja ARCO" fueran el mismo botón.
 */
export async function bajaEduPatient(
  ctx: EduArcoContext,
  patientId: string,
  body: { reason?: unknown },
  meta: { ip?: string | null; userAgent?: string | null } = {},
  now: Date = new Date(),
): Promise<{ id: string; folio: string }> {
  eduArcoAsegurarPermiso(ctx);
  const institutionId = requireInstitution(ctx);

  const paciente = await getEduArcoPatient(ctx, patientId, now);
  if (!paciente) throw new EduPadronError("Ese paciente no existe o no es de tu instituto.", 404);
  if (paciente.deletedAt) throw new EduPadronError("Esa ficha ya estaba dada de baja.", 409);

  const reason = eduArcoParseReason(body?.reason);

  // updateMany con el ESTADO en el where (`deletedAt: null`) y el
  // institutionId repetido: aunque el findFirst de arriba ya los
  // comprobó, la escritura no se apoya en que nadie meta mano entre las
  // dos consultas.
  const res = await prisma.eduPatient.updateMany({
    where: { id: paciente.id, institutionId, deletedAt: null },
    data: { deletedAt: now, deletedById: ctx.eduUserId, deleteReason: reason },
  });
  if (res.count === 0) {
    throw new EduPadronError(
      "Alguien dio de baja esa ficha mientras la mirabas: no se guardó nada. Actualiza la pantalla.",
      409,
    );
  }

  await eduAudit(ctx, {
    action: "arco",
    entity: "patient",
    entityId: paciente.id,
    patientId: paciente.id,
    before: { deletedAt: null },
    after: { deletedAt: now, deleteReason: reason },
    ...meta,
  });

  return { id: paciente.id, folio: paciente.folio };
}

/**
 * DESHACE la baja. No existe equivalente para la anonimización, y ésa es
 * justo la diferencia entre las dos.
 */
export async function reactivarEduPatient(
  ctx: EduArcoContext,
  patientId: string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
  now: Date = new Date(),
): Promise<{ id: string }> {
  eduArcoAsegurarPermiso(ctx);
  const institutionId = requireInstitution(ctx);

  const paciente = await getEduArcoPatient(ctx, patientId, now);
  if (!paciente) throw new EduPadronError("Ese paciente no existe o no es de tu instituto.", 404);
  if (paciente.anonymizedAt) {
    throw new EduPadronError(
      "Esa ficha está anonimizada: sus datos personales ya se sustituyeron y reactivarla no los devuelve.",
      409,
    );
  }

  const res = await prisma.eduPatient.updateMany({
    where: { id: paciente.id, institutionId, deletedAt: { not: null } },
    data: { deletedAt: null, deletedById: null, deleteReason: null },
  });
  if (res.count === 0) throw new EduPadronError("Esa ficha no estaba dada de baja.", 409);

  await eduAudit(ctx, {
    action: "arco",
    entity: "patient",
    entityId: paciente.id,
    patientId: paciente.id,
    before: { deletedAt: paciente.deletedAt },
    after: { deletedAt: null },
    ...meta,
  });

  return { id: paciente.id };
}

// ═══════════════════════════════════════════════════════════════════════
// 2 · LA ANONIMIZACIÓN
// ═══════════════════════════════════════════════════════════════════════

/**
 * Qué va a pasar SI se anonimiza: qué campos se sustituyen, qué se
 * conserva y hasta cuándo hay que guardar el expediente.
 *
 * 🔴 EXISTE PARA QUE LA PANTALLA DE CONFIRMACIÓN NO MIENTA. Este acto es
 * irreversible; quien lo firma tiene derecho a ver la lista exacta —no un
 * resumen redactado a mano en un componente, que es lo que se
 * desincroniza en la primera ola que agregue una columna de contacto.
 */
export async function previsualizarEduArco(
  ctx: EduArcoContext,
  patientId: string,
  now: Date = new Date(),
): Promise<{
  id: string;
  folio: string;
  sustituye: string[];
  conserva: Record<string, string>;
  ultimoActoAt: string | null;
  retencionHasta: string | null;
  bloqueo: string | null;
}> {
  eduArcoAsegurarPermiso(ctx);
  const institutionId = requireInstitution(ctx);

  const paciente = await getEduArcoPatient(ctx, patientId, now);
  if (!paciente) throw new EduPadronError("Ese paciente no existe o no es de tu instituto.", 404);

  // El ÚLTIMO ACTO MÉDICO, que es desde donde corren los cinco años. Se
  // toma la nota más reciente: es el registro que la NOM-004 obliga a
  // escribir por cada acto, así que es el que mejor lo fecha.
  const ultimaNota = await prisma.eduRecord.findFirst({
    where: { institutionId, patientId: paciente.id },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  const ultimoActo = ultimaNota?.createdAt ?? null;

  return {
    id: paciente.id,
    folio: paciente.folio,
    sustituye: EDU_ARCO_PII_FIELD_NAMES,
    conserva: EDU_ARCO_CONSERVADO,
    ultimoActoAt: ultimoActo ? ultimoActo.toISOString() : null,
    retencionHasta: ultimoActo ? eduArcoRetentionUntil(ultimoActo).toISOString() : null,
    bloqueo: eduArcoMotivoParaNoAnonimizar(paciente),
  };
}

/**
 * ANONIMIZA la ficha: sustituye el PII y CONSERVA lo clínico.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 ES IRREVERSIBLE, Y NO HAY BOTÓN PARA DESHACERLO. Lo que se sustituye
 * no vuelve: no se guarda una copia «por si acaso» en ningún sitio,
 * porque una copia del PII escondida en otra tabla es exactamente lo que
 * la solicitud de cancelación pedía que dejara de existir.
 *
 * 🔴 LO CLÍNICO NO SE TOCA. Odontograma, notas, estudios, fotos, recetas y
 * consentimientos se quedan enteros: la NOM-004 obliga a conservar el
 * expediente cinco años desde el último acto y esa obligación no la
 * derrota una solicitud ARCO. La lista de lo que sí y lo que no está en
 * arco-core.ts, en una sola constante.
 *
 * 🔴 LA BITÁCORA NO GUARDA EL PII QUE SE BORRÓ. El renglón dice QUÉ campos
 * se sustituyeron, no qué decían: guardar el "antes" aquí sería mover el
 * dato personal a una tabla de la que la anonimización no lo puede sacar.
 * Por eso el `before` es la lista de nombres de campo, no sus valores.
 * ═══════════════════════════════════════════════════════════════════════
 */
export async function anonymizeEduPatient(
  ctx: EduArcoContext,
  patientId: string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
  now: Date = new Date(),
): Promise<{ id: string; folio: string; campos: number }> {
  eduArcoAsegurarPermiso(ctx);
  const institutionId = requireInstitution(ctx);

  const paciente = await getEduArcoPatient(ctx, patientId, now);
  if (!paciente) throw new EduPadronError("Ese paciente no existe o no es de tu instituto.", 404);

  const bloqueo = eduArcoMotivoParaNoAnonimizar(paciente);
  if (bloqueo) throw new EduPadronError(bloqueo, 409);

  const data = eduArcoAnonymizeData(paciente, ctx.eduUserId, now);

  const res = await prisma.eduPatient.updateMany({
    where: { id: paciente.id, institutionId, anonymizedAt: null },
    data: data as Prisma.EduPatientUncheckedUpdateManyInput,
  });
  if (res.count === 0) {
    throw new EduPadronError("Esa ficha se anonimizó mientras la mirabas. Actualiza la pantalla.", 409);
  }

  await eduAudit(ctx, {
    action: "arco",
    entity: "patient",
    entityId: paciente.id,
    patientId: paciente.id,
    // Los NOMBRES de los campos, nunca sus valores. Ver el encabezado.
    before: { camposSustituidos: EDU_ARCO_PII_FIELD_NAMES.join(", ") },
    after: { anonymizedAt: now, folio: data.folio },
    ...meta,
  });

  return {
    id: paciente.id,
    folio: String(data.folio),
    campos: EDU_ARCO_PII_FIELD_NAMES.length,
  };
}
