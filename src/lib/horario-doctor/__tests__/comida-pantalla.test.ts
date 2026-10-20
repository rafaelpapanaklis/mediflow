/**
 * LA COMIDA EN LA PANTALLA DEL HORARIO — WS1-T5 (revisión t8, N-A3 y A8).
 *
 * Run: npm run test:salamanca-agenda
 *
 * N-A3: un fallo pasajero al leer la comida (un timeout del pooler) dejaba los
 * campos vacíos con `comida: true`; el doctor cambiaba otra cosa, guardaba y
 * la pantalla mandaba `null` en los 7 días: la comida se BORRABA. Ahora el GET
 * dice `comida: false, comidaIlegible: true`, la pantalla no manda la comida y
 * el PUT no la toca.
 *
 * Corre el SERVICIO REAL (`verHorario` / `guardarHorario`, lo que llaman las
 * rutas de /api/team/[id]/horario) con prisma de mentira, y entre los
 * dos el MISMO paso de la pantalla (`parseHorarioDoctor` → `cuerpoPut`). Las
 * escrituras se apuntan, ⛔ no hay base. Prisma va por `Module._load` (abajo).
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";

const CLAVE_FLEX = Symbol.for("dalecontrol.agenda.flexible");
const CLAVE_COLUMNAS = Symbol.for("dalecontrol.horarioDoctor.columnasComida");

let comidaFalla: boolean;
/** Lo que hay en la base: comida del lunes (0) al viernes (4). */
let comidas: { dayOfWeek: number; lunchStart: string; lunchEnd: string }[];
/** Los UPDATE de comida que llegaron a la transacción. */
let escriturasComida: { dia: unknown; lunchStart: unknown; lunchEnd: unknown }[];
/** ¿Ya se pegó sql/salamanca-agenda.sql? (la sonda de information_schema) */
let columnas: boolean;

beforeEach(() => {
  comidaFalla = false;
  comidas = [0, 1, 2, 3, 4].map((dayOfWeek) => ({ dayOfWeek, lunchStart: "14:00", lunchEnd: "15:00" }));
  escriturasComida = [];
  columnas = true;
  (globalThis as any)[CLAVE_FLEX] = undefined;
  (globalThis as any)[CLAVE_COLUMNAS] = { existe: true, at: Date.now() };
});

const semanaBase = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
  doctorId: "d1",
  dayOfWeek,
  enabled: dayOfWeek < 5,
  openTime: "09:00",
  closeTime: "18:00",
}));

const prismaStub: any = {
  user: { findFirst: async ({ where }: any) => (where.id === "d1" && where.clinicId === "c1" ? { id: "d1", role: "DOCTOR" } : null) },
  clinicFeatureFlag: {
    findMany: async ({ where }: any) => (where.clinicId === "c1" ? [{ flag: "agenda-flexible", enabled: true }] : []),
  },
  doctorSchedule: {
    findMany: async ({ where }: any) => {
      assert.equal(where.clinicId, "c1");
      return semanaBase;
    },
    upsert: (args: any) => ({ tipo: "upsert", args }),
  },
  $queryRaw: async (strings: TemplateStringsArray, ...valores: unknown[]) => {
    const sql = strings.join("?");
    if (sql.includes("to_regclass")) return [{ existe: true }];
    if (sql.includes("information_schema")) return [{ n: columnas ? 2 : 0 }];
    if (sql.includes('"lunchStart"')) {
      assert.equal(valores[0], "c1", "la comida se lee con el clinicId de la sesión");
      if (comidaFalla) throw Object.assign(new Error("timeout del pooler"), { code: "P1008" });
      return comidas.map((c) => ({ doctorId: "d1", ...c }));
    }
    throw new Error(`SQL inesperado: ${sql}`);
  },
  $executeRaw: (strings: TemplateStringsArray, ...valores: unknown[]) => {
    const sql = strings.join("?");
    assert.match(sql, /UPDATE "doctor_schedules"/);
    // valores: lunchStart, lunchEnd, clinicId, doctorId, dayOfWeek
    assert.equal(valores[2], "c1");
    return { tipo: "comida", dia: valores[4], lunchStart: valores[0], lunchEnd: valores[1] };
  },
  $transaction: async (ops: any[]) => {
    for (const op of ops) if (op?.tipo === "comida") escriturasComida.push({ dia: op.dia, lunchStart: op.lunchStart, lunchEnd: op.lunchEnd });
    return ops;
  },
};

// `service.ts` lleva `import "server-only"` (Next lo resuelve por alias; no
// hay paquete suelto). Como en anulables-cancelada.test.ts y
// agenda-bloqueos/politica.test.ts: se parchea `Module._load` para ese
// paquete, para prisma y para la bitácora.
const Mod = Module as unknown as { _load: (req: string, ...r: unknown[]) => unknown };
const cargaOriginal = Mod._load;
Mod._load = function (req: string, ...r: unknown[]) {
  if (req === "server-only") return {};
  if (req === "@/lib/prisma") return { prisma: prismaStub };
  if (req === "@/lib/audit") return { logAudit: async () => undefined };
  return cargaOriginal.call(this, req, ...r);
};

const ctx: any = {
  clinicId: "c1",
  userId: "u-admin",
  role: "ADMIN",
  puedeGestionar: true,
  clinica: {
    agendaDayStart: 0,
    agendaDayEnd: 24,
    schedules: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, enabled: dayOfWeek < 6, openTime: "08:00", closeTime: "20:00" })),
  },
};

/** GET → lo que hace la pantalla con la respuesta → PUT (el doctor solo cambió el viernes). */
async function abrirCambiarYGuardar() {
  const { verHorario, guardarHorario } = await import("@/lib/horario-doctor/service");
  const { cuerpoPut, parseHorarioDoctor } = await import("@/components/dashboard/horario-doctor/tipos");
  const get = await verHorario(ctx, "d1");
  const dto = parseHorarioDoctor(JSON.parse(JSON.stringify(get)))!;
  const borrador = dto.horario.map((d) => (d.dayOfWeek === 4 ? { ...d, closeTime: "17:00" } : d));
  const put = await guardarHorario(ctx, "d1", cuerpoPut(borrador, dto.comida));
  return { get, dto, put };
}

test("N-A3 · si la comida no se puede leer, el GET no la ofrece (comida: false, comidaIlegible) y guardar NO la borra", async () => {
  comidaFalla = true;
  const { get, dto, put } = await abrirCambiarYGuardar();
  assert.equal(get.comida, false);
  assert.equal(get.comidaIlegible, true);
  assert.equal(get.horario.some((d) => d.lunchStart || d.lunchEnd), false, "nada de campos vacíos que parezcan «sin comida»");
  assert.equal(dto.comida, false, "la pantalla no la enseña");
  assert.equal(dto.comidaIlegible, true, "y avisa");
  assert.deepEqual(escriturasComida, [], "ni un UPDATE de comida: la de la base se queda");
  assert.equal(put.comidaIlegible, true, "la respuesta del guardado sigue avisando");
});

test("N-A3 · control: con la comida legible se ofrece, y guardar la reescribe IGUAL (14:00–15:00 de lunes a viernes)", async () => {
  const { get, dto } = await abrirCambiarYGuardar();
  assert.equal(get.comida, true);
  assert.equal(get.comidaIlegible, undefined);
  assert.equal(dto.horario[0]!.lunchStart, "14:00");
  const porDia = new Map(escriturasComida.map((e) => [e.dia, e]));
  for (const d of [0, 1, 2, 3, 4]) {
    assert.deepEqual(porDia.get(d), { dia: d, lunchStart: "14:00", lunchEnd: "15:00" }, `día ${d}`);
  }
});

test("N-A3 · una pantalla VIEJA que recibe `comida: true` junto a `comidaIlegible` tampoco la ofrece", async () => {
  const { parseHorarioDoctor } = await import("@/components/dashboard/horario-doctor/tipos");
  const dto = parseHorarioDoctor({ hereda: false, horario: semanaBase, comida: true, comidaIlegible: true })!;
  assert.equal(dto.comida, false);
});

test("A8 · la comida solo se escribe en los días que la TRAEN (una llave en null sí la quita)", async () => {
  const { guardarHorario } = await import("@/lib/horario-doctor/service");
  const horario = semanaBase.map(({ doctorId: _d, ...d }) =>
    d.dayOfWeek === 1 ? { ...d, lunchStart: null, lunchEnd: null } : d.dayOfWeek === 2 ? { ...d, lunchStart: "13:00", lunchEnd: "14:00" } : d,
  );
  await guardarHorario(ctx, "d1", { horario });
  assert.deepEqual(
    escriturasComida.sort((a, b) => Number(a.dia) - Number(b.dia)),
    [
      { dia: 1, lunchStart: null, lunchEnd: null },
      { dia: 2, lunchStart: "13:00", lunchEnd: "14:00" },
    ],
  );
});

test("A11 · sin las columnas (el SQL sin pegar), guardar una comida responde 503 con texto de clínica, sin nombres de archivo", async () => {
  const { guardarHorario } = await import("@/lib/horario-doctor/service");
  columnas = false;
  const horario = semanaBase.map(({ doctorId: _d, ...d }) => (d.dayOfWeek === 0 ? { ...d, lunchStart: "14:00", lunchEnd: "15:00" } : d));
  await assert.rejects(guardarHorario(ctx, "d1", { horario }), (e: any) => {
    assert.equal(e.status, 503);
    assert.equal(e.message, "La hora de comida todavía no está disponible. Avisa a soporte.");
    assert.doesNotMatch(e.message, /\.sql/);
    return true;
  });
  assert.deepEqual(escriturasComida, []);
});
