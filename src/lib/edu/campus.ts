/**
 * DaleControl INSTITUCIONAL — LAS SEDES contra la base de datos.
 *
 * SERVIDOR: importa prisma y lee la cookie del selector. Lo puro —quién
 * entra a qué sede y cuál está viendo— vive en campus-core.ts, y los
 * `where` viven en visibility.ts. Aquí solo hay consultas.
 *
 * 🔴 institutionId de la SESIÓN, siempre. La sede NUNCA lo sustituye: es
 * una división DENTRO de una escuela, no el aislamiento entre escuelas.
 *
 * 🔴 LA COOKIE NO CONCEDE NADA. `edu_sede` solo dice qué quiere ver la
 * persona; lo que PUEDE ver sale de edu_user_campus_access y se vuelve a
 * calcular en CADA lectura. Una cookie con el id de una sede ajena (o de
 * otra escuela) se degrada sola a la vista consolidada de lo suyo — nunca
 * amplía. Es el mismo mecanismo que `dcb_branch` del vertical de barbería
 * (src/lib/barber/branches.ts).
 */
import { cookies } from "next/headers";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { EduPadronError } from "@/lib/edu/padron";
import { eduRequiredText, parseEduBoolean } from "@/lib/edu/padron-core";
import {
  eduCleanId,
  eduDayRange,
  eduOptionalText,
  eduSafeTimeZone,
  eduTodayISO,
} from "@/lib/edu/agenda-core";
import {
  EDU_CAMPUS_ADDRESS_MAX,
  EDU_CAMPUS_ALL,
  EDU_CAMPUS_COOKIE,
  EDU_CAMPUS_NAME_MAX,
  EDU_CAMPUS_NOTES_MAX,
  EDU_MAX_CAMPUSES,
  eduCampusAccessFromRows,
  eduResolveCampusScope,
  normalizeEduCampusCode,
  type EduCampusOption,
  type EduCampusPersonRow,
  type EduCampusRow,
  type EduCampusScope,
} from "@/lib/edu/campus-core";
import type { EduClinicaContext } from "@/lib/edu/visibility";
import type { EduRole } from "@/lib/edu/types";

export type {
  EduCampusOption,
  EduCampusPersonRow,
  EduCampusRow,
  EduCampusScope,
} from "@/lib/edu/campus-core";

function requireInstitution(ctx: EduClinicaContext): string {
  const id = ctx?.institutionId;
  if (!id || typeof id !== "string") {
    throw new EduPadronError("Sesión de instituto no válida.", 401);
  }
  return id;
}

function persona(u: { firstName: string; lastName: string; email: string }): string {
  return [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.email;
}

// ═══════════════════════════════════════════════════════════════════════
// 1 · EL ALCANCE POR SEDE — lo que llaman TODAS las pantallas
// ═══════════════════════════════════════════════════════════════════════

/** Las sedes del instituto, en el orden en que se pintan. */
export async function listEduCampusOptions(ctx: EduClinicaContext): Promise<EduCampusOption[]> {
  const institutionId = requireInstitution(ctx);
  const rows = await prisma.eduCampus.findMany({
    where: { institutionId },
    orderBy: [{ isActive: "desc" }, { orderIndex: "asc" }, { name: "asc" }],
    take: EDU_MAX_CAMPUSES,
    select: { id: true, name: true, code: true, timezone: true, isActive: true },
  });
  return rows;
}

/** Sede elegida en la cookie. Sin validar todavía: solo la lee. */
export function readEduCampusCookie(): string | null {
  try {
    return cookies().get(EDU_CAMPUS_COOKIE)?.value ?? null;
  } catch {
    // Fuera de un request (una prueba, un script) no hay cookies y no pasa
    // nada: se cae a la vista consolidada.
    return null;
  }
}

/**
 * EL ALCANCE POR SEDE de quien está mirando. Es lo que llaman las páginas.
 *
 * 🔴 SIN FILAS DE ACCESO = TODAS LAS SEDES. Es la compatibilidad hacia
 * atrás de esta ola: el día que se aplica nadie tiene filas, así que nadie
 * se queda fuera. La regla vive en campus-core.ts y se prueba sin base de
 * datos.
 *
 * Dos consultas y no una porque son dos preguntas: qué sedes existen y a
 * cuáles entra esta persona. Van en paralelo.
 */
export async function getEduCampusScope(
  ctx: EduClinicaContext & { institution?: { timezone?: string | null } | null },
  requested?: string | null,
): Promise<EduCampusScope> {
  const institutionId = requireInstitution(ctx);
  const institutionTimezone = eduSafeTimeZone(ctx.institution?.timezone ?? undefined);

  let campuses: EduCampusOption[] = [];
  let filas: { campusId: string }[] = [];

  try {
    [campuses, filas] = await Promise.all([
      listEduCampusOptions(ctx),
      prisma.eduUserCampusAccess.findMany({
        where: { institutionId, userId: ctx.eduUserId },
        select: { campusId: true },
      }),
    ]);
  } catch (err) {
    // 🔴 SIN LAS TABLAS DE ESTA OLA, EL PANEL SIGUE FUNCIONANDO. Esto lo
    // llama el LAYOUT del panel, así que un throw aquí dejaría en blanco
    // TODAS las pantallas del vertical —no solo la de sedes— en cuanto el
    // código llegue a producción antes que sql/edu-ola-11.sql. Sin sedes,
    // eduResolveCampusScope devuelve "sin recorte", que es exactamente
    // como se comportaba el producto antes de la ola.
    //
    // El warning es lo único que distingue "no aplicaste el .sql" de "este
    // instituto todavía no tiene sedes", que desde fuera se ven igual.
    console.warn(
      "[edu-campus] no se pudieron leer las sedes (¿falta aplicar sql/edu-ola-11.sql?):",
      err instanceof Error ? err.message : err,
    );
    campuses = [];
    filas = [];
  }

  return eduResolveCampusScope({
    campuses,
    access: eduCampusAccessFromRows(filas, campuses),
    requested: requested === undefined ? readEduCampusCookie() : requested,
    institutionTimezone,
  });
}

/**
 * Traduce lo que pidió el selector a un valor de cookie ya VALIDADO.
 *
 * Devuelve `EDU_CAMPUS_ALL` para la vista consolidada. Guardar el valor ya
 * validado evita que una cookie inservible sobreviva a un cambio de acceso:
 * la próxima lectura la volvería a degradar igual, pero así el selector
 * pinta desde el primer render lo que de verdad se está viendo.
 */
export async function resolveEduCampusChoice(
  ctx: EduClinicaContext & { institution?: { timezone?: string | null } | null },
  requested: unknown,
): Promise<{ value: string; scope: EduCampusScope }> {
  const pedido = typeof requested === "string" ? requested.trim() : null;
  const scope = await getEduCampusScope(ctx, pedido);
  return { value: scope.activeId ?? EDU_CAMPUS_ALL, scope };
}

// ═══════════════════════════════════════════════════════════════════════
// 2 · LA PANTALLA /instituto/sedes
// ═══════════════════════════════════════════════════════════════════════

/**
 * Las sedes con sus números.
 *
 * Los conteos no son decoración: son lo que la pantalla usa para avisar
 * antes de cerrar una sede. Cerrar la que tiene 18 sillones y 40 citas
 * agendadas deja a 40 pacientes sin lugar y nadie se entera hasta el lunes.
 *
 * ⚠️ `people` cuenta accesos EXPLÍCITOS. Un 0 no significa "no entra
 * nadie": significa que nadie está restringido a esta sede, y quien no
 * tiene ninguna fila entra a todas. La pantalla lo dice con esas palabras.
 */
export async function listEduCampuses(
  ctx: EduClinicaContext,
  now: Date = new Date(),
): Promise<EduCampusRow[]> {
  const institutionId = requireInstitution(ctx);

  const rows = await prisma.eduCampus.findMany({
    where: { institutionId },
    orderBy: [{ isActive: "desc" }, { orderIndex: "asc" }, { name: "asc" }],
    take: EDU_MAX_CAMPUSES,
    select: {
      id: true,
      name: true,
      code: true,
      address: true,
      city: true,
      state: true,
      phone: true,
      timezone: true,
      isActive: true,
      orderIndex: true,
      notes: true,
      createdAt: true,
      chairs: { select: { id: true, isActive: true } },
      _count: { select: { access: true } },
    },
  });

  // Las citas futuras se cuentan de una sola consulta agrupada por sillón:
  // una por sede sería N+1 en una pantalla que casi siempre tiene 2 filas,
  // pero N+1 es como se llega a una pantalla que tarda tres segundos.
  const chairIds = rows.flatMap((c) => c.chairs.map((s) => s.id));
  const porSillon =
    chairIds.length === 0
      ? []
      : await prisma.eduAppointment.groupBy({
          by: ["chairId"],
          where: {
            institutionId,
            chairId: { in: chairIds },
            startsAt: { gte: now },
            status: { notIn: ["CANCELLED", "NO_SHOW"] },
          },
          _count: { _all: true },
        });
  const citasPorSillon = new Map(porSillon.map((g) => [g.chairId, g._count._all]));

  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    code: c.code,
    address: c.address,
    city: c.city,
    state: c.state,
    phone: c.phone,
    timezone: c.timezone,
    isActive: c.isActive,
    orderIndex: c.orderIndex,
    notes: c.notes,
    chairs: c.chairs.length,
    activeChairs: c.chairs.filter((s) => s.isActive).length,
    upcoming: c.chairs.reduce((a, s) => a + (citasPorSillon.get(s.id) ?? 0), 0),
    people: c._count.access,
    createdAt: c.createdAt.toISOString(),
  }));
}

export interface EduCampusInput {
  name?: unknown;
  code?: unknown;
  address?: unknown;
  city?: unknown;
  state?: unknown;
  phone?: unknown;
  timezone?: unknown;
  orderIndex?: unknown;
  notes?: unknown;
  isActive?: unknown;
}

/**
 * Zona horaria de una sede, VALIDADA de verdad.
 *
 * eduSafeTimeZone devuelve "UTC" cuando la zona no existe, que es lo
 * correcto al PINTAR (una agenda desplazada se ve y se arregla; una
 * pantalla en blanco, no) y lo incorrecto al GUARDAR: "Marte/Olympus"
 * quedaría en la base y la agenda de esa sede saldría corrida unas horas
 * sin que nadie supiera por qué. Al guardar se rebota.
 */
function parseCampusTimeZone(raw: unknown, fallback: string | null | undefined): string {
  const tz = typeof raw === "string" ? raw.trim() : "";
  if (!tz) return eduSafeTimeZone(fallback);
  const segura = eduSafeTimeZone(tz);
  if (segura === "UTC" && tz.toUpperCase() !== "UTC") {
    throw new EduPadronError(
      `"${tz}" no es una zona horaria que este servidor conozca. Usa una como America/Tijuana o America/Merida.`,
    );
  }
  return segura;
}

function parseOrderIndex(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.trim()) : NaN;
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 999) return null;
  return n;
}

export async function createEduCampus(
  ctx: EduClinicaContext & { institution?: { timezone?: string | null } | null },
  input: EduCampusInput,
): Promise<{ id: string }> {
  const institutionId = requireInstitution(ctx);

  const name = eduRequiredText(input.name, EDU_CAMPUS_NAME_MAX);
  if (!name) {
    throw new EduPadronError(`El nombre de la sede es obligatorio (máximo ${EDU_CAMPUS_NAME_MAX} caracteres).`);
  }

  const code = normalizeEduCampusCode(input.code);
  if (!code) {
    throw new EduPadronError("La clave de la sede es obligatoria: una palabra corta, sin espacios (NORTE, CU, POSGRADO).");
  }

  const cuantas = await prisma.eduCampus.count({ where: { institutionId } });
  if (cuantas >= EDU_MAX_CAMPUSES) {
    throw new EduPadronError(`Este instituto ya tiene ${EDU_MAX_CAMPUSES} sedes, que es el techo del producto.`, 409);
  }

  const dup = await prisma.eduCampus.findFirst({
    where: { institutionId, code },
    select: { name: true },
  });
  if (dup) throw new EduPadronError(`La clave ${code} ya la usa "${dup.name}".`, 409);

  // La zona horaria por defecto es la del INSTITUTO y no la del servidor:
  // el caso normal es que las sedes de una escuela estén en el mismo huso,
  // y obligar a elegirlo en cada alta sería un trámite. Cuando difiere —una
  // universidad con campus en Tijuana y en Mérida— se cambia aquí.
  const tz = parseCampusTimeZone(input.timezone, ctx.institution?.timezone ?? undefined);

  const orderIndex =
    input.orderIndex === undefined || input.orderIndex === null || input.orderIndex === ""
      ? cuantas + 1
      : parseOrderIndex(input.orderIndex);
  if (orderIndex === null) throw new EduPadronError("El orden tiene que ser un número entero.");

  return prisma.eduCampus.create({
    data: {
      institutionId,
      name,
      code,
      address: eduOptionalText(input.address, EDU_CAMPUS_ADDRESS_MAX) ?? null,
      city: eduOptionalText(input.city, 80) ?? null,
      state: eduOptionalText(input.state, 80) ?? null,
      phone: eduOptionalText(input.phone, 30) ?? null,
      timezone: tz,
      orderIndex,
      notes: eduOptionalText(input.notes, EDU_CAMPUS_NOTES_MAX) ?? null,
    },
    select: { id: true },
  });
}

/**
 * Edita una sede, o la cierra.
 *
 * ⚠️ CERRAR UNA SEDE NO CANCELA SUS CITAS ni mueve sus sillones: sería
 * decidir por la escuela dónde va a sentar a cuarenta pacientes. Lo que
 * hace es sacarla del selector y de los desplegables de alta; lo agendado
 * se sigue viendo y se reagenda a mano. La pantalla avisa cuántas citas
 * futuras hay antes de cerrarla.
 *
 * ⚠️ Y NO HAY BORRADO, a propósito y por una razón que no es la de siempre:
 * las filas de acceso (edu_user_campus_access) cuelgan de la sede en
 * CASCADE, y "sin filas" significa "entra a TODAS las sedes". Borrar una
 * sede le abriría el instituto entero a quien solo entraba ahí.
 */
export async function updateEduCampus(
  ctx: EduClinicaContext,
  campusId: string,
  input: EduCampusInput,
): Promise<{ id: string }> {
  const institutionId = requireInstitution(ctx);
  const id = eduCleanId(campusId);
  if (!id) throw new EduPadronError("Esa sede no es de este instituto.", 404);

  const current = await prisma.eduCampus.findFirst({
    where: { id, institutionId },
    select: { id: true },
  });
  if (!current) throw new EduPadronError("Esa sede no es de este instituto.", 404);

  const data: Record<string, unknown> = {};

  if (input.name !== undefined) {
    const v = eduRequiredText(input.name, EDU_CAMPUS_NAME_MAX);
    if (!v) throw new EduPadronError(`El nombre de la sede es obligatorio (máximo ${EDU_CAMPUS_NAME_MAX} caracteres).`);
    data.name = v;
  }
  if (input.code !== undefined) {
    const v = normalizeEduCampusCode(input.code);
    if (!v) throw new EduPadronError("La clave de la sede es obligatoria: una palabra corta, sin espacios.");
    const dup = await prisma.eduCampus.findFirst({
      where: { institutionId, code: v, NOT: { id } },
      select: { name: true },
    });
    if (dup) throw new EduPadronError(`La clave ${v} ya la usa "${dup.name}".`, 409);
    data.code = v;
  }
  if (input.address !== undefined) data.address = eduOptionalText(input.address, EDU_CAMPUS_ADDRESS_MAX) ?? null;
  if (input.city !== undefined) data.city = eduOptionalText(input.city, 80) ?? null;
  if (input.state !== undefined) data.state = eduOptionalText(input.state, 80) ?? null;
  if (input.phone !== undefined) data.phone = eduOptionalText(input.phone, 30) ?? null;
  if (input.notes !== undefined) data.notes = eduOptionalText(input.notes, EDU_CAMPUS_NOTES_MAX) ?? null;
  if (input.timezone !== undefined) {
    if (typeof input.timezone !== "string" || !input.timezone.trim()) {
      throw new EduPadronError("La zona horaria de la sede es obligatoria.");
    }
    data.timezone = parseCampusTimeZone(input.timezone, null);
  }
  if (input.orderIndex !== undefined) {
    const n = parseOrderIndex(input.orderIndex);
    if (n === null) throw new EduPadronError("El orden tiene que ser un número entero.");
    data.orderIndex = n;
  }
  if (input.isActive !== undefined) {
    const b = parseEduBoolean(input.isActive);
    if (b === null) throw new EduPadronError("El estado de la sede tiene que ser verdadero o falso.");
    data.isActive = b;
  }

  if (Object.keys(data).length === 0) throw new EduPadronError("No mandaste ningún cambio.");

  await prisma.eduCampus.update({ where: { id }, data });
  return { id };
}

// ═══════════════════════════════════════════════════════════════════════
// 3 · QUIÉN ENTRA A CADA SEDE
// ═══════════════════════════════════════════════════════════════════════

/**
 * Las personas del instituto, con si entran a ESTA sede.
 *
 * Se listan TODAS y no solo las que ya tienen fila, porque la pregunta que
 * trae a alguien a esta pantalla es "¿quién entra al campus norte?" y la
 * respuesta útil incluye a los que no. `campusCount` es lo que permite
 * decir la verdad incómoda: quien tiene 0 sedes marcadas entra a todas.
 */
export async function listEduCampusPeople(
  ctx: EduClinicaContext,
  campusId: string,
): Promise<EduCampusPersonRow[]> {
  const institutionId = requireInstitution(ctx);
  const id = eduCleanId(campusId);
  if (!id) throw new EduPadronError("Esa sede no es de este instituto.", 404);

  const sede = await prisma.eduCampus.findFirst({
    where: { id, institutionId },
    select: { id: true },
  });
  if (!sede) throw new EduPadronError("Esa sede no es de este instituto.", 404);

  const usuarios = await prisma.eduUser.findMany({
    where: { institutionId },
    orderBy: [{ isActive: "desc" }, { role: "asc" }, { firstName: "asc" }, { lastName: "asc" }],
    take: 500,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      role: true,
      isActive: true,
      campusAccess: { select: { campusId: true } },
    },
  });

  return usuarios.map((u) => ({
    userId: u.id,
    name: persona(u),
    email: u.email,
    role: u.role as EduRole,
    isActive: u.isActive,
    allowed: u.campusAccess.some((a) => a.campusId === sede.id),
    campusCount: u.campusAccess.length,
  }));
}

/**
 * Da o quita el acceso de UNA persona a UNA sede.
 *
 * 🔴 QUITAR LA ÚLTIMA SEDE DE ALGUIEN LE ABRE TODAS, y por eso este método
 * no lo hace en silencio: cuando se quita la única fila que le quedaba, la
 * respuesta lo dice (`abrioTodas`) y la pantalla lo pinta. Es la
 * consecuencia directa de "sin filas = todas", que es la regla que hace
 * que aplicar esta ola no deje a nadie fuera — pero leída al revés
 * sorprende, y una sorpresa sobre quién entra dónde no se puede dejar
 * callada.
 */
export async function setEduCampusAccess(
  ctx: EduClinicaContext,
  campusId: string,
  userId: unknown,
  allowed: unknown,
): Promise<{ allowed: boolean; campusCount: number; abrioTodas: boolean }> {
  const institutionId = requireInstitution(ctx);
  const id = eduCleanId(campusId);
  const uid = eduCleanId(userId);
  if (!id) throw new EduPadronError("Esa sede no es de este instituto.", 404);
  if (!uid) throw new EduPadronError("Elige una persona de este instituto.", 400);

  const quiere = parseEduBoolean(allowed);
  if (quiere === null) throw new EduPadronError("Di si la persona entra a la sede o no.");

  const [sede, usuario] = await Promise.all([
    prisma.eduCampus.findFirst({ where: { id, institutionId }, select: { id: true } }),
    prisma.eduUser.findFirst({ where: { id: uid, institutionId }, select: { id: true } }),
  ]);
  if (!sede) throw new EduPadronError("Esa sede no es de este instituto.", 404);
  if (!usuario) throw new EduPadronError("Esa persona no es de este instituto.", 404);

  if (quiere) {
    // Idempotente: dar dos veces el mismo acceso no revienta ni duplica.
    await prisma.eduUserCampusAccess.upsert({
      where: { userId_campusId: { userId: usuario.id, campusId: sede.id } },
      create: { institutionId, userId: usuario.id, campusId: sede.id },
      update: {},
    });
  } else {
    await prisma.eduUserCampusAccess.deleteMany({
      where: { institutionId, userId: usuario.id, campusId: sede.id },
    });
  }

  const campusCount = await prisma.eduUserCampusAccess.count({
    where: { institutionId, userId: usuario.id },
  });

  return { allowed: quiere, campusCount, abrioTodas: !quiere && campusCount === 0 };
}

// ═══════════════════════════════════════════════════════════════════════
// 3B · LAS SEDES DE UNA PERSONA, DE UNA VEZ (H-112)
//
// 🔴 QUÉ ARREGLA. El alta de una cuenta no preguntaba la sede, y por la
// regla de esta ola —«sin filas = TODAS las sedes»— cada persona nueva
// nacía con acceso al instituto entero. Una universidad daba de alta a 40
// residentes del campus norte y los 40 veían también el sur, hasta que
// alguien los marcara UNO POR UNO en /instituto/sedes. El default abierto
// es deliberado y está bien explicado (es lo que hace que aplicar la ola no
// deje a nadie fuera), pero el alta ni lo mencionaba: nadie sabía que
// estaba eligiendo.
//
// 🔴 POR QUÉ ESTÁ AQUÍ Y NO EN equipo.ts. `edu_user_campus_access` tiene UN
// solo escritor y es este archivo — igual que la bitácora tiene un solo
// `eduAudit` y la visibilidad un solo `visibility.ts`. Escribirla también
// desde el alta serían dos sitios decidiendo qué significa "sin filas", y
// es exactamente el detalle que no se puede desincronizar: en esa tabla, la
// AUSENCIA de filas concede MÁS acceso, no menos. Por eso `equipo.ts` llama
// a esta función y no toca la tabla.
// ═══════════════════════════════════════════════════════════════════════

/** Cliente Prisma o transacción: el alta escribe la persona y sus sedes juntas. */
type EduDb = Pick<typeof prisma, "eduUserCampusAccess"> | Prisma.TransactionClient;

/**
 * Las sedes que se pueden ELEGIR al dar de alta o al editar a una persona.
 *
 * Solo las ACTIVAS: una sede cerrada sigue existiendo (sus turnos y sus
 * citas históricas cuelgan de ella) pero no se le asigna gente nueva, igual
 * que no se inscribe a nadie en una especialidad desactivada.
 */
export async function listEduCampusesAsignables(
  ctx: EduClinicaContext,
): Promise<EduCampusOption[]> {
  const institutionId = requireInstitution(ctx);
  const rows = await prisma.eduCampus.findMany({
    where: { institutionId, isActive: true },
    orderBy: [{ orderIndex: "asc" }, { name: "asc" }],
    take: EDU_MAX_CAMPUSES,
    select: { id: true, name: true, code: true, timezone: true, isActive: true },
  });
  return rows;
}

/**
 * Valida una lista de ids de sede contra ESTE instituto.
 *
 * Devuelve los ids limpios, sin repetidos y en el orden en que se pintan.
 * Lanza con un mensaje legible si alguno no es de aquí o está cerrado —
 * callarlo y guardar el resto dejaría a una persona con menos sedes de las
 * que quien la dio de alta creyó marcarle, y nadie se enteraría.
 *
 * ⚠️ Una lista VACÍA es válida y significa «todas las sedes» (la regla de
 * la ola). Quien llama tiene que decirlo en pantalla, no suponerlo.
 */
export async function eduParseCampusIds(
  ctx: EduClinicaContext,
  raw: unknown,
): Promise<string[]> {
  const institutionId = requireInstitution(ctx);
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new EduPadronError("Manda la lista de sedes, o una lista vacía para dejarle todas.");
  }
  const pedidos: string[] = [];
  for (const v of raw) {
    const id = eduCleanId(v);
    if (!id) throw new EduPadronError("Una de las sedes que mandaste no es válida.");
    if (!pedidos.includes(id)) pedidos.push(id);
  }
  if (pedidos.length === 0) return [];
  if (pedidos.length > EDU_MAX_CAMPUSES) {
    throw new EduPadronError(`No se pueden marcar más de ${EDU_MAX_CAMPUSES} sedes.`);
  }

  const validas = await prisma.eduCampus.findMany({
    where: { institutionId, id: { in: pedidos } },
    select: { id: true, name: true, isActive: true },
  });
  const porId = new Map(validas.map((c) => [c.id, c]));
  for (const id of pedidos) {
    const c = porId.get(id);
    if (!c) throw new EduPadronError("Una de las sedes que elegiste no es de este instituto.", 404);
    if (!c.isActive) {
      throw new EduPadronError(
        `La sede ${c.name} está cerrada: no se le puede asignar a nadie. Ábrela primero en Sedes.`,
      );
    }
  }
  return pedidos;
}

/**
 * Deja a UNA persona con EXACTAMENTE estas sedes. Reemplaza lo que tuviera.
 *
 * 🔴 LISTA VACÍA = TODAS LAS SEDES, y por eso lo devuelve dicho
 * (`abrioTodas`): es la misma sorpresa que ya avisaba `setEduCampusAccess`
 * al quitar la última, y leída al derecho sigue sorprendiendo. Quien llama
 * lo pinta; callarlo sería dejar que alguien creyera que "no marqué
 * ninguna" es "no entra a ninguna", cuando es justo lo contrario.
 *
 * `campusIds` tiene que venir YA validado por `eduParseCampusIds`: esta
 * función no vuelve a preguntarle a la base si esas sedes son de aquí,
 * porque el alta masiva la llama una vez por persona y serían N consultas
 * para comprobar N veces lo mismo. La firma lo dice y quien llama lo
 * cumple — los dos llamadores están en equipo.ts, a la vista.
 *
 * Acepta una transacción para que el alta escriba la persona y sus sedes
 * juntas: media alta —cuenta creada, sedes no— es una persona que ve el
 * instituto entero sin que nadie lo haya decidido.
 */
export async function setEduUserCampuses(
  ctx: EduClinicaContext,
  userId: string,
  campusIds: string[],
  db: EduDb = prisma,
): Promise<{ campusIds: string[]; abrioTodas: boolean }> {
  const institutionId = requireInstitution(ctx);
  const uid = eduCleanId(userId);
  if (!uid) throw new EduPadronError("Esa persona no es de este instituto.", 404);

  // Se borra lo que había y se escribe lo pedido. Es un REEMPLAZO y no un
  // diff a propósito: el diff exige leer antes, y entre la lectura y la
  // escritura cabe otra pestaña marcando otra cosa. El `deleteMany` lleva
  // el institutionId además del userId — un id de otra escuela no borra
  // nada aquí.
  await db.eduUserCampusAccess.deleteMany({ where: { institutionId, userId: uid } });
  if (campusIds.length > 0) {
    await db.eduUserCampusAccess.createMany({
      data: campusIds.map((campusId) => ({ institutionId, userId: uid, campusId })),
      skipDuplicates: true,
    });
  }
  return { campusIds, abrioTodas: campusIds.length === 0 };
}

// ═══════════════════════════════════════════════════════════════════════
// 4 · EL PANEL: CÓMO VA CADA SEDE HOY
// ═══════════════════════════════════════════════════════════════════════

/** Una sede con sus números de HOY, para el panel de Inicio. */
export interface EduCampusTodayRow {
  id: string;
  name: string;
  code: string;
  timezone: string;
  isActive: boolean;
  /** Sillones activos. */
  chairs: number;
  /** Citas de HOY (canceladas y "no llegó" fuera: ya no ocupan nada). */
  appointments: number;
  /** El día de calendario DE ESA SEDE, que puede no ser el mismo que aquí. */
  dayISO: string;
}

/**
 * Cómo va HOY cada sede a la que entra quien pregunta.
 *
 * 🔴 "HOY" SE CALCULA CON LA HORA DE CADA SEDE, no con una sola. Es la
 * razón de que esto no sea un `groupBy`: con un campus en Tijuana y otro en
 * Mérida, el día de calendario de cada uno empieza y acaba en un instante
 * distinto, y contar los dos con la misma ventana le pondría a uno las
 * citas de la madrugada del otro. Son N consultas y N es el número de
 * sedes de una escuela — dos, tres, cinco.
 *
 * ⚠️ Techo de EDU_CAMPUS_TODAY_MAX sedes: una consulta por sede está bien
 * con cinco y no con cuarenta, y esta pantalla se abre en cada visita al
 * panel. Lo que se corta es el RESUMEN, no el acceso.
 */
export const EDU_CAMPUS_TODAY_MAX = 12;

export async function listEduCampusToday(
  ctx: EduClinicaContext,
  scope: EduCampusScope,
  now: Date = new Date(),
): Promise<EduCampusTodayRow[]> {
  const institutionId = requireInstitution(ctx);
  if (!scope || scope.options.length === 0) return [];

  const sedes = scope.options.slice(0, EDU_CAMPUS_TODAY_MAX);

  return Promise.all(
    sedes.map(async (c) => {
      const tz = eduSafeTimeZone(c.timezone);
      const dayISO = eduTodayISO(tz, now);
      const rango = eduDayRange(dayISO, tz, 1);

      const [chairs, appointments] = await Promise.all([
        prisma.eduChair.count({ where: { institutionId, campusId: c.id, isActive: true } }),
        rango
          ? prisma.eduAppointment.count({
              where: {
                institutionId,
                chair: { institutionId, campusId: c.id },
                startsAt: { gte: rango.from, lt: rango.to },
                status: { notIn: ["CANCELLED", "NO_SHOW"] },
              },
            })
          : Promise.resolve(0),
      ]);

      return {
        id: c.id,
        name: c.name,
        code: c.code,
        timezone: tz,
        isActive: c.isActive,
        chairs,
        appointments,
        dayISO,
      };
    }),
  );
}
