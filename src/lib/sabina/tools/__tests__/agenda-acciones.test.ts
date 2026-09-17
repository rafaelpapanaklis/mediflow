/**
 * Las acciones de agenda de Sabina (WS1-T2): `proponer_horarios`,
 * `agendar_cita`, `reagendar_cita` y `cancelar_cita`.
 *
 * Run: npm run test:sabina-acciones-agenda
 *
 * 🔴 LA PRUEBA QUE MÁS IMPORTA va primero: las cuatro PROPONEN y no escriben.
 * Se demuestra con tres redes a la vez, porque cada una tapa un camino distinto:
 *  1. la base es un espía que LANZA ante cualquier operación que no sea de
 *     lectura (create, update, delete, upsert, $transaction, $executeRaw…);
 *  2. `fetch` global lanza: nadie llama al endpoint «por HTTP» a escondidas;
 *  3. los tres route handlers de citas están sustituidos por espías: si una
 *     herramienta los importara y los llamara, se vería.
 * Y además, las filas sembradas quedan idénticas byte a byte.
 *
 * Todo pasa por `correrHerramienta`, el mismo runner que usa el motor: sesión →
 * permiso → parámetros → herramienta.
 */

import "./preparar";
import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const rutasLlamadas: string[] = [];
const espiaRuta = (nombre: string) => async () => {
  rutasLlamadas.push(nombre);
  throw new Error(`una herramienta de fase 1 llamó al endpoint ${nombre}`);
};
mock.module("@/app/api/appointments/route", {
  namedExports: { GET: espiaRuta("GET /api/appointments"), POST: espiaRuta("POST /api/appointments") },
});
mock.module("@/app/api/appointments/[id]/route", {
  namedExports: { PATCH: espiaRuta("PATCH /api/appointments/:id"), DELETE: espiaRuta("DELETE /api/appointments/:id") },
});
mock.module("@/app/api/appointments/[id]/status/route", {
  namedExports: { PATCH: espiaRuta("PATCH /api/appointments/:id/status") },
});

import * as catalogo from "../index";
import {
  CL_A,
  DIA,
  DOMINGO,
  HOY,
  U_DOC1,
  U_DOC_B,
  admin,
  baseAgenda,
  conKeys,
  drSalas,
  draRojas,
  en,
  lector,
  recepcion,
  type BaseAgenda,
} from "./agenda-siembra";
import { sumarDias } from "../fechas";
import { scheduleDayOfISO } from "@/lib/agenda/clinic-hours";
import type { SabinaCtx } from "../../tipos";

/* ── utilidades ───────────────────────────────────────────────────────── */

function herramienta(nombre: string) {
  const lista = ((catalogo as any).HERRAMIENTAS_AGENDA ?? []) as any[];
  const t = lista.find((h) => h.nombre === nombre);
  assert.ok(t, `no existe la herramienta «${nombre}» en HERRAMIENTAS_AGENDA`);
  return t;
}

async function correr(nombre: string, ctx: SabinaCtx, params: Record<string, unknown>): Promise<any> {
  return (catalogo as any).correrHerramienta(herramienta(nombre), ctx, params);
}

/** Corre y exige `ok`; devuelve `datos`. */
async function datos(nombre: string, ctx: SabinaCtx, params: Record<string, unknown>): Promise<any> {
  const r = await correr(nombre, ctx, params);
  assert.equal(r.ok, true, `${nombre}: ${JSON.stringify(r)}`);
  assert.equal(typeof r.resumen, "string");
  return r.datos;
}

const iso = (dia: string, hhmm: string) => en(dia, hhmm).toISOString();

const agendarJuan = (extra: Record<string, unknown> = {}) => ({
  paciente: "Juan Pérez",
  doctor: "Salas",
  fecha: DIA,
  hora: "09:00",
  motivo: "Limpieza",
  ...extra,
});

/* ══════════════════════════════════════════════════════════════════════
 * 1 · 🔴 PROPONEN, NO ESCRIBEN
 * ══════════════════════════════════════════════════════════════════════ */

test("🔴 las cuatro proponen y NO escriben: ni base, ni fetch, ni endpoint", async () => {
  const db = baseAgenda({ sillones: true, google: true });
  const antes = JSON.stringify(db.filas);
  const fetchOriginal = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = (async () => {
    fetches += 1;
    throw new Error("una herramienta de fase 1 hizo fetch");
  }) as typeof fetch;

  const propuestas: any[] = [];
  try {
    const casos: Array<[string, SabinaCtx, Record<string, unknown>]> = [
      ["proponer_horarios", recepcion(db), { fecha: DIA, doctor: "Salas" }],
      ["agendar_cita", recepcion(db), agendarJuan({ sillon: "Sillón 1" })],
      ["agendar_cita", recepcion(db), agendarJuan({ hora: "10:00" })],
      ["agendar_cita", admin(db), { paciente: "María García", fecha: DIA, hora: "09:00" }],
      ["reagendar_cita", recepcion(db), { citaId: "a-juan-10", nuevaFecha: DIA, nuevaHora: "11:00" }],
      ["cancelar_cita", recepcion(db), { citaId: "a-juan-10", motivo: "Pidió cambio" }],
      ["cancelar_cita", admin(db), { citaId: "a-juan-curso" }],
      ["cancelar_cita", drSalas(db), { citaId: "a-juan-10" }],
    ];
    for (const [nombre, ctx, params] of casos) {
      const r = await correr(nombre, ctx, params);
      assert.equal(r.ok, true, `${nombre}: ${JSON.stringify(r)}`);
      if (r.datos.estado === "propuesta") propuestas.push(r.datos.propuesta);
    }
  } finally {
    globalThis.fetch = fetchOriginal;
  }

  assert.deepEqual(db.espia.escrituras, [], "una herramienta intentó escribir en la base");
  assert.equal(fetches, 0, "una herramienta hizo fetch");
  assert.deepEqual(rutasLlamadas, [], "una herramienta llamó a un route handler");
  assert.equal(JSON.stringify(db.filas), antes, "las filas cambiaron");
  assert.ok(db.espia.llamadas.length > 0, "el espía no vio ni una lectura: la prueba no ejerció nada");

  // Y lo que devuelven es una PROPUESTA con la petición que haría la pantalla.
  assert.equal(propuestas.length >= 3, true, `esperaba al menos 3 propuestas, hubo ${propuestas.length}`);
  for (const p of propuestas) {
    assert.match(p.peticion.metodo, /^(POST|PATCH|DELETE)$/);
    assert.match(p.peticion.ruta, /^\/api\/appointments(\/[\w-]+)?$/);
    assert.equal(typeof p.frase, "string");
    assert.equal(typeof p.deshacer.reversible, "boolean");
    assert.ok(p.revalidar && p.revalidar.herramienta === p.accion, "la propuesta no dice cómo revalidarse al confirmar");
  }
});

test("🔴 el código de las acciones no tiene por dónde escribir", () => {
  const dir = join(__dirname, "..");
  const archivos = readdirSync(dir).filter((f) =>
    /^(agenda-[\w-]+|proponer-horarios|agendar-cita|reagendar-cita|cancelar-cita)\.ts$/.test(f),
  );
  assert.equal(archivos.length >= 6, true, `faltan archivos de las acciones: ${archivos.join(", ")}`);
  const prohibido = /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(|\$transaction|\$executeRaw|\bfetch\(|@\/app\/api\//;
  for (const f of archivos) {
    const codigo = readFileSync(join(dir, f), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    assert.equal(prohibido.test(codigo), false, `${f} contiene una operación de escritura: ${codigo.match(prohibido)?.[0]}`);
  }
});

/* ══════════════════════════════════════════════════════════════════════
 * 2 · SIN PERMISO → `sin_permiso`, nunca una lista vacía
 * ══════════════════════════════════════════════════════════════════════ */

test("🔴 sin la key: las cuatro devuelven `sin_permiso` con su key y no consultan", async () => {
  const db = baseAgenda();
  const ctx = conKeys(db, ["patients.view"]);
  const casos: Array<[string, string, Record<string, unknown>]> = [
    ["proponer_horarios", "agenda.view", { fecha: DIA, doctor: "Salas" }],
    ["agendar_cita", "agenda.create", agendarJuan()],
    ["reagendar_cita", "agenda.edit", { citaId: "a-juan-10", nuevaFecha: DIA, nuevaHora: "11:00" }],
    ["cancelar_cita", "agenda.delete", { citaId: "a-juan-10" }],
  ];
  for (const [nombre, key, params] of casos) {
    const r = await correr(nombre, ctx, params);
    assert.deepEqual(r, { ok: false, motivo: "sin_permiso", permiso: key }, nombre);
  }
  assert.equal(db.espia.llamadas.length, 0, "se consultó la base sin permiso");
});

test("🔴 un DOCTOR no cancela: Sabina lo dice sin intentarlo (ni una lectura)", async () => {
  const db = baseAgenda();
  const d = await datos("cancelar_cita", drSalas(db), { citaId: "a-juan-10" });
  assert.equal(d.estado, "sin_permiso");
  assert.equal(d.causa, "rol");
  assert.equal(d.permiso, "agenda.delete");
  assert.match(d.frase, /recepci[oó]n|administrador/i);
  assert.equal(db.espia.llamadas.length, 0, "con rol DOCTOR no hay nada que leer: la respuesta ya se sabe");
});

test("READONLY con las keys puestas a mano tampoco escribe: el rol manda, como en el endpoint", async () => {
  const db = baseAgenda();
  for (const [nombre, params] of [
    ["agendar_cita", agendarJuan()],
    ["reagendar_cita", { citaId: "a-juan-10", nuevaFecha: DIA, nuevaHora: "11:00" }],
    ["cancelar_cita", { citaId: "a-juan-10" }],
  ] as Array<[string, Record<string, unknown>]>) {
    const d = await datos(nombre, lector(db), params);
    assert.equal(d.estado, "sin_permiso", nombre);
    assert.equal(d.causa, "rol", nombre);
  }
});

/* ══════════════════════════════════════════════════════════════════════
 * 3 · RESOLVEDORES — si hay dos, se PREGUNTA
 * ══════════════════════════════════════════════════════════════════════ */

test("🔴 dos «María García»: pregunta cuál, con folio y teléfono parcial, y NO propone", async () => {
  const db = baseAgenda();
  const d = await datos("agendar_cita", recepcion(db), {
    paciente: "María García", doctor: "Salas", fecha: DIA, hora: "09:00", motivo: "Limpieza",
  });
  assert.equal(d.estado, "pregunta");
  assert.equal(d.propuesta, undefined);
  const p = d.preguntas.find((q: any) => q.falta === "paciente");
  assert.ok(p, JSON.stringify(d));
  assert.deepEqual(p.opciones.map((o: any) => o.id).sort(), ["p-mg1", "p-mg2"]);
  // La vecina tiene otra María García: no puede aparecer.
  assert.equal(JSON.stringify(d).includes("V9999"), false, "se coló la paciente de la otra clínica");
  // Para distinguirlas: folio y los últimos dígitos, no el teléfono entero.
  assert.match(p.opciones[0].detalle, /P000[12]/);
  assert.equal(JSON.stringify(d).includes("1111 2222"), false, "no hace falta el teléfono completo para distinguir");

  // Elegida por id, ya propone.
  const r = await datos("agendar_cita", recepcion(db), {
    pacienteId: "p-mg2", doctor: "Salas", fecha: DIA, hora: "09:00", motivo: "Limpieza",
  });
  assert.equal(r.estado, "propuesta", JSON.stringify(r));
  assert.equal(r.propuesta.peticion.cuerpo.patientId, "p-mg2");
});

test("paciente: la de otra clínica, la restringida, la borrada y la archivada NO se agendan", async () => {
  const db = baseAgenda();
  for (const params of [
    agendarJuan({ paciente: undefined, pacienteId: "p-mg-vecina" }),
    agendarJuan({ paciente: undefined, pacienteId: "p-restr" }),
    agendarJuan({ paciente: "Renata Reservada" }),
    agendarJuan({ paciente: undefined, pacienteId: "p-borrada" }),
  ]) {
    const d = await datos("agendar_cita", recepcion(db), params);
    assert.equal(d.estado, "no_se_puede", JSON.stringify(params));
    assert.equal(d.causa, "paciente_no_encontrado", JSON.stringify(d));
    // «No lo encuentro entre los que puedes ver», nunca «no existe».
    assert.equal(/no existe/i.test(d.frase), false, d.frase);
  }
  // La doctora que SÍ está en la lista de la restringida, la encuentra.
  const rojas = await datos("agendar_cita", draRojas(db), agendarJuan({ paciente: undefined, pacienteId: "p-restr", doctor: undefined, hora: "09:30" }));
  assert.equal(rojas.estado, "propuesta", JSON.stringify(rojas));

  const arch = await datos("agendar_cita", recepcion(db), agendarJuan({ paciente: "Octavio Archivado" }));
  assert.equal(arch.estado, "no_se_puede");
  assert.equal(arch.causa, "paciente_archivado");
});

test("doctor: pregunta si hay varios, se elige a sí mismo si es doctor, y nunca uno inactivo o de fuera", async () => {
  const db = baseAgenda();

  const sinDoctor = await datos("agendar_cita", recepcion(db), agendarJuan({ doctor: undefined }));
  assert.equal(sinDoctor.estado, "pregunta");
  const q = sinDoctor.preguntas.find((p: any) => p.falta === "doctor");
  assert.deepEqual(q.opciones.map((o: any) => o.id).sort(), [U_DOC1, "u-doc-nadia"].sort());

  const yo = await datos("agendar_cita", drSalas(db), agendarJuan({ doctor: undefined }));
  assert.equal(yo.estado, "propuesta", JSON.stringify(yo));
  assert.equal(yo.propuesta.peticion.cuerpo.doctorId, U_DOC1);

  const inactivo = await datos("agendar_cita", recepcion(db), agendarJuan({ doctor: "Pablo Viejo" }));
  assert.notEqual(inactivo.estado, "propuesta");

  const deFuera = await datos("agendar_cita", recepcion(db), agendarJuan({ doctor: undefined, doctorId: U_DOC_B }));
  assert.equal(deFuera.estado, "no_se_puede");
  assert.equal(deFuera.causa, "doctor_no_disponible");

  // El dueño (SUPER_ADMIN) no es doctor para el POST: se dice por qué (N12).
  const dueno = await datos("agendar_cita", recepcion(db), agendarJuan({ doctor: "Rafael" }));
  assert.equal(dueno.estado, "no_se_puede");
  assert.match(dueno.frase, /rol de doctor/i);
});

test("motivo: el servidor lo exige, así que falta = pregunta (y va junto con las demás)", async () => {
  const db = baseAgenda();
  const d = await datos("agendar_cita", recepcion(db), { paciente: "María García", doctor: "Salas", fecha: DIA, hora: "09:00" });
  assert.equal(d.estado, "pregunta");
  const faltas = d.preguntas.map((p: any) => p.falta).sort();
  assert.deepEqual(faltas, ["motivo", "paciente"]);
});

/* ══════════════════════════════════════════════════════════════════════
 * 4 · AGENDAR — la hora ocupada propone alternativas; fuera de horario ni se ofrece
 * ══════════════════════════════════════════════════════════════════════ */

test("agendar: propone con la petición exacta del modal «Nueva cita»", async () => {
  const db = baseAgenda();
  const d = await datos("agendar_cita", recepcion(db), agendarJuan());
  assert.equal(d.estado, "propuesta", JSON.stringify(d));
  const p = d.propuesta;
  assert.equal(p.accion, "agendar_cita");
  assert.equal(p.permiso, "agenda.create");
  assert.deepEqual(p.peticion, {
    metodo: "POST",
    ruta: "/api/appointments",
    cuerpo: {
      patientId: "p-juan",
      doctorId: U_DOC1,
      resourceId: null,
      startsAt: iso(DIA, "09:00"),
      endsAt: iso(DIA, "09:30"), // defaultSlotMinutes 30
      reason: "Limpieza",
    },
  });
  assert.equal("overrideReason" in p.peticion.cuerpo, false, "Sabina nunca manda overrideReason");
  assert.match(p.frase, /Juan Pérez/);
  assert.match(p.frase, /09:00/);
  assert.match(p.frase, /Hugo Salas/);
  assert.equal(p.deshacer.reversible, true);
  assert.ok(p.avisos.some((a: string) => /no (le )?(manda|envía|enviará)|ningún mensaje/i.test(a)), JSON.stringify(p.avisos));
});

test("🔴 hora ocupada: no revienta, propone alternativas libres y cercanas", async () => {
  const db = baseAgenda();
  const d = await datos("agendar_cita", recepcion(db), agendarJuan({ hora: "10:00" }));
  assert.equal(d.estado, "no_disponible", JSON.stringify(d));
  assert.equal(d.causa, "ocupado");
  assert.equal(d.alternativas.length > 0, true);
  assert.equal(d.alternativas.length <= 5, true);
  assert.equal(d.alternativas.includes("10:00"), false);
  assert.equal(d.alternativas.includes("12:00"), false);
  assert.equal(d.alternativas.includes("12:30"), false);
  // Las dos más cercanas a las 10:00 van primero.
  assert.deepEqual(d.alternativas.slice(0, 2).sort(), ["09:30", "10:30"]);
  // Y no dice con quién está ocupado.
  assert.equal(JSON.stringify(d).includes("Renata"), false);

  // Cada alternativa, pedida tal cual, sí se propone.
  for (const hora of d.alternativas) {
    const r = await datos("agendar_cita", recepcion(db), agendarJuan({ hora }));
    assert.equal(r.estado, "propuesta", `${hora}: ${JSON.stringify(r)}`);
  }
});

test("una cita cancelada no ocupa el hueco", async () => {
  const db = baseAgenda();
  const d = await datos("agendar_cita", recepcion(db), agendarJuan({ hora: "17:00" }));
  assert.equal(d.estado, "propuesta", JSON.stringify(d));
});

test("🔴 fuera de horario: no se propone (el POST la guardaría con aviso), se ofrecen horas dentro", async () => {
  const db = baseAgenda();
  const tarde = await datos("agendar_cita", recepcion(db), agendarJuan({ hora: "17:45" })); // termina 18:15, cierra 18:00
  assert.equal(tarde.estado, "no_disponible", JSON.stringify(tarde));
  assert.equal(tarde.causa, "fuera_de_horario");
  for (const h of tarde.alternativas) {
    const [hh, mm] = h.split(":").map(Number);
    assert.equal(hh * 60 + mm + 30 <= 18 * 60, true, `${h} termina después del cierre`);
    assert.equal(hh * 60 + mm >= 9 * 60, true, `${h} empieza antes de abrir`);
  }
  assert.equal(tarde.alternativas[0], "17:30");

  const temprano = await datos("agendar_cita", recepcion(db), agendarJuan({ hora: "08:00" }));
  assert.equal(temprano.estado, "no_disponible");
  assert.equal(temprano.causa, "fuera_de_horario");

  const domingo = await datos("agendar_cita", recepcion(db), agendarJuan({ fecha: DOMINGO }));
  assert.equal(domingo.estado, "no_disponible");
  assert.equal(domingo.causa, "dia_cerrado");
  assert.deepEqual(domingo.alternativas, []);
  assert.match(domingo.frase, /cerrad/i);
});

test("en el pasado no se agenda", async () => {
  const db = baseAgenda();
  const d = await datos("agendar_cita", recepcion(db), agendarJuan({ fecha: sumarDias(HOY, -1), hora: "10:00" }));
  assert.equal(d.estado, "no_disponible");
  assert.equal(d.causa, "pasado");
});

test("🔴 sillones: si la clínica los usa, pregunta cuál (solo los libres y abiertos a esa hora)", async () => {
  const db = baseAgenda({ sillones: true });

  const manana = await datos("agendar_cita", recepcion(db), agendarJuan({ hora: "09:00" }));
  assert.equal(manana.estado, "pregunta", JSON.stringify(manana));
  const q = manana.preguntas.find((p: any) => p.falta === "sillon");
  assert.deepEqual(q.opciones.map((o: any) => o.id), ["r-1", "r-2"]);

  // A las 13:00 el Sillón 2 ya cerró: solo queda el 1.
  const trece = await datos("agendar_cita", recepcion(db), agendarJuan({ hora: "13:00" }));
  assert.deepEqual(trece.preguntas.find((p: any) => p.falta === "sillon").opciones.map((o: any) => o.id), ["r-1"]);

  // A las 14:00 el 1 lo ocupa otra doctora y el 2 está cerrado: alternativas.
  const catorce = await datos("agendar_cita", recepcion(db), agendarJuan({ hora: "14:00" }));
  assert.equal(catorce.estado, "no_disponible", JSON.stringify(catorce));
  assert.equal(catorce.alternativas.includes("14:00"), false);
  assert.equal(catorce.alternativas.includes("14:30"), true);

  // Pidiendo el Sillón 2 por la tarde: fuera de SU horario, alternativas de mañana.
  const s2 = await datos("agendar_cita", recepcion(db), agendarJuan({ hora: "13:00", sillon: "Sillón 2" }));
  assert.equal(s2.estado, "no_disponible");
  assert.equal(s2.causa, "sillon_no_disponible");
  for (const h of s2.alternativas) assert.equal(h < "12:00", true, `${h} está fuera del horario del Sillón 2`);

  const elegido = await datos("agendar_cita", recepcion(db), agendarJuan({ hora: "09:00", sillon: "sillon 1" }));
  assert.equal(elegido.estado, "propuesta", JSON.stringify(elegido));
  assert.equal(elegido.propuesta.peticion.cuerpo.resourceId, "r-1");

  const ajeno = await datos("agendar_cita", recepcion(db), agendarJuan({ sillonId: "r-vecina" }));
  assert.equal(ajeno.estado, "no_se_puede");
});

/* ══════════════════════════════════════════════════════════════════════
 * 5 · PROPONER HORARIOS
 * ══════════════════════════════════════════════════════════════════════ */

test("proponer_horarios: las primeras libres del día, dentro del horario", async () => {
  const db = baseAgenda();
  const d = await datos("proponer_horarios", recepcion(db), { fecha: DIA, doctor: "Salas" });
  assert.equal(d.estado, "con_huecos");
  assert.deepEqual(d.huecos.map((h: any) => h.hora), ["09:00", "09:30", "10:30", "11:00", "11:30"]);
  assert.equal(d.duracionMinutos, 30);
  assert.deepEqual(d.horario, { abre: "09:00", cierra: "18:00" });
  assert.equal(d.puedeAgendar, true);

  const cerca = await datos("proponer_horarios", recepcion(db), { fecha: DIA, doctor: "Salas", horaPreferida: "12:30", duracionMinutos: 60 });
  for (const h of cerca.huecos.map((x: any) => x.hora)) {
    assert.equal(["11:30", "12:00", "12:30", "09:30", "10:00"].includes(h), false, `${h} pisa una cita de 60 min`);
  }
  assert.equal(cerca.huecos[0].hora, "13:00");

  const dom = await datos("proponer_horarios", recepcion(db), { fecha: DOMINGO, doctor: "Salas" });
  assert.equal(dom.estado, "dia_cerrado");
  assert.deepEqual(dom.huecos, []);
});

test("🔴 proponer_horarios a un DOCTOR: lee la ocupación de toda la clínica pero no dice de quién es (N10)", async () => {
  const db = baseAgenda({ sillones: true });
  const d = await datos("proponer_horarios", drSalas(db), { fecha: DIA, horaPreferida: "14:00" });
  assert.equal(d.doctor.id, U_DOC1);
  const horas = d.huecos.map((h: any) => h.hora);
  assert.equal(horas.includes("14:00"), false, "a las 14:00 el único sillón abierto lo tiene otra doctora");
  const json = JSON.stringify(d);
  for (const marca of ["María", "García", "Nadia", "Rojas", "Renata"]) {
    assert.equal(json.includes(marca), false, `se coló «${marca}» en los huecos de un doctor`);
  }
});

test("proponer_horarios avisa si quien pregunta no puede agendar", async () => {
  const db = baseAgenda();
  const d = await datos("proponer_horarios", conKeys(db, ["agenda.view"]), { fecha: DIA, doctor: "Salas" });
  assert.equal(d.puedeAgendar, false);
});

test("🔴 proponer_horarios con `hasta`: tramo de días, cronológico y con un resumen por día (Rafael: «¿algo esta semana?»)", async () => {
  const db = baseAgenda();
  const hasta = sumarDias(DIA, 6);
  const d = await datos("proponer_horarios", recepcion(db), { fecha: DIA, hasta, doctor: "Salas" });
  assert.equal(d.estado, "con_huecos");
  assert.equal(d.fecha, DIA);
  assert.equal(d.hasta, hasta);
  assert.equal(d.resumenDias.length, 7, "un renglón por día del tramo");

  // El primer candidato ya es "lo antes posible": mismo día y misma hora que sin tramo.
  assert.equal(d.huecos[0].fecha, DIA);
  assert.equal(d.huecos[0].hora, "09:00");

  // Siete días seguidos siempre traen un domingo: ese día sale CERRADO, no "sin huecos".
  const domingo = d.resumenDias.find((rd: any) => scheduleDayOfISO(rd.fecha, "America/Mexico_City") === 6);
  assert.ok(domingo, "el tramo de 7 días no trajo ningún domingo");
  assert.equal(domingo.estado, "dia_cerrado");
  assert.equal(domingo.totalHuecos, 0);

  // `totalHuecos` suma TODO el tramo, no solo lo que cupo en `huecos` (tope 8).
  assert.ok(d.totalHuecos > d.huecos.length, `totalHuecos (${d.totalHuecos}) debería superar los ${d.huecos.length} candidatos listados`);
});

test("proponer_horarios: `hasta` antes que `fecha` no se puede", async () => {
  const db = baseAgenda();
  const d = await datos("proponer_horarios", recepcion(db), { fecha: DIA, hasta: sumarDias(DIA, -1), doctor: "Salas" });
  assert.equal(d.estado, "no_se_puede");
});

test("proponer_horarios: un tramo de más de dos semanas se recorta y lo dice, no se calla ni se va a buscar cinco años", async () => {
  const db = baseAgenda();
  const hasta = sumarDias(DIA, 30);
  const d = await datos("proponer_horarios", recepcion(db), { fecha: DIA, hasta, doctor: "Salas" });
  assert.equal(d.hasta, sumarDias(DIA, 13), "se recorta a 14 días desde `fecha`");
  assert.ok(d.frase && /14 d[ií]as/.test(d.frase), JSON.stringify(d.frase));
});

test("🔴 proponer_horarios: `desdeHora` acota a una franja del día («por la tarde»), sin tocar el horario de la clínica", async () => {
  const db = baseAgenda();
  const d = await datos("proponer_horarios", recepcion(db), { fecha: DIA, doctor: "Salas", desdeHora: "14:00" });
  assert.equal(d.estado, "con_huecos");
  for (const h of d.huecos.map((x: any) => x.hora)) {
    assert.equal(h < "14:00", false, `${h} está antes de la franja pedida`);
  }
  assert.equal(d.huecos[0].hora, "14:00");
  // La ventana de atención real de ese día no cambia por pedir una franja.
  assert.deepEqual(d.horario, { abre: "09:00", cierra: "18:00" });
});

/* ══════════════════════════════════════════════════════════════════════
 * 6 · REAGENDAR
 * ══════════════════════════════════════════════════════════════════════ */

test("🔴 reagendar: PATCH solo con la hora nueva, misma duración, y DICE que el paciente no recibirá aviso", async () => {
  const db = baseAgenda();
  const d = await datos("reagendar_cita", recepcion(db), { paciente: "Juan Pérez", nuevaFecha: DIA, nuevaHora: "11:00" });
  assert.equal(d.estado, "propuesta", JSON.stringify(d));
  const p = d.propuesta;
  assert.deepEqual(p.peticion, {
    metodo: "PATCH",
    ruta: "/api/appointments/a-juan-10",
    // Nunca motivo ni notas: `reason: null` borraría el motivo y `notes: null` las notas.
    cuerpo: { startsAt: iso(DIA, "11:00"), endsAt: iso(DIA, "11:30"), notifyPatient: false },
  });
  assert.equal(p.permiso, "agenda.edit");
  assert.ok(p.antes && p.despues, "reagendar enseña antes → después");
  assert.ok(p.avisos.some((a: string) => /no recibirá (ningún )?aviso/i.test(a)), JSON.stringify(p.avisos));
  // A Juan ya le salió el recordatorio con la hora vieja: la tarjeta lo dice.
  assert.ok(p.avisos.some((a: string) => /recordatorio/i.test(a) && /10:00/.test(a)), JSON.stringify(p.avisos));
  assert.deepEqual(p.esperado, { startsAt: iso(DIA, "10:00"), endsAt: iso(DIA, "10:30"), doctorId: U_DOC1, status: "SCHEDULED" });
});

test("reagendar: moverla encima de su propio hueco viejo no cuenta como solape", async () => {
  const db = baseAgenda();
  const d = await datos("reagendar_cita", recepcion(db), { citaId: "a-juan-10", nuevaFecha: DIA, nuevaHora: "10:15" });
  assert.equal(d.estado, "propuesta", JSON.stringify(d));
});

test("reagendar: a una hora ocupada propone alternativas sin nombrar al otro paciente", async () => {
  const db = baseAgenda();
  const d = await datos("reagendar_cita", recepcion(db), { citaId: "a-juan-10", nuevaFecha: DIA, nuevaHora: "12:00" });
  assert.equal(d.estado, "no_disponible");
  assert.equal(d.causa, "ocupado");
  assert.equal(d.alternativas.length > 0, true);
  assert.equal(JSON.stringify(d).includes("Renata"), false);
});

test("reagendar: ni completadas, ni en curso, ni la de otro doctor, ni la misma hora", async () => {
  const db = baseAgenda();
  const pasada = await datos("reagendar_cita", admin(db), { citaId: "a-juan-pasada", nuevaFecha: DIA, nuevaHora: "11:00" });
  assert.equal(pasada.estado, "no_se_puede");
  assert.equal(pasada.causa, "cita_no_movible");

  const curso = await datos("reagendar_cita", admin(db), { citaId: "a-juan-curso", nuevaFecha: DIA, nuevaHora: "17:00" });
  assert.equal(curso.estado, "no_se_puede");
  assert.equal(curso.causa, "cita_no_movible");

  // La Dra. Rojas no ve (ni mueve) la cita del Dr. Salas.
  const ajena = await datos("reagendar_cita", draRojas(db), { citaId: "a-juan-10", nuevaFecha: DIA, nuevaHora: "11:00" });
  assert.equal(ajena.estado, "no_se_puede");
  assert.equal(ajena.causa, "cita_no_encontrada");

  const igual = await datos("reagendar_cita", recepcion(db), { citaId: "a-juan-10", nuevaFecha: DIA, nuevaHora: "10:00" });
  assert.equal(igual.estado, "no_se_puede");
  assert.equal(igual.causa, "sin_cambios");

  // La de un paciente restringido no existe para recepción; la de la otra clínica tampoco.
  for (const citaId of ["a-restr-12", "a-vecina"]) {
    const r = await datos("reagendar_cita", recepcion(db), { citaId, nuevaFecha: DIA, nuevaHora: "17:00" });
    assert.equal(r.estado, "no_se_puede", citaId);
    assert.equal(r.causa, "cita_no_encontrada", citaId);
  }
});

/* ══════════════════════════════════════════════════════════════════════
 * 7 · CANCELAR
 * ══════════════════════════════════════════════════════════════════════ */

test("cancelar: DELETE (el camino con rastro y Google), irreversible dicho ANTES, y el aviso al paciente", async () => {
  const db = baseAgenda();
  const d = await datos("cancelar_cita", recepcion(db), { citaId: "a-juan-10", motivo: "Pidió cambio" });
  assert.equal(d.estado, "propuesta", JSON.stringify(d));
  const p = d.propuesta;
  assert.deepEqual(p.peticion, { metodo: "DELETE", ruta: "/api/appointments/a-juan-10", cuerpo: { reason: "Pidió cambio", notifyPatient: false } });
  assert.equal(p.permiso, "agenda.delete");
  assert.equal(p.deshacer.reversible, false);
  assert.ok(p.avisos.some((a: string) => /no recibirá (ningún )?aviso/i.test(a)), JSON.stringify(p.avisos));
  assert.ok(p.avisos.some((a: string) => /recordatorio/i.test(a)), "ya le llegó el recordatorio: puede presentarse igual");

  // Con Google se menciona el correo, pero NO se promete: si la cita se movió
  // antes, `updateCalendarEvent` la dejó sin invitados y ese correo no sale.
  const conGoogle = baseAgenda({ google: true });
  const g = await datos("cancelar_cita", recepcion(conGoogle), { citaId: "a-juan-10" });
  // Sin motivo el cuerpo ya no es null: lleva el «no avises» (ws1-t2).
  assert.deepEqual(g.propuesta.peticion.cuerpo, { notifyPatient: false });
  const aviso = g.propuesta.avisos.find((a: string) => /Google/.test(a));
  assert.ok(aviso && /correo/i.test(aviso), JSON.stringify(g.propuesta.avisos));
  assert.match(aviso, /no está garantizado/);
  assert.match(aviso, /avísale tú/);
  assert.equal(/le enviará/.test(aviso), false, "no se promete un correo que puede no salir");
});

test("cancelar: la matriz de estados de la ruta, dicha en una frase", async () => {
  const db = baseAgenda();
  const curso = await datos("cancelar_cita", recepcion(db), { citaId: "a-juan-curso" });
  assert.equal(curso.estado, "sin_permiso");
  assert.equal(curso.causa, "estado");
  assert.match(curso.frase, /administrador/i);

  const cursoAdmin = await datos("cancelar_cita", admin(db), { citaId: "a-juan-curso" });
  assert.equal(cursoAdmin.estado, "propuesta");

  const ya = await datos("cancelar_cita", recepcion(db), { citaId: "a-juan-cancel" });
  assert.equal(ya.estado, "no_se_puede");
  assert.equal(ya.causa, "ya_cancelada");

  const completada = await datos("cancelar_cita", admin(db), { citaId: "a-juan-pasada" });
  assert.equal(completada.estado, "no_se_puede");
  assert.equal(completada.causa, "transicion_invalida");
});

test("cancelar por paciente: si tiene varias citas, pregunta cuál", async () => {
  const db = baseAgenda();
  const d = await datos("cancelar_cita", recepcion(db), { paciente: "Juan Pérez" });
  assert.equal(d.estado, "pregunta", JSON.stringify(d));
  const q = d.preguntas.find((p: any) => p.falta === "cita");
  assert.deepEqual(q.opciones.map((o: any) => o.id).sort(), ["a-juan-10", "a-juan-curso"]);
});

/* ══════════════════════════════════════════════════════════════════════
 * 8 · FASE 2 — revalidar al confirmar e interpretar lo que devuelve el endpoint
 * ══════════════════════════════════════════════════════════════════════ */

test("🔴 revalidar: si entretanto se ocupó la hora, la propuesta ya no vale", async () => {
  const db = baseAgenda();
  const ctx = recepcion(db);
  const d = await datos("agendar_cita", ctx, agendarJuan());
  const revalidar = (catalogo as any).revalidarPropuestaAgenda;
  assert.equal(typeof revalidar, "function", "falta revalidarPropuestaAgenda");

  const vigente = await revalidar(ctx, d.propuesta);
  assert.equal(vigente.vigente, true, JSON.stringify(vigente));

  // Otra recepcionista agenda a las 09:00 con el Dr. Salas.
  db.filas.appointments.push({
    id: "a-intrusa", clinicId: CL_A, patientId: "p-mg1", doctorId: U_DOC1, resourceId: null, type: "X",
    status: "SCHEDULED", overrideReason: null, startsAt: en(DIA, "09:00"), endsAt: en(DIA, "09:30"),
  });
  const caducada = await revalidar(ctx, d.propuesta);
  assert.equal(caducada.vigente, false);
  assert.equal(caducada.resultado.datos.estado, "no_disponible");
  assert.equal(caducada.resultado.datos.alternativas.length > 0, true);
});

test("🔴 revalidar: si alguien movió la cita, la propuesta de reagendar ya no vale", async () => {
  const db = baseAgenda();
  const ctx = recepcion(db);
  const d = await datos("reagendar_cita", ctx, { citaId: "a-juan-10", nuevaFecha: DIA, nuevaHora: "11:00" });
  const cita = db.filas.appointments.find((a: any) => a.id === "a-juan-10");
  cita.startsAt = en(DIA, "09:00");
  cita.endsAt = en(DIA, "09:30");
  const r = await (catalogo as any).revalidarPropuestaAgenda(ctx, d.propuesta);
  assert.equal(r.vigente, false);
});

test("🔴 revalidar: si cambió lo que dice la tarjeta (salió el recordatorio), la propuesta ya no vale", async () => {
  const db = baseAgenda();
  const ctx = recepcion(db);
  const d = await datos("reagendar_cita", ctx, { citaId: "a-mg1-11", nuevaFecha: DIA, nuevaHora: "13:00" });
  assert.equal(d.estado, "propuesta", JSON.stringify(d));
  assert.equal(d.propuesta.avisos.some((a: string) => /ya le llegó/i.test(a)), false);

  // El cron manda el recordatorio de 24 h entre la propuesta y el «Confirmar».
  db.filas.whatsAppReminders.push({ id: "w-2", clinicId: CL_A, appointmentId: "a-mg1-11", status: "SENT" });
  const r = await (catalogo as any).revalidarPropuestaAgenda(ctx, d.propuesta);
  assert.equal(r.vigente, false, "la tarjeta que vio el usuario no decía que ya le llegó el recordatorio");
  assert.ok(r.resultado.datos.propuesta.avisos.some((a: string) => /ya le llegó/i.test(a)));
});

test("revalidar: la propuesta guardada con otro orden de claves (jsonb) sigue valiendo", async () => {
  const db = baseAgenda();
  const ctx = recepcion(db);
  const d = await datos("agendar_cita", ctx, agendarJuan());
  const reordenar = (v: any): any =>
    Array.isArray(v) ? v.map(reordenar)
      : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).reverse().map((k) => [k, reordenar(v[k])]))
        : v;
  const guardada = reordenar(JSON.parse(JSON.stringify(d.propuesta)));
  assert.notEqual(JSON.stringify(guardada.peticion), JSON.stringify(d.propuesta.peticion));
  const r = await (catalogo as any).revalidarPropuestaAgenda(ctx, guardada);
  assert.equal(r.vigente, true, JSON.stringify(r));
});

test("la hora pedida usa la tolerancia del servidor (hueco en curso + 15 min); las alternativas, nunca antes de ahora", async () => {
  const db = baseAgenda();
  mock.timers.enable({ apis: ["Date"], now: en(DIA, "10:10") });
  try {
    // A las 10:10, la recepción registra la cita de las 10:00 del que llegó: el POST la acepta.
    const enCurso = await datos("agendar_cita", recepcion(db), agendarJuan({ doctor: "Rojas", hora: "10:00" }));
    assert.equal(enCurso.estado, "propuesta", JSON.stringify(enCurso));

    // A las 09:00 ya no: 70 min > 30 + 15.
    const vieja = await datos("agendar_cita", recepcion(db), agendarJuan({ doctor: "Rojas", hora: "09:00" }));
    assert.equal(vieja.estado, "no_disponible", JSON.stringify(vieja));
    assert.equal(vieja.causa, "pasado");
    assert.equal(vieja.alternativas.length > 0, true);
    for (const h of vieja.alternativas) assert.equal(h >= "10:10", true, `${h} ya empezó`);
  } finally {
    mock.timers.reset();
  }
});

test("reagendar: el sillón de la cita cuenta aunque esté dado de baja (el PATCH lo sigue validando)", async () => {
  const db = baseAgenda({ sillones: true });
  db.filas.appointments.push({
    id: "a-juan-s2", clinicId: CL_A, patientId: "p-juan", doctorId: U_DOC1, resourceId: "r-2", type: "Consulta",
    status: "SCHEDULED", overrideReason: null, googleCalendarEventId: null,
    startsAt: en(DIA, "09:00"), endsAt: en(DIA, "09:30"),
  });
  db.filas.resources.find((r: any) => r.id === "r-2").isActive = false;

  // El Sillón 2 solo trabaja 09:00–12:00: a las 14:00 el PATCH respondería 422.
  const tarde = await datos("reagendar_cita", recepcion(db), { citaId: "a-juan-s2", nuevaFecha: DIA, nuevaHora: "14:30" });
  assert.equal(tarde.estado, "no_disponible", JSON.stringify(tarde));
  assert.equal(tarde.causa, "sillon_no_disponible");

  const manana = await datos("reagendar_cita", recepcion(db), { citaId: "a-juan-s2", nuevaFecha: DIA, nuevaHora: "09:30" });
  assert.equal(manana.estado, "propuesta", JSON.stringify(manana));
});

test("una sola coincidencia por un pedazo de palabra se confirma antes de usarla", async () => {
  const db = baseAgenda();
  const debil = await datos("agendar_cita", recepcion(db), agendarJuan({ paciente: "uan" }));
  assert.equal(debil.estado, "pregunta", JSON.stringify(debil));
  assert.deepEqual(debil.preguntas[0].opciones.map((o: any) => o.id), ["p-juan"]);

  // El teléfono con lada y espacios («+52 55 …») lo encuentra la consulta
  // normalizada, que el doble no ejecuta (su `$queryRaw` lanza y se usa el
  // `contains`): aquí solo se prueban los formatos que llegan por el respaldo.
  for (const paciente of ["Juan Pér", "P0003", "5599990000"]) {
    const fuerte = await datos("agendar_cita", recepcion(db), agendarJuan({ paciente }));
    assert.equal(fuerte.estado, "propuesta", `${paciente}: ${JSON.stringify(fuerte)}`);
  }
});

test("revalidar con otra sesión: sin permiso, no vale", async () => {
  const db = baseAgenda();
  const d = await datos("cancelar_cita", recepcion(db), { citaId: "a-juan-10" });
  const r = await (catalogo as any).revalidarPropuestaAgenda(drSalas(db), d.propuesta);
  assert.equal(r.vigente, false);
});

test("interpretar: «ya hay una cita ahí» y «no tienes permiso» son frases distintas", async () => {
  const db = baseAgenda();
  const { propuesta } = await datos("agendar_cita", recepcion(db), agendarJuan());
  const interpretar = (catalogo as any).interpretarRespuestaAgenda;
  assert.equal(typeof interpretar, "function", "falta interpretarRespuestaAgenda");

  const ok = interpretar(propuesta, 201, { appointment: { id: "nueva" }, scheduleWarning: null });
  assert.equal(ok.ok, true);
  assert.equal(ok.motivo, "hecho");

  const solape = interpretar(propuesta, 409, {
    error: "appointment_overlap",
    conflictingAppointment: { id: "x", patientName: "Paciente privado", startsAt: iso(DIA, "09:00"), endsAt: iso(DIA, "09:30"), doctorId: U_DOC1, resourceId: null, status: "SCHEDULED" },
  });
  assert.equal(solape.ok, false);
  assert.equal(solape.motivo, "solape");
  assert.equal(solape.reintentar, true);
  assert.equal(solape.frase.includes("Paciente privado"), false);

  // Aunque la ruta mande el nombre (paciente no restringido), no se repite:
  // a un DOCTOR le diría quién ocupa el sillón de otro doctor.
  const conNombre = interpretar(propuesta, 409, {
    error: "appointment_overlap",
    conflictingAppointment: { id: "x", patientName: "Luis Gómez", startsAt: iso(DIA, "09:00"), endsAt: iso(DIA, "09:30"), doctorId: "otro", resourceId: "r-1", status: "SCHEDULED" },
  });
  assert.equal(conNombre.motivo, "solape");
  assert.equal(conNombre.frase.includes("Luis"), false);

  // El 401 también es 2FA o plan vencido (loadClinicSession los atrapa): no se afirma que fue la sesión.
  const sinAcceso = interpretar(propuesta, 401, { error: "unauthorized" });
  assert.equal(sinAcceso.motivo, "sin_sesion");
  assert.match(sinAcceso.frase, /dos pasos/);

  const rol = interpretar(propuesta, 403, { error: "forbidden" });
  const key = interpretar(propuesta, 403, { error: "Permiso requerido: agenda.create" });
  assert.equal(rol.motivo, "sin_permiso");
  assert.equal(key.motivo, "sin_permiso");
  assert.notEqual(rol.frase, key.frase);
  assert.match(key.frase, /Crear citas/);
  assert.equal(solape.frase === rol.frase, false);

  const pasado = interpretar(propuesta, 422, { error: "appointment_in_past", reason: "No se puede agendar una cita en una fecha u hora que ya pasó." });
  assert.equal(pasado.motivo, "regla");
  assert.match(pasado.frase, /ya pasó/);

  const noVe = interpretar(propuesta, 404, { error: "patient_not_found" });
  assert.equal(/no existe/i.test(noVe.frase), false);

  const roto = interpretar(propuesta, 500, { error: "PrismaClientKnownRequestError: la tabla appointments…", code: "P2002" });
  assert.equal(roto.motivo, "error_sistema");
  assert.equal(/prisma|tabla/i.test(roto.frase), false, "nunca se repite el texto interno");
  assert.match(roto.frase, /no (se guardó|quedó)/i);

  const cancel = await datos("cancelar_cita", admin(db), { citaId: "a-juan-pasada" }).catch(() => null);
  assert.ok(cancel);
  const { propuesta: pc } = await datos("cancelar_cita", recepcion(db), { citaId: "a-juan-10" });
  const transicion = interpretar(pc, 409, { error: "invalid_transition", reason: "No se puede pasar una cita de COMPLETED a CANCELLED." });
  assert.equal(transicion.motivo, "transicion_invalida");
  assert.equal(transicion.frase.includes("COMPLETED"), false, "los estados van en español");
  const hecho = interpretar(pc, 200, { ok: true });
  assert.equal(hecho.ok, true);
});
