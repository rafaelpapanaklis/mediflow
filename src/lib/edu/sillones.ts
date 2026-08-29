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
 * pasa por el helper de visibilidad porque no hay nada que recortar —
 * quien puede verlos (sillones.view) los ve todos. Lo que sí se cierra,
 * como siempre, es el tenant: todas las consultas llevan el institutionId
 * de la SESIÓN.
 */
import { prisma } from "@/lib/prisma";
import { EduPadronError } from "@/lib/edu/padron";
import { eduRequiredText, parseEduBoolean } from "@/lib/edu/padron-core";
import {
  EDU_MAX_CHAIRS,
  EDU_MAX_CHAIR_NUMBER,
  EDU_MINUTES_IN_DAY,
  eduCleanId,
  parseEduMinuteOfDay,
  type EduChairOption,
  type EduChairRow,
} from "@/lib/edu/agenda-core";
import type { EduClinicaContext } from "@/lib/edu/visibility";

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
    where: { institutionId },
    orderBy: [{ isActive: "desc" }, { orderIndex: "asc" }, { number: "asc" }],
    take: EDU_MAX_CHAIRS,
    select: {
      id: true,
      name: true,
      number: true,
      isActive: true,
      orderIndex: true,
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
  }));
}

/** Lo mínimo para un <select> y para las columnas de la agenda. */
export async function listEduChairOptions(ctx: EduClinicaContext): Promise<EduChairOption[]> {
  const institutionId = requireInstitution(ctx);
  const rows = await prisma.eduChair.findMany({
    where: { institutionId },
    orderBy: [{ orderIndex: "asc" }, { number: "asc" }],
    take: EDU_MAX_CHAIRS,
    select: { id: true, name: true, number: true, isActive: true },
  });
  return rows;
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

export async function createEduChair(
  ctx: EduClinicaContext,
  input: { name?: unknown; number?: unknown; orderIndex?: unknown },
): Promise<{ id: string }> {
  const institutionId = requireInstitution(ctx);

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

  const dup = await prisma.eduChair.findFirst({
    where: { institutionId, number },
    select: { name: true },
  });
  if (dup) throw new EduPadronError(`El número ${number} ya lo usa "${dup.name}".`, 409);

  const orderIndex =
    input.orderIndex === undefined || input.orderIndex === null || input.orderIndex === ""
      ? number
      : parseChairNumber(input.orderIndex);
  if (orderIndex === null) throw new EduPadronError("El orden tiene que ser un número entero.");

  return prisma.eduChair.create({
    data: { institutionId, name, number, orderIndex },
    select: { id: true },
  });
}

export async function updateEduChair(
  ctx: EduClinicaContext,
  chairId: string,
  input: { name?: unknown; number?: unknown; orderIndex?: unknown; isActive?: unknown },
): Promise<{ id: string }> {
  const institutionId = requireInstitution(ctx);
  const id = eduCleanId(chairId);
  if (!id) throw new EduPadronError("Ese sillón no es de este instituto.", 404);

  const current = await prisma.eduChair.findFirst({
    where: { id, institutionId },
    select: { id: true },
  });
  if (!current) throw new EduPadronError("Ese sillón no es de este instituto.", 404);

  const data: { name?: string; number?: number; orderIndex?: number; isActive?: boolean } = {};

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
      where: { institutionId, number: n, NOT: { id } },
      select: { name: true },
    });
    if (dup) throw new EduPadronError(`El número ${n} ya lo usa "${dup.name}".`, 409);
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
    where: { id, institutionId },
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
