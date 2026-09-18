/**
 * Las tres que sustituyen a las chips de /dashboard/patients (ws1-t5, «fuera
 * los cuatro filtros»): `cumpleanos`, `pacientes_con_etiqueta` y
 * `proximas_citas`.
 *
 * Run: npm run test:sabina-lista-pacientes
 *
 * Viven en `CONSULTAS` (engine-catalog.ts) y no en `CATALOGO_SABINA`, así que
 * se corren con `correrHerramienta` pasando la herramienta directa, igual que
 * clinico.test.ts. Lo que se vigila:
 *
 *  · el criterio es el de la chip que sustituyen (mes y día de `dob` sin el
 *    año; `tags hasSome`; `startsAt >= ahora` y ni canceladas ni no-asistidas);
 *  · el scope es el de la pantalla: un DOCTOR ve SUS pacientes y SUS citas, la
 *    restringida se enmascara, el cancelado por ARCO no sale en ninguna lista y
 *    la clínica de al lado tampoco;
 *  · sin permiso se DICE (`sin_permiso` con la key), no se devuelve vacío;
 *  · y ninguna manda expediente ni saldo.
 */

import "./preparar";
import { test } from "node:test";
import assert from "node:assert/strict";

import { tzLocalToUtc } from "@/lib/agenda/time-utils";
import { correrHerramienta } from "../base";
import { cumpleanos } from "../cumpleanos";
import { pacientesConEtiqueta } from "../pacientes-con-etiqueta";
import { proximasCitas } from "../proximas-citas";
import { sumarDias } from "../fechas";
import { SABINA_TOOLS } from "../../engine-catalog";
import { crearBase, type Fila } from "./doble-base";
import {
  CL_NORTE,
  CL_SUR,
  HOY_N,
  TZ_NORTE,
  U_ADMIN_N,
  U_DOC_N,
  U_DOC2_N,
  U_ADMIN_S,
  adminNorte,
  adminSur,
  conPermisos,
  datosDePrueba,
  doctorNorte,
  recepcionNorte,
} from "./siembra";

/** Medianoche UTC del día, como lo guarda `patient-create-core.ts`. */
function nacido(anio: number, mes: number, dia: number): Date {
  return new Date(Date.UTC(anio, mes - 1, dia));
}

/** `HOY_N` + n días, como mes/día de un `dob` de ese año. */
function cumpleEn(diasDesdeHoy: number, anioNacimiento: number): Date {
  const [, m, d] = sumarDias(HOY_N, diasDesdeHoy).split("-").map((x) => parseInt(x, 10));
  return nacido(anioNacimiento, m, d);
}

function en(dia: string, hora: number, min: number, tz = TZ_NORTE): Date {
  return tzLocalToUtc(dia, hora, min, tz);
}

const ANIO_HOY = parseInt(HOY_N.slice(0, 4), 10);

/**
 * La siembra común más lo que estas tres necesitan: fechas de nacimiento,
 * etiquetas y citas de los próximos días. Todo a partir de MAÑANA, para que la
 * prueba no dependa de la hora a la que corre.
 */
function baseLista() {
  const datos = datosDePrueba();
  const porId: Record<string, Fila> = {};
  for (const p of datos.patients ?? []) porId[p.id] = p;

  // Cumpleaños: Ana en 2 días, Beto en 20, la restringida en 3, el cancelado por
  // ARCO mañana (no debe salir), Sofía del SUR mañana (otra clínica).
  porId["p-ana"].dob = cumpleEn(2, 1990);
  porId["p-beto"].dob = cumpleEn(20, 1985);
  porId["p-priv"].dob = cumpleEn(3, 2001);
  porId["p-borrado"].dob = cumpleEn(1, 1970);
  porId["p-sur-1"].dob = cumpleEn(1, 1992);
  // Carla nació un 29 de febrero.
  porId["p-carla"].dob = nacido(2000, 2, 29);
  // Dora, un 2 de enero: para el rango que cruza el fin de año.
  porId["p-dora"].dob = nacido(1988, 1, 2);
  // Irma es INACTIVE y cumple en 4 días: sale, con su estado.
  porId["p-inact-5"].dob = cumpleEn(4, 1960);
  porId["p-inact-5"].status = "INACTIVE";

  // Etiquetas.
  porId["p-ana"].tags = ["VIP", "Alergia"];
  porId["p-carla"].tags = ["Alergia"];
  porId["p-priv"].tags = ["VIP"];
  porId["p-borrado"].tags = ["VIP"];
  porId["p-sur-1"].tags = ["VIP"];

  const mas = (n: number) => sumarDias(HOY_N, n);
  const citas: Fila[] = [
    { id: "px-ana-1", clinicId: CL_NORTE, patientId: "p-ana", doctorId: U_DOC_N, status: "CONFIRMED", type: "Limpieza", resourceId: null, startsAt: en(mas(1), 10, 0), endsAt: en(mas(1), 10, 30) },
    { id: "px-ana-2", clinicId: CL_NORTE, patientId: "p-ana", doctorId: U_DOC2_N, status: "SCHEDULED", type: "Revisión", resourceId: null, startsAt: en(mas(3), 12, 0), endsAt: en(mas(3), 12, 30) },
    { id: "px-priv", clinicId: CL_NORTE, patientId: "p-priv", doctorId: U_DOC_N, status: "CONFIRMED", type: "Consulta", resourceId: null, startsAt: en(mas(2), 9, 0), endsAt: en(mas(2), 9, 30) },
    { id: "px-beto", clinicId: CL_NORTE, patientId: "p-beto", doctorId: U_DOC2_N, status: "SCHEDULED", type: "Extracción", resourceId: null, startsAt: en(mas(5), 16, 0), endsAt: en(mas(5), 17, 0) },
    // Cancelada y no asistida: no son citas próximas.
    { id: "px-carla", clinicId: CL_NORTE, patientId: "p-carla", doctorId: U_DOC_N, status: "CANCELLED", type: "Consulta", resourceId: null, startsAt: en(mas(2), 11, 0), endsAt: en(mas(2), 11, 30) },
    { id: "px-elias", clinicId: CL_NORTE, patientId: "p-elias", doctorId: U_DOC_N, status: "NO_SHOW", type: "Consulta", resourceId: null, startsAt: en(mas(4), 11, 0), endsAt: en(mas(4), 11, 30) },
    // Fuera de la semana.
    { id: "px-dora", clinicId: CL_NORTE, patientId: "p-dora", doctorId: U_DOC_N, status: "CONFIRMED", type: "Consulta", resourceId: null, startsAt: en(mas(12), 11, 0), endsAt: en(mas(12), 11, 30) },
    // La del SUR, mañana: nunca en la del norte.
    { id: "px-sur", clinicId: CL_SUR, patientId: "p-sur-1", doctorId: U_ADMIN_S, status: "CONFIRMED", type: "Consulta", resourceId: null, startsAt: en(mas(1), 10, 0), endsAt: en(mas(1), 10, 30) },
  ];
  datos.appointments = [...(datos.appointments ?? []), ...citas];
  return crearBase(datos);
}

const SEMANA = { desde: sumarDias(HOY_N, 1), hasta: sumarDias(HOY_N, 7) };

/* ══════════════════════════════════════════════════════════════════════
 * el catálogo
 * ══════════════════════════════════════════════════════════════════════ */

test("las tres están en SABINA_TOOLS, que es lo que ve el motor", () => {
  for (const nombre of ["cumpleanos", "pacientes_con_etiqueta", "proximas_citas"]) {
    assert.ok(SABINA_TOOLS.some((t) => t.nombre === nombre), `falta ${nombre}`);
  }
});

/* ══════════════════════════════════════════════════════════════════════
 * cumpleanos
 * ══════════════════════════════════════════════════════════════════════ */

test("cumpleanos: sin parámetros son los próximos 7 días, por fecha y con la edad que cumple", async () => {
  const r = await correrHerramienta(cumpleanos, adminNorte(baseLista()), {});
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.datos.desde, HOY_N);
  assert.equal(r.datos.hasta, sumarDias(HOY_N, 6));
  // Ana (+2), Paula (+3), Irma (+4). Beto (+20) no; Borrado (ARCO) no; Sofía (SUR) no.
  assert.deepEqual(
    r.datos.cumpleanos.filas.map((f) => f.paciente),
    ["Ana Perez", "Paula Restringida", "Irma Antigua"],
  );
  const ana = r.datos.cumpleanos.filas[0];
  assert.equal(ana.fecha, sumarDias(HOY_N, 2));
  assert.equal(ana.cumple, ANIO_HOY - 1990);
  assert.equal(ana.telefono, "+52 55 1234 5678");
  // El estado de la ficha viaja y el resumen lo dice.
  assert.equal(r.datos.cumpleanos.filas[2].estado, "INACTIVE");
  assert.match(r.resumen, /3 pacientes cumplen años/);
  assert.match(r.resumen, /Irma Antigua .*\[inactivo\]/);
});

test("cumpleanos: «este mes» es el rango del 1 al último día, y Beto entra si cae dentro", async () => {
  const [y, m] = HOY_N.split("-").map((x) => parseInt(x, 10));
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const desde = `${HOY_N.slice(0, 7)}-01`;
  const hasta = `${HOY_N.slice(0, 7)}-${String(ultimo).padStart(2, "0")}`;
  const r = await correrHerramienta(cumpleanos, adminNorte(baseLista()), { desde, hasta });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const nombres = r.datos.cumpleanos.filas.map((f) => f.paciente);
  // Ana cumple en 2 días y Beto en 20: cada uno entra solo si ese día sigue
  // siendo de este mes (la prueba corre cualquier día del año).
  const esteMes = (dias: number) => sumarDias(HOY_N, dias).slice(0, 7) === HOY_N.slice(0, 7);
  assert.equal(nombres.includes("Ana Perez"), esteMes(2));
  const betoEsteMes = esteMes(20);
  assert.equal(nombres.includes("Beto Munoz"), betoEsteMes);
  assert.equal(nombres.includes("Borrado ARCO"), false);
});

test("cumpleanos: el 29 de febrero se felicita el 28 en año no bisiesto y el 29 en bisiesto", async () => {
  const noBisiesto = await correrHerramienta(cumpleanos, adminNorte(baseLista()), { desde: "2027-02-25", hasta: "2027-03-01" });
  assert.equal(noBisiesto.ok, true);
  if (!noBisiesto.ok) return;
  const carla = noBisiesto.datos.cumpleanos.filas.find((f) => f.paciente === "Carla Gomez");
  assert.ok(carla);
  assert.equal(carla.fecha, "2027-02-28");
  assert.equal(carla.cumple, 27);

  const bisiesto = await correrHerramienta(cumpleanos, adminNorte(baseLista()), { desde: "2028-02-25", hasta: "2028-03-01" });
  assert.equal(bisiesto.ok, true);
  if (!bisiesto.ok) return;
  assert.equal(bisiesto.datos.cumpleanos.filas.find((f) => f.paciente === "Carla Gomez")?.fecha, "2028-02-29");
});

test("cumpleanos: un rango que cruza el fin de año encuentra el cumpleaños de enero", async () => {
  const r = await correrHerramienta(cumpleanos, adminNorte(baseLista()), { desde: "2026-12-28", hasta: "2027-01-03" });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const dora = r.datos.cumpleanos.filas.find((f) => f.paciente === "Dora Sanchez");
  assert.ok(dora);
  assert.equal(dora.fecha, "2027-01-02");
  assert.equal(dora.cumple, 2027 - 1988);
});

test("🔴 cumpleanos: el DOCTOR solo ve a sus pacientes y la restringida no le sale", async () => {
  const r = await correrHerramienta(cumpleanos, doctorNorte(baseLista()), {});
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const nombres = r.datos.cumpleanos.filas.map((f) => f.paciente);
  assert.ok(nombres.includes("Ana Perez")); // su paciente (primaryDoctorId)
  assert.equal(nombres.includes("Paula Restringida"), false); // solo la ve el admin
  // Irma también es suya por la heurística de `buildPatientWhere`: tuvo una
  // cita con él (a-in-5), aunque no tenga doctor de cabecera. Es lo que le
  // pinta /dashboard/patients, así que Sabina le dice lo mismo.
  assert.ok(nombres.includes("Irma Antigua"));
});

test("🔴 cumpleanos: la clínica del SUR no ve a los del norte, y viceversa", async () => {
  const r = await correrHerramienta(cumpleanos, adminSur(baseLista()), {});
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.datos.cumpleanos.filas.map((f) => f.paciente), ["Sofia SUR"]);
});

test("cumpleanos: sin patients.view se DICE, no se devuelve vacío", async () => {
  const r = await correrHerramienta(cumpleanos, conPermisos(baseLista(), ["agenda.view"]), {});
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.motivo, "sin_permiso");
  assert.equal(r.permiso, "patients.view");
});

test("cumpleanos: sin nadie que cumpla es sin_datos, y un rango al revés es un error explicado", async () => {
  const nadie = await correrHerramienta(cumpleanos, adminNorte(baseLista()), { desde: sumarDias(HOY_N, 40), hasta: sumarDias(HOY_N, 41) });
  assert.equal(nadie.ok, false);
  if (!nadie.ok) assert.equal(nadie.motivo, "sin_datos");

  const reves = await correrHerramienta(cumpleanos, adminNorte(baseLista()), { desde: sumarDias(HOY_N, 5), hasta: HOY_N });
  assert.equal(reves.ok, false);
  if (!reves.ok) {
    assert.equal(reves.motivo, "error");
    assert.match(reves.detalle ?? "", /rango_invalido/);
  }
});

test("cumpleanos: no manda expediente", async () => {
  const r = await correrHerramienta(cumpleanos, adminNorte(baseLista()), {});
  const json = JSON.stringify(r);
  for (const campo of ["allergies", "alergias", "medications", "conditions", "notes", "balance"]) {
    assert.equal(json.indexOf(`"${campo}"`), -1, `se filtró ${campo}`);
  }
});

/* ══════════════════════════════════════════════════════════════════════
 * pacientes_con_etiqueta
 * ══════════════════════════════════════════════════════════════════════ */

test("pacientes_con_etiqueta: sin parámetros es VIP; el ARCO y la otra clínica no salen", async () => {
  const r = await correrHerramienta(pacientesConEtiqueta, adminNorte(baseLista()), {});
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.datos.etiqueta, "VIP");
  // Ana y Paula (la admin sí la ve). Borrado (ARCO) y Sofía (SUR) no.
  assert.deepEqual(r.datos.pacientes.filas.map((f) => f.paciente), ["Ana Perez", "Paula Restringida"]);
  assert.equal(r.datos.pacientes.total, 2);
  assert.deepEqual(r.datos.pacientes.filas[0].etiquetas, ["VIP", "Alergia"]);
  assert.match(r.resumen, /2 pacientes con la etiqueta VIP/);
});

test("pacientes_con_etiqueta: «vip» en minúsculas encuentra a los VIP", async () => {
  const r = await correrHerramienta(pacientesConEtiqueta, adminNorte(baseLista()), { etiqueta: "vip" });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.datos.pacientes.total, 2);
});

test("pacientes_con_etiqueta: otra etiqueta (Alergia) es el mismo criterio del cajón de filtros", async () => {
  const r = await correrHerramienta(pacientesConEtiqueta, adminNorte(baseLista()), { etiqueta: "Alergia" });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.datos.pacientes.filas.map((f) => f.paciente), ["Ana Perez", "Carla Gomez"]);
});

test("🔴 pacientes_con_etiqueta: recepción no ve a la paciente restringida", async () => {
  const r = await correrHerramienta(pacientesConEtiqueta, recepcionNorte(baseLista()), {});
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.datos.pacientes.filas.map((f) => f.paciente), ["Ana Perez"]);
  assert.equal(r.datos.pacientes.total, 1);
});

test("pacientes_con_etiqueta: sin permiso se dice; una etiqueta que nadie tiene es sin_datos", async () => {
  // Un override VACÍO cae al default del rol; hay que dejar alguna key que no
  // sea patients.view para que el corte sea el del permiso.
  const sin = await correrHerramienta(pacientesConEtiqueta, conPermisos(baseLista(), ["agenda.view"]), {});
  assert.equal(sin.ok, false);
  if (!sin.ok) {
    assert.equal(sin.motivo, "sin_permiso");
    assert.equal(sin.permiso, "patients.view");
  }
  const nadie = await correrHerramienta(pacientesConEtiqueta, adminNorte(baseLista()), { etiqueta: "Zurdo" });
  assert.equal(nadie.ok, false);
  if (!nadie.ok) assert.equal(nadie.motivo, "sin_datos");
});

test("pacientes_con_etiqueta: no manda saldo ni expediente", async () => {
  const r = await correrHerramienta(pacientesConEtiqueta, adminNorte(baseLista()), {});
  const json = JSON.stringify(r);
  for (const campo of ["balance", "saldo", "allergies", "notes", "medications"]) {
    assert.equal(json.indexOf(`"${campo}"`), -1, `se filtró ${campo}`);
  }
});

/* ══════════════════════════════════════════════════════════════════════
 * proximas_citas
 * ══════════════════════════════════════════════════════════════════════ */

test("proximas_citas: un paciente por fila con su cita más cercana; canceladas y no-asistidas fuera", async () => {
  const r = await correrHerramienta(proximasCitas, adminNorte(baseLista()), SEMANA);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  // Ana (+1, aunque también tiene +3), Paula (+2), Beto (+5). Carla cancelada,
  // Elías no asistió, Dora a 12 días y Sofía en la otra clínica: fuera.
  assert.deepEqual(
    r.datos.pacientes.filas.map((f) => f.paciente),
    ["Ana Perez", "Paula Restringida", "Beto Munoz"],
  );
  assert.equal(r.datos.pacientes.total, 3);
  // 4 citas activas en el rango (Ana tiene dos).
  assert.equal(r.datos.citas, 4);
  assert.equal(r.datos.alcance, "clinica");
  const ana = r.datos.pacientes.filas[0];
  assert.equal(ana.fecha, sumarDias(HOY_N, 1));
  assert.equal(ana.hora, "10:00");
  assert.equal(ana.doctor, "Hugo Salas");
  assert.equal(ana.estado, "confirmada");
  assert.equal(ana.motivo, "Limpieza");
  assert.equal(ana.telefono, "+52 55 1234 5678");
  assert.match(r.resumen, /3 pacientes con cita en la clínica/);
  assert.match(r.resumen, /4 citas en total/);
});

test("proximas_citas: sin parámetros es de hoy a dentro de una semana", async () => {
  const r = await correrHerramienta(proximasCitas, adminNorte(baseLista()), {});
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.datos.desde, HOY_N);
  assert.equal(r.datos.hasta, sumarDias(HOY_N, 6));
  assert.ok(r.datos.pacientes.filas.some((f) => f.paciente === "Ana Perez"));
  assert.equal(r.datos.pacientes.filas.some((f) => f.paciente === "Dora Sanchez"), false);
});

test("🔴 proximas_citas: el DOCTOR solo ve SUS citas y la restringida sale enmascarada", async () => {
  const r = await correrHerramienta(proximasCitas, doctorNorte(baseLista()), SEMANA);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.datos.alcance, "propio");
  // Suyas en el rango: Ana (+1) y Paula (+2). La de Ana con Nadia y la de Beto no.
  assert.deepEqual(r.datos.pacientes.filas.map((f) => f.paciente), ["Ana Perez", "Paciente privado"]);
  assert.equal(r.datos.citas, 2);
  const privada = r.datos.pacientes.filas[1];
  assert.equal(privada.folio, null);
  assert.equal(privada.telefono, null);
  assert.equal(JSON.stringify(r).indexOf("Restringida"), -1);
});

test("🔴 proximas_citas: la del SUR solo ve lo suyo", async () => {
  const r = await correrHerramienta(proximasCitas, adminSur(baseLista()), SEMANA);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.datos.pacientes.filas.map((f) => f.paciente), ["Sofia SUR"]);
  assert.equal(r.datos.citas, 1);
});

test("proximas_citas: exige agenda.view y lo dice; sin citas es sin_datos; rango absurdo es error", async () => {
  const sin = await correrHerramienta(proximasCitas, conPermisos(baseLista(), ["patients.view"]), SEMANA);
  assert.equal(sin.ok, false);
  if (!sin.ok) {
    assert.equal(sin.motivo, "sin_permiso");
    assert.equal(sin.permiso, "agenda.view");
  }
  const nadie = await correrHerramienta(proximasCitas, adminNorte(baseLista()), { desde: sumarDias(HOY_N, 30), hasta: sumarDias(HOY_N, 40) });
  assert.equal(nadie.ok, false);
  if (!nadie.ok) assert.equal(nadie.motivo, "sin_datos");

  const grande = await correrHerramienta(proximasCitas, adminNorte(baseLista()), { desde: HOY_N, hasta: sumarDias(HOY_N, 400) });
  assert.equal(grande.ok, false);
  if (!grande.ok) {
    assert.equal(grande.motivo, "error");
    assert.match(grande.detalle, /rango_demasiado_grande/);
  }
});

test("proximas_citas: no manda notas de la cita ni expediente", async () => {
  const r = await correrHerramienta(proximasCitas, adminNorte(baseLista()), SEMANA);
  const json = JSON.stringify(r);
  for (const campo of ["notes", "allergies", "balance", "medications"]) {
    assert.equal(json.indexOf(`"${campo}"`), -1, `se filtró ${campo}`);
  }
});

// Para que TypeScript no marque U_ADMIN_N como sin usar si la siembra cambia.
void U_ADMIN_N;
