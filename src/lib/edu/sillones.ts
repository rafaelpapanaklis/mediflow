/**
 * DaleControl INSTITUCIONAL — los SILLONES contra la base de datos.
 *
 * SERVIDOR: importa prisma. Lo puro vive en agenda-core.ts.
 *
 * 🔴 CUÁNTOS SILLONES HAY LO DECIDE CADA INSTITUTO. No hay un número en el
 * código, ni un seed con doce unidades, ni un "por defecto son 8": una
 * escuela tiene 40 y otra tiene 6. Se dan de alta desde
 * /instituto/sillones y hasta que exista el primero, la agenda lo dice en
 * vez de fingir columnas vacías.
 *
 * El sillón es INFRAESTRUCTURA de la escuela, no una fila de nadie: no
 * pasa por el recorte POR PERSONA del helper de visibilidad porque no hay
 * nada que recortar — quien puede verlos (sillones.view) los ve todos. Lo
 * que sí se cierra, como siempre, es el tenant: todas las consultas llevan
 * el institutionId de la SESIÓN.
 *
 * 🔴 OLA 11 — LO QUE SÍ RECORTA UN SILLÓN ES LA SEDE, y es una pregunta
 * distinta: no "¿de quién es esta fila?" sino "¿en qué edificio está?". El
 * `where` sale de eduChairScopeWhere (visibility.ts) y no se escribe a mano
 * en ninguna consulta de este archivo — tres copias del mismo filtro son
 * tres sitios donde discrepar.
 *
 * 🔴 Y EL NÚMERO DEL SILLÓN ES ÚNICO DENTRO DE LA SEDE, no del instituto:
 * el campus norte y el campus sur tienen cada uno su "Sillón 1" pintado en
 * su pared. Las dos comprobaciones de duplicado de abajo llevan el
 * campusId; sin él, abrir el campus sur obligaría a numerar del 21 al 40 y
 * el número dejaría de ser el de la pared, que es para lo único que sirve.
 */
import { prisma } from "@/lib/prisma";
import { EduPadronError } from "@/lib/edu/padron";
import { eduRequiredText, parseEduBoolean } from "@/lib/edu/padron-core";
import { EDU_MAX_CAMPUSES } from "@/lib/edu/campus-core";
import {
  EDU_MAX_CHAIRS,
  EDU_MAX_CHAIR_NUMBER,
  EDU_MINUTES_IN_DAY,
  eduCleanId,
  parseEduMinuteOfDay,
  type EduChairOption,
  type EduChairRow,
} from "@/lib/edu/agenda-core";
import {
  eduCampusCovers,
  eduCampusScopeWhere,
  eduChairScopeWhere,
  type EduClinicaContext,
} from "@/lib/edu/visibility";

export type { EduChairRow, EduChairOption, EduChairScheduleRow } from "@/lib/edu/agenda-core";

function requireInstitution(ctx: EduClinicaContext): string {
  const id = ctx?.institutionId;
  if (!id || typeof id !== "string") {
    throw new EduPadronError("Sesión de instituto no válida.", 401);
  }
  return id;
}

/** Cuántas franjas admite un sillón. Alto pero finito: sin techo, un PUT
 *  con diez mil filas se guarda y después nadie puede pintar la pantalla. */
export const EDU_MAX_SCHEDULE_SLOTS = 40;

// ═══════════════════════════════════════════════════════════════════════
// LECTURAS
// ═══════════════════════════════════════════════════════════════════════

/**
 * Los sillones del instituto con su horario y cuántas citas futuras tienen.
 *
 * El conteo de citas futuras no es decoración: es lo que la pantalla usa
 * para avisar antes de desactivar un sillón. Desactivar uno con doce citas
 * agendadas deja doce pacientes sin lugar y nadie se entera hasta el lunes.
 */
export async function listEduChairs(
  ctx: EduClinicaContext,
  now: Date = new Date(),
): Promise<EduChairRow[]> {
  const institutionId = requireInstitution(ctx);
  const rows = await prisma.eduChair.findMany({
    where: eduChairScopeWhere({ institutionId, campusIds: ctx.campusIds }),
    orderBy: [{ isActive: "desc" }, { campus: { orderIndex: "asc" } }, { orderIndex: "asc" }, { number: "asc" }],
    take: EDU_MAX_CHAIRS,
    select: {
      id: true,
      name: true,
      number: true,
      isActive: true,
      orderIndex: true,
      campusId: true,
      campus: { select: { name: true, timezone: true } },
      schedules: {
        orderBy: [{ weekday: "asc" }, { startMinute: "asc" }],
        select: { id: true, weekday: true, startMinute: true, endMinute: true },
      },
      _count: {
        select: {
          appointments: {
            where: {
              institutionId,
              startsAt: { gte: now },
              // Una cita cancelada o a la que el paciente no llegó no
              // cuenta: ya no ocupa nada.
              status: { notIn: ["CANCELLED", "NO_SHOW"] },
            },
          },
        },
      },
    },
  });

  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    number: c.number,
    isActive: c.isActive,
    orderIndex: c.orderIndex,
    schedules: c.schedules,
    upcoming: c._count.appointments,
    campusId: c.campusId,
    campusName: c.campus.name,
    campusTimezone: c.campus.timezone,
  }));
}

/**
 * Lo mínimo para un <select> y para las columnas de la agenda.
 *
 * 🔴 Ola 11: recortado POR SEDE. Es lo que hace que la agenda del campus
 * norte no tenga columnas del sur, y también lo que impide agendar en un
 * sillón de una sede a la que no entras: el desplegable no lo ofrece, y el
 * servidor lo vuelve a comprobar al guardar (resolveParties, en agenda.ts).
 */
export async function listEduChairOptions(ctx: EduClinicaContext): Promise<EduChairOption[]> {
  const institutionId = requireInstitution(ctx);
  const rows = await prisma.eduChair.findMany({
    where: eduChairScopeWhere({ institutionId, campusIds: ctx.campusIds }),
    orderBy: [{ campus: { orderIndex: "asc" } }, { orderIndex: "asc" }, { number: "asc" }],
    take: EDU_MAX_CHAIRS,
    select: {
      id: true,
      name: true,
      number: true,
      isActive: true,
      campusId: true,
      campus: { select: { name: true } },
    },
  });
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    number: c.number,
    isActive: c.isActive,
    campusId: c.campusId,
    campusName: c.campus.name,
  }));
}

// ═══════════════════════════════════════════════════════════════════════
// ESCRITURAS
// ═══════════════════════════════════════════════════════════════════════

function parseChairNumber(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.trim()) : NaN;
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  if (n < 1 || n > EDU_MAX_CHAIR_NUMBER) return null;
  return n;
}

/**
 * En qué SEDE se da de alta este sillón.
 *
 * 🔴 UN SILLÓN SIEMPRE ESTÁ EN UNA SEDE. Si el instituto tiene una sola, se
 * usa ésa sin preguntar (que es el caso de casi todas las escuelas y el
 * estado en que la deja el backfill de sql/edu-ola-11.sql). Con varias, hay
 * que decir cuál: un sillón "de todas las sedes" no existe, y dejarlo al
 * azar pondría la unidad en el edificio equivocado.
 *
 * Y se comprueba contra las sedes a las que ENTRA quien lo da de alta: un
 * campusId del body no puede meter un sillón en una sede ajena. Ojo — la
 * sede se valida contra el INSTITUTO de la sesión, así que tampoco puede
 * apuntar a la de otra escuela.
 */
async function resolveChairCampus(
  ctx: EduClinicaContext,
  institutionId: string,
  raw: unknown,
): Promise<string> {
  const pedido = eduCleanId(raw);

  if (pedido) {
    const sede = await prisma.eduCampus.findFirst({
      where: { id: pedido, institutionId },
      select: { id: true, name: true, isActive: true },
    });
    if (!sede) throw new EduPadronError("Esa sede no es de este instituto.", 404);
    if (!eduCampusCovers(ctx.campusIds, sede.id)) {
      throw new EduPadronError("No tienes acceso a esa sede.", 403);
    }
    if (!sede.isActive) {
      throw new EduPadronError(`"${sede.name}" está cerrada. Reábrela antes de darle sillones.`);
    }
    return sede.id;
  }

  const sedes = await prisma.eduCampus.findMany({
    where: eduCampusScopeWhere({ institutionId, campusIds: ctx.campusIds }),
    orderBy: [{ orderIndex: "asc" }, { name: "asc" }],
    take: EDU_MAX_CAMPUSES,
    select: { id: true, isActive: true },
  });
  const abiertas = sedes.filter((s) => s.isActive);
  if (abiertas.length === 1) return abiertas[0].id;
  if (abiertas.length === 0) {
    throw new EduPadronError(
      "Este instituto todavía no tiene ninguna sede abierta. Da de alta una en Sedes antes de capturar sillones: un sillón está en un edificio o no está en ninguno.",
      409,
    );
  }
  throw new EduPadronError("Elige en qué sede está este sillón.");
}

export async function createEduChair(
  ctx: EduClinicaContext,
  input: { name?: unknown; number?: unknown; orderIndex?: unknown; campusId?: unknown },
): Promise<{ id: string }> {
  const institutionId = requireInstitution(ctx);
  const campusId = await resolveChairCampus(ctx, institutionId, input.campusId);

  const number = parseChairNumber(input.number);
  if (!number) {
    throw new EduPadronError(`El número del sillón tiene que ser un entero entre 1 y ${EDU_MAX_CHAIR_NUMBER}.`);
  }

  // El nombre es opcional: en la mayoría de las escuelas el sillón se llama
  // por su número y obligar a teclear "Sillón 7" dos veces es un trámite.
  const name =
    input.name === undefined || input.name === null || input.name === ""
      ? `Sillón ${number}`
      : eduRequiredText(input.name, 60);
  if (!name) throw new EduPadronError("El nombre del sillón no puede pasar de 60 caracteres.");

  const cuantos = await prisma.eduChair.count({ where: { institutionId } });
  if (cuantos >= EDU_MAX_CHAIRS) {
    throw new EduPadronError(`Este instituto ya tiene ${EDU_MAX_CHAIRS} sillones, que es el techo del producto.`, 409);
  }

  // 🔴 El duplicado se busca DENTRO DE LA SEDE: el campus sur puede tener
  // su propio "Sillón 1" y tiene que poder tenerlo.
  const dup = await prisma.eduChair.findFirst({
    where: { institutionId, campusId, number },
    select: { name: true },
  });
  if (dup) throw new EduPadronError(`El número ${number} ya lo usa "${dup.name}" en esta sede.`, 409);

  const orderIndex =
    input.orderIndex === undefined || input.orderIndex === null || input.orderIndex === ""
      ? number
      : parseChairNumber(input.orderIndex);
  if (orderIndex === null) throw new EduPadronError("El orden tiene que ser un número entero.");

  return prisma.eduChair.create({
    data: { institutionId, campusId, name, number, orderIndex },
    select: { id: true },
  });
}

export async function updateEduChair(
  ctx: EduClinicaContext,
  chairId: string,
  input: {
    name?: unknown;
    number?: unknown;
    orderIndex?: unknown;
    isActive?: unknown;
    campusId?: unknown;
  },
): Promise<{ id: string }> {
  const institutionId = requireInstitution(ctx);
  const id = eduCleanId(chairId);
  if (!id) throw new EduPadronError("Ese sillón no es de este instituto.", 404);

  // El sillón se busca CON el recorte de sede: uno de una sede a la que no
  // entras se ve exactamente igual que uno que no existe (404), que es lo
  // que debe verse desde fuera.
  const current = await prisma.eduChair.findFirst({
    where: { ...eduChairScopeWhere({ institutionId, campusIds: ctx.campusIds }), id },
    select: { id: true, name: true, number: true, campusId: true },
  });
  if (!current) throw new EduPadronError("Ese sillón no es de este instituto.", 404);

  const data: {
    name?: string;
    number?: number;
    orderIndex?: number;
    isActive?: boolean;
    campusId?: string;
  } = {};

  // 🔴 MUDAR UN SILLÓN DE SEDE MUEVE TAMBIÉN SUS CITAS, porque la sede de
  // una cita se DERIVA de su sillón y no se copia. Es justamente lo que se
  // quiere cuando una unidad se traslada de edificio —las citas se van con
  // ella— y es la razón de que EduAppointment no tenga su propia columna:
  // una copia se habría quedado apuntando al edificio viejo.
  //
  // ⚠️ Y su HORARIO se muda tal cual, sin convertirse. Las franjas se
  // guardan en minutos de la hora de PARED (EduChairSchedule), así que un
  // sillón que abría a las 8 sigue abriendo a las 8 — en la hora de su
  // sede nueva. Es lo correcto para una unidad que se traslada de
  // edificio, y sería un error convertirla: nadie mueve un sillón a
  // Tijuana para que abra a las 6 de la mañana.
  let campusId = current.campusId;
  if (input.campusId !== undefined) {
    campusId = await resolveChairCampus(ctx, institutionId, input.campusId);
    if (campusId !== current.campusId) data.campusId = campusId;
  }

  // El número se comprueba en la sede DE DESTINO aunque no se esté
  // cambiando: mudar el "Sillón 1" del norte a una sede que ya tiene su
  // propio "Sillón 1" choca con el índice único, y sin esta comprobación el
  // error saldría como un 500 sin explicación en vez de decir qué pasó.
  const numeroDestino = input.number === undefined ? current.number : null;
  if (data.campusId && numeroDestino !== null) {
    const dup = await prisma.eduChair.findFirst({
      where: { institutionId, campusId, number: numeroDestino, NOT: { id } },
      select: { name: true },
    });
    if (dup) {
      throw new EduPadronError(
        `En esa sede el número ${numeroDestino} ya lo usa "${dup.name}". Cámbiale el número a "${current.name}" antes de mudarlo.`,
        409,
      );
    }
  }

  if (input.name !== undefined) {
    const v = eduRequiredText(input.name, 60);
    if (!v) throw new EduPadronError("El nombre del sillón es obligatorio (máximo 60 caracteres).");
    data.name = v;
  }
  if (input.number !== undefined) {
    const n = parseChairNumber(input.number);
    if (!n) {
      throw new EduPadronError(`El número del sillón tiene que ser un entero entre 1 y ${EDU_MAX_CHAIR_NUMBER}.`);
    }
    const dup = await prisma.eduChair.findFirst({
      where: { institutionId, campusId, number: n, NOT: { id } },
      select: { name: true },
    });
    if (dup) throw new EduPadronError(`El número ${n} ya lo usa "${dup.name}" en esa sede.`, 409);
    data.number = n;
  }
  if (input.orderIndex !== undefined) {
    const n = parseChairNumber(input.orderIndex);
    if (n === null) throw new EduPadronError("El orden tiene que ser un número entero.");
    data.orderIndex = n;
  }
  if (input.isActive !== undefined) {
    const b = parseEduBoolean(input.isActive);
    if (b === null) throw new EduPadronError("El estado del sillón tiene que ser verdadero o falso.");
    data.isActive = b;
  }

  if (Object.keys(data).length === 0) throw new EduPadronError("No mandaste ningún cambio.");

  // ⚠️ Desactivar un sillón NO cancela sus citas ni las mueve: sería
  // decidir por la escuela dónde va a sentar a doce pacientes. Lo que hace
  // es sacarlo de los desplegables de alta; las citas ya agendadas se
  // siguen viendo y se reagendan a mano.
  await prisma.eduChair.update({ where: { id }, data });
  return { id };
}

/**
 * Reemplaza el horario COMPLETO de un sillón.
 *
 * Es un PUT y no un POST por fila a propósito: capturar un horario es
 * "estos son mis días y mis horas", y una pantalla que borra y agrega fila
 * por fila deja estados intermedios raros (un sillón sin horario durante
 * medio segundo, que en ese instante acepta cualquier hora).
 *
 * 🔴 Mandar una lista VACÍA borra el horario, y eso significa "siempre
 * abierto", no "cerrado". Está dicho en la pantalla con todas sus letras
 * porque es lo contrario de lo que la gente supone.
 */
export async function replaceEduChairSchedule(
  ctx: EduClinicaContext,
  chairId: string,
  input: { slots?: unknown },
): Promise<{ id: string; slots: number }> {
  const institutionId = requireInstitution(ctx);
  const id = eduCleanId(chairId);
  if (!id) throw new EduPadronError("Ese sillón no es de este instituto.", 404);

  const chair = await prisma.eduChair.findFirst({
    where: { ...eduChairScopeWhere({ institutionId, campusIds: ctx.campusIds }), id },
    select: { id: true },
  });
  if (!chair) throw new EduPadronError("Ese sillón no es de este instituto.", 404);

  const raw = Array.isArray(input.slots) ? input.slots : null;
  if (raw === null) throw new EduPadronError("El horario tiene que venir como una lista de franjas.");
  if (raw.length > EDU_MAX_SCHEDULE_SLOTS) {
    throw new EduPadronError(`Un sillón admite ${EDU_MAX_SCHEDULE_SLOTS} franjas como máximo.`);
  }

  const slots: { weekday: number; startMinute: number; endMinute: number }[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) {
      throw new EduPadronError("Una de las franjas no es válida.");
    }
    const it = item as Record<string, unknown>;
    const weekday =
      typeof it.weekday === "number"
        ? it.weekday
        : typeof it.weekday === "string"
          ? Number(it.weekday)
          : NaN;
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      throw new EduPadronError("El día de la semana tiene que ir de 0 (domingo) a 6 (sábado).");
    }
    const startMinute = parseEduMinuteOfDay(it.startMinute ?? it.start);
    const endMinute = parseEduMinuteOfDay(it.endMinute ?? it.end);
    if (startMinute === null || endMinute === null) {
      throw new EduPadronError("Las horas del horario tienen que venir como HH:MM.");
    }
    if (endMinute <= startMinute) {
      throw new EduPadronError("Una franja no puede terminar antes de empezar.");
    }
    if (endMinute > EDU_MINUTES_IN_DAY) {
      throw new EduPadronError("Una franja no puede pasar de la medianoche.");
    }
    // Franjas que se pisan el mismo día: se rebota en vez de guardarlas.
    // Dos franjas superpuestas no rompen nada (la cita solo tiene que caber
    // en UNA), pero la pantalla las pinta como dos renglones que dicen lo
    // mismo y la escuela cree que capturó mal.
    for (const ya of slots) {
      if (ya.weekday !== weekday) continue;
      if (startMinute < ya.endMinute && ya.startMinute < endMinute) {
        throw new EduPadronError("Hay dos franjas encimadas el mismo día. Únelas en una sola.");
      }
    }
    slots.push({ weekday, startMinute, endMinute });
  }

  await prisma.$transaction(async (tx) => {
    await tx.eduChairSchedule.deleteMany({ where: { institutionId, chairId: chair.id } });
    if (slots.length > 0) {
      await tx.eduChairSchedule.createMany({
        data: slots.map((s) => ({ institutionId, chairId: chair.id, ...s })),
      });
    }
  });

  return { id: chair.id, slots: slots.length };
}
