/**
 * `registrar_paciente` — Sabina PROPONE el alta; el usuario la CONFIRMA.
 *
 * Run: npm run test:sabina-alta-paciente
 *
 * Lo que fija esta prueba, en el orden en que importa:
 *
 *  1. La herramienta propone y NO escribe: ni una operación de escritura en la
 *     base, ni una llamada al endpoint. Escribir es de la fase 2.
 *  2. El duplicado no es un error: es una pregunta con TRES caminos —usar el que
 *     existe, crear otro a sabiendas, cancelar—, tanto si lo ve la propuesta
 *     como si lo dice el 409 del servidor al confirmar.
 *  3. El aviso no fuga la ficha de un paciente que el usuario no puede ver.
 *  4. Sin `patients.create`, `sin_permiso`.
 *  5. `allowDuplicate` solo viaja con un «es otra persona» elegido por el
 *     usuario, y no a ciegas: si desde la propuesta apareció otro gemelo, se
 *     vuelve a preguntar.
 *
 * El criterio de duplicado (`isProbablePatientDuplicate`), el reparto que no
 * fuga (`splitPatientDuplicates`), `buildPatientWhere`, `canSeePatient` y el
 * validador del cuerpo (`validatePatientCreateBody`) corren DE VERDAD: son las
 * mismas funciones que usa POST /api/patients. Lo único simulado es el SQL de la
 * búsqueda sin acentos (./busqueda-falsa) y, en la fase 2, el endpoint —que se
 * ejecuta de verdad en registrar-paciente-ruta.test.ts—.
 */

import "./preparar-alta";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { correrHerramienta } from "../base";
import { buscarDuplicados, registrarPaciente, type PropuestaAlta } from "../registrar-paciente";
import {
  confirmarRegistroPaciente,
  type LlamarAlta,
  type RespuestaAlta,
} from "../registrar-paciente-confirmar";
import { crearBase, type BaseDoble, type Datos, type Fila } from "./doble-base";
import { conBusqueda } from "./busqueda-falsa";
import { CL_NORTE, CL_SUR, TZ_NORTE, TZ_SUR, U_ADMIN_N, U_DOC2_N, U_DOC_N, U_RECEP_N } from "./siembra";
import type { SabinaCtx } from "../../tipos";

/* ── la siembra ─────────────────────────────────────────────────────── */

function pacientes(): Fila[] {
  const p = (over: Fila): Fila => ({
    clinicId: CL_NORTE, status: "ACTIVE", visibleUserIds: [], deletedAt: null,
    primaryDoctorId: null, email: null, createdAt: new Date(0), ...over,
  });
  return [
    // Paciente del OTRO doctor, sin restricción: un doctor no lo tiene «a su alcance».
    p({ id: "p-juan", firstName: "Juan", lastName: "Pérez López", phone: "+52 55 1234 5678",
        patientNumber: "P0031", primaryDoctorId: U_DOC2_N }),
    // Paciente del doctor de la sesión.
    p({ id: "p-ana", firstName: "Ana", lastName: "García", phone: "5511112222",
        patientNumber: "P0040", primaryDoctorId: U_DOC_N }),
    // RESTRINGIDO: solo lo ve el doctor 2.
    p({ id: "p-luis", firstName: "Luis", lastName: "Mora", phone: "5533334444",
        patientNumber: "P0050", visibleUserIds: [U_DOC2_N], primaryDoctorId: U_DOC2_N }),
    // Borrado por ARCO: no existe para nadie.
    p({ id: "p-marta", firstName: "Marta", lastName: "Ruiz", phone: "5566667777",
        patientNumber: "P0060", deletedAt: new Date(0) }),
    // De la clínica de al lado.
    p({ id: "p-pedro", clinicId: CL_SUR, firstName: "Pedro", lastName: "Soto", phone: "5599990000",
        patientNumber: "S0001" }),
  ];
}

function sembrar(opciones: { falla?: boolean; extra?: Fila[] } = {}): { db: BaseDoble; datos: Datos } {
  const datos: Datos = {
    clinics: [
      { id: CL_NORTE, timezone: TZ_NORTE, agendaDayStart: 8, agendaDayEnd: 20 },
      { id: CL_SUR, timezone: TZ_SUR, agendaDayStart: 8, agendaDayEnd: 20 },
    ],
    users: [
      { id: U_ADMIN_N, clinicId: CL_NORTE, role: "ADMIN" },
      { id: U_DOC_N, clinicId: CL_NORTE, role: "DOCTOR" },
      { id: U_DOC2_N, clinicId: CL_NORTE, role: "DOCTOR" },
      { id: U_RECEP_N, clinicId: CL_NORTE, role: "RECEPTIONIST" },
    ],
    patients: [...pacientes(), ...(opciones.extra ?? [])],
    appointments: [],
    records: [],
  };
  const db = conBusqueda(crearBase(datos), datos.patients!, { falla: opciones.falla });
  return { db, datos };
}

function sesion(db: BaseDoble, over: Partial<SabinaCtx> = {}): SabinaCtx {
  return {
    clinicId: CL_NORTE, userId: U_ADMIN_N, role: "ADMIN", permissionsOverride: [],
    timezone: TZ_NORTE, clinicCategory: "DENTAL", db, ...over,
  };
}
const admin = (db: BaseDoble) => sesion(db);
const doctor = (db: BaseDoble) => sesion(db, { userId: U_DOC_N, role: "DOCTOR" });
const doctor2 = (db: BaseDoble) => sesion(db, { userId: U_DOC2_N, role: "DOCTOR" });
const recepcion = (db: BaseDoble) => sesion(db, { userId: U_RECEP_N, role: "RECEPTIONIST" });

const ESCRITURAS = ["create", "createMany", "update", "updateMany", "delete", "deleteMany", "upsert"];
const escrituras = (db: BaseDoble) => db.contador.llamadas.filter((l) => ESCRITURAS.indexOf(l.op) !== -1);

const nuevo = {
  nombre: "Sofía",
  apellidos: "Núñez",
  telefono: "55 8888 7777",
  alergias: ["ninguna"],
};
const juan = { nombre: "Juan", apellidos: "Perez lopez", telefono: "5512345678", alergias: ["penicilina"] };

async function proponer(ctx: SabinaCtx, params: Record<string, unknown>): Promise<PropuestaAlta> {
  const r = await correrHerramienta(registrarPaciente, ctx, params);
  assert.equal(r.ok, true, `la propuesta falló: ${JSON.stringify(r)}`);
  return (r as { ok: true; datos: PropuestaAlta }).datos;
}

/** Un endpoint de mentira que apunta lo que recibe y contesta lo que se le diga. */
function endpoint(respuesta: RespuestaAlta | (() => RespuestaAlta) | Error) {
  const llamadas: Array<Record<string, unknown>> = [];
  const llamar: LlamarAlta = async (cuerpo) => {
    llamadas.push(cuerpo);
    if (respuesta instanceof Error) throw respuesta;
    return typeof respuesta === "function" ? respuesta() : respuesta;
  };
  return { llamar, llamadas };
}

const creado = (over: Fila = {}): RespuestaAlta => ({
  status: 201,
  cuerpo: { id: "p-nuevo", patientNumber: "P0101", firstName: "Sofía", lastName: "Núñez", ...over },
});

const tipos = (p: PropuestaAlta) => p.opciones.map((o) => o.tipo);

/* ══════════════════════════════════════════════════════════════════════
 * FASE 1 · PROPONER
 * ══════════════════════════════════════════════════════════════════════ */

test("🔴 propone y NO escribe: devuelve qué daría de alta, sin tocar la base ni el endpoint", async () => {
  const { db } = sembrar();
  const r = await correrHerramienta(registrarPaciente, recepcion(db), nuevo);

  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) return;
  const p = r.datos;
  assert.equal(p.accion, "registrar_paciente");
  assert.deepEqual(p.cuerpo, {
    firstName: "Sofía",
    lastName: "Núñez",
    phone: "55 8888 7777",
    // «ninguna» se guarda como lo guarda el modal de la pantalla.
    allergies: ["N/A"],
  });
  assert.deepEqual(tipos(p), ["crear", "cancelar"]);
  assert.equal(p.pregunta, null);
  assert.equal(p.reversible.reversible, false, "la tarjeta tiene que decir ANTES que no se deshace");
  assert.match(p.reversible.como, /archivar/i);
  // Lo que no se capturó se dice, no se inventa.
  assert.deepEqual(p.sinCapturar, ["fecha de nacimiento", "género", "correo"]);
  assert.match(r.resumen, /confirm/i, "el resumen tiene que dejar claro que NO está hecho");

  assert.deepEqual(escrituras(db), [], "la propuesta escribió en la base");
});

test("🔴 la herramienta de la fase 1 no puede escribir ni por descuido: no importa el endpoint ni Prisma", () => {
  const fuente = readFileSync(join(__dirname, "..", "registrar-paciente.ts"), "utf8");
  assert.doesNotMatch(fuente, /@\/app\/api/, "la propuesta importa un route handler");
  assert.doesNotMatch(fuente, /registrar-paciente-http/, "la propuesta importa el adaptador que escribe");
  assert.doesNotMatch(fuente, /from "@\/lib\/prisma"/, "la propuesta usa el prisma real en vez de ctx.db");
  // `<cliente>.<modelo>.<escritura>(`: `db.patient.create(`, `prisma.patient.updateMany(`…
  assert.doesNotMatch(fuente, /\.\w+\.(create|update|upsert|delete)\w*\(/, "la propuesta llama a una escritura");
  assert.match("ctx.db.patient.create({", /\.\w+\.(create|update|upsert|delete)\w*\(/, "la guarda de arriba tiene que morder");
});

test("🔴 sin `patients.create` → `sin_permiso` con su key, y no se consulta nada", async () => {
  const { db } = sembrar();
  const ctx = sesion(db, { userId: U_RECEP_N, role: "RECEPTIONIST", permissionsOverride: ["patients.view"] });
  const r = await correrHerramienta(registrarPaciente, ctx, nuevo);
  assert.deepEqual(r, { ok: false, motivo: "sin_permiso", permiso: "patients.create" });
  assert.equal(db.contador.llamadas.length, 0);
});

test("faltan datos: sin teléfono o sin alergias no hay propuesta, y se dice qué falta", async () => {
  const { db } = sembrar();
  const ctx = recepcion(db);
  const casos: Array<[Record<string, unknown>, RegExp]> = [
    [{ ...nuevo, telefono: undefined }, /telefono/],
    [{ ...nuevo, telefono: "12345" }, /telefono/],
    [{ ...nuevo, alergias: undefined }, /alergias/],
    [{ ...nuevo, alergias: [] }, /alergias/],
    [{ ...nuevo, alergias: ["ninguna", "penicilina"] }, /alergias/],
    [{ ...nuevo, apellidos: "   " }, /apellidos/],
    // Estas dos las rechaza el MISMO validador que el POST.
    [{ ...nuevo, fechaNacimiento: "2023-02-30" }, /dob/],
    [{ ...nuevo, fechaNacimiento: "2999-01-01" }, /futuro/],
  ];
  for (const [params, motivo] of casos) {
    const r = await correrHerramienta(registrarPaciente, ctx, params);
    assert.equal(r.ok, false, `se propuso con ${JSON.stringify(params)}`);
    assert.equal((r as any).motivo, "error");
    assert.match((r as any).detalle, /parametros_invalidos/);
    assert.match((r as any).detalle, motivo);
  }
  assert.equal(db.contador.llamadas.length, 0, "se consultó la base con datos incompletos");
});

test("lo opcional viaja solo si el usuario lo dio, y normalizado como lo guarda el servidor", async () => {
  const { db } = sembrar();
  const p = await proponer(recepcion(db), {
    ...nuevo,
    alergias: ["Penicilina", " látex ", "penicilina"],
    fechaNacimiento: "1990-05-17",
    genero: "F",
    correo: "sofia@example.com",
  });
  assert.deepEqual(p.cuerpo, {
    firstName: "Sofía",
    lastName: "Núñez",
    phone: "55 8888 7777",
    allergies: ["Penicilina", "látex"],
    dob: "1990-05-17",
    gender: "F",
    email: "sofia@example.com",
  });
  assert.deepEqual(p.sinCapturar, []);
});

test("🔴 el modelo no puede colar `allowDuplicate`, `clinicId` ni visibilidad", async () => {
  const { db } = sembrar();
  const p = await proponer(recepcion(db), {
    ...nuevo,
    allowDuplicate: true,
    clinicId: CL_SUR,
    visibleUserIds: [U_DOC2_N],
    primaryDoctorId: U_DOC2_N,
  });
  for (const k of ["allowDuplicate", "clinicId", "visibleUserIds", "primaryDoctorId"]) {
    assert.equal(k in p.cuerpo, false, `${k} llegó al cuerpo del alta`);
  }
});

test("🔴 duplicado a la vista: pregunta con los tres caminos; ni lo crea ni lo descarta", async () => {
  const { db } = sembrar();
  const r = await correrHerramienta(registrarPaciente, admin(db), juan);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const p = r.datos;

  assert.equal(p.duplicados.visibles.length, 1);
  assert.deepEqual(p.duplicados.visibles[0], {
    pacienteId: "p-juan",
    folio: "P0031",
    nombre: "Juan Pérez López",
    telefonoFinal: "…5678",
  });
  assert.equal(p.duplicados.hayOcultos, false);
  assert.match(p.pregunta ?? "", /misma persona/);

  // Los tres caminos, y NINGÚN «crear» a secas.
  assert.deepEqual(tipos(p), ["usar_existente", "crear_a_sabiendas", "cancelar"]);
  assert.equal(p.opciones[0].pacienteId, "p-juan");
  assert.match(r.resumen, /no lo des de alta/i);
  assert.deepEqual(escrituras(db), []);
});

test("🔴 duplicado FUERA de su alcance: avisa que existe sin fugar la ficha", async () => {
  const { db } = sembrar();
  // El doctor 1 da de alta a «Juan Perez lopez», que es paciente del doctor 2.
  const r = await correrHerramienta(registrarPaciente, doctor(db), juan);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const p = r.datos;

  assert.deepEqual(p.duplicados.visibles, []);
  assert.equal(p.duplicados.hayOcultos, true, "el gemelo de otro doctor tiene que avisar");
  assert.match(p.pregunta ?? "", /fuera de tu alcance/);
  assert.deepEqual(tipos(p), ["usar_existente", "crear_a_sabiendas", "cancelar"]);
  assert.equal(p.opciones[0].pacienteId, null, "no se da el id de un paciente que no puede ver");

  const todo = JSON.stringify(r);
  for (const fuga of ["p-juan", "P0031", "+52 55 1234 5678", "Pérez López"]) {
    assert.equal(todo.indexOf(fuga), -1, `se fugó «${fuga}» del paciente que el doctor no puede ver`);
  }
});

test("restringido a otros: con solo el nombre no se delata; con el mismo teléfono sí se avisa", async () => {
  const { db } = sembrar();
  const soloNombre = await proponer(doctor(db), { nombre: "Luis", apellidos: "Mora", telefono: "5500001111", alergias: ["ninguna"] });
  assert.deepEqual(tipos(soloNombre), ["crear", "cancelar"], "el alta no puede servir para averiguar si «Luis Mora» es paciente");

  const conTelefono = await proponer(doctor(db), { nombre: "Luis", apellidos: "Mora", telefono: "55 3333 4444", alergias: ["ninguna"] });
  assert.equal(conTelefono.duplicados.hayOcultos, true);
  assert.deepEqual(conTelefono.duplicados.visibles, []);
  for (const fuga of ["p-luis", "P0050"]) {
    assert.equal(JSON.stringify(conTelefono).indexOf(fuga), -1, `se fugó «${fuga}»`);
  }

  // Y quien SÍ lo puede ver, lo ve.
  const suDoctor = await proponer(doctor2(db), { nombre: "Luis", apellidos: "Mora", telefono: "5500001111", alergias: ["ninguna"] });
  assert.equal(suDoctor.duplicados.visibles[0]?.pacienteId, "p-luis");
});

test("sin `patients.view` ni los de su alcance se enseñan: solo que existe alguien", async () => {
  const { db } = sembrar();
  const ctx = sesion(db, { userId: U_RECEP_N, role: "RECEPTIONIST", permissionsOverride: ["patients.create"] });
  const p = await proponer(ctx, { nombre: "Ana", apellidos: "García", telefono: "5500001111", alergias: ["ninguna"] });
  assert.deepEqual(p.duplicados.visibles, []);
  assert.equal(p.duplicados.hayOcultos, true);
  assert.equal(JSON.stringify(p).indexOf("P0040"), -1);
});

test("la clínica de al lado y los borrados por ARCO no cuentan como duplicado", async () => {
  const { db } = sembrar();
  const pedro = await proponer(admin(db), { nombre: "Pedro", apellidos: "Soto", telefono: "5599990000", alergias: ["ninguna"] });
  assert.deepEqual(tipos(pedro), ["crear", "cancelar"]);
  assert.equal(JSON.stringify(pedro).indexOf("S0001"), -1);

  const marta = await proponer(admin(db), { nombre: "Marta", apellidos: "Ruiz", telefono: "5566667777", alergias: ["ninguna"] });
  assert.deepEqual(tipos(marta), ["crear", "cancelar"]);
});

test("mejor que la pantalla: apellido mal escrito con el MISMO teléfono también avisa", async () => {
  // POST /api/patients busca candidatos solo por nombre: «Peres» no encuentra a
  // «Pérez» y el gemelo se crea. La propuesta busca además por teléfono, y el
  // criterio sigue siendo el del servidor (mismo nombre de pila + mismo tel.).
  const { db } = sembrar();
  const p = await proponer(admin(db), { ...juan, apellidos: "Peres" });
  assert.equal(p.duplicados.visibles[0]?.pacienteId, "p-juan");
  assert.deepEqual(tipos(p), ["usar_existente", "crear_a_sabiendas", "cancelar"]);
});

test("si la búsqueda sin acentos no responde, la propuesta lo DICE en vez de dar por hecho que no hay nadie", async () => {
  const { db } = sembrar({ falla: true });
  const p = await proponer(admin(db), juan);
  assert.equal(p.duplicados.comprobacion, "parcial");
  assert.ok(p.avisos.some((a) => /no pude comprobar/i.test(a)), JSON.stringify(p.avisos));
});

/* ══════════════════════════════════════════════════════════════════════
 * FASE 2 · CONFIRMAR
 * ══════════════════════════════════════════════════════════════════════ */

test("confirmar «crear»: una sola llamada al endpoint, con el cuerpo propuesto y SIN allowDuplicate", async () => {
  const { db } = sembrar();
  const ctx = recepcion(db);
  const propuesta = await proponer(ctx, nuevo);
  const api = endpoint(creado());

  const r = await confirmarRegistroPaciente({ ctx, propuesta, opcionId: "crear", llamar: api.llamar });

  assert.equal(r.estado, "creado", JSON.stringify(r));
  if (r.estado === "creado") {
    assert.deepEqual(r.paciente, { pacienteId: "p-nuevo", folio: "P0101", nombre: "Sofía Núñez" });
  }
  assert.equal(api.llamadas.length, 1);
  assert.deepEqual(api.llamadas[0], propuesta.cuerpo);
  assert.equal("allowDuplicate" in api.llamadas[0], false);
});

test("🔴 un 409 del servidor al confirmar es una PREGUNTA con los tres caminos, no un error", async () => {
  const { db } = sembrar();
  const ctx = recepcion(db);
  const propuesta = await proponer(ctx, nuevo);
  assert.deepEqual(tipos(propuesta), ["crear", "cancelar"]);

  // Entre la propuesta y el toque, alguien dio de alta a Sofía por la pantalla.
  const api = endpoint({
    status: 409,
    cuerpo: {
      error: 'Ya existe un paciente con nombre "Sofía Núñez".',
      code: "DUPLICATE_PATIENT",
      duplicates: [{ id: "p-sofia", patientNumber: "P0077", fullName: "Sofía Núñez", phone: "55 8888 7777" }],
      hasHiddenDuplicates: false,
    },
  });
  const r = await confirmarRegistroPaciente({ ctx, propuesta, opcionId: "crear", llamar: api.llamar });

  assert.equal(r.estado, "duplicado", JSON.stringify(r));
  if (r.estado !== "duplicado") return;
  assert.deepEqual(tipos(r.propuesta), ["usar_existente", "crear_a_sabiendas", "cancelar"]);
  assert.equal(r.propuesta.opciones[0].pacienteId, "p-sofia");
  assert.equal(r.propuesta.duplicados.visibles[0].telefonoFinal, "…7777");
  assert.match(r.frase, /misma persona/);
  // Y NO reintenta por su cuenta con allowDuplicate: eso lo decide el usuario.
  assert.equal(api.llamadas.length, 1);
});

test("🔴 un 409 con el gemelo fuera de alcance: pregunta sin datos de ese paciente", async () => {
  const { db } = sembrar();
  const ctx = doctor(db);
  const propuesta = await proponer(ctx, nuevo);
  const api = endpoint({
    status: 409,
    cuerpo: { error: "Ya existe en la clínica…", code: "DUPLICATE_PATIENT", duplicates: [], hasHiddenDuplicates: true },
  });
  const r = await confirmarRegistroPaciente({ ctx, propuesta, opcionId: "crear", llamar: api.llamar });
  assert.equal(r.estado, "duplicado");
  if (r.estado !== "duplicado") return;
  assert.equal(r.propuesta.duplicados.hayOcultos, true);
  assert.deepEqual(tipos(r.propuesta), ["usar_existente", "crear_a_sabiendas", "cancelar"]);
  assert.equal(r.propuesta.opciones[0].pacienteId, null);
});

test("un 409 que trae fichas a quien no tiene `patients.view` se reduce a «existe alguien»", async () => {
  const { db } = sembrar();
  const ctx = sesion(db, { userId: U_RECEP_N, role: "RECEPTIONIST", permissionsOverride: ["patients.create"] });
  const propuesta = await proponer(ctx, nuevo);
  const api = endpoint({
    status: 409,
    cuerpo: {
      code: "DUPLICATE_PATIENT",
      duplicates: [{ id: "p-sofia", patientNumber: "P0077", fullName: "Sofía Núñez", phone: "5588887777" }],
      hasHiddenDuplicates: false,
    },
  });
  const r = await confirmarRegistroPaciente({ ctx, propuesta, opcionId: "crear", llamar: api.llamar });
  assert.equal(r.estado, "duplicado");
  const todo = JSON.stringify(r);
  for (const fuga of ["p-sofia", "P0077"]) assert.equal(todo.indexOf(fuga), -1, `se fugó «${fuga}»`);
});

test("crear a sabiendas: SOLO aquí viaja allowDuplicate, tras enseñar el duplicado", async () => {
  const { db } = sembrar();
  const ctx = admin(db);
  const propuesta = await proponer(ctx, juan);
  const api = endpoint(creado({ id: "p-juan-2", patientNumber: "P0102", firstName: "Juan", lastName: "Perez lopez" }));

  const r = await confirmarRegistroPaciente({ ctx, propuesta, opcionId: "crear_a_sabiendas", llamar: api.llamar });
  assert.equal(r.estado, "creado", JSON.stringify(r));
  assert.equal(api.llamadas.length, 1);
  assert.deepEqual(api.llamadas[0], { ...propuesta.cuerpo, allowDuplicate: true });
});

test("🔴 crear a sabiendas NO escribe a ciegas: si apareció OTRO gemelo desde la propuesta, vuelve a preguntar", async () => {
  const { db, datos } = sembrar();
  const ctx = admin(db);
  const propuesta = await proponer(ctx, juan);

  // Mientras la tarjeta estaba abierta, recepción dio de alta a otro Juan Pérez.
  datos.patients!.push({
    id: "p-juan-recepcion", clinicId: CL_NORTE, firstName: "Juan", lastName: "Pérez López",
    phone: null, patientNumber: "P0099", status: "ACTIVE", visibleUserIds: [], deletedAt: null,
  });
  const api = endpoint(creado());
  const r = await confirmarRegistroPaciente({ ctx, propuesta, opcionId: "crear_a_sabiendas", llamar: api.llamar });

  assert.equal(r.estado, "duplicado", JSON.stringify(r));
  if (r.estado === "duplicado") {
    assert.deepEqual(r.propuesta.duplicados.visibles.map((v) => v.pacienteId).sort(), ["p-juan", "p-juan-recepcion"]);
  }
  assert.equal(api.llamadas.length, 0, "se creó con allowDuplicate sin enseñar el gemelo nuevo");
});

test("usar el que existe: no llama al endpoint y devuelve el paciente para seguir (p. ej. agendar)", async () => {
  const { db } = sembrar();
  const ctx = admin(db);
  const propuesta = await proponer(ctx, juan);
  const api = endpoint(creado());

  const r = await confirmarRegistroPaciente({ ctx, propuesta, opcionId: propuesta.opciones[0].id, llamar: api.llamar });
  assert.equal(r.estado, "usar_existente", JSON.stringify(r));
  if (r.estado === "usar_existente") {
    assert.deepEqual(r.paciente, { pacienteId: "p-juan", folio: "P0031", nombre: "Juan Pérez López" });
  }
  assert.equal(api.llamadas.length, 0);
  assert.deepEqual(escrituras(db), []);
});

test("usar el que existe, si entretanto dejó de estar disponible: lo dice y no inventa", async () => {
  const { db, datos } = sembrar();
  const ctx = admin(db);
  const propuesta = await proponer(ctx, juan);
  datos.patients!.find((p) => p.id === "p-juan")!.deletedAt = new Date();

  const r = await confirmarRegistroPaciente({ ctx, propuesta, opcionId: propuesta.opciones[0].id, llamar: endpoint(creado()).llamar });
  assert.equal(r.estado, "no_encontrado", JSON.stringify(r));
});

test("gemelo fuera de alcance + «es el mismo»: no escribe y manda a un administrador", async () => {
  const { db } = sembrar();
  const ctx = doctor(db);
  const propuesta = await proponer(ctx, juan);
  const api = endpoint(creado());
  const r = await confirmarRegistroPaciente({ ctx, propuesta, opcionId: propuesta.opciones[0].id, llamar: api.llamar });
  assert.equal(r.estado, "requiere_revision", JSON.stringify(r));
  assert.match(r.frase, /administrador/);
  assert.equal(api.llamadas.length, 0);
});

test("cancelar no llama a nada", async () => {
  const { db } = sembrar();
  const ctx = admin(db);
  const propuesta = await proponer(ctx, juan);
  const api = endpoint(creado());
  const r = await confirmarRegistroPaciente({ ctx, propuesta, opcionId: "cancelar", llamar: api.llamar });
  assert.equal(r.estado, "cancelado");
  assert.equal(api.llamadas.length, 0);
});

test("🔴 una opción que la propuesta no ofreció no se ejecuta", async () => {
  const { db } = sembrar();
  const ctx = admin(db);
  const conDuplicado = await proponer(ctx, juan);
  const api = endpoint(creado());

  // «crear» a secas no existe cuando hay un duplicado.
  const r1 = await confirmarRegistroPaciente({ ctx, propuesta: conDuplicado, opcionId: "crear", llamar: api.llamar });
  assert.equal(r1.estado, "error");

  // Ni un paciente que la propuesta no enseñó, aunque alguien reescriba la opción.
  const manipulada: PropuestaAlta = {
    ...conDuplicado,
    opciones: conDuplicado.opciones.map((o) => (o.tipo === "usar_existente" ? { ...o, pacienteId: "p-luis" } : o)),
  };
  const r2 = await confirmarRegistroPaciente({ ctx, propuesta: manipulada, opcionId: manipulada.opciones[0].id, llamar: api.llamar });
  assert.equal(r2.estado, "error");
  assert.equal(JSON.stringify(r2).indexOf("Mora"), -1);

  // Ni `crear_a_sabiendas` sobre una propuesta sin duplicados manda allowDuplicate.
  const limpia = await proponer(ctx, nuevo);
  const trucada: PropuestaAlta = { ...limpia, opciones: [...limpia.opciones, { id: "crear_a_sabiendas", tipo: "crear_a_sabiendas", etiqueta: "x" }] };
  const r3 = await confirmarRegistroPaciente({ ctx, propuesta: trucada, opcionId: "crear_a_sabiendas", llamar: api.llamar });
  assert.equal(r3.estado, "creado");
  assert.equal("allowDuplicate" in api.llamadas[api.llamadas.length - 1], false);
  assert.equal(api.llamadas.length, 1);
});

test("🔴 el cuerpo que viaja es SOLO el de la lista blanca, aunque la propuesta guardada traiga más", async () => {
  const { db } = sembrar();
  const ctx = recepcion(db);
  const propuesta = await proponer(ctx, nuevo);
  const trucada: PropuestaAlta = {
    ...propuesta,
    cuerpo: { ...propuesta.cuerpo, allowDuplicate: true, clinicId: CL_SUR, visibleUserIds: [U_DOC2_N], notes: "x" } as any,
  };
  const api = endpoint(creado());
  await confirmarRegistroPaciente({ ctx, propuesta: trucada, opcionId: "crear", llamar: api.llamar });
  assert.deepEqual(Object.keys(api.llamadas[0]).sort(), ["allergies", "firstName", "lastName", "phone"]);
});

test("🔴 sin permiso al confirmar (se lo quitaron entre medias) → `sin_permiso`, sin llamar", async () => {
  const { db } = sembrar();
  const propuesta = await proponer(recepcion(db), nuevo);
  const sinLlave = sesion(db, { userId: U_RECEP_N, role: "RECEPTIONIST", permissionsOverride: ["patients.view"] });
  const api = endpoint(creado());
  const r = await confirmarRegistroPaciente({ ctx: sinLlave, propuesta, opcionId: "crear", llamar: api.llamar });
  assert.equal(r.estado, "sin_permiso");
  if (r.estado === "sin_permiso") assert.equal(r.permiso, "patients.create");
  assert.equal(api.llamadas.length, 0);
});

test("lo que responde el servidor se traduce a una frase, SIN repetir sus textos internos", async () => {
  const { db } = sembrar();
  const ctx = recepcion(db);
  const propuesta = await proponer(ctx, nuevo);
  const confirmar = (resp: RespuestaAlta | Error) =>
    confirmarRegistroPaciente({ ctx, propuesta, opcionId: "crear", llamar: endpoint(resp).llamar });

  const r403 = await confirmar({ status: 403, cuerpo: { error: "Permiso requerido: patients.create" } });
  assert.equal(r403.estado, "sin_permiso");

  const r402 = await confirmar({ status: 402, cuerpo: { code: "PLAN_LIMIT_PATIENTS", limit: 200, used: 200, isAdmin: false } });
  assert.equal(r402.estado, "tope_plan");
  if (r402.estado === "tope_plan") {
    assert.equal(r402.limite, 200);
    assert.equal(r402.esAdmin, false);
    assert.match(r402.frase, /200/);
  }

  const r401 = await confirmar({ status: 401, cuerpo: { error: "Unauthorized" } });
  assert.equal(r401.estado, "sesion_cerrada");

  const r400 = await confirmar({
    status: 400,
    cuerpo: { error: "La fecha de nacimiento no es válida.", code: "INVALID_PATIENT", field: "dob" },
  });
  assert.equal(r400.estado, "datos_invalidos");
  if (r400.estado === "datos_invalidos") {
    assert.equal(r400.campo, "dob");
    assert.match(r400.frase, /fecha de nacimiento/);
  }

  const folio = await confirmar({ status: 409, cuerpo: { error: "folios agotados", code: "PATIENT_NUMBER_EXHAUSTED" } });
  assert.equal(folio.estado, "error", "un 409 que no es de duplicado no es una pregunta");

  const prisma500 = await confirmar({
    status: 500,
    cuerpo: { error: "Invalid `prisma.patient.create()` invocation: Unique constraint failed", code: "P2002" },
  });
  assert.equal(prisma500.estado, "error");
  assert.equal(JSON.stringify(prisma500).toLowerCase().indexOf("prisma"), -1, "se repitió el texto interno de Prisma");

  const sinId = await confirmar({ status: 201, cuerpo: {} });
  assert.equal(sinId.estado, "error");
  assert.match(sinId.frase, /busca/i, "si no se sabe qué se creó, hay que decir que se busque antes de reintentar");

  const caida = await confirmar(new Error("fetch failed"));
  assert.equal(caida.estado, "error");
});

/* ══════════════════════════════════════════════════════════════════════
 * Lo que encontró la revisión adversarial (casos límite)
 * ══════════════════════════════════════════════════════════════════════ */

/** `n` homónimos de «Juan Pérez López», todos a la vista de un admin. */
function juanes(n: number, desde = 1): Fila[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p-juan-${desde + i}`, clinicId: CL_NORTE, firstName: "Juan", lastName: "Pérez López", phone: null,
    patientNumber: `J${String(desde + i).padStart(4, "0")}`, status: "ACTIVE", visibleUserIds: [], deletedAt: null,
  }));
}

test("🔴 más de 5 a la vista: no dice «fuera de tu alcance», y un 7.º que aparece vuelve a preguntar", async () => {
  const { db, datos } = sembrar({ extra: juanes(5, 1) }); // + p-juan = 6 visibles para un admin
  const ctx = admin(db);
  const propuesta = await proponer(ctx, juan);
  assert.equal(propuesta.duplicados.visibles.length, 5);
  assert.equal(propuesta.duplicados.masVisibles, 1);
  assert.equal(propuesta.duplicados.hayOcultos, false, "un admin no tiene nada fuera de su alcance");
  assert.doesNotMatch(propuesta.pregunta ?? "", /fuera de tu alcance/);
  assert.match(propuesta.pregunta ?? "", /otro más/);
  assert.equal(propuesta.opciones.some((o) => o.pacienteId === null), false);

  // El 7.º, con folio mayor: cae fuera del recorte de 5, pero cambia la huella.
  datos.patients!.push(...juanes(1, 99));
  const api = endpoint(creado());
  const r = await confirmarRegistroPaciente({ ctx, propuesta, opcionId: "crear_a_sabiendas", llamar: api.llamar });
  assert.equal(r.estado, "duplicado", JSON.stringify(r).slice(0, 300));
  assert.equal(api.llamadas.length, 0, "se mandó allowDuplicate sin enseñar el gemelo nuevo");
});

test("🔴 un SEGUNDO gemelo fuera de alcance también vuelve a preguntar, sin decir cuántos hay", async () => {
  const { db, datos } = sembrar();
  const ctx = doctor(db);
  const propuesta = await proponer(ctx, juan);
  assert.equal(propuesta.duplicados.hayOcultos, true);

  datos.patients!.push({ ...juanes(1, 50)[0], primaryDoctorId: U_DOC2_N });
  const api = endpoint(creado());
  const r = await confirmarRegistroPaciente({ ctx, propuesta, opcionId: "crear_a_sabiendas", llamar: api.llamar });
  assert.equal(r.estado, "duplicado");
  assert.equal(api.llamadas.length, 0);
  const todo = JSON.stringify(r);
  for (const fuga of ["p-juan", "J0050", "P0031"]) assert.equal(todo.indexOf(fuga), -1, `se fugó «${fuga}»`);

  // Y si nada cambió, «es otra persona» sí crea.
  const sinCambios = await proponer(ctx, juan);
  const api2 = endpoint(creado());
  const r2 = await confirmarRegistroPaciente({ ctx, propuesta: sinCambios, opcionId: "crear_a_sabiendas", llamar: api2.llamar });
  assert.equal(r2.estado, "creado", JSON.stringify(r2).slice(0, 300));
  assert.equal(api2.llamadas[0].allowDuplicate, true);
});

test("la huella no dice quiénes ni cuántos: dos conjuntos distintos de ocultos solo se distinguen por cambiar", async () => {
  const { db } = sembrar();
  const p = await proponer(doctor(db), juan);
  assert.match(p.duplicados.huella ?? "", /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(p).indexOf("p-juan"), -1);
});

test("🔴 una propuesta de OTRA sesión o de otra sede no se confirma", async () => {
  const { db } = sembrar();
  const propuesta = await proponer(recepcion(db), nuevo);
  const api = endpoint(creado());
  const otraPersona = await confirmarRegistroPaciente({ ctx: admin(db), propuesta, opcionId: "crear", llamar: api.llamar });
  assert.equal(otraPersona.estado, "error");
  const otraSede = await confirmarRegistroPaciente({
    ctx: sesion(db, { userId: U_RECEP_N, role: "RECEPTIONIST", clinicId: CL_SUR }),
    propuesta, opcionId: "crear", llamar: api.llamar,
  });
  assert.equal(otraSede.estado, "error");
  assert.equal(api.llamadas.length, 0);
});

test("una propuesta guardada malformada devuelve `error`; nunca lanza", async () => {
  const { db } = sembrar();
  const ctx = admin(db);
  const buena = await proponer(ctx, juan);
  const api = endpoint(creado());
  for (const mala of [
    { ...buena, duplicados: { hayOcultos: true } },
    { ...buena, duplicados: undefined },
    { ...buena, opciones: null },
    null,
  ] as any[]) {
    for (const opcionId of ["crear_a_sabiendas", "usar:p-juan", "crear"]) {
      const r = await confirmarRegistroPaciente({ ctx, propuesta: mala, opcionId, llamar: api.llamar });
      assert.equal(typeof r.estado, "string");
    }
  }
  // Y si la base falla al volver a mirar, tampoco sale su texto.
  const rota = { ...admin(db), db: { ...db, patient: { ...db.patient, findMany: async () => { throw new Error("Can't reach database server at db:5432"); } } } } as SabinaCtx;
  const r = await confirmarRegistroPaciente({ ctx: rota, propuesta: buena, opcionId: "usar:p-juan", llamar: api.llamar });
  assert.equal(r.estado, "error");
  assert.equal(JSON.stringify(r).indexOf("5432"), -1);
});

test("🔴 `buscarDuplicados` exportada corta sin clinicId, antes de consultar", async () => {
  const { db } = sembrar({ falla: true });
  const rota = { ...admin(db), clinicId: undefined } as unknown as SabinaCtx;
  await assert.rejects(() => buscarDuplicados(rota, { firstName: "Pedro", lastName: "Soto", phone: "5599990000" }), /sesion_invalida/);
  assert.equal(db.contador.llamadas.length, 0);
});

test("búsqueda caída: el respaldo sigue sin cruzar clínicas, sin borrados y sin delatar restringidos", async () => {
  const { db } = sembrar({ falla: true });
  const pedro = await proponer(admin(db), { nombre: "Pedro", apellidos: "Soto", telefono: "5599990000", alergias: ["ninguna"] });
  assert.deepEqual(tipos(pedro), ["crear", "cancelar"]);
  const marta = await proponer(admin(db), { nombre: "Marta", apellidos: "Ruiz", telefono: "5566667777", alergias: ["ninguna"] });
  assert.deepEqual(tipos(marta), ["crear", "cancelar"]);
  const luis = await proponer(doctor(db), { nombre: "Luis", apellidos: "Mora", telefono: "5500001111", alergias: ["ninguna"] });
  assert.deepEqual(tipos(luis), ["crear", "cancelar"]);
  // Y el teléfono guardado con lada y espacios lo sigue encontrando.
  const juanTel = await proponer(admin(db), { ...juan, apellidos: "Peres" });
  assert.equal(juanTel.duplicados.visibles[0]?.pacienteId, "p-juan");
});

test("las formas habituales de «no tiene alergias» se guardan como las guarda el modal", async () => {
  const { db } = sembrar();
  for (const dicho of ["Ninguna", "sin alergias conocidas", "Niega alergias", "NKA", "no tiene", "N/A", "negadas"]) {
    const p = await proponer(recepcion(db), { ...nuevo, alergias: [dicho] });
    assert.deepEqual(p.cuerpo.allergies, ["N/A"], `«${dicho}» se guardó como alergia`);
  }
  const real = await proponer(recepcion(db), { ...nuevo, alergias: ["Penicilina"] });
  assert.deepEqual(real.cuerpo.allergies, ["Penicilina"]);
});
