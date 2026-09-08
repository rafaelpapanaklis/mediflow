/**
 * DaleControl INSTITUCIONAL — LOS DATOS DEL PROPIO INSTITUTO contra la
 * base (H-150).
 *
 * SERVIDOR: importa prisma. Lo puro (qué se puede editar y qué no, y por
 * qué) vive en institucion-core.ts.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 CERO SQL EN ESTA PIEZA. Las columnas existen TODAS desde la Ola 0 y
 * la Ola 1 (`name`, `legalName`, `rfc`, `city`, `state`, `phone`, `email`,
 * `logoUrl`, `timezone`). H-150 no era una columna que faltara: era que
 * «en todo el vertical hay DOS escrituras a EduInstitution y ninguna es
 * del panel» — el seed de demo y el medidor de almacenamiento. Esto es la
 * tercera, y la primera que una persona puede provocar.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 EL DOBLE CANDADO
 *
 *   · PERMISO — `sedes.manage`, que solo lleva DIRECCION por defecto.
 *     Ninguna key nueva (una key nueva no le llega a nadie que ya tenga
 *     `permissionsOverride` guardado y habría exigido backfill en SQL).
 *     Y es la key correcta y no un apaño: `sedes.manage` ya es «la
 *     configuración física y organizativa de la escuela», y los datos del
 *     instituto son su cabecera.
 *   · ALCANCE — no hay filas que recortar: SOLO se lee y se escribe el
 *     `institutionId` DE LA SESIÓN. Esta función no acepta un id de
 *     instituto por parámetro, y eso es a propósito: un endpoint que
 *     aceptara cuál instituto editar sería, literalmente, el botón de
 *     renombrar la escuela de otro.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 LA ZONA HORARIA ES LO QUE MÁS PESA DE TODO ESTO. Gobierna la vista
 * consolidada de dirección y es el respaldo de las sedes que no tienen la
 * suya. «Un instituto de Tijuana dado de alta con el default de CDMX no
 * tiene arreglo», decía el hallazgo. Ahora sí, y se valida contra `Intl`
 * para que no se pueda guardar una zona inventada.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { prisma } from "@/lib/prisma";
import { EduPadronError } from "@/lib/edu/padron";
import { eduInstitucionParsePatch, type EduInstitucionPatch } from "@/lib/edu/institucion-core";
import { eduAudit, type EduAuditActor } from "@/lib/edu/auditoria";

export interface EduInstitucionContext extends EduAuditActor {
  user: { firstName: string; lastName: string; permissionsOverride?: string[] | null };
}

function requireInstitution(ctx: { institutionId?: string }): string {
  const id = ctx?.institutionId;
  if (!id || typeof id !== "string") {
    throw new EduPadronError("Tu sesión no trae instituto. Vuelve a entrar.", 401);
  }
  return id;
}

export interface EduInstitucionDatos {
  id: string;
  name: string;
  slug: string;
  legalName: string | null;
  rfc: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  email: string | null;
  logoUrl: string | null;
  timezone: string;
  /** Solo LECTURA: son cláusulas del contrato. Ver institucion-core.ts. */
  contractStartsAt: string | null;
  contractEndsAt: string | null;
  storageQuotaBytes: string;
}

/** LOS DATOS del instituto de la sesión. */
export async function getEduInstitucion(
  ctx: { institutionId: string },
): Promise<EduInstitucionDatos> {
  const institutionId = requireInstitution(ctx);
  const i = await prisma.eduInstitution.findFirst({
    where: { id: institutionId },
    select: {
      id: true,
      name: true,
      slug: true,
      legalName: true,
      rfc: true,
      city: true,
      state: true,
      phone: true,
      email: true,
      logoUrl: true,
      timezone: true,
      contractStartsAt: true,
      contractEndsAt: true,
      storageQuotaBytes: true,
    },
  });
  if (!i) throw new EduPadronError("Tu instituto no existe. Vuelve a entrar.", 404);

  return {
    ...i,
    contractStartsAt: i.contractStartsAt?.toISOString() ?? null,
    contractEndsAt: i.contractEndsAt?.toISOString() ?? null,
    // 🔴 BigInt A STRING. `JSON.stringify` de un BigInt LANZA
    // ("Do not know how to serialize a BigInt") y la respuesta se
    // convertiría en un 500 sin mensaje. Es la misma conversión que ya
    // hace el medidor de almacenamiento.
    storageQuotaBytes: i.storageQuotaBytes.toString(),
  };
}

/**
 * CORRIGE los datos del instituto.
 *
 * 🔴 SOLO LOS CAMPOS QUE LLEGAN, y solo los de la lista blanca del core.
 * Campo ausente no se escribe; campo en blanco sí borra. Sin esa regla, un
 * PATCH que solo trae el teléfono le vaciaría el RFC a la escuela.
 *
 * 🔴 EL `where` DEL `updateMany` LLEVA EL id DE LA SESIÓN, y por eso es
 * `updateMany` y no `update`: un `update` por id acepta cualquier id que
 * le pases, y esta función nunca debe poder escribir en el instituto de
 * otro. Aquí el id no viene de fuera, pero la forma de la escritura es la
 * que impide que mañana venga.
 */
export async function updateEduInstitucion(
  ctx: EduInstitucionContext,
  body: Record<string, unknown>,
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<EduInstitucionDatos> {
  const institutionId = requireInstitution(ctx);
  const patch: EduInstitucionPatch = eduInstitucionParsePatch(body ?? {});

  const antes = await prisma.eduInstitution.findFirst({
    where: { id: institutionId },
    select: {
      name: true,
      legalName: true,
      rfc: true,
      city: true,
      state: true,
      phone: true,
      email: true,
      logoUrl: true,
      timezone: true,
    },
  });
  if (!antes) throw new EduPadronError("Tu instituto no existe. Vuelve a entrar.", 404);

  const res = await prisma.eduInstitution.updateMany({
    where: { id: institutionId },
    data: patch,
  });
  if (res.count === 0) {
    throw new EduPadronError("No se guardó nada. Actualiza la pantalla e inténtalo otra vez.", 409);
  }

  await eduAudit(ctx, {
    action: "update",
    entity: "institution",
    entityId: institutionId,
    before: antes as Record<string, unknown>,
    after: { ...antes, ...patch } as Record<string, unknown>,
    ...meta,
  });

  return getEduInstitucion(ctx);
}
