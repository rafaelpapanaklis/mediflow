/**
 * DaleControl INSTITUCIONAL — LA CATEGORÍA DE PROCEDIMIENTO contra la
 * base (H-90).
 *
 * SERVIDOR: importa prisma. Lo puro (la clave, los parsers, el
 * emparejado sugerido) vive en categorias-core.ts.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 EL DOBLE CANDADO
 *   · PERMISO — `tarifarios.view` para leer, `tarifarios.manage` para
 *     escribir. Ninguna key nueva: la categoría ES del catálogo de
 *     procedimientos, que ya vive detrás de esas dos.
 *   · ALCANCE — el `institutionId` de la sesión en todas las consultas.
 *     No hay recorte por rol: el catálogo es de la escuela entera.
 *
 * ⛔ ESTE ARCHIVO NO TOCA `src/lib/edu/tarifas.ts` NI `procedimientos`.
 * Solo administra la tabla nueva y CONECTA (`categoryId`) desde ella. La
 * pantalla del tarifario y la lógica del precio son de otra casilla de
 * esta ola; lo que aquí se deja listo es la tabla, su alta y el
 * emparejado sugerido.
 *
 * 🔴 Y NO SE MIGRA NADA SOLO. `EduProcedure.category` (texto libre) se
 * queda intacta. Emparejar «Endodoncia», «endodoncias» y «ENDO» es un
 * juicio humano: `eduCategoriaSugerirEmparejado` PROPONE y una persona
 * confirma. Una migración automática que se equivoque pone el avance de
 * una generación a cero en silencio, que es exactamente el fallo H-90.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { prisma } from "@/lib/prisma";
import { EduPadronError } from "@/lib/edu/padron";
import { eduCleanId } from "@/lib/edu/agenda-core";
import {
  EDU_CATEGORIA_MAX_ROWS,
  eduCategoriaParseKey,
  eduCategoriaParseNombre,
  eduCategoriaSugerirEmparejado,
} from "@/lib/edu/categorias-core";
import { eduAudit, type EduAuditActor } from "@/lib/edu/auditoria";

export interface EduCategoriaContext extends EduAuditActor {
  user: { firstName: string; lastName: string; permissionsOverride?: string[] | null };
}

function requireInstitution(ctx: { institutionId?: string }): string {
  const id = ctx?.institutionId;
  if (!id || typeof id !== "string") {
    throw new EduPadronError("Tu sesión no trae instituto. Vuelve a entrar.", 401);
  }
  return id;
}

export interface EduCategoriaRow {
  id: string;
  name: string;
  key: string;
  isActive: boolean;
  orderIndex: number;
  /** Cuántos procedimientos del catálogo ya apuntan aquí. */
  procedimientos: number;
}

/** LAS CATEGORÍAS del instituto, con cuántos procedimientos cuelgan. */
export async function listEduCategorias(
  ctx: { institutionId: string },
): Promise<{ rows: EduCategoriaRow[]; sinPareja: string[] }> {
  const institutionId = requireInstitution(ctx);

  const [cats, sueltos] = await Promise.all([
    prisma.eduProcedureCategory.findMany({
      where: { institutionId },
      orderBy: [{ isActive: "desc" }, { orderIndex: "asc" }, { name: "asc" }],
      take: EDU_CATEGORIA_MAX_ROWS,
      include: { _count: { select: { procedures: true } } },
    }),
    // Los textos libres que TODAVÍA no tienen llave. Es la lista que la
    // pantalla de C·2 pone delante de una persona para que empareje.
    prisma.eduProcedure.findMany({
      where: { institutionId, categoryId: null, category: { not: null } },
      distinct: ["category"],
      select: { category: true },
      take: 200,
    }),
  ]);

  const rows: EduCategoriaRow[] = cats.map((c) => ({
    id: c.id,
    name: c.name,
    key: c.key,
    isActive: c.isActive,
    orderIndex: c.orderIndex,
    procedimientos: c._count.procedures,
  }));

  const sugerencias = eduCategoriaSugerirEmparejado(
    sueltos.map((p) => p.category ?? "").filter(Boolean),
    rows,
  );

  return { rows, sinPareja: sugerencias.filter((s) => !s.categoryId).map((s) => s.texto) };
}

/** DA DE ALTA una categoría. */
export async function createEduCategoria(
  ctx: EduCategoriaContext,
  body: { name?: unknown; key?: unknown; orderIndex?: unknown },
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<{ id: string; key: string }> {
  const institutionId = requireInstitution(ctx);
  const name = eduCategoriaParseNombre(body?.name);
  const key = eduCategoriaParseKey(body?.key, name);
  const orderIndex = Number.parseInt(String(body?.orderIndex ?? "0"), 10) || 0;
  const updatedByName = `${ctx.user.firstName} ${ctx.user.lastName}`.trim().slice(0, 160) || "—";

  try {
    const c = await prisma.eduProcedureCategory.create({
      data: {
        institutionId,
        name,
        key,
        orderIndex,
        updatedByUserId: ctx.eduUserId,
        updatedByName,
      },
      select: { id: true, key: true },
    });

    await eduAudit(ctx, {
      action: "create",
      entity: "feeSchedule",
      entityId: c.id,
      after: { categoria: name, key },
      ...meta,
    });

    return c;
  } catch (err) {
    if ((err as { code?: string })?.code === "P2002") {
      throw new EduPadronError(`Ya existe una categoría con la clave «${key}».`, 409);
    }
    throw err;
  }
}

/**
 * EDITA una categoría: el nombre, el orden y si está activa.
 *
 * 🔴 LA CLAVE NO SE EDITA, Y ÉSE ES EL PUNTO ENTERO DE H-90. La clave es
 * lo que no cambia cuando la dirección renombra la categoría; si se
 * pudiera editar, renombrar volvería a romper lo que esto arregla.
 *
 * 🔴 DESACTIVAR NO ES BORRAR. `isActive: false` la saca de los selectores
 * y deja intacto todo lo que ya apunta a ella — igual que los sillones,
 * las especialidades y las sedes.
 */
export async function updateEduCategoria(
  ctx: EduCategoriaContext,
  categoriaId: string,
  body: { name?: unknown; orderIndex?: unknown; isActive?: unknown },
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<{ id: string }> {
  const institutionId = requireInstitution(ctx);
  const id = eduCleanId(categoriaId);
  if (!id) throw new EduPadronError("Falta la categoría.", 400);

  const antes = await prisma.eduProcedureCategory.findFirst({
    where: { id, institutionId },
    select: { id: true, name: true, isActive: true, orderIndex: true },
  });
  if (!antes) throw new EduPadronError("Esa categoría no existe o no es de tu instituto.", 404);

  const data: { name?: string; orderIndex?: number; isActive?: boolean; updatedByUserId: string; updatedByName: string } = {
    updatedByUserId: ctx.eduUserId,
    updatedByName: `${ctx.user.firstName} ${ctx.user.lastName}`.trim().slice(0, 160) || "—",
  };
  if (body?.name !== undefined) data.name = eduCategoriaParseNombre(body.name);
  if (body?.orderIndex !== undefined) {
    data.orderIndex = Number.parseInt(String(body.orderIndex), 10) || 0;
  }
  if (body?.isActive !== undefined) data.isActive = body.isActive !== false;

  const res = await prisma.eduProcedureCategory.updateMany({
    where: { id: antes.id, institutionId },
    data,
  });
  if (res.count === 0) {
    throw new EduPadronError("No se guardó nada. Actualiza la pantalla.", 409);
  }

  await eduAudit(ctx, {
    action: "update",
    entity: "feeSchedule",
    entityId: antes.id,
    before: { name: antes.name, isActive: antes.isActive, orderIndex: antes.orderIndex },
    after: { ...antes, ...data },
    ...meta,
  });

  return { id: antes.id };
}

/**
 * CONECTA un procedimiento del catálogo a una categoría con llave.
 *
 * Es la escritura que cierra H-90, y va aquí y no en `tarifas.ts` para no
 * tocar el archivo de otra casilla: solo escribe `categoryId`, no el
 * `category` de texto libre, que se queda como estaba.
 */
export async function asignarEduCategoria(
  ctx: EduCategoriaContext,
  body: { procedureId?: unknown; categoryId?: unknown },
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<{ id: string; categoryId: string | null }> {
  const institutionId = requireInstitution(ctx);
  const procedureId = eduCleanId(body?.procedureId);
  if (!procedureId) throw new EduPadronError("Falta el procedimiento.", 400);

  const proc = await prisma.eduProcedure.findFirst({
    where: { id: procedureId, institutionId },
    select: { id: true, name: true, categoryId: true },
  });
  if (!proc) throw new EduPadronError("Ese procedimiento no existe o no es de tu instituto.", 404);

  let categoryId: string | null = null;
  const raw = eduCleanId(body?.categoryId);
  if (raw) {
    const cat = await prisma.eduProcedureCategory.findFirst({
      where: { id: raw, institutionId },
      select: { id: true },
    });
    if (!cat) throw new EduPadronError("Esa categoría no existe o no es de tu instituto.", 404);
    categoryId = cat.id;
  }

  const res = await prisma.eduProcedure.updateMany({
    where: { id: proc.id, institutionId, categoryId: proc.categoryId },
    data: { categoryId },
  });
  if (res.count === 0) {
    throw new EduPadronError(
      "Alguien cambió la categoría de ese procedimiento mientras lo mirabas. Actualiza la pantalla.",
      409,
    );
  }

  await eduAudit(ctx, {
    action: "update",
    entity: "feeSchedule",
    entityId: proc.id,
    before: { procedimiento: proc.name, categoryId: proc.categoryId },
    after: { procedimiento: proc.name, categoryId },
    ...meta,
  });

  return { id: proc.id, categoryId };
}

// ═══════════════════════════════════════════════════════════════════════
// OLA C·2 · LA PANTALLA DE CATEGORÍAS (H-90)
// ═══════════════════════════════════════════════════════════════════════

/** Un procedimiento o un requisito que todavía se compara por texto. */
export interface EduCategoriaPendiente {
  id: string;
  name: string;
  /** El texto libre que tiene capturado hoy. */
  texto: string | null;
  /** La categoría con llave, si ya se emparejó. */
  categoryId: string | null;
  /**
   * La categoría que el emparejado SUGIERE por el texto normalizado.
   *
   * 🔴 ES UNA SUGERENCIA Y NO SE APLICA SOLA. Emparejar «Cirugía» con
   * «Cirugía bucal» es un juicio humano: una migración automática que se
   * equivoque pone en cero el avance de una generación entera, en silencio,
   * que es exactamente el fallo H-90. Aquí se PROPONE y una persona
   * confirma con un clic.
   */
  sugerido: string | null;
}

export interface EduCategoriasPanel {
  rows: EduCategoriaRow[];
  /** Los procedimientos del catálogo, con su texto y su llave. */
  procedimientos: EduCategoriaPendiente[];
  /** Los requisitos que se comparan por categoría (texto o llave). */
  requisitos: EduCategoriaPendiente[];
  /** Textos libres sin ninguna categoría con la que emparejarlos. */
  sinPareja: string[];
}

/**
 * TODO lo que la pantalla de categorías necesita, en una sola pasada.
 *
 * Va aparte de `listEduCategorias` —que ya la usa la pantalla de
 * requisitos— para no engordar aquella lectura con dos consultas que allí
 * no se pintan.
 */
export async function getEduCategoriasPanel(
  ctx: { institutionId: string },
): Promise<EduCategoriasPanel> {
  const institutionId = requireInstitution(ctx);

  const [cats, procedimientos, requisitos] = await Promise.all([
    prisma.eduProcedureCategory.findMany({
      where: { institutionId },
      orderBy: [{ isActive: "desc" }, { orderIndex: "asc" }, { name: "asc" }],
      take: EDU_CATEGORIA_MAX_ROWS,
      include: { _count: { select: { procedures: true, requirements: true } } },
    }),
    prisma.eduProcedure.findMany({
      where: { institutionId },
      orderBy: [{ orderIndex: "asc" }, { name: "asc" }],
      take: 500,
      select: { id: true, name: true, category: true, categoryId: true },
    }),
    // Solo los requisitos que se miden POR CATEGORÍA: los que piden un
    // procedimiento concreto no tienen nada que emparejar aquí, y
    // listarlos convertiría esta pantalla en un plan de estudios entero.
    prisma.eduRequirement.findMany({
      where: {
        institutionId,
        OR: [{ category: { not: null } }, { categoryId: { not: null } }],
      },
      orderBy: [{ orderIndex: "asc" }, { name: "asc" }],
      take: 500,
      select: { id: true, name: true, category: true, categoryId: true },
    }),
  ]);

  const rows: EduCategoriaRow[] = cats.map((c) => ({
    id: c.id,
    name: c.name,
    key: c.key,
    isActive: c.isActive,
    orderIndex: c.orderIndex,
    procedimientos: c._count.procedures,
  }));

  // El emparejado se calcula UNA vez sobre todos los textos que hay
  // sueltos, y se reparte: dos llamadas separadas darían las mismas
  // parejas, pero el día que la regla cambie solo se arreglaría una.
  const textos = [
    ...procedimientos.map((p) => p.category ?? ""),
    ...requisitos.map((r) => r.category ?? ""),
  ].filter(Boolean);
  const sugerencias = eduCategoriaSugerirEmparejado(textos, rows);
  const porTexto = new Map(sugerencias.map((s) => [s.texto, s.categoryId]));

  const aPendiente = (x: {
    id: string;
    name: string;
    category: string | null;
    categoryId: string | null;
  }): EduCategoriaPendiente => ({
    id: x.id,
    name: x.name,
    texto: x.category,
    categoryId: x.categoryId,
    sugerido: x.categoryId ? null : (porTexto.get(x.category ?? "") ?? null),
  });

  return {
    rows,
    procedimientos: procedimientos.map(aPendiente),
    requisitos: requisitos.map(aPendiente),
    sinPareja: sugerencias.filter((s) => !s.categoryId).map((s) => s.texto),
  };
}

/**
 * CONECTA un REQUISITO del plan de estudios a una categoría con llave.
 *
 * Es la otra mitad de H-90: la categoría del requisito era «texto libre sin
 * llave», y renombrarla en el catálogo ponía el avance a cero en silencio
 * para toda la especialidad.
 *
 * 🔴 AL PONER LA LLAVE SE LIMPIA EL TEXTO. Dejar los dos puestos haría que
 * el requisito contara por llave hoy y por texto el día que alguien
 * desconectara la llave, y el número del alumno cambiaría sin que nadie
 * tocara su avance. Una fuente, no dos.
 *
 * ⚠️ Y SE DICE EN VOZ ALTA: emparejar un requisito PUEDE mover su avance en
 * el momento, porque los casos cuyo procedimiento todavía no está
 * emparejado dejan de contar para él. Ésa es la razón de que esta pantalla
 * empareje primero los procedimientos y avise de los que faltan.
 */
export async function asignarEduCategoriaRequisito(
  ctx: EduCategoriaContext,
  body: { requirementId?: unknown; categoryId?: unknown },
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<{ id: string; categoryId: string | null }> {
  const institutionId = requireInstitution(ctx);
  const requirementId = eduCleanId(body?.requirementId);
  if (!requirementId) throw new EduPadronError("Falta el requisito.", 400);

  const req = await prisma.eduRequirement.findFirst({
    where: { id: requirementId, institutionId },
    select: { id: true, name: true, category: true, categoryId: true, procedureId: true },
  });
  if (!req) throw new EduPadronError("Ese requisito no existe o no es de tu instituto.", 404);
  if (req.procedureId) {
    throw new EduPadronError(
      "Ese requisito se mide por un PROCEDIMIENTO concreto, no por categoría. Cámbialo en Requisitos si quieres que cuente una categoría entera.",
      409,
    );
  }

  let categoryId: string | null = null;
  const raw = eduCleanId(body?.categoryId);
  if (raw) {
    const cat = await prisma.eduProcedureCategory.findFirst({
      where: { id: raw, institutionId },
      select: { id: true },
    });
    if (!cat) throw new EduPadronError("Esa categoría no existe o no es de tu instituto.", 404);
    categoryId = cat.id;
  }

  // El `where` lleva la llave que se leyó: si otra persona emparejó este
  // requisito entre la lectura y ahora, esto NO la pisa — contesta 409 y la
  // pantalla se actualiza. Es el patrón de toda la casa.
  const res = await prisma.eduRequirement.updateMany({
    where: { id: req.id, institutionId, categoryId: req.categoryId },
    data: { categoryId, category: categoryId ? null : req.category },
  });
  if (res.count === 0) {
    throw new EduPadronError(
      "Alguien cambió la categoría de ese requisito mientras lo mirabas. Actualiza la pantalla.",
      409,
    );
  }

  await eduAudit(ctx, {
    action: "update",
    entity: "student",
    entityId: req.id,
    before: { requisito: req.name, categoryId: req.categoryId, category: req.category },
    after: { requisito: req.name, categoryId, category: categoryId ? null : req.category },
    ...meta,
  });

  return { id: req.id, categoryId };
}
