/**
 * EL CONTRATO, herramienta por herramienta — los cuatro casos que pide el
 * prompt de esta tarea, para las diez: CON permiso, SIN permiso, SIN datos, y
 * con MÁS DE 50 FILAS.
 *
 * Run: npm run test:sabina-contrato
 *
 * ── POR QUÉ "SIN PERMISO" TIENE SU PROPIO CASO ─────────────────────────
 * Porque devolver una lista vacía cuando lo que falta es el acceso es la forma
 * de mentir sin decir una sola frase falsa:
 *
 *   ❌ «No tengo datos de facturación» → el doctor entiende que no se facturó.
 *   ✅ «No tienes acceso a facturación.»
 *
 * El motor depende de `motivo: "sin_permiso"` para poder decir la segunda. Si
 * alguna herramienta contestara `sin_datos` —o un `ok` con cero filas— cuando el
 * usuario no tiene la key, esa distinción se pierde aguas arriba y ya no se
 * puede recuperar. De ahí que se compruebe en las diez, una por una.
 */

import "./preparar";
import { test } from "node:test";
import assert from "node:assert/strict";

import { CATALOGO_SABINA, TOPE_FILAS, ejecutarHerramienta } from "../index";
import { sumarDias } from "../fechas";
import { crearBase, type Datos } from "./doble-base";
import {
  CL_NORTE,
  DIA_ALTAS_MASIVAS,
  DIA_LLENO,
  DIA_MUCHAS_AUSENCIAS,
  HOY_N,
  TZ_NORTE,
  U_ADMIN_N,
  adminNorte,
  base,
  conPermisos,
} from "./siembra";
import { crearSabinaCtx, type SabinaCtx } from "../../tipos";

/** Parámetros con los que cada herramienta SÍ encuentra datos en la siembra. */
function paramsConDatos(nombre: string): Record<string, unknown> {
  switch (nombre) {
    case "citas_del_dia":
      return { fecha: HOY_N };
    case "agenda_ocupacion":
    case "ausencias":
      return { desde: sumarDias(HOY_N, -30), hasta: HOY_N };
    case "pacientes_nuevos":
    case "ingresos_por_periodo":
    case "tratamientos_por_ingreso":
      return { desde: sumarDias(HOY_N, -10), hasta: HOY_N };
    case "buscar_paciente":
      return { termino: "Ana" };
    default:
      return {};
  }
}

/** Una clínica vacía: existe, pero sin una sola fila de datos. */
function baseVacia() {
  return crearBase({
    clinics: [{ id: CL_NORTE, timezone: TZ_NORTE, agendaDayStart: 8, agendaDayEnd: 20 }],
  });
}

/* ══════════════════════════════════════════════════════════════════════
 * 1 · CON PERMISO — la herramienta contesta con datos
 * ══════════════════════════════════════════════════════════════════════ */

test("con permiso: las diez contestan `ok` con su resumen de una línea", async () => {
  const db = base();
  for (const tool of CATALOGO_SABINA) {
    // Sesión con EXACTAMENTE la key que la herramienta declara y ninguna más:
    // así se comprueba que no exige de tapadillo otra cosa.
    const ctx = conPermisos(db, [tool.permiso]);
    const r = await ejecutarHerramienta(tool.nombre, ctx, paramsConDatos(tool.nombre));
    assert.equal(r.ok, true, `${tool.nombre}: ${JSON.stringify(r)}`);
    if (r.ok) {
      assert.equal(typeof r.resumen, "string");
      assert.equal(r.resumen.length > 10, true, `${tool.nombre}: el resumen es lo que deja contestar rápido; que diga algo`);
      // Un resumen que no lleva ni un número no sirve para contestar.
      if (tool.nombre !== "resumen_clinica") {
        assert.match(r.resumen, /\d/, `${tool.nombre}: el resumen tiene que llevar el número que contesta`);
      }
    }
  }
});

/* ══════════════════════════════════════════════════════════════════════
 * 2 · SIN PERMISO — `sin_permiso`, NUNCA una lista vacía
 * ══════════════════════════════════════════════════════════════════════ */

test("🔴 sin permiso: las diez devuelven `sin_permiso` con su key, no `sin_datos` ni cero filas", async () => {
  const db = base();
  // Un override con una sola key que NINGUNA herramienta usa. El override
  // REEMPLAZA al default del rol, así que esta sesión no tiene nada más.
  const ctx = conPermisos(db, ["settings.view"]);

  for (const tool of CATALOGO_SABINA) {
    const r = await ejecutarHerramienta(tool.nombre, ctx, paramsConDatos(tool.nombre));
    assert.equal(r.ok, false, `${tool.nombre} contestó con datos sin permiso`);
    assert.equal(
      (r as any).motivo,
      "sin_permiso",
      `${tool.nombre} devolvió "${(r as any).motivo}" en vez de "sin_permiso": el motor no podría distinguir «no tienes acceso» de «no hay datos»`,
    );
    assert.equal((r as any).permiso, tool.permiso, `${tool.nombre} no dice QUÉ permiso falta`);
  }

  // Y no se consultó la base: el corte por permiso va ANTES de la consulta.
  assert.equal(db.contador.llamadas.length, 0, "se consultó la base sin permiso");
});

test("🔴 sin permiso NO se disfraza de lista vacía: los dos casos son distinguibles", async () => {
  const conDatos = base();
  const vacia = baseVacia();

  // Misma pregunta, tres situaciones. Las tres respuestas tienen que ser
  // distintas, porque significan cosas distintas.
  const sinAcceso = await ejecutarHerramienta(
    "pacientes_con_deuda",
    conPermisos(conDatos, ["patients.view"]),
    {},
  );
  const sinDatos = await ejecutarHerramienta("pacientes_con_deuda", adminNorte(vacia), {});
  const conTodo = await ejecutarHerramienta("pacientes_con_deuda", adminNorte(conDatos), {});

  assert.deepEqual(sinAcceso, { ok: false, motivo: "sin_permiso", permiso: "billing.view" });
  assert.deepEqual(sinDatos, { ok: false, motivo: "sin_datos" });
  assert.equal(conTodo.ok, true);
});

/* ══════════════════════════════════════════════════════════════════════
 * 3 · SIN DATOS — `sin_datos`, y no un `ok` con listas en blanco
 * ══════════════════════════════════════════════════════════════════════ */

test("sin datos: nueve devuelven `sin_datos`; `resumen_clinica` contesta la foto en cero", async () => {
  const db = baseVacia();
  const ctx = adminNorte(db);

  for (const tool of CATALOGO_SABINA) {
    const r = await ejecutarHerramienta(tool.nombre, ctx, paramsConDatos(tool.nombre));
    if (tool.nombre === "resumen_clinica") {
      // A propósito: «tu clínica está en calma» es una respuesta, y si además
      // falta algún permiso hay que poder decirlo. Nunca es `sin_datos`.
      assert.equal(r.ok, true, "resumen_clinica tiene que poder contestar una clínica vacía");
      if (r.ok) {
        assert.equal(r.datos.citasHoy.activas, 0);
        assert.equal(r.datos.deuda.total, 0);
      }
      continue;
    }
    assert.equal(r.ok, false, `${tool.nombre} devolvió \`ok\` con la base vacía`);
    assert.equal((r as any).motivo, "sin_datos", `${tool.nombre}: ${JSON.stringify(r)}`);
  }
});

/* ══════════════════════════════════════════════════════════════════════
 * 4 · MÁS DE 50 FILAS — recorta a 50 y dice el total de verdad
 * ══════════════════════════════════════════════════════════════════════ */

test("tope de 50: `citas_del_dia` con 60 citas devuelve 50 y dice que hay 60", async () => {
  const r = await ejecutarHerramienta("citas_del_dia", adminNorte(base()), { fecha: DIA_LLENO });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.datos.citas.filas.length, TOPE_FILAS);
  assert.equal(r.datos.citas.total, 60, "el total REAL, no el recortado");
  assert.equal(r.datos.citas.truncado, true);
  // Y el conteo de activas es el de las 60, no el de las 50 leídas: sale de un
  // `groupBy` sobre todas las filas, no de la página.
  assert.equal(r.datos.activas, 60);
});

test("tope de 50: `ausencias` con 55 no-shows devuelve 50 y dice que hay 55", async () => {
  const r = await ejecutarHerramienta("ausencias", adminNorte(base()), {
    desde: sumarDias(DIA_MUCHAS_AUSENCIAS, -1),
    hasta: sumarDias(DIA_MUCHAS_AUSENCIAS, 1),
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.datos.ausencias.filas.length, TOPE_FILAS);
  assert.equal(r.datos.ausencias.total, 55);
  assert.equal(r.datos.ausencias.truncado, true);
  assert.match(r.resumen, /55 ausencias/);
});

test("tope de 50: `pacientes_nuevos` con 60 altas el mismo día devuelve 50 y dice 60", async () => {
  const r = await ejecutarHerramienta("pacientes_nuevos", adminNorte(base()), {
    desde: DIA_ALTAS_MASIVAS,
    hasta: DIA_ALTAS_MASIVAS,
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.datos.nuevos.filas.length, TOPE_FILAS);
  assert.equal(r.datos.nuevos.total, 60);
  assert.match(r.resumen, /van 50 de 60 pacientes/);
});

test("tope de 50: `buscar_paciente` con 60 coincidencias devuelve 50 y dice 60", async () => {
  const r = await ejecutarHerramienta("buscar_paciente", adminNorte(base()), { termino: "Masivo" });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.datos.resultados.filas.length, TOPE_FILAS);
  assert.equal(r.datos.resultados.total, 60);
  assert.match(r.resumen, /van 50 de 60 pacientes/);
});

test("tope de 50: `pacientes_con_deuda` con 55 deudores devuelve 50, ordenados, y dice 55", async () => {
  // Base a medida: 55 pacientes, cada uno con una factura de saldo creciente.
  const datos: Datos = {
    clinics: [{ id: CL_NORTE, timezone: TZ_NORTE, agendaDayStart: 8, agendaDayEnd: 20 }],
    patients: [],
    invoices: [],
  };
  for (let i = 0; i < 55; i++) {
    datos.patients.push({
      id: `p-${i}`, clinicId: CL_NORTE, firstName: "Deudor", lastName: `N${i}`,
      patientNumber: `D${i}`, status: "ACTIVE", visibleUserIds: [], deletedAt: null,
      createdAt: new Date(),
    });
    datos.invoices.push({
      id: `i-${i}`, clinicId: CL_NORTE, patientId: `p-${i}`, status: "PENDING",
      total: 100 + i, paid: 0, balance: 100 + i, discount: 0, dueDate: null,
      createdAt: new Date(), items: [],
    });
  }
  const db = crearBase(datos);
  const ctx: SabinaCtx = { ...adminNorte(db as any), userId: U_ADMIN_N };

  const r = await ejecutarHerramienta("pacientes_con_deuda", ctx, {});
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.datos.deudores.filas.length, TOPE_FILAS);
  assert.equal(r.datos.deudores.total, 55, "los 55 deudores de verdad");
  assert.equal(r.datos.deudores.truncado, true);
  // «van los 50 MAYORES», no los 50 primeros que salgan.
  assert.equal(r.datos.deudores.filas[0].saldo, 154);
  assert.equal(r.datos.deudores.filas[49].saldo, 105);
  // Y el monto total es el de los 55, no el de los 50 que se enseñan.
  const suma55 = Array.from({ length: 55 }, (_, i) => 100 + i).reduce((a, b) => a + b, 0);
  assert.equal(r.datos.totalAdeudado, suma55);
  assert.match(r.resumen, /van 50 de 55 pacientes/);
});

test("tope de 50: `tratamientos_por_ingreso` con 60 conceptos devuelve 50 y dice 60", async () => {
  const items = [];
  for (let i = 0; i < 60; i++) {
    items.push({ description: `Tratamiento ${i}`, quantity: 1, unitPrice: 100 + i, total: 100 + i });
  }
  const db = crearBase({
    clinics: [{ id: CL_NORTE, timezone: TZ_NORTE, agendaDayStart: 8, agendaDayEnd: 20 }],
    patients: [{ id: "p-1", clinicId: CL_NORTE, firstName: "Uno", lastName: "Uno", status: "ACTIVE", visibleUserIds: [], deletedAt: null, createdAt: new Date() }],
    invoices: [{
      id: "i-1", clinicId: CL_NORTE, patientId: "p-1", status: "PAID",
      total: 0, paid: 0, balance: 0, discount: 0, dueDate: null,
      createdAt: new Date(Date.now() - 86_400_000), items,
    }],
  });

  const r = await ejecutarHerramienta("tratamientos_por_ingreso", adminNorte(db as any), {
    desde: sumarDias(HOY_N, -3),
    hasta: HOY_N,
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.datos.tratamientos.filas.length, TOPE_FILAS);
  assert.equal(r.datos.tratamientos.total, 60);
  assert.equal(r.datos.tratamientos.truncado, true);
  // Ordenado por importe: el primero es el más caro.
  assert.equal(r.datos.tratamientos.filas[0].importe, 159);
});

test("tope de 50: `pacientes_inactivos` con 55 perdidos devuelve 50, del más antiguo, y dice 55", async () => {
  const datos: Datos = {
    clinics: [{ id: CL_NORTE, timezone: TZ_NORTE, agendaDayStart: 8, agendaDayEnd: 20 }],
    patients: [],
    appointments: [],
  };
  for (let i = 0; i < 55; i++) {
    datos.patients.push({
      id: `p-${i}`, clinicId: CL_NORTE, firstName: "Perdido", lastName: `N${i}`,
      patientNumber: `X${i}`, status: "ACTIVE", visibleUserIds: [], deletedAt: null,
      createdAt: new Date(0), phone: null,
    });
    datos.appointments.push({
      id: `a-${i}`, clinicId: CL_NORTE, patientId: `p-${i}`, doctorId: U_ADMIN_N,
      status: "COMPLETED", type: "Consulta",
      // 200 + i días: el índice más alto es el que lleva MÁS tiempo sin venir.
      startsAt: new Date(Date.now() - (200 + i) * 86_400_000),
      endsAt: new Date(Date.now() - (200 + i) * 86_400_000),
    });
  }
  const db = crearBase(datos);

  const r = await ejecutarHerramienta("pacientes_inactivos", adminNorte(db as any), { dias: 180 });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.datos.inactivos.filas.length, TOPE_FILAS);
  assert.equal(r.datos.inactivos.total, 55);
  assert.equal(r.datos.inactivos.truncado, true);
  // El primero es el más antiguo (el índice 54, con 254 días).
  assert.equal(r.datos.inactivos.filas[0].paciente, "Perdido N54");
  assert.equal(r.datos.inactivos.filas[0].diasSinVenir, 254);
});

test("las dos que NO pueden pasar de 50 filas, y por qué", async () => {
  const db = base();
  const ctx = adminNorte(db);

  // `agenda_ocupacion` devuelve SIEMPRE siete filas: una por día de la semana.
  // No hay tope que aplicar porque la forma del resultado no crece con los datos.
  const ocup = await ejecutarHerramienta("agenda_ocupacion", ctx, {
    desde: sumarDias(HOY_N, -30),
    hasta: HOY_N,
  });
  assert.equal(ocup.ok, true);
  if (ocup.ok) assert.equal(ocup.datos.porDia.length, 7);

  // `resumen_clinica` no devuelve listados: solo los totales de las demás, y las
  // partes que se omitieron por permiso. Tampoco crece.
  const res = await ejecutarHerramienta("resumen_clinica", ctx, {});
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(Array.isArray(res.datos.omitidas), true);
});

/* ══════════════════════════════════════════════════════════════════════
 * 5 · SOLO LECTURA, y lo que el modelo manda
 * ══════════════════════════════════════════════════════════════════════ */

test("🔴 solo lectura: ninguna herramienta llama a una operación de escritura", async () => {
  const db = base();
  const ctx = adminNorte(db);

  for (const tool of CATALOGO_SABINA) {
    await ejecutarHerramienta(tool.nombre, ctx, paramsConDatos(tool.nombre));
  }

  const escrituras = db.contador.llamadas.filter(
    (l) => ["create", "createMany", "update", "updateMany", "delete", "deleteMany", "upsert"].indexOf(l.op) !== -1,
  );
  assert.deepEqual(escrituras, [], "una herramienta intentó escribir");
  // Y algo se consultó de verdad: si no, la prueba de arriba sería vacía.
  assert.equal(db.contador.llamadas.length > 20, true);
});

test("un nombre de herramienta inventado se contesta, no revienta la conversación", async () => {
  const r = await ejecutarHerramienta("dame_todo", adminNorte(base()), {});
  assert.equal(r.ok, false);
  assert.equal((r as any).motivo, "error");
  assert.match((r as any).detalle, /herramienta_desconocida/);
  // Y le dice al modelo cuáles SÍ existen, para que no vuelva a inventar.
  assert.match((r as any).detalle, /citas_del_dia/);
});

test("parámetros basura se explican; no se consulta a ciegas", async () => {
  const db = base();
  const ctx = adminNorte(db);

  const malaFecha = await ejecutarHerramienta("citas_del_dia", ctx, { fecha: "el jueves" });
  assert.equal(malaFecha.ok, false);
  assert.match((malaFecha as any).detalle, /parametros_invalidos/);

  const fechaInexistente = await ejecutarHerramienta("citas_del_dia", ctx, { fecha: "2026-02-31" });
  assert.equal(fechaInexistente.ok, false);

  const alRevés = await ejecutarHerramienta("ausencias", ctx, { desde: HOY_N, hasta: sumarDias(HOY_N, -10) });
  assert.equal(alRevés.ok, false);
  assert.match((alRevés as any).detalle, /rango_invalido/);

  const enorme = await ejecutarHerramienta("ausencias", ctx, { desde: "2020-01-01", hasta: HOY_N });
  assert.equal(enorme.ok, false);
  assert.match((enorme as any).detalle, /rango_demasiado_grande/);

  assert.equal(db.contador.llamadas.length, 0, "se consultó la base con parámetros inválidos");
});

/* ══════════════════════════════════════════════════════════════════════
 * 6 · La puerta de entrada del motor
 * ══════════════════════════════════════════════════════════════════════ */

test("🔴 crearSabinaCtx: sin sesión devuelve null, y un clinicId a medias también", () => {
  // Es la línea que va a escribir el motor: `crearSabinaCtx(await getAuthContext())`.
  // `getAuthContext()` devuelve null sin sesión, así que tiene que aceptarlo.
  assert.equal(crearSabinaCtx(null), null);
  assert.equal(crearSabinaCtx(undefined), null);
  assert.equal(crearSabinaCtx({}), null);
  assert.equal(crearSabinaCtx({ clinicId: "", userId: "u1", role: "ADMIN" }), null);
  assert.equal(crearSabinaCtx({ clinicId: "  ", userId: "u1", role: "ADMIN" }), null);
  assert.equal(crearSabinaCtx({ clinicId: "c1", userId: "", role: "ADMIN" }), null);
  assert.equal(crearSabinaCtx({ clinicId: "c1", userId: "u1", role: "" }), null);
});

test("crearSabinaCtx: la zona sale de la CLÍNICA, y sin ella cae a México (no a UTC)", () => {
  const conZona = crearSabinaCtx({
    clinicId: "c1",
    userId: "u1",
    role: "ADMIN",
    clinic: { timezone: "America/Cancun", category: "DENTAL" },
  });
  assert.equal(conZona.timezone, "America/Cancun");
  assert.equal(conZona.clinicCategory, "DENTAL");

  // Una zona vacía NO puede caer al runtime default (UTC en Vercel): ése es el
  // offset de -6 h que vaciaba la vista Mes. Cae al mismo default que `safeTz`.
  for (const clinic of [null, {}, { timezone: null }, { timezone: "" }]) {
    const sinZona = crearSabinaCtx({ clinicId: "c1", userId: "u1", role: "ADMIN", clinic } as any);
    assert.equal(sinZona.timezone, "America/Mexico_City");
  }
});

test("crearSabinaCtx: `permissionsOverride` siempre llega como array", () => {
  // Si llegara `undefined`, la comprobación de permiso caería al default del rol
  // ignorando el override que sí está en la base — el mismo cinturón que pone
  // `getAuthContext`.
  assert.deepEqual(crearSabinaCtx({ clinicId: "c1", userId: "u1", role: "DOCTOR" }).permissionsOverride, []);
  assert.deepEqual(
    crearSabinaCtx({ clinicId: "c1", userId: "u1", role: "DOCTOR", permissionsOverride: null }).permissionsOverride,
    [],
  );
  assert.deepEqual(
    crearSabinaCtx({ clinicId: "c1", userId: "u1", role: "DOCTOR", permissionsOverride: ["agenda.view"] })
      .permissionsOverride,
    ["agenda.view"],
  );
});
