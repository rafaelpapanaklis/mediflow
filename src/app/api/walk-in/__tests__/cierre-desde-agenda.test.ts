/**
 * FILA DE WALK-IN — se cierra también cuando su cita se cierra por la Agenda (ws1-t1, 3-oct-2026).
 *
 * Run: npm run test:walk-in-cierre-desde-agenda
 *
 * Antes solo «Completar»/«Cancelar» en la fila cerraban la cita; al revés no: completar, cancelar o marcar
 * «No asistió» la cita en la Agenda (o «Terminar consulta» en la ficha) dejaba la fila «En atención». Con el
 * código viejo el módulo no existe y las tres rutas no lo llaman.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const INICIO = new Date("2026-10-03T16:00:00.000Z");
let filas: any[];
let citas: any[];
let ligas: Record<string, string>; // filaId → appointmentId (columna de sql/ws1-t4-walkin-cita.sql)
let sinColumna: boolean;
let crudas: number;

beforeEach(() => {
  (globalThis as any).__walkInSinLiga = undefined;
  filas = [
    { id: "w1", clinicId: "c1", patientId: "p1", status: "IN_PROGRESS", startedAt: new Date(INICIO), completedAt: null },
    { id: "w-ajena", clinicId: "c2", patientId: "p1", status: "IN_PROGRESS", startedAt: new Date(INICIO), completedAt: null },
    { id: "w-espera", clinicId: "c1", patientId: "p2", status: "WAITING", startedAt: null, completedAt: null },
  ];
  citas = [
    { id: "cita-walkin", clinicId: "c1", patientId: "p1", startedAt: new Date(INICIO) },
    { id: "cita-normal", clinicId: "c1", patientId: "p1", startedAt: new Date("2026-10-03T18:00:00.000Z") },
    { id: "cita-sin-empezar", clinicId: "c1", patientId: "p2", startedAt: null },
  ];
  ligas = {};
  sinColumna = true;
  crudas = 0;
});

// `$executeRaw` como tagged template: se reconstruye el SQL para saber qué estado escribe.
function executeRaw(partes: TemplateStringsArray, ...valores: any[]) {
  crudas++;
  if (sinColumna) return Promise.reject(new Error('column "appointmentId" does not exist'));
  const sql = partes.join("?");
  const [clinicId, appointmentId] = sql.includes('"completedAt" = ?') ? valores.slice(1) : valores;
  let n = 0;
  for (const f of filas) {
    if (f.clinicId === clinicId && ligas[f.id] === appointmentId && f.status === "IN_PROGRESS") {
      f.status = sql.includes("'COMPLETED'") ? "COMPLETED" : "CANCELLED";
      if (f.status === "COMPLETED") f.completedAt = valores[0];
      n++;
    }
  }
  return Promise.resolve(n);
}

(mock as any).module("@/lib/prisma", {
  namedExports: {
    prisma: {
      $executeRaw: executeRaw,
      appointment: {
        findFirst: async (a: any) => {
          assert.ok(a.where.clinicId, "toda lectura de citas lleva clínica");
          const c = citas.find((x) => x.id === a.where.id && x.clinicId === a.where.clinicId);
          return c ? { patientId: c.patientId, startedAt: c.startedAt } : null;
        },
      },
      walkInQueue: {
        updateMany: async (a: any) => {
          assert.ok(a.where.clinicId, "toda escritura de la fila lleva clínica");
          let n = 0;
          for (const f of filas) {
            if (
              f.clinicId === a.where.clinicId &&
              f.patientId === a.where.patientId &&
              f.status === a.where.status &&
              f.startedAt?.getTime() === a.where.startedAt.getTime()
            ) {
              Object.assign(f, a.data);
              n++;
            }
          }
          return { count: n };
        },
      },
    },
  },
});

const fila = (id: string) => filas.find((f) => f.id === id);

test("completar la cita de un walk-in en la Agenda completa su fila (sin la columna de la liga)", async () => {
  const { cerrarFilaDeLaCita } = await import("@/lib/walk-in/cerrar-fila-de-la-cita");
  const ahora = new Date("2026-10-03T16:25:00.000Z");
  assert.equal(await cerrarFilaDeLaCita({ clinicId: "c1", appointmentId: "cita-walkin", estado: "COMPLETED", ahora }), 1);
  assert.equal(fila("w1").status, "COMPLETED");
  assert.equal(fila("w1").completedAt.getTime(), ahora.getTime());
  assert.equal(fila("w-ajena").status, "IN_PROGRESS", "otra clínica no se toca");
});

test("cancelar o «No asistió» en la Agenda cancela la fila", async () => {
  const { cerrarFilaDeLaCita } = await import("@/lib/walk-in/cerrar-fila-de-la-cita");
  assert.equal(await cerrarFilaDeLaCita({ clinicId: "c1", appointmentId: "cita-walkin", estado: "CANCELLED" }), 1);
  assert.equal(fila("w1").status, "CANCELLED");
  fila("w1").status = "IN_PROGRESS";
  assert.equal(await cerrarFilaDeLaCita({ clinicId: "c1", appointmentId: "cita-walkin", estado: "NO_SHOW" }), 1);
  assert.equal(fila("w1").status, "CANCELLED");
});

test("con la columna de la liga se cierra ESA fila, sin buscar por paciente; sin columna se pregunta una sola vez", async () => {
  const { cerrarFilaDeLaCita } = await import("@/lib/walk-in/cerrar-fila-de-la-cita");
  await cerrarFilaDeLaCita({ clinicId: "c1", appointmentId: "cita-normal", estado: "COMPLETED" });
  await cerrarFilaDeLaCita({ clinicId: "c1", appointmentId: "cita-normal", estado: "COMPLETED" });
  assert.equal(crudas, 1, "sin la columna, el SQL crudo falla una vez por proceso y no se repite");

  (globalThis as any).__walkInSinLiga = undefined;
  sinColumna = false;
  ligas = { w1: "cita-normal" };
  assert.equal(await cerrarFilaDeLaCita({ clinicId: "c1", appointmentId: "cita-normal", estado: "CANCELLED" }), 1);
  assert.equal(fila("w1").status, "CANCELLED");
  assert.equal(fila("w-ajena").status, "IN_PROGRESS");
});

test("una cita normal (sin fila con su mismo inicio), una sin empezar o un estado que no cierra: nada cambia", async () => {
  const { cerrarFilaDeLaCita } = await import("@/lib/walk-in/cerrar-fila-de-la-cita");
  assert.equal(await cerrarFilaDeLaCita({ clinicId: "c1", appointmentId: "cita-normal", estado: "COMPLETED" }), 0);
  assert.equal(await cerrarFilaDeLaCita({ clinicId: "c1", appointmentId: "cita-sin-empezar", estado: "CANCELLED" }), 0);
  assert.equal(await cerrarFilaDeLaCita({ clinicId: "c1", appointmentId: "cita-walkin", estado: "IN_CHAIR" }), 0);
  assert.equal(await cerrarFilaDeLaCita({ clinicId: "", appointmentId: "cita-walkin", estado: "COMPLETED" }), 0);
  assert.equal(await cerrarFilaDeLaCita({ clinicId: "c2", appointmentId: "cita-walkin", estado: "COMPLETED" }), 0, "la cita de otra clínica no existe para c2");
  assert.deepEqual(filas.map((f) => f.status), ["IN_PROGRESS", "IN_PROGRESS", "WAITING"]);
});

test("una fila que ya se cerró desde la fila no se reabre ni se cambia", async () => {
  const { cerrarFilaDeLaCita } = await import("@/lib/walk-in/cerrar-fila-de-la-cita");
  fila("w1").status = "COMPLETED";
  assert.equal(await cerrarFilaDeLaCita({ clinicId: "c1", appointmentId: "cita-walkin", estado: "CANCELLED" }), 0);
  assert.equal(fila("w1").status, "COMPLETED");
});

// Guarda de código fuente: las tres puertas de la Agenda que cierran una cita llaman al cierre de la fila, y
// DESPUÉS de su transacción (un error de SQL dentro la abortaría entera).
const PUERTAS = [
  { ruta: "src/app/api/appointments/[id]/status/route.ts", nombre: "estado desde la Agenda (completar, cancelar, no asistió)" },
  { ruta: "src/app/api/appointments/[id]/complete/route.ts", nombre: "«Terminar consulta»" },
  { ruta: "src/app/api/appointments/[id]/route.ts", nombre: "cancelar la cita (DELETE)" },
];
for (const p of PUERTAS) {
  test(`la puerta ${p.nombre} cierra la fila después de su transacción`, () => {
    const src = readFileSync(join(process.cwd(), p.ruta), "utf8");
    assert.match(src, /import \{ cerrarFilaDeLaCita \} from "@\/lib\/walk-in\/cerrar-fila-de-la-cita"/);
    const llamada = src.indexOf("await cerrarFilaDeLaCita(");
    assert.ok(llamada > 0, "llama al cierre de la fila");
    assert.ok(src.lastIndexOf("$transaction(", llamada) > 0 && src.lastIndexOf("$transaction(", llamada) < llamada);
  });
}

test("la Agenda cierra la fila al completar, cancelar y «No asistió», no en cada cambio de estado", () => {
  const src = readFileSync(join(process.cwd(), "src/app/api/appointments/[id]/status/route.ts"), "utf8");
  assert.match(src, /if \(body\.status === "COMPLETED" \|\| closesAppointment\) \{\s*await cerrarFilaDeLaCita\(/);
  assert.match(src, /const closesAppointment = body\.status === "CANCELLED" \|\| body\.status === "NO_SHOW";/);
});
