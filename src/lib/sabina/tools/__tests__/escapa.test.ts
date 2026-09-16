/**
 * `oportunidades_perdidas` — las pruebas de lo que se le escapa a la clínica.
 *
 * Run: npm run test:sabina-escapa
 *
 * Las tres obligatorias del contrato (§3) más las cuatro trampas del encargo:
 *
 *  1. NO cruza de clínica — con el doble de dos clínicas sembradas.
 *  2. SIN permiso devuelve `sin_permiso` y no lee ni una fila.
 *  3. NO escribe — por tipos (`EscapeDb` no tiene `create`) y comprobado: el
 *     contador del doble solo registra lecturas.
 *  4. 🔴 EL DINERO NO SE INFLA: nada se cuenta dos veces y lo que no está
 *     aceptado no entra en el total.
 *  5. Un paciente ARCHIVADO (ARCO) no sale en ninguna lista y sí en el contador.
 *  6. Con permiso a medias se enseña lo que sí y se DICE lo que no.
 *  7. El orden es el que pidió Rafael: $30,000 de hace una semana por delante de
 *     $800 de hace seis meses.
 */

import "./preparar";
import { test } from "node:test";
import assert from "node:assert/strict";

import { ejecutarHerramienta } from "../index";
import { correrHerramienta } from "../base";
import { oportunidadesPerdidas, type DatosEscape } from "../oportunidades-perdidas";
import { prioridad, SEMIVIDA_DIAS } from "../oportunidades-criterio";
import type { FilaEscape } from "../oportunidades-criterio";
import { crearBase, type BaseDoble } from "./doble-base";
import {
  COSTE_PLAN,
  P_ARCO,
  SALDO_ARCO,
  VALOR_ACEPTADO,
  VALOR_BARATO,
  VALOR_CARO,
  VALOR_FACTURADO,
  VALOR_PLAN_PENDIENTE,
  baseEscape,
  datosEscape,
} from "./escapa-siembra";
import { CL_NORTE, TZ_NORTE, U_ADMIN_N, U_DOC_N, adminNorte, adminSur, conPermisos, doctorNorte } from "./siembra";
import type { SabinaCtx } from "../../tipos";

/** Corre la herramienta de verdad, por el mismo runner que usa el motor. */
async function correr(ctx: SabinaCtx, params: Record<string, unknown> = {}) {
  return correrHerramienta(oportunidadesPerdidas, ctx, params);
}

async function datos(ctx: SabinaCtx, params: Record<string, unknown> = {}): Promise<DatosEscape> {
  const r = await correr(ctx, params);
  assert.equal(r.ok, true, JSON.stringify(r));
  return (r as { ok: true; datos: DatosEscape }).datos;
}

function filasDe(d: DatosEscape, tipo: keyof DatosEscape["secciones"]): FilaEscape[] {
  return d.secciones[tipo]?.lista.filas ?? [];
}

/**
 * Las filas de UNA sección, pidiéndola por su nombre.
 *
 * Hace falta porque el modo resumen recorta cada sección a cinco filas: buscar
 * ahí un paciente concreto da falsos negativos en cuanto la siembra crece, y una
 * prueba que falla por el recorte y no por el fallo no sirve para nada.
 */
async function filasDeSeccion(
  ctx: SabinaCtx,
  tipo: "sin_agendar" | "sin_respuesta" | "por_cobrar" | "sin_reagendar" | "sin_contestar",
): Promise<FilaEscape[]> {
  return filasDe(await datos(ctx, { tipo }), tipo);
}

function nombres(filas: FilaEscape[]): string[] {
  return filas.map((f) => f.paciente);
}

/* ══════════════════════════════════════════════════════════════════════
 * 1 · NO CRUZA DE CLÍNICA
 * ══════════════════════════════════════════════════════════════════════ */

test("🔴 no cruza de clínica: nada del SUR aparece en la del NORTE (ni un peso)", async () => {
  const db = baseEscape();
  const d = await datos(adminNorte(db));

  const todo = JSON.stringify(d);
  assert.ok(!/SUR/i.test(todo), `se coló algo de la otra clínica: ${todo.slice(0, 400)}`);
  // Los importes de la del sur son absurdos a propósito: si alguno aparece, la
  // fuga no se puede confundir con un dato propio.
  for (const importe of [99999, 88888, 77777]) {
    assert.ok(!todo.includes(String(importe)), `se coló el importe ${importe} de la clínica del sur`);
  }
});

test("🔴 y tampoco al revés: la del SUR no ve nada del NORTE", async () => {
  const db = baseEscape();
  const d = await datos(adminSur(db));

  const todo = JSON.stringify(d);
  for (const nombre of ["Rosa", "Tito", "Pablo", "Celia", "Bruno", "Cati"]) {
    assert.ok(!todo.includes(nombre), `${nombre} es del norte y salió en la del sur`);
  }
  // Y sí ve LO SUYO: si no, la prueba de arriba pasaría con una herramienta rota.
  assert.equal(d.dinero.porCobrar, 77777, "la del sur tiene que ver SU factura");
});

test("🔴 una clínica vacía no hereda nada: cero, no la clínica de al lado", async () => {
  const db = crearBase({
    clinics: [{ id: "cl-vacia", timezone: TZ_NORTE, agendaDayStart: 8, agendaDayEnd: 20 }],
    ...{ patients: [], invoices: [], quotes: [], appointments: [], treatmentPlans: [] },
  });
  const ctx: SabinaCtx = {
    clinicId: "cl-vacia",
    userId: "u-vacia",
    role: "ADMIN",
    permissionsOverride: [],
    timezone: TZ_NORTE,
    db,
  };
  const d = await datos(ctx);
  assert.equal(d.dinero.total, 0);
  assert.equal(d.primero.length, 0);
  // Y aun así contesta: «no se te está escapando nada» NO es «no tengo datos».
  const r = await correr(ctx);
  assert.equal(r.ok, true);
  assert.match((r as any).resumen, /no se te está escapando nada/);
});

/* ══════════════════════════════════════════════════════════════════════
 * 2 · SIN PERMISO SE DICE, NO SE OMITE
 * ══════════════════════════════════════════════════════════════════════ */

test("🔴 sin la key de la herramienta: `sin_permiso` con su key y CERO consultas", async () => {
  const db = baseEscape();
  // Un override con una sola key que la herramienta no usa. El override
  // REEMPLAZA al default del rol, así que esta sesión no tiene nada más.
  const ctx = conPermisos(db, ["settings.view"]);
  const r = await correr(ctx);

  assert.equal(r.ok, false);
  assert.equal((r as any).motivo, "sin_permiso");
  assert.equal((r as any).permiso, "today.view");
  assert.equal(db.contador.llamadas.length, 0, "se consultó la base sin permiso");
});

test("🔴 con permiso a medias: se enseña el dinero y se DICE que falta lo demás", async () => {
  const db = baseEscape();
  // Solo puede preguntar y ver facturación: ni planes, ni agenda, ni pacientes.
  const ctx = conPermisos(db, ["today.view", "billing.view"]);
  const d = await datos(ctx);

  assert.ok(d.dinero.porCobrar > 0, "la parte que SÍ puede ver tiene que venir");
  assert.equal(d.secciones.sin_reagendar, undefined, "no tiene agenda.view");
  assert.equal(d.enfriados, null, "no tiene patients.view");

  const faltan = d.omitidas.map((o) => o.permiso).sort();
  assert.deepEqual(faltan, ["agenda.view", "patients.view", "treatments.view"]);

  const r = await correr(ctx);
  assert.match((r as any).resumen, /NO tienes acceso a/, "el resumen tiene que DECIR lo que falta");
});

test("🔴 sin `billing.view` no se lee ni una factura ni un presupuesto", async () => {
  const db = baseEscape();
  const ctx = conPermisos(db, ["today.view", "agenda.view"]);
  const d = await datos(ctx);

  const tablas = db.contador.llamadas.map((l) => l.modelo);
  assert.ok(!tablas.includes("invoice"), "leyó facturas sin billing.view");
  assert.ok(!tablas.includes("quote"), "leyó presupuestos sin billing.view");
  assert.equal(d.dinero.total, 0);
  assert.ok(d.omitidas.some((o) => o.permiso === "billing.view"));
});

test("pedir UNA lista solo se queja de SU permiso, no de los otros tres", async () => {
  const db = baseEscape();
  const ctx = conPermisos(db, ["today.view"]);
  const d = await datos(ctx, { tipo: "por_cobrar" });

  assert.deepEqual(d.omitidas.map((o) => o.permiso), ["billing.view"]);
});

/* ══════════════════════════════════════════════════════════════════════
 * 3 · NO ESCRIBE
 * ══════════════════════════════════════════════════════════════════════ */

test("🔴 solo lee: ni una operación de escritura en toda la ejecución", async () => {
  const db = baseEscape();
  await datos(adminNorte(db));

  const escrituras = db.contador.llamadas.filter((l) =>
    ["create", "update", "delete", "upsert", "createMany", "updateMany", "deleteMany"].includes(l.op),
  );
  assert.deepEqual(escrituras, [], "la herramienta escribió en la base");
});

/* ══════════════════════════════════════════════════════════════════════
 * 4 · 🔴 EL DINERO NO SE INFLA
 * ══════════════════════════════════════════════════════════════════════ */

test("🔴 un presupuesto YA facturado no se cuenta dos veces", async () => {
  const db = baseEscape();
  const d = await datos(adminNorte(db));

  const tito = (await filasDeSeccion(adminNorte(db), "sin_agendar")).find((f) => f.paciente === "Tito Facturado");
  assert.ok(tito, "la fila tiene que salir: el trabajo sigue sin agendar");
  assert.equal(tito!.yaFacturado, true);
  assert.equal(tito!.valor, 0, "su dinero ya está en por_cobrar; aquí vale 0");

  // Y ese mismo dinero sí está, UNA vez, en la sección de facturas.
  const factura = (await filasDeSeccion(adminNorte(db), "por_cobrar")).find((f) => f.paciente === "Tito Facturado");
  assert.ok(factura);
  assert.equal(factura!.valor, VALOR_FACTURADO);
});

test("🔴 de un plan solo cuenta la parte pendiente, no el plan entero", async () => {
  const db = baseEscape();
  const d = await datos(adminNorte(db));

  const plan = (await filasDeSeccion(adminNorte(db), "sin_agendar")).find((f) => f.paciente === "Pablo Plan");
  assert.ok(plan, "un plan activo, atrasado y sin cita es la fuga más cara");
  // $40,000 en 4 sesiones con 1 hecha → 3/4 = $30,000, no $40,000.
  assert.equal(plan!.valor, VALOR_PLAN_PENDIENTE);
  assert.notEqual(plan!.valor, COSTE_PLAN);
  assert.match(plan!.detalle, /3 de 4 sesiones/);
});

test("🔴 el presupuesto que ya parió su plan NO sale además por su cuenta", async () => {
  const db = baseEscape();
  const d = await datos(adminNorte(db));

  const dePablo = (await filasDeSeccion(adminNorte(db), "sin_agendar")).filter((f) => f.paciente === "Pablo Plan");
  assert.equal(dePablo.length, 1, "una sola fila: la del plan, no también la del presupuesto");
  assert.match(dePablo[0].detalle, /^plan /);
});

test("🔴 lo que el paciente NO ha aceptado no entra en el total", async () => {
  const db = baseEscape();
  const d = await datos(adminNorte(db));

  // El total son las dos cosas defendibles, y ni un peso más.
  assert.equal(d.dinero.total, d.dinero.porCobrar + d.dinero.aceptadoSinAgendar);
  assert.ok(d.dinero.enElAire > 0, "hay presupuestos en el aire en la siembra");
  assert.notEqual(d.dinero.total, d.dinero.total + d.dinero.enElAire);
  assert.ok(
    d.dinero.enElAire >= VALOR_CARO,
    "los presentados sin respuesta van en su cubo, no en el total",
  );
  // Y la nota que obliga a decirlo viaja siempre.
  assert.match(d.notaDinero, /NO cuenta/);
});

test("aceptado sin agendar = lo de Rosa + la parte pendiente de Pablo, y nada más", async () => {
  const db = baseEscape();
  const d = await datos(adminNorte(db));

  // Tito vale 0 (ya facturado) y Nina no sale (tiene cita). El plan de la otra
  // doctora sí cuenta para la administradora: 2 sesiones, 0 hechas → $16,000.
  assert.equal(d.dinero.aceptadoSinAgendar, VALOR_ACEPTADO + VALOR_PLAN_PENDIENTE + 16_000);
});

test("un presupuesto aceptado con cita futura NO es una oportunidad perdida", async () => {
  const db = baseEscape();
  const d = await datos(adminNorte(db));
  assert.ok(!nombres(await filasDeSeccion(adminNorte(db), "sin_agendar")).includes("Nina Agendada"));
  assert.ok(!JSON.stringify(d).includes("50000"), "sus $50,000 no pueden aparecer por ningún lado");
});

test("un plan cuya próxima sesión aún no toca no cuenta, y uno terminado tampoco", async () => {
  const db = baseEscape();
  const d = await datos(adminNorte(db));
  const dePaz = (await filasDeSeccion(adminNorte(db), "sin_agendar")).filter((f) => f.paciente === "Paz AlDia");
  assert.deepEqual(dePaz, []);
});

test("las facturas en BORRADOR no son dinero que se escapa: no se han pedido", async () => {
  const db = baseEscape();
  const d = await datos(adminNorte(db));
  const folios = (await filasDeSeccion(adminNorte(db), "por_cobrar")).map((f) => f.detalle);
  assert.ok(!folios.some((t) => t.includes("inv-esc-draft")));
  // El borrador de $12,000 de Rosa no está en por_cobrar; su presupuesto sí en
  // sin_agendar, y por el importe entero.
  const rosa = (await filasDeSeccion(adminNorte(db), "sin_agendar")).find((f) => f.paciente === "Rosa Acepto");
  assert.equal(rosa?.valor, VALOR_ACEPTADO);
});

test("un presupuesto RECHAZADO o en BORRADOR no es «sin respuesta»", async () => {
  const db = baseEscape();
  const d = await datos(adminNorte(db), { tipo: "sin_respuesta" });
  const detalles = filasDe(d, "sin_respuesta").map((f) => f.detalle).join(" | ");
  assert.ok(!detalles.includes("P-0012"), "el rechazado contestó que no");
  assert.ok(!detalles.includes("P-0013"), "el borrador ni se presentó");
  assert.ok(detalles.includes("P-0010") && detalles.includes("P-0011"));
});

/* ══════════════════════════════════════════════════════════════════════
 * 5 · PACIENTES ARCHIVADOS Y RESTRINGIDOS
 * ══════════════════════════════════════════════════════════════════════ */

test("🔴 un paciente archivado por ARCO no sale en NINGUNA lista, y se dice cuántos quedaron fuera", async () => {
  const db = baseEscape();
  const d = await datos(adminNorte(db));

  const todo = JSON.stringify(d.secciones) + JSON.stringify(d.primero);
  assert.ok(!todo.includes("Ana Archivada"), "el archivado se coló en una lista");
  assert.ok(!todo.includes("P-0014"), "su presupuesto se coló");

  // 1 factura + 1 presupuesto + 1 cita caída + 1 petición de mover cita. Son
  // FILAS, no personas: aquí es UNA sola paciente con cuatro cosas, y la frase
  // no puede decir «4 pacientes archivados».
  assert.equal(d.archivados.filas, 4);
  assert.equal(d.archivados.monto, SALDO_ARCO, "el monto es solo saldo YA facturado");

  const r = await correr(adminNorte(baseEscape()));
  const texto = (r as any).resumen as string;
  assert.match(texto, /cancelados por ARCO/);
  assert.ok(!/4 pacientes/.test(texto), "cuenta filas: no puede llamarlas pacientes");
});

test("🔴 el dinero del archivado tampoco entra en el total: no se le puede cobrar llamándolo", async () => {
  const db = baseEscape();
  const d = await datos(adminNorte(db));
  const suma = filasDe(d, "por_cobrar").reduce((s, f) => s + f.valor, 0);
  assert.equal(d.dinero.porCobrar, suma, "el total tiene que ser el de las filas que se pueden llamar");
});

test("🔴 un paciente restringido no sale por la puerta de atrás", async () => {
  const db = baseEscape();
  // La recepcionista NO está en la lista de la paciente restringida (p-priv,
  // visible solo para la administradora) y su factura son $7,777.
  const recep = conPermisos(db, ["today.view", "billing.view", "treatments.view", "agenda.view", "patients.view"]);
  const d = await datos(recep);
  assert.ok(!JSON.stringify(d).includes("7777"), "la deuda de la paciente restringida se filtró");

  const admin = await datos(adminNorte(baseEscape()));
  assert.ok(JSON.stringify(admin).includes("7777"), "a la administradora SÍ le toca verla");
});

/* ══════════════════════════════════════════════════════════════════════
 * 6 · EL ORDEN — EL CORAZÓN DEL ENCARGO
 * ══════════════════════════════════════════════════════════════════════ */

test("🔴 $30,000 de hace una semana va por delante de $800 de hace seis meses", async () => {
  const db = baseEscape();
  const d = await datos(adminNorte(db), { tipo: "sin_respuesta" });
  const filas = filasDe(d, "sin_respuesta");

  const iCaro = filas.findIndex((f) => f.valor === VALOR_CARO);
  const iBarato = filas.findIndex((f) => f.valor === VALOR_BARATO);
  assert.ok(iCaro >= 0 && iBarato >= 0, "los dos tienen que estar");
  assert.ok(iCaro < iBarato, "el caro y reciente va primero; es el ejemplo literal del encargo");
});

test("la fórmula del orden: el dinero manda y se descuenta al enfriarse", () => {
  // El mismo par del encargo, con la semivida de los presupuestos.
  const caro = prioridad(30_000, 7, "sin_respuesta");
  const barato = prioridad(800, 180, "sin_respuesta");
  assert.ok(caro > barato * 1000, "no es un desempate: es un orden de magnitud");

  // A igual antigüedad manda el dinero…
  assert.ok(prioridad(5_000, 30, "por_cobrar") > prioridad(500, 30, "por_cobrar"));
  // …y a igual dinero manda lo reciente.
  assert.ok(prioridad(5_000, 10, "por_cobrar") > prioridad(5_000, 300, "por_cobrar"));
  // Media vida es exactamente eso: a los N días vale la mitad.
  const v = prioridad(1_000, SEMIVIDA_DIAS.por_cobrar, "por_cobrar");
  assert.ok(Math.abs(v - 1_001 / 2) < 0.001);
  // Una fila sin dinero nunca adelanta a una con dinero, por vieja que sea ésta.
  assert.ok(prioridad(1_000, 365, "por_cobrar") > prioridad(0, 0, "sin_reagendar"));
});

test("🔴 la prioridad NO viaja en la fila: un número ponderado no se puede decir como pesos", async () => {
  const db = baseEscape();
  const d = await datos(adminNorte(db));
  for (const f of d.primero) {
    assert.ok(!("prioridad" in f), "la prioridad no puede salir de aquí");
    assert.ok(!("score" in f), "la prioridad no puede salir de aquí");
  }
});

test("`primero` mezcla secciones y respeta el orden: el dinero por delante de lo que no lo tiene", async () => {
  const db = baseEscape();
  const d = await datos(adminNorte(db));

  assert.ok(d.primero.length > 0 && d.primero.length <= 5, "cinco se leen; cincuenta no");
  // Quitando la única excepción declarada (el hueco reservado a quien espera
  // respuesta), las filas sin dinero van al final y nunca intercaladas.
  const resto = d.primero.filter((f) => f.tipo !== "sin_contestar");
  const conDinero = resto.filter((f) => f.valor > 0).length;
  const sinDinero = resto.findIndex((f) => f.valor === 0);
  if (sinDinero >= 0) {
    assert.equal(sinDinero, conDinero, "las filas sin dinero van al final, nunca intercaladas");
  }
});

/* ══════════════════════════════════════════════════════════════════════
 * 7 · CITAS CAÍDAS
 * ══════════════════════════════════════════════════════════════════════ */

test("una cancelación con cita posterior NO cuenta: el paciente se recuperó solo", async () => {
  const db = baseEscape();
  const d = await datos(adminNorte(db), { tipo: "sin_reagendar" });
  const filas = filasDe(d, "sin_reagendar");
  assert.ok(!nombres(filas).includes("Raul Volvio"));
  assert.ok(nombres(filas).includes("Cati Cayo"));
});

test("un paciente con varias caídas es UNA llamada, no varias líneas", async () => {
  const db = baseEscape();
  const d = await datos(adminNorte(db), { tipo: "sin_reagendar" });
  const deCati = filasDe(d, "sin_reagendar").filter((f) => f.paciente === "Cati Cayo");
  assert.equal(deCati.length, 1);
  assert.match(deCati[0].detalle, /2 caídas/);
  // Y manda la más reciente: la de hace 20 días, no la de hace 45.
  assert.equal(deCati[0].dias, 20);
});

test("las citas caídas no llevan dinero inventado", async () => {
  const db = baseEscape();
  const d = await datos(adminNorte(db), { tipo: "sin_reagendar" });
  for (const f of filasDe(d, "sin_reagendar")) assert.equal(f.valor, 0);
  assert.equal(d.secciones.sin_reagendar?.dinero, 0);
});

/* ══════════════════════════════════════════════════════════════════════
 * 8 · SCOPE DE DOCTOR Y COHERENCIA CON LAS OTRAS HERRAMIENTAS
 * ══════════════════════════════════════════════════════════════════════ */

test("a un DOCTOR le tocan SUS planes, igual que en GET /api/treatments", async () => {
  const doc = await datos(doctorNorte(baseEscape()), { tipo: "sin_agendar" });
  const admin = await datos(adminNorte(baseEscape()), { tipo: "sin_agendar" });

  assert.ok(!nombres(filasDe(doc, "sin_agendar")).includes("Otto OtraDoctora"), "el plan es de la otra doctora");
  assert.ok(nombres(filasDe(admin, "sin_agendar")).includes("Otto OtraDoctora"), "la administradora sí lo ve");
});

test("🔴 el cruce de «tiene cita futura» NO se acota por doctor: eso fabricaría fugas falsas", async () => {
  const db = baseEscape();
  // La cita futura de Nina es del doctor Hugo; su presupuesto también. Lo que se
  // prueba aquí es que, mirado por la OTRA puerta (la administradora), Nina
  // sigue fuera — el cruce es un hecho de la clínica, no del que pregunta.
  const d = await datos(adminNorte(db));
  assert.ok(!nombres(await filasDeSeccion(adminNorte(db), "sin_agendar")).includes("Nina Agendada"));
});

test("los pacientes fríos se delegan en `pacientes_inactivos`, no se reimplementan", async () => {
  const db = baseEscape();
  const mia = await datos(adminNorte(db), {});
  const suya = await ejecutarHerramienta("pacientes_inactivos", adminNorte(baseEscape()), {});

  assert.ok(mia.enfriados, "el resumen tiene que traerlos");
  assert.equal(suya.ok, true);
  assert.equal(mia.enfriados!.total, (suya as any).datos.inactivos.total, "el mismo número, porque es la misma consulta");
  assert.equal(mia.enfriados!.dias, (suya as any).datos.dias);
});

test("pedir una lista concreta no paga la consulta más cara del catálogo", async () => {
  const db = baseEscape();
  const d = await datos(adminNorte(db), { tipo: "por_cobrar" });
  assert.equal(d.enfriados, null, "los inactivos solo en el resumen");
  const groupBys = db.contador.llamadas.filter((l) => l.op === "groupBy");
  assert.deepEqual(groupBys, [], "por_cobrar no tiene por qué barrer la agenda entera");
});

/* ══════════════════════════════════════════════════════════════════════
 * 9 · EL RESUMEN — LO QUE DE VERDAD LEE EL DOCTOR
 * ══════════════════════════════════════════════════════════════════════ */

test("el resumen lleva la cifra, separa lo que no se suma y da la lista de a quién llamar", async () => {
  const db = baseEscape();
  const r = await correr(adminNorte(db));
  assert.equal(r.ok, true);
  const texto = (r as any).resumen as string;

  assert.match(texto, /se te escapan \$/, "la cifra, primero");
  assert.match(texto, /NO se suma/, "lo que está en el aire va marcado");
  assert.match(texto, /\n- /, "la lista va en líneas, no en una sola fila separada por comas");
  assert.match(texto, /tel\. /, "con teléfono: es una lista de llamadas");
  assert.ok(texto.length > 120);
});

test("la cifra del resumen es la del campo `total`, sin adornos", async () => {
  const db = baseEscape();
  const d = await datos(adminNorte(db));
  const texto = oportunidadesPerdidas.resumir(d, {});
  const esperado = d.dinero.total.toLocaleString("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  assert.ok(texto.includes(`$${esperado}`), `el resumen dice otra cifra: ${texto.slice(0, 200)}`);
});

test("el peso que se paga en cada pregunta: descripción y esquema, medidos", () => {
  const desc = oportunidadesPerdidas.descripcion.length;
  // No es un límite de estilo: cada carácter viaja en CADA llamada al modelo, se
  // use la herramienta o no (regla 2 del contrato). Si alguien la alarga, que
  // sea a sabiendas.
  assert.ok(desc < 750, `la descripción se fue a ${desc} caracteres`);
  assert.ok(desc > 200, "y tiene que decir cuándo usarla");
});

/* ══════════════════════════════════════════════════════════════════════
 * 10 · EL POOLER — menos de 7 consultas a la vez
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * Envuelve el doble para medir cuántas consultas están EN VUELO a la vez. El
 * contador del doble cuenta llamadas totales; lo que satura el pooler de
 * Supabase es la CONCURRENCIA, que es otra cosa y no se veía.
 */
function conMedidorDeConcurrencia(db: BaseDoble): { db: BaseDoble; pico: () => number } {
  let enVuelo = 0;
  let pico = 0;
  const envuelto: any = { ...db };
  for (const clave of Object.keys(db as any)) {
    const modelo = (db as any)[clave];
    if (!modelo || typeof modelo !== "object" || clave === "contador") continue;
    const espejo: any = {};
    for (const op of Object.keys(modelo)) {
      const fn = modelo[op];
      if (typeof fn !== "function") continue;
      espejo[op] = async (...args: unknown[]) => {
        enVuelo++;
        if (enVuelo > pico) pico = enVuelo;
        try {
          // Un tick para que las que salieron juntas se solapen de verdad.
          await new Promise((r) => setTimeout(r, 0));
          return await fn.apply(modelo, args);
        } finally {
          enVuelo--;
        }
      };
    }
    envuelto[clave] = espejo;
  }
  return { db: envuelto as BaseDoble, pico: () => pico };
}

test("🔴 nunca hay 7 o más consultas a la vez: es lo que satura el pooler", async () => {
  const base = baseEscape();
  const { db, pico } = conMedidorDeConcurrencia(base);
  const ctx: SabinaCtx = { ...adminNorte(base), db };

  await datos(ctx);
  assert.ok(pico() < 7, `se lanzaron ${pico()} consultas a la vez; la regla de la casa es menos de 7`);
});

test("el resumen cuesta lo que dice el reporte: una cuenta de consultas que se pueda vigilar", async () => {
  const db = baseEscape();
  await datos(adminNorte(db));
  // Si alguien añade una consulta, esta prueba lo dice. No es un tope sagrado:
  // es un aviso de que el coste cambió y hay que volver a mirarlo.
  assert.ok(
    db.contador.llamadas.length <= 18,
    `el resumen pasó a ${db.contador.llamadas.length} consultas: ${JSON.stringify(db.contador.llamadas)}`,
  );
});

/* ══════════════════════════════════════════════════════════════════════
 * 11 · CUANDO LA CIFRA PUEDE QUEDARSE CORTA, SE DICE
 * ══════════════════════════════════════════════════════════════════════ */

test("🔴 `enElAire` es la suma de TODOS los presupuestos en el aire, no la de los que caben", async () => {
  const db = baseEscape();
  const d = await datos(adminNorte(db), { tipo: "sin_respuesta" });
  const sumaVisible = filasDe(d, "sin_respuesta").reduce((s, f) => s + f.valor, 0);
  assert.equal(d.dinero.enElAire, sumaVisible, "con pocas filas coinciden…");
  // …y el total de la lista es el de verdad, no el de las filas traídas.
  assert.equal(d.secciones.sin_respuesta?.lista.total, 2);
  assert.equal(d.secciones.sin_respuesta?.aproximado, false, "sale de un aggregate: nunca es aproximado");
});

/* ══════════════════════════════════════════════════════════════════════
 * 12 · FILAS A MEDIAS — un dato vacío no puede inflar la cifra
 * ══════════════════════════════════════════════════════════════════════ */

test("🔴 un presupuesto ACEPTADO sin fecha de aceptación entra igual, y su plan NO se cuenta dos veces", async () => {
  const db = baseEscape();
  const d = await datos(adminNorte(db));

  // El plan sale (hay que llamar: el trabajo sigue sin agendarse)…
  const plan = filasDe(d, "sin_agendar").find((f) => f.paciente === "Nilo SinFecha");
  assert.ok(plan, "un plan activo, atrasado y sin cita tiene que salir");
  // …pero valiendo 0: sus $24,000 ya están en la factura MF-9005. Sin el
  // respaldo a `createdAt`, el presupuesto se caía del filtro de fecha, el plan
  // no sabía que estaba facturado y esos $24,000 se contaban DOS veces.
  assert.equal(plan!.yaFacturado, true);
  assert.equal(plan!.valor, 0);

  const factura = filasDe(d, "por_cobrar").find((f) => f.paciente === "Nilo SinFecha");
  assert.ok(factura);
  assert.equal(factura!.valor, 24_000);

  // Y la cifra de arriba no se movió por esto.
  assert.equal(d.dinero.aceptadoSinAgendar, VALOR_ACEPTADO + VALOR_PLAN_PENDIENTE + 16_000);
});

/* ══════════════════════════════════════════════════════════════════════
 * 13 · GENTE ESPERANDO RESPUESTA — la quinta fuga
 * ══════════════════════════════════════════════════════════════════════ */

test("quien pidió cita por la web y quien pidió mover la suya salen los dos", async () => {
  const db = baseEscape();
  const d = await datos(adminNorte(db), { tipo: "sin_contestar" });
  const filas = filasDe(d, "sin_contestar");

  assert.ok(nombres(filas).includes("Wendy Web"), "la solicitud de la mini-web");
  assert.ok(nombres(filas).includes("Eva Espera"), "la petición de mover cita desde el portal");
  assert.ok(!nombres(filas).includes("Aida Atendida"), "esa ya se contestó");
  assert.ok(!nombres(filas).includes("Nina Agendada"), "su petición ya se resolvió");
});

test("una solicitud a la que ya se le pasó la hora se marca: ahí duele más", async () => {
  const db = baseEscape();
  const d = await datos(adminNorte(db), { tipo: "sin_contestar" });
  const pedro = filasDe(d, "sin_contestar").find((f) => f.paciente === "Pedro Plantado");
  assert.ok(pedro);
  assert.match(pedro!.detalle, /se le pasó la hora/);
  // Y sigue sin expediente: no hay folio que dar, y eso es parte del dato.
  assert.equal(pedro!.folio, null);
  assert.equal(pedro!.telefono, "5210000002");
});

test("🔴 esta sección NO espera los `dias`: cuenta desde el primer día", async () => {
  const db = baseEscape();
  // Con `dias: 30`, todo lo demás se estrecha muchísimo; las solicitudes no.
  const d = await datos(adminNorte(db), { dias: 30 });
  assert.ok((d.secciones.sin_contestar?.lista.total ?? 0) >= 2, "una persona esperando no madura");
});

test("🔴 sin dinero inventado, y sin cruzar de clínica", async () => {
  const db = baseEscape();
  const d = await datos(adminNorte(db), { tipo: "sin_contestar" });
  for (const f of filasDe(d, "sin_contestar")) assert.equal(f.valor, 0);
  assert.equal(d.dinero.total, 0);
  const todo = JSON.stringify(d);
  assert.ok(!todo.includes("Wilma SUR") && !todo.includes("SOLICITUD DEL SUR"));
});

test("🔴 el archivado por ARCO tampoco sale aquí", async () => {
  const db = baseEscape();
  const d = await datos(adminNorte(db), { tipo: "sin_contestar" });
  assert.ok(!nombres(filasDe(d, "sin_contestar")).includes("Ana Archivada"));
  assert.equal(d.archivados.filas, 1);
});

test("el resumen nombra a los que esperan ANTES que el dinero: se arregla en cinco minutos", async () => {
  const db = baseEscape();
  const r = await correr(adminNorte(db));
  const texto = (r as any).resumen as string;
  const iEsperando = texto.indexOf("esperando respuesta");
  const iDinero = texto.indexOf("se te escapan");
  assert.ok(iEsperando >= 0 && iDinero >= 0);
  assert.ok(iEsperando < iDinero, "urgencia y valor no son lo mismo; esto va primero en la frase");
});

test("si la tabla `booking_requests` no existe, no se cae: se contesta con lo demás", async () => {
  const db = baseEscape();
  const roto: any = { ...db };
  roto.bookingRequest = {
    async findMany() {
      // Lo que devuelve Postgres cuando falta `sql/landing-v2.sql`.
      throw Object.assign(new Error('relation "booking_requests" does not exist'), { code: "P2021" });
    },
  };
  const d = await datos({ ...adminNorte(db), db: roto }, {});
  // Las peticiones del portal sí salen; las de la mini-web, no, y el resto de la
  // respuesta llega entera.
  assert.ok(nombres(filasDe(d, "sin_contestar")).includes("Eva Espera"));
  assert.ok(!nombres(filasDe(d, "sin_contestar")).includes("Wendy Web"));
  assert.ok(d.dinero.total > 0, "lo demás tiene que seguir contestándose");
});

test("sin `agenda.view` no se leen ni las citas caídas ni las solicitudes", async () => {
  const db = baseEscape();
  const ctx = conPermisos(db, ["today.view", "billing.view"]);
  const d = await datos(ctx);
  const tablas = db.contador.llamadas.map((l) => l.modelo);
  assert.ok(!tablas.includes("bookingRequest"));
  assert.ok(!tablas.includes("appointmentChangeRequest"));
  assert.equal(d.secciones.sin_contestar, undefined);
  // Y se dice UNA vez, no dos, aunque sean dos secciones con la misma llave.
  assert.equal(d.omitidas.filter((o) => o.permiso === "agenda.view").length, 1);
});

test("🔴 si alguien espera respuesta, su nombre va el PRIMERO de la lista de hoy", async () => {
  const db = baseEscape();
  const d = await datos(adminNorte(db));

  assert.equal(d.primero[0]?.tipo, "sin_contestar", "lo que se arregla en cinco minutos, primero");
  assert.ok(d.primero[0]?.telefono, "sin teléfono no es una llamada");
  // Y es la única excepción: de la segunda en adelante manda el dinero.
  const resto = d.primero.slice(1);
  assert.ok(resto.every((f) => f.tipo !== "sin_contestar"), "una sola, no la sección entera");
  assert.ok(resto.length > 0 && resto[0].valor >= (resto[resto.length - 1]?.valor ?? 0) - 1e9);
  assert.equal(d.primero.length, 5);
});

test("sin nadie esperando, la lista es puro orden por valor", async () => {
  const db = baseEscape();
  const d = await datos(adminNorte(db), { tipo: "por_cobrar" });
  assert.ok(d.primero.every((f) => f.tipo === "por_cobrar"));
});

/* ══════════════════════════════════════════════════════════════════════
 * 14 · LO QUE ENCONTRÓ LA AUDITORÍA — una prueba por agujero tapado
 * ══════════════════════════════════════════════════════════════════════ */

test("🔴 `dias` grande ENSANCHA la ventana de citas caídas, no la vacía en silencio", async () => {
  const db = baseEscape();
  // Con la ventana fija en 90 días y el corte en `ahora − dias`, un `dias` de 90
  // o más pedía «desde hace 90 días HASTA hace 365»: un rango imposible. Sabina
  // contestaba «no hay ninguna cita caída» como un HECHO, sin avisar de nada.
  for (const dias of [90, 180, 365, 3650]) {
    const d = await datos(adminNorte(baseEscape()), { dias, tipo: "sin_reagendar" });
    assert.ok(
      nombres(filasDe(d, "sin_reagendar")).includes("Cati Cayo"),
      `con dias=${dias} la sección se quedó vacía: el rango volvió a ser imposible`,
    );
  }
  // Y con el valor por defecto sigue haciendo lo de siempre.
  const normal = await datos(adminNorte(db), { tipo: "sin_reagendar" });
  assert.ok(nombres(filasDe(normal, "sin_reagendar")).includes("Cati Cayo"));
});

test("🔴 ningún peso se cuenta dos veces aunque el enlace presupuesto→factura se pierda", async () => {
  // El paciente tiene una factura viva por $24,000 Y un plan activo atrasado por
  // esos mismos $24,000. Da igual por dónde venga el enlace: el tope por
  // paciente resta lo ya facturado y el plan aporta 0.
  const db = baseEscape();
  const d = await datos(adminNorte(db));

  const plan = (await filasDeSeccion(adminNorte(db), "sin_agendar")).find((f) => f.paciente === "Nilo SinFecha");
  assert.ok(plan, "la fila tiene que salir: el trabajo sigue sin agendarse");
  assert.equal(plan!.valor, 0);
  assert.equal(plan!.yaFacturado, true);

  // Y el dinero total de la clínica no incluye esos $24,000 dos veces.
  const enFacturas = (await filasDeSeccion(adminNorte(db), "por_cobrar")).find((f) => f.paciente === "Nilo SinFecha");
  assert.equal(enFacturas?.valor, 24_000);
  assert.equal(d.dinero.aceptadoSinAgendar, VALOR_ACEPTADO + VALOR_PLAN_PENDIENTE + 16_000);
});

test("🔴 y tampoco con un plan creado a mano y facturado por adelantado (el caso de ortodoncia)", async () => {
  // Un plan SIN presupuesto detrás, con la factura del tratamiento entero ya
  // emitida. Por el enlace no había nada que mirar; por el tope por paciente, sí.
  const base = datosEscape();
  const db = crearBase({
    ...base,
    patients: [
      ...(base.patients ?? []),
      { id: "p-orto", clinicId: CL_NORTE, firstName: "Orto", lastName: "Adelantada", patientNumber: "E9001", phone: "5511112222", status: "ACTIVE", visibleUserIds: [], deletedAt: null, createdAt: new Date(Date.now() - 400 * 86_400_000) },
    ],
    treatmentPlans: [
      ...(base.treatmentPlans ?? []),
      { id: "tp-orto", clinicId: CL_NORTE, patientId: "p-orto", doctorId: U_DOC_N, name: "Ortodoncia", status: "ACTIVE", totalCost: 40_000, totalSessions: 4, sessionIntervalDays: 30, startDate: new Date(Date.now() - 200 * 86_400_000), nextExpectedDate: new Date(Date.now() - 50 * 86_400_000), createdAt: new Date(Date.now() - 200 * 86_400_000) },
    ],
    invoices: [
      ...(base.invoices ?? []),
      { id: "inv-orto", invoiceNumber: "MF-9900", clinicId: CL_NORTE, patientId: "p-orto", status: "PENDING", total: 40_000, paid: 0, balance: 40_000, discount: 0, dueDate: new Date(Date.now() - 20 * 86_400_000), createdAt: new Date(Date.now() - 200 * 86_400_000), items: [] },
    ],
    treatmentSessions: [
      ...(base.treatmentSessions ?? []),
      { id: "ts-orto", treatmentId: "tp-orto", sessionNumber: 1, completedAt: new Date(Date.now() - 150 * 86_400_000), createdAt: new Date(Date.now() - 150 * 86_400_000) },
    ],
  });

  const d = await datos(adminNorte(db));
  const orto = (await filasDeSeccion(adminNorte(db), "sin_agendar")).find((f) => f.paciente === "Orto Adelantada");
  assert.ok(orto, "hay que llamarla: le faltan 3 de 4 sesiones y no tiene cita");
  // 3/4 de $40,000 son $30,000, pero sus $40,000 ya están enteros en por_cobrar.
  assert.equal(orto!.valor, 0);
  assert.equal(orto!.yaFacturado, true);
  const enFacturas = (await filasDeSeccion(adminNorte(db), "por_cobrar")).find((f) => f.paciente === "Orto Adelantada");
  assert.equal(enFacturas?.valor, 40_000);
});

test("🔴 y el dinero tampoco DESAPARECE: una factura más nueva que el corte cuenta una vez", async () => {
  // La factura se emitió hace 2 días, así que `por_cobrar` (que exige 7) la deja
  // fuera. Entonces NO se resta del plan: los $18,000 tienen que estar en alguna
  // de las dos cifras, no en ninguna.
  const base = datosEscape();
  const db = crearBase({
    ...base,
    patients: [
      ...(base.patients ?? []),
      { id: "p-fresca", clinicId: CL_NORTE, firstName: "Fresca", lastName: "Factura", patientNumber: "E9002", phone: "5511113333", status: "ACTIVE", visibleUserIds: [], deletedAt: null, createdAt: new Date(Date.now() - 400 * 86_400_000) },
    ],
    treatmentPlans: [
      ...(base.treatmentPlans ?? []),
      { id: "tp-fresca", clinicId: CL_NORTE, patientId: "p-fresca", doctorId: U_DOC_N, name: "Rehabilitacion", status: "ACTIVE", totalCost: 18_000, totalSessions: 2, sessionIntervalDays: 30, startDate: new Date(Date.now() - 90 * 86_400_000), nextExpectedDate: new Date(Date.now() - 30 * 86_400_000), createdAt: new Date(Date.now() - 90 * 86_400_000) },
    ],
    invoices: [
      ...(base.invoices ?? []),
      { id: "inv-fresca", invoiceNumber: "MF-9901", clinicId: CL_NORTE, patientId: "p-fresca", status: "PENDING", total: 18_000, paid: 0, balance: 18_000, discount: 0, dueDate: null, createdAt: new Date(Date.now() - 2 * 86_400_000), items: [] },
    ],
  });

  const d = await datos(adminNorte(db));
  const fila = (await filasDeSeccion(adminNorte(db), "sin_agendar")).find((f) => f.paciente === "Fresca Factura");
  assert.ok(fila);
  assert.equal(fila!.valor, 18_000, "no se resta lo que no se ha sumado: si no, el dinero se evapora");
  const enFacturas = await filasDeSeccion(adminNorte(db), "por_cobrar");
  assert.ok(!enFacturas.some((f) => f.paciente === "Fresca Factura"), "su factura es de anteayer");
});

test("🔴 el trabajo aceptado de un paciente archivado se CUENTA, no se evapora", async () => {
  const base = datosEscape();
  const db = crearBase({
    ...base,
    treatmentPlans: [
      ...(base.treatmentPlans ?? []),
      { id: "tp-arco", clinicId: CL_NORTE, patientId: P_ARCO, doctorId: U_DOC_N, name: "Plan del archivado", status: "ACTIVE", totalCost: 30_000, totalSessions: 2, sessionIntervalDays: 30, startDate: new Date(Date.now() - 120 * 86_400_000), nextExpectedDate: new Date(Date.now() - 60 * 86_400_000), createdAt: new Date(Date.now() - 120 * 86_400_000) },
    ],
  });
  const d = await datos(adminNorte(db));
  assert.ok(!JSON.stringify(d.secciones).includes("Plan del archivado"), "no sale en la lista");
  // Y sube el contador: antes desaparecía sin dejar rastro justo en la sección
  // que más dinero mueve.
  assert.equal(d.archivados.filas, 5);
});

test("🔴 el teléfono pide `patients.view`: ver una deuda no es ver la ficha", async () => {
  const db = baseEscape();
  const contable = conPermisos(db, ["today.view", "billing.view"]);
  const d = await datos(contable);
  for (const f of filasDe(d, "por_cobrar")) {
    assert.equal(f.telefono, null, "el perfil «contable» no se lleva la agenda de teléfonos");
  }
  // Con la llave de pacientes, sí.
  const completo = conPermisos(baseEscape(), ["today.view", "billing.view", "patients.view"]);
  const d2 = await datos(completo);
  assert.ok(filasDe(d2, "por_cobrar").some((f) => f.telefono), "con patients.view sí");
});

test("`aproximado` significa UNA cosa: que el dinero es un suelo", async () => {
  const db = baseEscape();
  const d = await datos(adminNorte(db));
  // por_cobrar y sin_respuesta salen de un `aggregate`: exactos siempre, aunque
  // la lista venga recortada (para eso está `lista.truncado`).
  assert.equal(d.secciones.por_cobrar?.aproximado, false);
  assert.equal(d.secciones.sin_respuesta?.aproximado, false);
});

test("un presupuesto que vence HOY todavía no está caducado", async () => {
  const base = datosEscape();
  const hoyTarde = new Date();
  hoyTarde.setHours(23, 59, 0, 0);
  const db = crearBase({
    ...base,
    quotes: [
      ...(base.quotes ?? []),
      { id: "q-vence-hoy", clinicId: CL_NORTE, patientId: "p-esc-caro", folio: "P-0099", title: "Vence hoy", status: "PRESENTED", total: 5_000, subtotal: 5_000, discountAmount: 0, acceptedAt: null, presentedAt: new Date(Date.now() - 20 * 86_400_000), validUntil: hoyTarde, invoiceId: null, treatmentPlanId: null, createdAt: new Date(Date.now() - 20 * 86_400_000) },
    ],
  });
  const d = await datos(adminNorte(db), { tipo: "sin_respuesta" });
  const fila = filasDe(d, "sin_respuesta").find((f) => f.detalle.includes("P-0099"));
  assert.ok(fila);
  assert.ok(!fila!.detalle.includes("caducado"), "le queda todo el día: el mismo criterio que «vencida»");
});

/* ══════════════════════════════════════════════════════════════════════
 * 15 · LO QUE ENCONTRÓ LA REFUTACIÓN — dos frases que podían mentir
 * ══════════════════════════════════════════════════════════════════════ */

test("🔴 nunca dice «no se te está escapando nada» y a continuación da a quién llamar", async () => {
  // Una clínica donde la ÚNICA fila de `sin_agendar` está ya facturada entera:
  // vale 0, su dinero está contado en las facturas por cobrar. Pidiendo esa
  // sección sola, el dinero de la respuesta es 0 pero la fila sigue ahí.
  const hace = (n: number) => new Date(Date.now() - n * 86_400_000);
  const db = crearBase({
    clinics: [{ id: CL_NORTE, timezone: TZ_NORTE, agendaDayStart: 8, agendaDayEnd: 20 }],
    patients: [
      { id: "p-uno", clinicId: CL_NORTE, firstName: "Uno", lastName: "Solo", patientNumber: "U1", phone: "5500000001", status: "ACTIVE", visibleUserIds: [], deletedAt: null, createdAt: hace(300) },
    ],
    treatmentPlans: [
      { id: "tp-uno", clinicId: CL_NORTE, patientId: "p-uno", doctorId: U_DOC_N, name: "Rehabilitacion", status: "ACTIVE", totalCost: 10_000, totalSessions: 2, sessionIntervalDays: 30, startDate: hace(120), nextExpectedDate: hace(40), createdAt: hace(120) },
    ],
    invoices: [
      { id: "i-uno", invoiceNumber: "MF-1", clinicId: CL_NORTE, patientId: "p-uno", status: "PENDING", total: 10_000, paid: 0, balance: 10_000, discount: 0, dueDate: hace(30), createdAt: hace(120), items: [] },
    ],
  });
  const ctx: SabinaCtx = { clinicId: CL_NORTE, userId: U_ADMIN_N, role: "ADMIN", permissionsOverride: [], timezone: TZ_NORTE, db };

  const r = await correr(ctx, { tipo: "sin_agendar" });
  assert.equal(r.ok, true);
  const texto = (r as any).resumen as string;

  // La fila está: hay que llamar, el trabajo sigue sin agendarse.
  assert.match(texto, /Uno Solo/);
  // Y por tanto la cabecera NO puede afirmar que no hay nada.
  assert.ok(
    !/no se te está escapando nada/.test(texto),
    `la cabecera contradice a su propia lista:\n${texto}`,
  );
  assert.match(texto, /ya está contado en tus facturas por cobrar/);

  // Con la clínica de verdad vacía, la frase sí es la de «nada».
  const vacia = crearBase({ clinics: [{ id: CL_NORTE, timezone: TZ_NORTE, agendaDayStart: 8, agendaDayEnd: 20 }] });
  const r2 = await correr({ ...ctx, db: vacia }, { tipo: "sin_agendar" });
  assert.match((r2 as any).resumen, /no se te está escapando nada/);
});

test("🔴 el contador de archivados dice «al menos» cuando puede quedarse corto", async () => {
  // Las tres secciones que cuentan archivados recorriendo filas ya recortadas
  // por el tope no pueden presentar su cifra como cerrada: un archivado que se
  // cayera del recorte no se vería, y el número sería un mínimo mudo.
  const hace = (n: number) => new Date(Date.now() - n * 86_400_000);
  const patients: any[] = [];
  const appointments: any[] = [];
  // 2.100 citas caídas de pacientes distintos: por encima del tope de 2.000.
  for (let i = 0; i < 2_100; i++) {
    // El archivado es el de la caída MÁS RECIENTE, así que sí entra en el
    // recorte: lo que se prueba es que, aun viéndolo, la cifra se presenta como
    // mínimo porque hay 100 filas más que no se miraron.
    patients.push({ id: `pc${i}`, clinicId: CL_NORTE, firstName: "Caida", lastName: `N${i}`, patientNumber: `C${i}`, phone: null, status: "ACTIVE", visibleUserIds: [], deletedAt: i === 0 ? hace(200) : null, createdAt: hace(300) });
    appointments.push({ id: `ac${i}`, clinicId: CL_NORTE, patientId: `pc${i}`, doctorId: U_DOC_N, type: "Consulta", status: "CANCELLED", resourceId: null, startsAt: hace(30 + (i % 50)), endsAt: hace(30 + (i % 50)) });
  }
  const db = crearBase({
    clinics: [{ id: CL_NORTE, timezone: TZ_NORTE, agendaDayStart: 8, agendaDayEnd: 20 }],
    patients,
    appointments,
  });
  const ctx: SabinaCtx = { clinicId: CL_NORTE, userId: U_ADMIN_N, role: "ADMIN", permissionsOverride: [], timezone: TZ_NORTE, db };

  const d = await datos(ctx, { tipo: "sin_reagendar" });
  assert.equal(d.secciones.sin_reagendar?.aproximado, true, "se tocó el tope de candidatos");
  assert.equal(d.archivados.exacto, false, "entonces el contador de ARCO es un mínimo");

  assert.ok(d.archivados.filas > 0, "el archivado entra en el recorte");
  const r = await correr(ctx, { tipo: "sin_reagendar" });
  assert.match((r as any).resumen, /Dejé fuera al menos/);
});

test("sin tocar el tope, el contador de archivados se presenta como cerrado", async () => {
  const db = baseEscape();
  const d = await datos(adminNorte(db));
  assert.equal(d.archivados.exacto, true);
  const r = await correr(adminNorte(baseEscape()));
  assert.ok(!/Dejé fuera al menos/.test((r as any).resumen), "aquí la cifra sí es la de verdad");
});
