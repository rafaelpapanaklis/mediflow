/**
 * WS1-T5 · Dar de alta un paciente se valida en el SERVIDOR.
 * Hallazgos N7 y N8 del mapa de escritura de Sabina (13-sep-2026).
 *
 * Run: npm run test:alta-paciente
 *   (--experimental-test-module-mocks: se ejecuta el POST /api/patients DE
 *   VERDAD, llamado como lo haría cualquiera que no es el formulario. También
 *   son reales `getAuthContext`, `buildPatientWhere`, la regla de visibilidad,
 *   el permiso y el cotejo de duplicados. Sólo se sustituyen Prisma, la sesión
 *   de Supabase y los efectos de después del alta.)
 *
 * N7 — el POST no validaba el cuerpo. Sin nombre, con fecha o género inválidos
 *   llegaba a Prisma y salía un 500 con el mensaje interno de Prisma; con nombre
 *   "" se guardaba un paciente sin nombre. El modal lo tapaba en el navegador.
 *
 * N8 — la guarda de duplicados buscaba candidatos con `buildPatientWhere`, que
 *   para un DOCTOR es «solo mis pacientes». Un doctor que daba de alta a un
 *   paciente de otro doctor no recibía el aviso y el expediente se partía en
 *   dos. La guarda mira ahora toda la clínica, pero al doctor no le devuelve
 *   datos de pacientes que están fuera de su alcance.
 *
 * El Prisma falso se porta como el real en lo que importa aquí: evalúa el
 * `where` (AND/OR, `in`, `visibleUserIds`, citas y notas del doctor) y el
 * `create` rechaza lo mismo que rechaza Prisma (campo obligatorio ausente,
 * fecha inválida, valor fuera del enum, tipos equivocados). Un `where` que no
 * sabe evaluar LANZA: así una prueba no puede pasar por accidente.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

/* ─── la clínica de prueba ─────────────────────────────────────────────── */

const CLINICA = "cli_1";
const OTRA_CLINICA = "cli_2";

type Rol = "ADMIN" | "RECEPTIONIST" | "DOCTOR";
const usuarios: Record<string, { id: string; role: Rol; clinicId: string }> = {
  admin: { id: "u_admin", role: "ADMIN", clinicId: CLINICA },
  recepcion: { id: "u_recep", role: "RECEPTIONIST", clinicId: CLINICA },
  drA: { id: "u_drA", role: "DOCTOR", clinicId: CLINICA },
  drB: { id: "u_drB", role: "DOCTOR", clinicId: CLINICA },
};
let sesion: keyof typeof usuarios = "recepcion";

interface Fila {
  id: string;
  clinicId: string;
  patientNumber: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  deletedAt: Date | null;
  visibleUserIds: string[];
  primaryDoctorId: string | null;
  doctoresConCita: string[];
  doctoresConNota: string[];
}

const fila = (f: Partial<Fila> & Pick<Fila, "id" | "firstName" | "lastName">): Fila => ({
  clinicId: CLINICA,
  patientNumber: "P0000",
  phone: null,
  deletedAt: null,
  visibleUserIds: [],
  primaryDoctorId: null,
  doctoresConCita: [],
  doctoresConNota: [],
  ...f,
});

const PADRON: Fila[] = [
  // Paciente de la Dra. A, sin lista de visibilidad: lo ve todo el equipo,
  // pero NO está en la lista «mis pacientes» del Dr. B. Es el caso de N8.
  fila({ id: "pat_juan", patientNumber: "P0007", firstName: "Juan", lastName: "Pérez",
         phone: "+52 55 1234 5678", primaryDoctorId: "u_drA", doctoresConCita: ["u_drA"] }),
  // Otro paciente de la Dra. A, con segundo apellido: «Pedro Gómez» + su
  // teléfono es duplicado por nombre de pila + teléfono, no por nombre completo.
  fila({ id: "pat_pedro", patientNumber: "P0015", firstName: "Pedro", lastName: "Gómez Ruiz",
         phone: "55 3333 4444", primaryDoctorId: "u_drA" }),
  // Paciente propio del Dr. B.
  fila({ id: "pat_ana", patientNumber: "P0011", firstName: "Ana", lastName: "García",
         phone: "5511112222", primaryDoctorId: "u_drB" }),
  // RESTRINGIDA a la Dra. A: para el Dr. B y para recepción no existe.
  fila({ id: "pat_rosa", patientNumber: "P0023", firstName: "Rosa", lastName: "Luna",
         phone: "55 9876 5432", visibleUserIds: ["u_drA"] }),
  // Homónimo en OTRA clínica: jamás puede disparar el aviso aquí.
  fila({ id: "pat_marta_otra", clinicId: OTRA_CLINICA, patientNumber: "P0001",
         firstName: "Marta", lastName: "Ruiz", phone: "5500001111" }),
  // Cancelado por ARCO (anonimizado): no cuenta como duplicado.
  fila({ id: "pat_luis_arco", patientNumber: "P0030", firstName: "Luis", lastName: "Soto",
         deletedAt: new Date("2026-01-01") }),
];

/* ─── Prisma falso ─────────────────────────────────────────────────────── */

function cumple(f: Fila, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (k === "AND") {
      if (!(Array.isArray(v) ? v : [v]).every((w) => cumple(f, w))) return false;
    } else if (k === "OR") {
      if (!(v as any[]).some((w) => cumple(f, w))) return false;
    } else if (k === "appointments" || k === "records") {
      const some = (v as any)?.some;
      if (!some || Object.keys(some).join() !== "doctorId") throw new Error(`where no soportado: ${k}`);
      const ids = k === "appointments" ? f.doctoresConCita : f.doctoresConNota;
      if (!ids.includes(some.doctorId)) return false;
    } else if (k === "visibleUserIds") {
      if ((v as any).isEmpty === true) { if (f.visibleUserIds.length !== 0) return false; }
      else if (typeof (v as any).has === "string") { if (!f.visibleUserIds.includes((v as any).has)) return false; }
      else throw new Error("where no soportado: visibleUserIds");
    } else if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if (Object.keys(v).join() !== "in") throw new Error(`where no soportado: ${k}`);
      if (!(v as any).in.includes((f as any)[k])) return false;
    } else if ((f as any)[k] !== v) {
      return false;
    }
  }
  return true;
}

function proyectar(f: Fila, select: any) {
  if (!select) return { ...f };
  const out: any = {};
  for (const k of Object.keys(select)) {
    if (!(k in f)) throw new Error(`select no soportado: ${k}`);
    out[k] = (f as any)[k];
  }
  return out;
}

/** Lo que el `create` real de Prisma rechaza con PrismaClientValidationError. */
function validarComoPrisma(data: any) {
  const falla = (msg: string) => {
    throw Object.assign(new Error(`\nInvalid \`prisma.patient.create()\` invocation:\n\n${msg}`), {
      name: "PrismaClientValidationError",
    });
  };
  for (const k of ["firstName", "lastName"]) {
    if (typeof data[k] !== "string") falla(`Argument \`${k}\` is missing.`);
  }
  if (data.dob !== null && !(data.dob instanceof Date && !isNaN(data.dob.getTime()))) {
    falla("Invalid value for argument `dob`: Provided Date object is invalid. Expected Date.");
  }
  if (!["M", "F", "OTHER"].includes(data.gender)) {
    falla(`Invalid value for argument \`gender\`. Expected Gender.`);
  }
  for (const k of ["allergies", "chronicConditions", "tags"]) {
    if (!Array.isArray(data[k]) || data[k].some((x: unknown) => typeof x !== "string")) {
      falla(`Invalid value provided. Expected String[], provided ${typeof data[k]}.`);
    }
  }
  if (typeof data.isChild !== "boolean") falla("Argument `isChild`: Invalid value provided. Expected Boolean.");
  for (const k of ["email", "phone", "bloodType", "address", "notes", "primaryDoctorId",
                   "familyHistory", "personalNonPathologicalHistory"]) {
    if (data[k] !== null && typeof data[k] !== "string") falla(`Argument \`${k}\`: Expected String or Null.`);
  }
}

let creados: any[] = [];

const prismaFalso: any = {
  user: {
    findFirst: async ({ where }: any) => {
      const u = Object.values(usuarios).find((x) => `sb_${x.id}` === where.supabaseId);
      if (!u) return null;
      return {
        ...u,
        supabaseId: `sb_${u.id}`,
        isActive: true,
        color: null,
        totpEnabled: false,
        permissionsOverride: [],
        clinic: { id: u.clinicId, category: "DENTAL", require2fa: false },
      };
    },
    findMany: async () => [],
  },
  patient: {
    findMany: async ({ where, select }: any) =>
      PADRON.filter((f) => cumple(f, where)).map((f) => proyectar(f, select)),
    create: async ({ data }: any) => {
      validarComoPrisma(data);
      creados.push(data);
      return { id: `pat_nuevo_${creados.length}`, portalToken: "secreto", ...data };
    },
  },
};

/* ─── módulos sustituidos ──────────────────────────────────────────────── */

mock.module("@/lib/prisma", { namedExports: { prisma: prismaFalso } });

// La sesión: lo que devuelve Supabase y lo que rodea a getAuthContext. La
// función en sí es la real.
mock.module("@/lib/supabase/server", {
  namedExports: {
    createClient: () => ({
      auth: { getUser: async () => ({ data: { user: { id: `sb_${usuarios[sesion].id}` } } }) },
    }),
  },
});
mock.module("@/lib/active-clinic", {
  namedExports: { readActiveClinicCookie: () => null, logClinicFallback: () => {} },
});
mock.module("@/lib/plan-status", {
  namedExports: { isPlanExpired: () => false, isApiPathBlockedForExpiredPlan: () => false },
});
mock.module("@/lib/auth/two-factor-cookie", { namedExports: { hasValidTwoFactorCookie: () => true } });
mock.module("@/lib/auth/two-factor-gate", {
  namedExports: { needsTwoFactor: () => false, isApiPathBlockedForMissingTwoFactor: () => false },
});
mock.module("@/lib/auth/two-factor-identity", {
  namedExports: { personaTieneDosFactores: async () => false },
});

// `@/lib/branches` y `@/lib/patient-quota` importan "server-only", que sólo
// existe dentro del bundle de Next. El cupo no es lo que se prueba aquí.
mock.module("@/lib/branches", {
  namedExports: { getPatientVisibility: async () => ({ clinicIds: [CLINICA], otherClinicNames: {} }) },
});
mock.module("@/lib/patient-quota", {
  namedExports: { getPatientQuota: async () => ({ canCreate: true, max: null, used: 0, unlimited: true }) },
});

class PatientNumberExhaustedError extends Error {
  code = "PATIENT_NUMBER_EXHAUSTED";
}
mock.module("@/lib/patients/next-patient-number", {
  namedExports: {
    nextPatientNumber: async () => "P0999",
    withPatientNumberRetry: async (fn: () => Promise<unknown>) => fn(),
    PatientNumberExhaustedError,
  },
});

// La búsqueda normalizada es SQL crudo. Aquí se emula su contrato: ids de las
// clínicas pedidas —SIN filtro de visibilidad, igual que la real— donde cada
// término aparece en el nombre, el folio o el teléfono.
mock.module("@/lib/patients/patient-search", {
  namedExports: {
    findPatientIdsBySearch: async ({ clinicIds, tokens }: any) => {
      const plano = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
      return PADRON.filter((f) => clinicIds.includes(f.clinicId))
        .filter((f) => tokens.every((t: any) => {
          const texto = plano(`${f.firstName} ${f.lastName} ${f.patientNumber}`);
          return texto.includes(t.text) || (t.digits && (f.phone ?? "").replace(/\D/g, "").includes(t.digits));
        }))
        .map((f) => f.id);
    },
  },
});
mock.module("@/lib/audit", { namedExports: { logMutation: async () => {} } });
mock.module("@/lib/cache/revalidate", { namedExports: { revalidateAfter: () => {} } });
mock.module("@/lib/whatsapp/inbox-log", { namedExports: { linkOrphanThreadsToPatient: async () => {} } });

/* ─── llamar al POST ───────────────────────────────────────────────────── */

async function alta(quien: keyof typeof usuarios, cuerpo: unknown, crudo = false) {
  sesion = quien;
  const { NextRequest } = await import("next/server");
  const mod: any = await import("@/app/api/patients/route");
  const req = new NextRequest("https://dalecontrol.test/api/patients", {
    method: "POST",
    body: crudo ? (cuerpo as string) : JSON.stringify(cuerpo),
    headers: { "content-type": "application/json" },
  } as any);
  const res = await mod.POST(req);
  const texto = await res.text();
  let body: any = {};
  try { body = JSON.parse(texto); } catch { /* cuerpo no JSON */ }
  return { status: res.status as number, body, texto };
}

beforeEach(() => {
  creados = [];
});

/** Un 400 claro: con `error` legible, sin tripas de Prisma y sin escribir nada. */
function esErrorClaro(r: { status: number; body: any; texto: string }, campo: string) {
  assert.equal(r.status, 400, `respondió ${r.status}: ${r.texto}`);
  assert.equal(typeof r.body.error, "string", "el 400 tiene que traer un `error` legible");
  assert.equal(r.body.field, campo, `el error debería señalar el campo ${campo}: ${r.texto}`);
  assert.ok(!/prisma|invocation|Argument `/i.test(r.texto), `se coló el mensaje interno de Prisma: ${r.texto}`);
  assert.equal(creados.length, 0, "no debería haberse escrito ningún paciente");
}

/* ══════════════════════════════════════════════════════════════════════
 * N7 · el cuerpo se valida en el servidor
 * ══════════════════════════════════════════════════════════════════════ */

test("N7 · sin nombre → 400 claro (antes: 500 con el mensaje de Prisma)", async () => {
  esErrorClaro(await alta("recepcion", { lastName: "Pérez", phone: "5512345678" }), "firstName");
});

test("N7 · sin apellido → 400 claro", async () => {
  esErrorClaro(await alta("recepcion", { firstName: "Juana" }), "lastName");
});

test('N7 · nombre "" → 400 (antes: se GUARDABA un paciente sin nombre)', async () => {
  esErrorClaro(await alta("recepcion", { firstName: "", lastName: "Sin Nombre" }), "firstName");
});

test("N7 · nombre de puros espacios → 400", async () => {
  esErrorClaro(await alta("recepcion", { firstName: "   ", lastName: "Espacios" }), "firstName");
});

test("N7 · nombre que no es texto → 400", async () => {
  esErrorClaro(await alta("recepcion", { firstName: 42, lastName: "Número" }), "firstName");
});

for (const dob of ["no-es-fecha", "2024-13-01", "2023-02-30", "2023-02-30T00:00:00Z", "abc 2020", "1", 19900510, "2999-01-01", "1850-01-01"]) {
  test(`N7 · fecha de nacimiento ${JSON.stringify(dob)} → 400 (antes: 500 o fecha basura)`, async () => {
    esErrorClaro(await alta("recepcion", { firstName: "Leo", lastName: "Fecha", dob }), "dob");
  });
}

for (const gender of ["X", "hombrecito", 1, true]) {
  test(`N7 · género ${JSON.stringify(gender)} → 400 (antes: 500 con el mensaje de Prisma)`, async () => {
    esErrorClaro(await alta("recepcion", { firstName: "Leo", lastName: "Género", gender }), "gender");
  });
}

test("N7 · listas que no son listas de texto → 400, no 500", async () => {
  esErrorClaro(await alta("recepcion", { firstName: "Leo", lastName: "Listas", allergies: "penicilina" }), "allergies");
  esErrorClaro(await alta("recepcion", { firstName: "Leo", lastName: "Listas", tags: ["VIP", 3] }), "tags");
});

test("N7 · campos de texto con tipo equivocado → 400, no 500", async () => {
  esErrorClaro(await alta("recepcion", { firstName: "Leo", lastName: "Tipos", phone: 5512345678 }), "phone");
  esErrorClaro(await alta("recepcion", { firstName: "Leo", lastName: "Tipos", isChild: "sí" }), "isChild");
});

test("N7 · CURP o pasaporte más largos que su columna → 400, no 500", async () => {
  esErrorClaro(
    await alta("recepcion", { firstName: "Leo", lastName: "Curp", curpStatus: "PENDING", curp: "X".repeat(30) }),
    "curp",
  );
  esErrorClaro(
    await alta("recepcion", { firstName: "Leo", lastName: "Pasaporte", curpStatus: "FOREIGN", passportNo: "P".repeat(25) }),
    "passportNo",
  );
  // "ß" mide 1 y en mayúsculas mide 2: se mide lo que se va a guardar.
  esErrorClaro(
    await alta("recepcion", { firstName: "Leo", lastName: "Eszett", curpStatus: "PENDING", curp: "ß".repeat(10) }),
    "curp",
  );
});

test("N7 · una fecha ISO con hora sigue siendo válida", async () => {
  const r = await alta("recepcion", { firstName: "Iris", lastName: "Hora", dob: "1995-11-03T00:00:00.000Z" });
  assert.equal(r.status, 201, r.texto);
  assert.equal(creados[0].dob.toISOString(), "1995-11-03T00:00:00.000Z");
});

test("N7 · cuerpo que no es JSON, o que no es un objeto → 400", async () => {
  const r1 = await alta("recepcion", "{esto no es json", true);
  assert.equal(r1.status, 400, r1.texto);
  const r2 = await alta("recepcion", [{ firstName: "Leo", lastName: "Lista" }]);
  assert.equal(r2.status, 400, r2.texto);
  assert.equal(creados.length, 0);
});

/* ─── lo que NO se puede romper: los llamadores de hoy ─────────────────── */

test("N7 · el cuerpo EXACTO del modal «Nuevo paciente» sigue creando igual", async () => {
  // Copia de lo que arma new-patient-modal.tsx: `...form` con sus cadenas
  // vacías, más las alergias partidas, CURP pendiente y sin visibilidad.
  const cuerpoDelModal = {
    firstName: "Beatriz", lastName: "Ortega", email: "", phone: "55 4444 3333", gender: "F",
    dob: "1988-07-21", address: "", allergies: ["N/A"], notes: "", isChild: false,
    curp: null, curpStatus: "PENDING", passportNo: null,
    source: "", lifecycleStage: "patient",
    emergencyContactName: "", emergencyContactPhone: "", emergencyContactRelation: "",
  };
  const r = await alta("recepcion", cuerpoDelModal);
  assert.equal(r.status, 201, r.texto);
  assert.equal(creados.length, 1);
  const d = creados[0];
  assert.equal(d.firstName, "Beatriz");
  assert.equal(d.lastName, "Ortega");
  assert.equal(d.gender, "F");
  assert.equal(d.dob.toISOString(), "1988-07-21T00:00:00.000Z");
  assert.deepEqual(d.allergies, ["N/A"]);
  assert.equal(d.email, "", "el modal manda email vacío y hoy se guarda tal cual: no se cambia aquí");
  assert.equal(d.curpStatus, "PENDING");
  assert.equal(r.body.portalToken, undefined, "la respuesta sigue sin secretos");
});

test("N7 · el modal con CURP completo y extranjero con pasaporte siguen pasando", async () => {
  const base = { firstName: "Iker", lastName: "Mora", gender: "M", dob: "2001-01-09", phone: "5510101010", allergies: ["Látex"] };
  const r1 = await alta("recepcion", { ...base, curpStatus: "COMPLETE", curp: "MOAI010109HDFRKR09", passportNo: null });
  assert.equal(r1.status, 201, r1.texto);
  const r2 = await alta("recepcion", { ...base, lastName: "Mora Two", curpStatus: "FOREIGN", curp: null, passportNo: "G12345678" });
  assert.equal(r2.status, 201, r2.texto);
});

test("N7 · un alta con SOLO nombre y apellido sigue siendo válida (alta rápida)", async () => {
  // Obligatorio de verdad en el servidor = nombre y apellido: son NOT NULL en
  // la base, y el resto de caminos que crean pacientes (aceptar solicitud,
  // bot de WhatsApp, portal) los crean sin fecha, género ni alergias.
  const r = await alta("recepcion", { firstName: "Tomás", lastName: "Rápido" });
  assert.equal(r.status, 201, r.texto);
  assert.equal(creados[0].gender, "OTHER");
  assert.equal(creados[0].dob, null);
  assert.deepEqual(creados[0].allergies, []);
});

test("N7 · el nombre se guarda sin espacios sobrantes", async () => {
  const r = await alta("recepcion", { firstName: "  Elsa ", lastName: " Vega  " });
  assert.equal(r.status, 201, r.texto);
  assert.equal(creados[0].firstName, "Elsa");
  assert.equal(creados[0].lastName, "Vega");
});

test('N7 · género con alias histórico ("MALE") se normaliza al enum, como en el PATCH', async () => {
  const r = await alta("recepcion", { firstName: "Raúl", lastName: "Alias", gender: "MALE" });
  assert.equal(r.status, 201, r.texto);
  assert.equal(creados[0].gender, "M");
});

test("N7 · fecha, género y teléfono vacíos o null cuentan como «no lo dijo»", async () => {
  const r = await alta("recepcion", { firstName: "Nora", lastName: "Vacía", dob: "", gender: "", phone: null });
  assert.equal(r.status, 201, r.texto);
  assert.equal(creados[0].dob, null);
  assert.equal(creados[0].gender, "OTHER");
});

/* ══════════════════════════════════════════════════════════════════════
 * N8 · la guarda de duplicados mira TODA la clínica, sin fugar datos
 * ══════════════════════════════════════════════════════════════════════ */

/** Nada del expediente ajeno puede aparecer en la respuesta. */
function sinDatosDe(r: { texto: string }, f: Fila) {
  assert.ok(!r.texto.includes(f.id), `la respuesta trae el id del paciente ajeno: ${r.texto}`);
  assert.ok(!r.texto.includes(f.patientNumber), `la respuesta trae el folio del paciente ajeno: ${r.texto}`);
  const digitos = (f.phone ?? "").replace(/\D/g, "").slice(-8);
  if (digitos) {
    assert.ok(!r.texto.replace(/\D/g, "").includes(digitos), `la respuesta trae el teléfono del paciente ajeno: ${r.texto}`);
  }
}

const juan = PADRON.find((f) => f.id === "pat_juan")!;
const rosa = PADRON.find((f) => f.id === "pat_rosa")!;

test("N8 · DOCTOR que da de alta al paciente de OTRO doctor → 409 (antes: se creaba el duplicado)", async () => {
  const r = await alta("drB", { firstName: "Juan", lastName: "Perez", phone: "5500000000" });
  assert.equal(r.status, 409, `el Dr. B no recibió el aviso: ${r.texto}`);
  assert.equal(r.body.code, "DUPLICATE_PATIENT", "el modal reconoce el aviso por este código");
  assert.equal(creados.length, 0, "se creó el duplicado");
});

test("N8 · …y ese 409 NO le devuelve datos del paciente ajeno", async () => {
  const r = await alta("drB", { firstName: "Juan", lastName: "Pérez" });
  assert.equal(r.status, 409, r.texto);
  assert.deepEqual(r.body.duplicates, [], "no puede listar fichas que el doctor no tiene en su alcance");
  assert.equal(r.body.hasHiddenDuplicates, true, "sí dice que existe en la clínica, sin decir cuántos");
  sinDatosDe(r, juan);
});

test("N8 · por teléfono + nombre de pila también avisa al doctor, sin datos", async () => {
  const pedro = PADRON.find((f) => f.id === "pat_pedro")!;
  const r = await alta("drB", { firstName: "Pedro", lastName: "Gómez", phone: "5533334444" });
  assert.equal(r.status, 409, r.texto);
  assert.deepEqual(r.body.duplicates, []);
  assert.equal(r.body.hasHiddenDuplicates, true);
  sinDatosDe(r, pedro);
});

test("N8 · el modal sigue pudiendo crear igual tras confirmar (allowDuplicate)", async () => {
  const r = await alta("drB", { firstName: "Juan", lastName: "Pérez", allowDuplicate: true });
  assert.equal(r.status, 201, r.texto);
  assert.equal(creados.length, 1);
});

test("N8 · a quien SÍ tiene al paciente en su alcance se le siguen dando los datos (admin)", async () => {
  const r = await alta("admin", { firstName: "juan", lastName: "perez" });
  assert.equal(r.status, 409, r.texto);
  assert.equal(r.body.duplicates.length, 1);
  assert.deepEqual(r.body.duplicates[0], {
    id: "pat_juan", patientNumber: "P0007", fullName: "Juan Pérez", phone: "+52 55 1234 5678",
  });
  assert.equal(r.body.hasHiddenDuplicates, false);
});

test("N8 · y a la Dra. A, dueña del paciente, también", async () => {
  const r = await alta("drA", { firstName: "Juan", lastName: "Pérez" });
  assert.equal(r.status, 409, r.texto);
  assert.equal(r.body.duplicates[0]?.id, "pat_juan");
});

test("N8 · un paciente propio del doctor sigue saliendo con datos", async () => {
  const r = await alta("drB", { firstName: "Ana", lastName: "Garcia" });
  assert.equal(r.status, 409, r.texto);
  assert.equal(r.body.duplicates[0]?.id, "pat_ana");
});

test("N8 · paciente RESTRINGIDO a otro: con solo el nombre no se confirma que existe", async () => {
  // La visibilidad por paciente promete que, para quien no está en la lista,
  // el paciente NO existe (404, nunca 403). Preguntar por un nombre en el alta
  // no puede servir para averiguarlo.
  const r = await alta("drB", { firstName: "Rosa", lastName: "Luna" });
  assert.equal(r.status, 201, r.texto);
  const r2 = await alta("recepcion", { firstName: "Rosa", lastName: "Luna" });
  assert.equal(r2.status, 201, r2.texto);
});

test("N8 · paciente RESTRINGIDO a otro: con nombre Y teléfono sí avisa, sin datos", async () => {
  const r = await alta("drB", { firstName: "Rosa", lastName: "Luna", phone: "5598765432" });
  assert.equal(r.status, 409, r.texto);
  assert.deepEqual(r.body.duplicates, []);
  assert.equal(r.body.hasHiddenDuplicates, true);
  sinDatosDe(r, rosa);
  // Y el mensaje es el MISMO que para un paciente no restringido: la respuesta
  // no distingue «es de otro doctor» de «está restringido».
  const noRestringido = await alta("drB", { firstName: "Juan", lastName: "Pérez", phone: "5512345678" });
  assert.equal(r.body.error, noRestringido.body.error);
});

test("N8 · un homónimo de OTRA clínica nunca dispara el aviso", async () => {
  const r = await alta("drB", { firstName: "Marta", lastName: "Ruiz", phone: "5500001111" });
  assert.equal(r.status, 201, r.texto);
});

test("N8 · un paciente cancelado por ARCO no cuenta como duplicado", async () => {
  const r = await alta("admin", { firstName: "Luis", lastName: "Soto" });
  assert.equal(r.status, 201, r.texto);
});
