/**
 * La confirmación del alta contra el POST /api/patients DE VERDAD.
 *
 * Run: npm run test:sabina-alta-paciente
 *   (--experimental-test-module-mocks)
 *
 * registrar-paciente.test.ts prueba la propuesta y la traducción de respuestas
 * con un endpoint de mentira. Esta prueba cierra el hueco que eso deja: que las
 * respuestas que traduce la confirmación son las que de verdad da el handler, y
 * que el handler recibe lo que la propuesta dice que va a mandar. Se ejecuta el
 * route handler entero, a través de `llamarAltaEnProceso` —el mismo adaptador
 * que usará producción—.
 *
 * Qué corre DE VERDAD: el handler, `validatePatientCreateBody`,
 * `splitPatientDuplicates`, `isProbablePatientDuplicate`, `buildPatientWhere`,
 * `canSeePatient`, `denyIfMissingPermission` y `stripPatientSecrets`. Las
 * consultas de Prisma las evalúa el doble de base (./doble-base), que interpreta
 * los `where` como Prisma.
 *
 * Qué se sustituye, y por qué no importa para lo que se prueba:
 *  · `getAuthContext` — sin Supabase no hay sesión; se inyecta la del usuario.
 *    Se sustituye SOLO esa función: `buildPatientWhere` es el real (se carga el
 *    módulo verdadero antes de sustituirlo y se re-exporta).
 *  · la búsqueda SQL sin acentos — la evalúa ./busqueda-falsa en memoria.
 *  · `patient.create`, folio, cupo del plan, bitácora, revalidación y enlace de
 *    WhatsApp — efectos que no deciden la respuesta (salvo el cupo, que se
 *    prueba poniéndolo a tope).
 */

import { before, test, mock } from "node:test";
import assert from "node:assert/strict";

import { crearBase, type BaseDoble, type Datos, type Fila } from "./doble-base";
import { conBusqueda, idsQueCasan } from "./busqueda-falsa";
import { CL_NORTE, CL_SUR, TZ_NORTE, U_ADMIN_N, U_DOC2_N, U_DOC_N } from "./siembra";
import type { SabinaCtx } from "../../tipos";

/* ── el mundo ───────────────────────────────────────────────────────── */

const datos: Datos = {
  clinics: [{ id: CL_NORTE, timezone: TZ_NORTE }, { id: CL_SUR, timezone: TZ_NORTE }],
  users: [
    { id: U_ADMIN_N, clinicId: CL_NORTE, role: "ADMIN", isActive: true },
    { id: U_DOC_N, clinicId: CL_NORTE, role: "DOCTOR", isActive: true },
    { id: U_DOC2_N, clinicId: CL_NORTE, role: "DOCTOR", isActive: true },
  ],
  patients: [],
  appointments: [],
  records: [],
};
const doble: BaseDoble = conBusqueda(crearBase(datos), datos.patients!);

/** Lo que el handler intentó escribir. */
const creados: Fila[] = [];
let crearLanza: Error | null = null;
const bitacora: Array<{ ip?: string | null; ua?: string | null; entityId: string }> = [];
let cupo = { canCreate: true, max: 500, used: 10 };
/** La sesión que ve el handler. */
let sesionDelHandler: any = null;

const prismaFalso: any = {
  patient: {
    findMany: (args: any) => doble.patient.findMany(args),
    count: (args: any) => doble.patient.count(args),
    create: async ({ data }: any) => {
      if (crearLanza) throw crearLanza;
      const fila = { id: `p-creado-${creados.length + 1}`, createdAt: new Date(), deletedAt: null, status: "ACTIVE", ...data };
      creados.push(fila);
      return fila;
    },
  },
  user: { findMany: async () => [] },
  $queryRaw: (q: any) => doble.$queryRaw(q),
};

mock.module("@/lib/auth/two-factor-identity", {
  namedExports: { personaTieneDosFactores: async () => false, dosFactoresDeLaPersona: async () => false },
});
mock.module("@/lib/prisma", { namedExports: { prisma: prismaFalso } });
mock.module("@/lib/patients/patient-search", {
  namedExports: {
    buildPatientSearchSql: (args: unknown) => ({ __busqueda: args }),
    findPatientIdsBySearch: async (args: any) =>
      args.clinicIds.length === 0 || args.tokens.length === 0
        ? null
        : idsQueCasan(datos.patients!, { ...args, limit: args.limit ?? 5000 }),
  },
});
mock.module("@/lib/patient-quota", { namedExports: { getPatientQuota: async () => cupo } });
mock.module("@/lib/branches", {
  namedExports: { getPatientVisibility: async () => ({ clinicIds: [CL_NORTE] }) },
});
mock.module("@/lib/audit", {
  namedExports: {
    logMutation: async (o: any) => {
      bitacora.push({
        ip: o.req.headers.get("x-forwarded-for"),
        ua: o.req.headers.get("user-agent"),
        entityId: o.entityId,
      });
    },
  },
});
mock.module("@/lib/cache/revalidate", { namedExports: { revalidateAfter: () => {} } });
mock.module("@/lib/whatsapp/inbox-log", { namedExports: { linkOrphanThreadsToPatient: async () => {} } });
mock.module("@/lib/patients/next-patient-number", {
  namedExports: {
    nextPatientNumber: async () => `P0${100 + creados.length}`,
    withPatientNumberRetry: async (fn: () => Promise<unknown>) => fn(),
    PatientNumberExhaustedError: class PatientNumberExhaustedError extends Error {
      code = "PATIENT_NUMBER_EXHAUSTED";
    },
    isPatientNumberConflict: () => false,
  },
});

/* ── carga, en este orden ───────────────────────────────────────────── */

// Sin `await` de primer nivel: `tsx --test` transpila a CommonJS.
let comoAuthContext: typeof import("../base").comoAuthContext;
let correrHerramienta: typeof import("../base").correrHerramienta;
let registrarPaciente: typeof import("../registrar-paciente").registrarPaciente;
let confirmarRegistroPaciente: typeof import("../registrar-paciente-confirmar").confirmarRegistroPaciente;
let llamarAltaEnProceso: typeof import("../registrar-paciente-http").llamarAltaEnProceso;

before(async () => {
  // 1. El auth-context VERDADERO, para quedarse con su `buildPatientWhere`.
  const authReal: any = await import("@/lib/auth-context");
  // 2. Se sustituye solo `getAuthContext`; lo demás es el módulo real.
  mock.module("@/lib/auth-context", {
    namedExports: { ...authReal, getAuthContext: async () => sesionDelHandler },
  });
  // 3. Ya con eso, lo que se prueba.
  ({ comoAuthContext, correrHerramienta } = await import("../base"));
  ({ registrarPaciente } = await import("../registrar-paciente"));
  ({ confirmarRegistroPaciente } = await import("../registrar-paciente-confirmar"));
  ({ llamarAltaEnProceso } = await import("../registrar-paciente-http"));
});

/* ── utilidades ─────────────────────────────────────────────────────── */

function sesion(over: Partial<SabinaCtx> = {}): SabinaCtx {
  return {
    clinicId: CL_NORTE, userId: U_ADMIN_N, role: "ADMIN", permissionsOverride: [],
    timezone: TZ_NORTE, clinicCategory: "DENTAL", db: doble, ...over,
  };
}
const admin = () => sesion();
const doctor = () => sesion({ userId: U_DOC_N, role: "DOCTOR" });

/** La petición con la que el usuario «toca confirmar». */
const confirmacion = new Request("https://dalecontrol.test/api/sabina/confirmar", {
  method: "POST",
  headers: { "user-agent": "Navegador-de-la-doctora", "x-forwarded-for": "201.1.2.3" },
});

function reiniciar(pacientes: Fila[] = []) {
  datos.patients!.length = 0;
  datos.patients!.push(...pacientes);
  creados.length = 0;
  bitacora.length = 0;
  crearLanza = null;
  cupo = { canCreate: true, max: 500, used: 10 };
}

/** El paciente del doctor 2, que el doctor 1 no tiene a su alcance. */
const juanDelDoctor2: Fila = {
  id: "p-juan", clinicId: CL_NORTE, firstName: "Juan", lastName: "Pérez López", phone: "+52 55 1234 5678",
  patientNumber: "P0031", primaryDoctorId: U_DOC2_N, visibleUserIds: [], deletedAt: null, status: "ACTIVE",
};

const juan = { nombre: "Juan", apellidos: "Perez lopez", telefono: "5512345678", alergias: ["penicilina"] };

async function proponer(ctx: SabinaCtx, params: Record<string, unknown>) {
  const r = await correrHerramienta(registrarPaciente, ctx, params);
  assert.equal(r.ok, true, JSON.stringify(r));
  return (r as any).datos;
}

/** Confirma como `ctx`, con el handler viendo la MISMA sesión (salvo que se diga otra). */
async function confirmar(ctx: SabinaCtx, propuesta: any, opcionId: string, sesionHandler?: SabinaCtx) {
  sesionDelHandler = comoAuthContext(sesionHandler ?? ctx);
  return confirmarRegistroPaciente({ ctx, propuesta, opcionId, llamar: llamarAltaEnProceso(confirmacion) });
}

/* ══════════════════════════════════════════════════════════════════════ */

test("201: la confirmación llega al POST real y crea exactamente lo propuesto, en la clínica de la sesión", async () => {
  reiniciar();
  const ctx = admin();
  const propuesta = await proponer(ctx, { nombre: " Sofía ", apellidos: "Núñez", telefono: "55 8888 7777", alergias: ["ninguna"] });
  const r = await confirmar(ctx, propuesta, "crear");

  assert.equal(r.estado, "creado", JSON.stringify(r));
  assert.equal(creados.length, 1);
  const fila = creados[0];
  assert.equal(fila.clinicId, CL_NORTE, "el clinicId sale de la sesión del handler");
  assert.equal(fila.firstName, "Sofía");
  assert.equal(fila.lastName, "Núñez");
  assert.equal(fila.phone, "55 8888 7777");
  assert.deepEqual(fila.allergies, ["N/A"]);
  assert.equal(fila.gender, "OTHER");
  if (r.estado === "creado") {
    assert.equal(r.paciente.pacienteId, fila.id);
    assert.equal(r.paciente.folio, fila.patientNumber);
  }
  // La bitácora del alta apunta a quien confirmó.
  assert.deepEqual(bitacora, [{ ip: "201.1.2.3", ua: "Navegador-de-la-doctora", entityId: fila.id }]);
});

test("🔴 409 real con el gemelo fuera de alcance: la confirmación pregunta, no crea y no fuga", async () => {
  reiniciar();
  const ctx = doctor();
  // La tarjeta se armó cuando aún no existía el gemelo…
  const propuesta = await proponer(ctx, juan);
  assert.deepEqual(propuesta.opciones.map((o: any) => o.tipo), ["crear", "cancelar"]);
  // …y antes del toque, recepción dio de alta a Juan como paciente del doctor 2.
  datos.patients!.push({ ...juanDelDoctor2 });

  const r = await confirmar(ctx, propuesta, "crear");

  assert.equal(r.estado, "duplicado", JSON.stringify(r));
  assert.equal(creados.length, 0, "se creó el gemelo");
  if (r.estado !== "duplicado") return;
  assert.equal(r.http, 409);
  assert.deepEqual(r.propuesta.opciones.map((o) => o.tipo), ["usar_existente", "crear_a_sabiendas", "cancelar"]);
  assert.equal(r.propuesta.duplicados.hayOcultos, true);
  assert.deepEqual(r.propuesta.duplicados.visibles, []);
  const todo = JSON.stringify(r);
  for (const fuga of ["p-juan", "P0031", "+52 55 1234 5678", "Pérez López"]) {
    assert.equal(todo.indexOf(fuga), -1, `se fugó «${fuga}»`);
  }

  // Y la propuesta, armada ahora, dice LO MISMO que el servidor.
  const otraVez = await proponer(ctx, juan);
  assert.deepEqual(otraVez.duplicados, r.propuesta.duplicados);
});

test("🔴 409 real con el gemelo a la vista: pregunta con su ficha, y la propuesta coincide con el servidor", async () => {
  reiniciar();
  const ctx = admin();
  const propuesta = await proponer(ctx, juan);
  datos.patients!.push({ ...juanDelDoctor2 });

  const r = await confirmar(ctx, propuesta, "crear");
  assert.equal(r.estado, "duplicado", JSON.stringify(r));
  assert.equal(creados.length, 0);
  if (r.estado !== "duplicado") return;
  assert.deepEqual(r.propuesta.duplicados.visibles, [
    { pacienteId: "p-juan", folio: "P0031", nombre: "Juan Pérez López", telefonoFinal: "…5678" },
  ]);
  assert.equal(r.propuesta.opciones[0].id, "usar:p-juan");

  const otraVez = await proponer(ctx, juan);
  assert.deepEqual(otraVez.duplicados, r.propuesta.duplicados);

  // Y «usar el que existe» sobre esa nueva pregunta no toca el endpoint.
  const usar = await confirmar(ctx, r.propuesta, "usar:p-juan");
  assert.equal(usar.estado, "usar_existente");
  assert.equal(creados.length, 0);
});

test("crear a sabiendas contra el POST real: pasa la guarda con allowDuplicate y crea UNO", async () => {
  reiniciar([{ ...juanDelDoctor2 }]);
  const ctx = admin();
  const propuesta = await proponer(ctx, juan);
  assert.equal(propuesta.duplicados.visibles.length, 1);

  const r = await confirmar(ctx, propuesta, "crear_a_sabiendas");
  assert.equal(r.estado, "creado", JSON.stringify(r));
  assert.equal(creados.length, 1);
});

test("400 real: un dato que el validador del servidor rechaza vuelve como `datos_invalidos`, sin crear", async () => {
  reiniciar();
  const ctx = admin();
  const propuesta = await proponer(ctx, { ...juan, fechaNacimiento: "1990-01-01" });
  // Una propuesta guardada que alguien alteró: el servidor sigue siendo la última palabra.
  const alterada = { ...propuesta, cuerpo: { ...propuesta.cuerpo, dob: "2023-02-30" } };
  const r = await confirmar(ctx, alterada, "crear");
  assert.equal(r.estado, "datos_invalidos", JSON.stringify(r));
  if (r.estado === "datos_invalidos") {
    assert.equal(r.campo, "dob");
    assert.equal(r.http, 400);
  }
  assert.equal(creados.length, 0);
});

test("🔴 403 real: si al handler le quitaron `patients.create`, la confirmación dice `sin_permiso`", async () => {
  reiniciar();
  const ctx = admin();
  const propuesta = await proponer(ctx, juan);
  const sinLlave = sesion({ role: "RECEPTIONIST", permissionsOverride: ["patients.view"] });
  const r = await confirmar(ctx, propuesta, "crear", sinLlave);
  assert.equal(r.estado, "sin_permiso", JSON.stringify(r));
  assert.equal(creados.length, 0);
});

test("402 real: con el cupo del plan lleno, `tope_plan` con el límite, sin crear", async () => {
  reiniciar();
  cupo = { canCreate: false, max: 200, used: 200 };
  const ctx = doctor();
  const propuesta = await proponer(ctx, juan);
  const r = await confirmar(ctx, propuesta, "crear");
  assert.equal(r.estado, "tope_plan", JSON.stringify(r));
  if (r.estado === "tope_plan") {
    assert.equal(r.limite, 200);
    assert.equal(r.esAdmin, false);
  }
  assert.equal(creados.length, 0);
});

test("500 real: el handler devuelve el mensaje de Prisma, y la confirmación NO lo repite", async () => {
  reiniciar();
  crearLanza = Object.assign(new Error("Invalid `prisma.patient.create()` invocation: connection reset"), { code: "P1017" });
  const ctx = admin();
  const propuesta = await proponer(ctx, juan);
  const r = await confirmar(ctx, propuesta, "crear");
  assert.equal(r.estado, "error", JSON.stringify(r));
  assert.equal(JSON.stringify(r).toLowerCase().indexOf("prisma"), -1);
});
