/**
 * ws1-t9 (1-nov-2026) — checklist de inicio: el paso «Agrega un doctor» (id "doctor") se da por HECHO con 2 o más
 * personas ACTIVAS en Equipo, del rol que sea (decisión de Rafael: «2+ personas en Equipo»). Antes solo contaba
 * role='DOCTOR' y una clínica con 4 ADMIN/SUPER_ADMIN seguía viendo «falta».
 *
 * Run: npx tsx --test --experimental-test-module-mocks src/lib/__tests__/onboarding-equipo.test.ts
 *
 * Prisma se sustituye por un doble de `$queryRaw` que (1) guarda el SQL para comprobar el filtro de la subconsulta de
 * usuarios y (2) cuenta sobre una tabla en memoria aplicando ESE filtro (clínica + activo, sin rol).
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

interface U { clinicId: string; role: string; isActive: boolean }
let usuarios: U[] = [];
let sqls: string[] = [];
let llamadas = 0;

function contarUsuarios(sql: string, clinicId: string): number {
  // Lo que la consulta pide de verdad: solo la clínica y los activos; ningún filtro por rol.
  const sub = sql.match(/\(SELECT COUNT\(\*\) FROM users WHERE ([^)]*)\) AS equipo/);
  if (!sub) throw new Error(`no encuentro la subconsulta de equipo en:\n${sql}`);
  const pideActivo = /"isActive" = true/.test(sub[1]);
  const pideRol = /role/.test(sub[1]);
  return usuarios.filter((u) => u.clinicId === clinicId && (!pideActivo || u.isActive) && (!pideRol || u.role === "DOCTOR")).length;
}

const prismaDoble = {
  $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
    llamadas++;
    const sql = strings.join("$");
    sqls.push(sql);
    const clinicId = String(values[0]);
    assert.ok(values.every((v) => v === clinicId), "todas las subconsultas filtran por la misma clínica");
    // El resto de pasos ya hechos: así solo el de equipo decide.
    return [{ equipo: BigInt(contarUsuarios(sql, clinicId)), patients: 3n, appts: 2n, records: 1n, invoices: 1n, schedules: 5n }];
  },
};
mock.module("@/lib/prisma", { namedExports: { prisma: prismaDoble } });
// `cache` de React solo existe en el build de servidor (react-server); fuera de una petición RSC no memoiza nada.
// Se dobla como identidad por Module._load (mock.module de un paquete npm no llega al require CJS de tsx).
const Module = require("node:module") as { _load: (req: string, ...r: unknown[]) => unknown };
const cargarOriginal = Module._load;
Module._load = function (req: string, ...r: unknown[]) {
  const real = cargarOriginal.call(this, req, ...r);
  if (req === "react") return { ...(real as object), cache: <F,>(f: F) => f };
  return real;
};

const mod = () => import("../onboarding-steps-server");

let n = 0;
const clinicaNueva = () => `cli_${++n}`;

test("pasosHechosDeConteos: 1 persona = falta; 2 o más = hecho (umbral EQUIPO_MINIMO = 2)", async () => {
  const { pasosHechosDeConteos, EQUIPO_MINIMO } = await mod();
  assert.equal(EQUIPO_MINIMO, 2);
  const resto = { patients: 0, appts: 0, records: 0, invoices: 0, schedules: 0 };
  assert.deepEqual(pasosHechosDeConteos({ equipo: 0, ...resto }).completed, []);
  assert.deepEqual(pasosHechosDeConteos({ equipo: 1n, ...resto }).completed, []);
  assert.deepEqual(pasosHechosDeConteos({ equipo: 2n, ...resto }).completed, ["doctor"]);
  assert.deepEqual(pasosHechosDeConteos({ equipo: 4n, ...resto }).completed, ["doctor"]);
  // Terminal (lo que se cachea) solo con los 6 en verde: con 1 persona NO es terminal aunque el resto esté hecho.
  const todo = { patients: 1, appts: 1, records: 1, invoices: 1, schedules: 1 };
  assert.equal(pasosHechosDeConteos({ equipo: 1, ...todo }).terminal, false);
  assert.equal(pasosHechosDeConteos({ equipo: 2, ...todo }).terminal, true);
  assert.deepEqual(pasosHechosDeConteos({ equipo: 2, ...todo }).completed, ["doctor", "schedule", "patient", "appointment", "invoice"]);
});

test("la consulta cuenta usuarios ACTIVOS de la clínica, de cualquier rol (no solo DOCTOR)", async () => {
  const { getOnboardingCompleted } = await mod();
  sqls = [];
  await getOnboardingCompleted(clinicaNueva(), false);
  const sub = sqls[0].match(/\(SELECT COUNT\(\*\) FROM users WHERE ([^)]*)\) AS equipo/);
  assert.ok(sub, sqls[0]);
  assert.match(sub[1], /"clinicId" = \$/);
  assert.match(sub[1], /"isActive" = true/);
  assert.doesNotMatch(sub[1], /role/);
});

test("checklist: 1 usuario = falta; 2 activos de cualquier rol = hecho; 2 con uno inactivo = falta", async () => {
  const { getOnboardingCompleted } = await mod();

  const sola = clinicaNueva();
  usuarios = [{ clinicId: sola, role: "SUPER_ADMIN", isActive: true }];
  assert.ok(!(await getOnboardingCompleted(sola, false)).includes("doctor"), "solo el dueño: falta");

  // El caso de Smile: 4 personas ADMIN/SUPER_ADMIN, ningún DOCTOR.
  const smile = clinicaNueva();
  usuarios = [
    { clinicId: smile, role: "SUPER_ADMIN", isActive: true },
    { clinicId: smile, role: "ADMIN", isActive: true },
    { clinicId: smile, role: "ADMIN", isActive: true },
    { clinicId: smile, role: "SUPER_ADMIN", isActive: true },
  ];
  assert.ok((await getOnboardingCompleted(smile, false)).includes("doctor"), "4 admins: hecho");

  const dos = clinicaNueva();
  usuarios = [{ clinicId: dos, role: "SUPER_ADMIN", isActive: true }, { clinicId: dos, role: "RECEPTIONIST", isActive: true }];
  assert.ok((await getOnboardingCompleted(dos, false)).includes("doctor"), "dueño + recepción: hecho");

  const inactivo = clinicaNueva();
  usuarios = [{ clinicId: inactivo, role: "SUPER_ADMIN", isActive: true }, { clinicId: inactivo, role: "DOCTOR", isActive: false }];
  assert.ok(!(await getOnboardingCompleted(inactivo, false)).includes("doctor"), "2 pero uno inactivo: falta");

  // Los de OTRA clínica no cuentan.
  const ajena = clinicaNueva();
  usuarios = [{ clinicId: ajena, role: "SUPER_ADMIN", isActive: true }, { clinicId: "otra", role: "DOCTOR", isActive: true }];
  assert.ok(!(await getOnboardingCompleted(ajena, false)).includes("doctor"), "uno propio + uno ajeno: falta");
});

test("caché del terminal: con 1 persona nunca se cachea (cada visita consulta fresco); con 2 sí, y sigue dando todo hecho", async () => {
  const { getOnboardingCompleted } = await mod();
  const c = clinicaNueva();
  usuarios = [{ clinicId: c, role: "SUPER_ADMIN", isActive: true }];
  llamadas = 0;
  await getOnboardingCompleted(c, false);
  usuarios.push({ clinicId: c, role: "DOCTOR", isActive: true });
  const segunda = await getOnboardingCompleted(c, true);
  assert.equal(llamadas, 2, "sin terminal no hay caché: la 2.ª visita vuelve a contar y ve al nuevo miembro");
  assert.deepEqual(segunda, ["doctor", "schedule", "patient", "appointment", "invoice", "whatsapp"]);
  const tercera = await getOnboardingCompleted(c, false);
  assert.equal(llamadas, 2, "terminal cacheado: no vuelve a consultar");
  assert.deepEqual(tercera, ["doctor", "schedule", "patient", "appointment", "invoice"]);
});
