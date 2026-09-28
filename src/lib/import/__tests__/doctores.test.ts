/**
 * ws1-t12 — DOCTORES/PROFESIONALES MIGRADOS (doctorsHandler, archivo nuevo
 * src/lib/import/doctores/handler.ts).
 *
 * Run: npx tsx --test --experimental-test-module-mocks src/lib/import/__tests__/doctores.test.ts
 *
 * Prisma sustituido por el doble en memoria (doble-prisma.ts). El cliente
 * admin de Supabase se sustituye por un doble propio: cada createUser()
 * genera un id fresco y falla si el correo "ya existe" (para probar el
 * emparejamiento por cuenta duplicada), sin tocar ninguna red de verdad.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { crearBase, type Base } from "./doble-prisma";

const CLINICA = "cli_A";
const IMPORTA = "u_admin";

function semilla() {
  return {
    clinic: [{ id: CLINICA, name: "Clínica Sonrisa", plan: "BASIC", planOverrideFor: null, maxUsersOverride: null, maxClinicsOverride: null, priceMxnMonthlyOverride: null, priceMxnAnnualOverride: null }],
    user: [
      { id: IMPORTA, clinicId: CLINICA, email: "admin@clinica.com", firstName: "Rafael", lastName: "Admin", isActive: true, color: "#3b82f6", cedulaProfesional: null, especialidad: null, phone: null },
      { id: "u_existente", clinicId: CLINICA, email: "mariana@clinica.com", firstName: "Mariana", lastName: "Cortés", isActive: true, color: "#7c3aed", cedulaProfesional: null, especialidad: null, phone: null },
    ],
  };
}

let base: Base = crearBase(semilla());
let correosYaRegistrados = new Set<string>(["ocupado@otraclinica.com"]);
let sbCreados: Array<{ email: string }> = [];

mock.module("@/lib/prisma", { namedExports: { prisma: new Proxy({}, { get: (_t, k: string) => base.prisma[k] }) } });
mock.module("@/lib/audit", { namedExports: { logAudit: async () => {} } });
mock.module("../doctores/supabase-admin", {
  namedExports: {
    getAdminClient: () => ({
      auth: {
        admin: {
          createUser: async (args: { email: string }) => {
            if (correosYaRegistrados.has(args.email)) {
              return { data: null, error: { message: "Email address already been registered" } };
            }
            sbCreados.push({ email: args.email });
            return { data: { user: { id: `sb_${sbCreados.length}` } }, error: null };
          },
        },
      },
    }),
  },
});
// getPlanLimitsForClinic lee PlanConfig de la base real (fuera del alcance del
// doble): se sustituye por un límite fijo alto, salvo en la prueba de cupo.
let maxUsersFijo: number | null = 100;
mock.module("@/lib/plans", { namedExports: { getPlanLimitsForClinic: async () => ({ maxUsers: maxUsersFijo }) } });

const engine = () => import("../engine");
const manejador = () => import("../doctores/handler");

function reiniciar() {
  base = crearBase(semilla());
  sbCreados = [];
  correosYaRegistrados = new Set(["ocupado@otraclinica.com"]);
  maxUsersFijo = 100;
}

const csv = (nombre: string, texto: string) => new File([texto], nombre, { type: "text/csv" });
const tabla = (m: string) => base.tablas[m] ?? [];
const fila = (res: any, n: number) => res.preview.find((r: any) => r.row === n);

async function correr(file: File, opts: { dryRun?: boolean; skipDuplicates?: boolean } = { dryRun: true }): Promise<any> {
  const { runImport } = await engine();
  const { doctorsHandler } = await manejador();
  return runImport(doctorsHandler, {
    file, clinicId: CLINICA, userId: IMPORTA, role: "ADMIN",
    dryRun: opts.dryRun ?? true, skipDuplicates: opts.skipDuplicates ?? true,
    columnMapping: null, origin: null, valueMapping: null, sheet: null,
  });
}

const CABECERA = "nombre,apellido,email,celular,cedula,especialidad";

test("crea un doctor nuevo: cuenta de Supabase SIN invitación, mustChangePassword, isActive", async () => {
  reiniciar();
  const texto = [CABECERA, "Carlos,Nuñez,carlos@clinica.com,5551112222,12345678,Ortodoncia"].join("\n");
  const hecho = await correr(csv("doc1.csv", texto), { dryRun: false });
  assert.equal(hecho.created, 1);
  assert.equal(sbCreados.length, 1, "llamó a Supabase createUser exactamente una vez");
  assert.equal(sbCreados[0].email, "carlos@clinica.com");

  const nuevo = tabla("user").find((u: any) => u.email === "carlos@clinica.com");
  assert.ok(nuevo, "se creó el User");
  assert.equal(nuevo.mustChangePassword, true, "pendiente de activar: nunca inicia sesión sola");
  assert.equal(nuevo.isActive, true);
  assert.equal(nuevo.role, "DOCTOR");
  assert.equal(nuevo.cedulaProfesional, "12345678");
});

test("empareja por correo existente: NO crea cuenta nueva, solo completa los datos que faltaban", async () => {
  reiniciar();
  const texto = [CABECERA, "Mariana,Cortés,mariana@clinica.com,5550000000,99887766,Endodoncia"].join("\n");
  const hecho = await correr(csv("doc2.csv", texto), { dryRun: false });
  assert.equal(hecho.created, 1, "cuenta como éxito, pero sin crear cuenta");
  assert.equal(sbCreados.length, 0, "no llamó a Supabase: ya existe");
  assert.equal(tabla("user").length, 2, "sigue habiendo solo los 2 doctores de siempre");
  const mariana = tabla("user").find((u: any) => u.id === "u_existente");
  assert.equal(mariana.cedulaProfesional, "99887766", "se completó la cédula que le faltaba");
});

test("sin correo NI cédula: error, no se adivina", async () => {
  reiniciar();
  const texto = [CABECERA, "Sin Datos,Apellido,,,,"].join("\n");
  const prev = await correr(csv("doc3.csv", texto), { dryRun: true });
  assert.equal(fila(prev, 2).status, "error");
  assert.match(fila(prev, 2).errors.join(" · "), /correo o cédula/);
});

test("sin correo pero con cédula que NO existe: error (no se puede crear cuenta sin correo)", async () => {
  reiniciar();
  const texto = [CABECERA, "Nueva Doctora,Apellido,,5551234567,55443322,General"].join("\n");
  const prev = await correr(csv("doc4.csv", texto), { dryRun: true });
  assert.equal(fila(prev, 2).status, "error");
  assert.match(fila(prev, 2).errors.join(" · "), /sin correo no se puede crear/);
});

test("correo ya registrado en Supabase (otra clínica): la fila queda en error, no rompe el lote", async () => {
  reiniciar();
  const texto = [CABECERA, "Carlos,Nuñez,ocupado@otraclinica.com,5551112222,12345678,Ortodoncia"].join("\n");
  const hecho = await correr(csv("doc5.csv", texto), { dryRun: false });
  assert.equal(hecho.created, 0);
  assert.equal(tabla("user").length, 2, "no se creó nada");
});

test("límite de usuarios del plan alcanzado: la fila se marca error y no se crea", async () => {
  reiniciar();
  maxUsersFijo = 2; // ya hay 2 usuarios activos (admin + Mariana)
  const texto = [CABECERA, "Carlos,Nuñez,carlos@clinica.com,5551112222,12345678,Ortodoncia"].join("\n");
  const prev = await correr(csv("doc6.csv", texto), { dryRun: true });
  assert.equal(fila(prev, 2).status, "error");
  assert.match(fila(prev, 2).errors.join(" · "), /Límite de usuarios del plan/);
});

test("doctor deshabilitado en el origen: isActive=false y NO cuenta contra el cupo del plan", async () => {
  reiniciar();
  maxUsersFijo = 2; // sin cupo para uno activo más
  const texto = [CABECERA, "Ex Doctor,Apellido,exdoc@clinica.com,5551112222,12345678,General,No"].join("\n");
  // La columna "activo" no está en CABECERA: se agrega aparte para esta prueba.
  const cab2 = CABECERA + ",activo";
  const texto2 = [cab2, "Ex Doctor,Apellido,exdoc@clinica.com,5551112222,12345678,General,No"].join("\n");
  const hecho = await correr(csv("doc7.csv", texto2), { dryRun: false });
  assert.equal(hecho.created, 1, "sí se crea: no consume cupo");
  const nuevo = tabla("user").find((u: any) => u.email === "exdoc@clinica.com");
  assert.equal(nuevo.isActive, false);
});

test("doctor repetido en el archivo (mismo correo dos veces): la segunda fila es duplicado", async () => {
  reiniciar();
  const texto = [
    CABECERA,
    "Carlos,Nuñez,carlos@clinica.com,5551112222,12345678,Ortodoncia",
    "Carlos,Nuñez,carlos@clinica.com,5551112222,12345678,Ortodoncia",
  ].join("\n");
  const prev = await correr(csv("doc8.csv", texto), { dryRun: true });
  assert.equal(fila(prev, 2).status, "ok");
  assert.equal(fila(prev, 3).status, "duplicate");
});
