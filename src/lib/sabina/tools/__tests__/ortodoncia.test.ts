/**
 * Sabina sabe de ORTODONCIA — `orto_caso`, `orto_controles`, `orto_cobranza` (ws1-t11).
 *
 *   npm run test:sabina-ortodoncia
 *
 * Lo que se prueba, y por qué cada cosa:
 *
 *  1. QUE RESPONDE BIEN, y que dice EL NÚMERO DE LA PANTALLA. Las herramientas
 *     no calculan: llaman al motor del módulo. Así que la prueba corre los
 *     cargadores de las pantallas (`loadOrthoCases` + `filasDeCobranza`,
 *     `loadOrthoControles`, `loadOrthoTableroData`) contra la MISMA base y exige
 *     la misma cifra.
 *  2. 🔴 QUE NO ESCRIBE NADA (regla dura de Rafael). Ninguna es una acción;
 *     contra una base que REVIENTA ante cualquier operación que no sea de
 *     lectura, las tres contestan; su SQL crudo pasa el filtro del candado de
 *     solo lectura del motor; y su código no nombra ninguna escritura.
 *  3. 🔴 QUE RESPETA PERMISOS: sin la key del módulo no se consulta; recepción
 *     recibe el caso SIN lo clínico y se le dice; un doctor no se entera de la
 *     paciente restringida; sin facturación no sale el dinero; y si fue el Super
 *     Admin quien se lo quitó a Sabina, la frase no le miente al usuario.
 *  4. 🔴 QUE NO CRUZA DE CLÍNICA, en las dos direcciones, y que cada consulta
 *     en SQL crudo sale con el `clinicId` de la sesión.
 *  5. 🔴 QUE SIN EL MÓDULO DICE QUE NO ESTÁ CONTRATADO, sin leer ni un caso.
 *  6. QUE EL ENLACE VA SIEMPRE, aunque el modelo se lo coma.
 */

import { pantalla } from "./preparar-orto"; // PRIMERO
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { loadOrthoCases, loadOrthoTableroData } from "@/lib/orthodontics/tablero-data";
import { loadOrthoControles } from "@/lib/orthodontics/controles-data";
import { filasDeCobranza, resumenDeCobranza } from "@/lib/orthodontics/cobranza-modulo";
import { hoyEnZona } from "@/lib/whatsapp/cobranza/sweep";
import { getEffectivePermissions } from "@/lib/auth/permissions";
import { accionDeHerramienta } from "../../engine-acciones";
import { ACCIONES_SABINA, SABINA_TOOLS } from "../../engine-catalog";
import { fraseSinPermiso, garantizarAvisosObligatorios } from "../../engine-core";
import { ejecutarSabina, type TurnoModelo } from "../../engine";
import { esSqlDeLectura } from "../../engine-solo-lectura";
import type { SabinaCtx, SabinaTool } from "../../tipos";
import { correrHerramienta } from "../base";
import { sumarDias } from "../fechas";
import { ortoCaso } from "../orto-caso";
import { ortoCobranza } from "../orto-cobranza";
import { ENLACES_ORTO } from "../orto-comun";
import { ortoControles } from "../orto-controles";
import type { BaseDoble } from "./doble-base";
import { CL_SIN_MODULO, CL_VENCIDA, baseOrto, sesion } from "./orto-siembra";
import { CL_NORTE, CL_SUR, HOY_N, TZ_NORTE, TZ_SUR, U_ADMIN_S, U_DOC_N, U_RECEP_N } from "./siembra";

/* ── utilería ───────────────────────────────────────────────────────── */

const LAS_TRES: SabinaTool[] = [ortoCaso, ortoControles, ortoCobranza];

/** Todas las preguntas del encargo, con sus parámetros. */
const PREGUNTAS: Array<{ tool: SabinaTool; params: Record<string, unknown>; dice: string }> = [
  { tool: ortoCaso, params: { patientId: "p-ana" }, dice: "¿cómo va el caso de Ana?" },
  { tool: ortoControles, params: { que: "hoy" }, dice: "¿qué controles tengo hoy?" },
  { tool: ortoControles, params: { que: "semana" }, dice: "¿y esta semana?" },
  { tool: ortoControles, params: { que: "sin_control" }, dice: "¿quién se pasó de su control?" },
  { tool: ortoControles, params: { que: "casos" }, dice: "¿cuántos casos activos y terminados?" },
  { tool: ortoCobranza, params: { que: "deben" }, dice: "¿quién debe mensualidades y cuánto?" },
  { tool: ortoCobranza, params: { que: "este_mes" }, dice: "¿cuánto entra por mensualidades este mes?" },
];

const OPS_DE_LECTURA = new Set(["findMany", "findFirst", "findUnique", "count", "aggregate", "groupBy"]);

/**
 * Monta la base de la prueba, y la deja también detrás del `prisma` global (por
 * donde leen los cargadores del módulo). Devuelve además una versión que
 * REVIENTA —y lo apunta— ante cualquier operación que no sea de lectura.
 */
function montar(): { db: BaseDoble; escrituras: string[] } {
  const b = baseOrto();
  const escrituras: string[] = [];
  const trampa = new Proxy(b.db as any, {
    get(objetivo, clave) {
      const valor = objetivo[clave];
      if (clave === "contador" || typeof clave !== "string" || valor === undefined) return valor;
      // El buscador de pacientes consulta en SQL crudo por `ctx.db`: es una
      // lectura, y el doble la rechaza a su manera (camino degradado).
      if (clave === "$queryRaw") return valor.bind(objetivo);
      if (typeof valor === "function") {
        escrituras.push(`${clave}`);
        throw new Error(`escritura prohibida: ${clave}`);
      }
      return new Proxy(valor, {
        get(delegado, op) {
          if (typeof op === "string" && !OPS_DE_LECTURA.has(op)) {
            escrituras.push(`${clave}.${op}`);
            throw new Error(`escritura prohibida: ${clave}.${op}`);
          }
          return delegado[op];
        },
      });
    },
  }) as BaseDoble;
  pantalla.db = trampa;
  pantalla.sql = b.sql;
  pantalla.consultasSql = [];
  return { db: trampa, escrituras };
}

const admin = (db: BaseDoble, over: Partial<SabinaCtx> = {}) => sesion(db, over);
const doctor = (db: BaseDoble) => sesion(db, { userId: U_DOC_N, role: "DOCTOR" });
const recepcion = (db: BaseDoble) => sesion(db, { userId: U_RECEP_N, role: "RECEPTIONIST" });
const adminDelSur = (db: BaseDoble) => sesion(db, { clinicId: CL_SUR, userId: U_ADMIN_S, timezone: TZ_SUR });

/** Las keys del rol, menos las que se quitan: el override que pone el Super Admin en Equipo. */
const sinEstas = (rol: string, ...quitar: string[]) =>
  getEffectivePermissions({ role: rol as any, permissionsOverride: [] }).filter((k) => !quitar.includes(k));

async function ok(tool: SabinaTool, ctx: SabinaCtx, params: unknown): Promise<{ datos: any; resumen: string }> {
  const r = await correrHerramienta(tool, ctx, params);
  assert.equal(r.ok, true, `${tool.nombre} ${JSON.stringify(params)} → ${JSON.stringify(r)}`);
  return r as { datos: any; resumen: string };
}

const todo = (r: { datos: any; resumen: string }) => `${r.resumen}\n${JSON.stringify(r.datos)}`;
const visor = (ctx: SabinaCtx) => ({ userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
const leidos = (db: BaseDoble) => db.contador.llamadas.map((l) => `${l.modelo}.${l.op}`);

function turno(bloques: TurnoModelo["bloques"], stopReason: string): TurnoModelo {
  return { bloques, stopReason, tokensEntrada: 100, tokensSalida: 20, error: null };
}

/* ═══════════════════════════════════════════════════════════════════════
   0. EL CATÁLOGO
   ═══════════════════════════════════════════════════════════════════════ */

test("el motor ve las tres de ortodoncia, con la key del módulo y sin clinicId en sus parámetros", () => {
  const nombres = SABINA_TOOLS.map((t) => t.nombre);
  for (const t of LAS_TRES) {
    assert.ok(nombres.includes(t.nombre), `el motor no ve ${t.nombre}`);
    assert.equal(t.permiso, "specialties.orthodontics", t.nombre);
    assert.ok(!("clinicId" in ((t.parametros as any).shape ?? {})), `${t.nombre} acepta clinicId del modelo`);
  }
});

test("🔴 solo lectura: ninguna de las tres es una acción, y Sabina sigue sin acciones de ortodoncia", () => {
  for (const t of LAS_TRES) {
    const delMotor = SABINA_TOOLS.find((h) => h.nombre === t.nombre)!;
    assert.equal(accionDeHerramienta(delMotor), null, `${t.nombre} entró como acción`);
  }
  // La prohibición de MAPA-dinero §7 (sabina-dinero-actua.test.ts), donde de
  // verdad importa: en lo que ESCRIBE. Ni con el nombre largo ni con el corto.
  for (const a of ACCIONES_SABINA) {
    assert.doesNotMatch(a.nombre, /orto|plan_de_pago|mensualidad|control/i, `hay una acción de ortodoncia: ${a.nombre}`);
  }
});

/* ═══════════════════════════════════════════════════════════════════════
   1. RESPONDE BIEN
   ═══════════════════════════════════════════════════════════════════════ */

test("caso: fase, mes N de M y el arco del último control FIRMADO (no el del borrador ni el planeado)", async () => {
  const { db } = montar();
  const r = await ok(ortoCaso, admin(db), { patientId: "p-ana" });
  const d = r.datos;

  assert.equal(d.paciente, "Ana Perez");
  assert.deepEqual([d.caso.estado, d.caso.mes, d.caso.de], ["En curso", 7, 24]);
  assert.equal(d.clinico.fase, "Nivelación");
  // w-ana-2 (NiTi 16x22) es el último anotado en una hoja firmada. El SS 19x25
  // es el «activo» de la secuencia planeada Y el del borrador de hoy: no cuenta.
  assert.equal(d.clinico.arco, "NiTi 16x22 (superior e inferior)");
  assert.doesNotMatch(todo(r), /19x25/);

  assert.match(r.resumen, /mes 7 de 24/);
  assert.match(r.resumen, /Fase: Nivelación/);
  assert.equal(d.enlace, "/dashboard/patients/p-ana?tab=ortodoncia");
  assert.ok(r.resumen.includes(`(${d.enlace})`), "el resumen no lleva el enlace a la ficha");
});

test("🔴 caso por NOMBRE, teléfono o folio: `buscar_paciente` no da ids, así que tiene que poder sin él", async () => {
  const { db } = montar();
  for (const paciente of ["Ana Perez", "ana perez", "P0001", "Perez"]) {
    const r = await ok(ortoCaso, admin(db), { paciente });
    assert.equal(r.datos.paciente, "Ana Perez", paciente);
    assert.deepEqual([r.datos.caso.mes, r.datos.caso.de], [7, 24], paciente);
    assert.equal(r.datos.enlace, "/dashboard/patients/p-ana?tab=ortodoncia");
  }
});

test("🔴 caso: si hay varios pacientes posibles se PREGUNTA cuál — no se elige, y no se lee ningún caso", async () => {
  const { db } = montar();
  const r = await ok(ortoCaso, admin(db), { paciente: "Masivo" });
  assert.equal(r.datos.caso, null);
  assert.match(r.datos.aclarar.pregunta, /muchos pacientes que coinciden/i);
  assert.match(r.resumen, /NO elijas tú/);
  assert.equal(ortoCaso.avisoObligatorio!(r.datos), null);
  assert.ok(!leidos(db).some((l) => l.startsWith("ortho")), "se leyó un caso sin saber de quién");

  // Una sola coincidencia por un pedazo de palabra: se confirma antes.
  const pedazo = await ok(ortoCaso, admin(db), { paciente: "eto" });
  assert.match(pedazo.datos.aclarar.pregunta, /¿Te refieres a Beto Munoz\?/);

  // Sin decir de quién: se pregunta.
  const nadie = await ok(ortoCaso, admin(db), {});
  assert.match(nadie.datos.aclarar.pregunta, /¿Para qué paciente\?/);
});

test("caso: la higiene es la del último control firmado, con el aviso del panel de que empeora", async () => {
  const { db } = montar();
  const d = (await ok(ortoCaso, admin(db), { patientId: "p-ana" })).datos;

  // El borrador de hoy trae placa 5 %: si saliera, Sabina diría que va bien.
  assert.equal(d.clinico.higiene.placaPct, 45);
  // Ese control fue a las 18:30 de Ciudad de México: en UTC ya era el día
  // siguiente. La fecha es la de la clínica.
  assert.equal(d.clinico.higiene.fecha, sumarDias(HOY_N, -30));
  assert.equal(d.clinico.higiene.gingivitis, "MODERADA");
  assert.equal(d.clinico.higiene.manchasBlancas, true);
  assert.deepEqual(d.clinico.higieneEmpeora, [
    "placa subió de 20% a 45%",
    "gingivitis pasó de leve a moderada",
    "aparecieron manchas blancas nuevas",
    "dejó de reportar uso de elásticos",
  ]);
});

test("caso: alineadores — cuál trae y cuál debería traer hoy", async () => {
  const { db } = montar();
  const r = await ok(ortoCaso, admin(db), { patientId: "p-dora" });
  // Empezó hace 70 días y cambia cada 14: hoy toca el 6. Trae el 3.
  assert.deepEqual(r.datos.clinico.alineadores, {
    sistema: "Invisalign",
    actual: 3,
    total: 20,
    esperado: 6,
    diferencia: -3,
    estado: "ACTIVE",
  });
  assert.match(r.resumen, /trae el 3 de 20; va 3 atrás de lo esperado \(el 6\)/);
  assert.equal(r.datos.clinico.arco, null, "Dora no tiene arcos: no se inventa uno");
});

test("caso: alineadores en pausa o terminados — no se dice que «va atrás», el calendario siguió corriendo solo", () => {
  const datos = (estado: string) =>
    ({
      modulo: "activo", noEncontrado: null, aclarar: null, paciente: "Dora Sanchez", tieneValoracion: false, omitidas: [],
      enlace: "/dashboard/patients/p-dora?tab=ortodoncia",
      caso: { estado: "En curso", mes: 3, de: 12, inicio: null, finEstimado: null },
      clinico: {
        fase: null, arco: null, higiene: null, higieneEmpeora: [],
        alineadores: { sistema: "Invisalign", actual: 3, total: 20, esperado: 9, diferencia: -6, estado },
      },
      controles: null, cobranza: null,
    }) as any;
  assert.match(ortoCaso.resumir(datos("PAUSED"), { patientId: "p-dora" }), /trae el 3 de 20, en pausa\./);
  assert.match(ortoCaso.resumir(datos("FINISHED"), { patientId: "p-dora" }), /trae el 3 de 20, terminados\./);
  assert.doesNotMatch(ortoCaso.resumir(datos("PAUSED"), { patientId: "p-dora" }), /atrás|esperado/);
  assert.match(ortoCaso.resumir(datos("ACTIVE"), { patientId: "p-dora" }), /va 6 atrás de lo esperado \(el 9\)/);
});

test("🔴 caso cerrado: «saldado» solo si tuvo plan y lo pagó; sin factura no hay nada que dar por saldado", async () => {
  const { db } = montar();
  // Elías terminó y pagó sus tres pagos. La pantalla de Cobranza ya no lo lista.
  const elias = await ok(ortoCaso, admin(db), { patientId: "p-elias" });
  assert.equal(elias.datos.caso.estado, "Completado");
  assert.deepEqual(
    [elias.datos.cobranza.situacion, elias.datos.cobranza.cuotasPagadas, elias.datos.cobranza.cuotasTotales, elias.datos.cobranza.porCobrar],
    ["saldado", 3, 3, 0],
  );
  assert.match(elias.resumen, /saldado; 3 de 3 pagos hechos/);

  // Iván abandonó y nunca tuvo factura: decir «saldado» sería inventar un plan.
  const ivan = await ok(ortoCaso, admin(db), { patientId: "p-inact-2" });
  assert.equal(ivan.datos.caso.estado, "Abandono");
  assert.equal(ivan.datos.cobranza.situacion, "sin-plan");
  assert.match(ivan.resumen, /Mensualidades: no tiene plan de pagos\./);
  assert.doesNotMatch(ivan.resumen, /saldado|0 de 0/);
});

test("caso: último y próximo control salen de la agenda; quien se pasó, con los días", async () => {
  const { db } = montar();
  const ana = (await ok(ortoCaso, admin(db), { patientId: "p-ana" })).datos;
  assert.ok(ana.controles.ultimo, "Ana tiene controles hechos");
  assert.match(ana.controles.proximo, /^\d{4}-\d{2}-\d{2} 10:00$/, "la hora va en la zona de la clínica");
  assert.equal(ana.controles.sinControl, null, "tiene su próximo control: no se pasó");

  const beto = await ok(ortoCaso, admin(db), { patientId: "p-beto" });
  assert.equal(beto.datos.controles.proximo, null);
  assert.equal(beto.datos.controles.sinControl, "Su último control fue hace 60 días · faltó a su última cita");
  assert.equal(beto.datos.controles.urgente, true);
  assert.match(beto.resumen, /sin próximo control agendado/);
});

test("🔴 caso: las mensualidades son la fila de la pantalla de Cobranza, no una cuenta propia", async () => {
  const { db } = montar();
  const ctx = admin(db);
  const d = (await ok(ortoCaso, ctx, { patientId: "p-ana" })).datos;

  const { cases } = await loadOrthoCases(CL_NORTE, TZ_NORTE, visor(ctx));
  const fila = filasDeCobranza(cases, hoyEnZona(new Date(), TZ_NORTE)).find((f) => f.planId === "plan-ana")!;
  assert.equal(d.cobranza.situacion, fila.situacion);
  assert.equal(d.cobranza.vencido, fila.vencido);
  assert.equal(d.cobranza.pagosVencidos, fila.cuotasVencidas);
  assert.equal(d.cobranza.porCobrar, fila.porCobrar);
  assert.equal(d.cobranza.proximaFecha, fila.proximaFecha);
  assert.equal(d.cobranza.diasDeAtraso, fila.diasDeAtraso);

  // Y lo que tiene que dar: pagó el enganche y dos de $2,000; debe la tercera.
  assert.deepEqual([d.cobranza.situacion, d.cobranza.vencido, d.cobranza.pagosVencidos], ["vencido", 2000, 1]);
  assert.equal(d.cobranza.porCobrar, 16000);
});

test("caso: un paciente sin caso no es «sin datos» — se dice que no lo tiene, y dónde se abre", async () => {
  const { db } = montar();
  const valorada = await ok(ortoCaso, admin(db), { patientId: "p-inact-3" });
  assert.equal(valorada.datos.caso, null);
  assert.match(valorada.resumen, /no tiene un caso de ortodoncia abierto/);
  assert.match(valorada.resumen, /valoración de ortodoncia/);
  assert.match(valorada.resumen, /Yo no lo abro/);

  const sinNada = await ok(ortoCaso, admin(db), { patientId: "p-inact-1" });
  assert.match(sinNada.resumen, /no tiene un caso de ortodoncia abierto/);
  assert.doesNotMatch(sinNada.resumen, /valoración/);
});

test("🔴 controles de hoy y de la semana: los mismos que pinta la pantalla de Controles", async () => {
  const { db } = montar();
  const ctx = admin(db);
  const pantallaControles = await loadOrthoControles(CL_NORTE, TZ_NORTE, visor(ctx));

  const hoy = await ok(ortoControles, ctx, { que: "hoy" });
  assert.deepEqual(
    hoy.datos.controles.filas.map((f: any) => f.paciente),
    pantallaControles.semana.hoy.map((c) => c.patientName),
  );
  assert.deepEqual(hoy.datos.resumenHoy, pantallaControles.semana.resumenHoy);
  assert.deepEqual(hoy.datos.resumenHoy, { enPie: 2, atendidos: 1, faltaron: 0, cancelados: 1 });
  assert.match(hoy.resumen, /hay 3 controles de ortodoncia: 2 por atender, 1 ya atendido; aparte, 1 cancelado/);
  // La hora, en la zona de la clínica; la hoja, con su estado.
  const deAna = hoy.datos.controles.filas.find((f: any) => f.paciente === "Ana Perez");
  assert.deepEqual([deAna.hora, deAna.estado, deAna.hoja, deAna.doctor], ["10:00", "Confirmada", "borrador", "Hugo Salas"]);

  const semana = await ok(ortoControles, ctx, { que: "semana" });
  const deLaPantalla = [
    ...pantallaControles.semana.hoy,
    ...pantallaControles.semana.proximosDias.flatMap((dia) => dia.citas),
  ].map((c) => c.patientName);
  assert.deepEqual(semana.datos.controles.filas.map((f: any) => f.paciente), deLaPantalla);
  assert.ok(deLaPantalla.includes("Carla Gomez"), "el control de Carla en tres días entra en la semana");
  // El total de la semana es el de la pantalla, no una cuenta sobre la lista (que se recorta a 50).
  assert.equal(semana.datos.proximos, pantallaControles.semana.totalProximos);
  assert.match(semana.resumen, /en los siete días siguientes, 1 control[;.(]/);
  assert.ok(!hoy.datos.controles.filas.some((f: any) => f.paciente === "Carla Gomez"));
  assert.ok(semana.resumen.includes(`(${ENLACES_ORTO.controles})`));
});

test("🔴 quién se pasó de su control: el criterio de la pantalla (caso activo sin control futuro)", async () => {
  const { db } = montar();
  const ctx = admin(db);
  const pantallaControles = await loadOrthoControles(CL_NORTE, TZ_NORTE, visor(ctx));
  const r = await ok(ortoControles, ctx, { que: "sin_control" });

  assert.deepEqual(
    r.datos.sinControl.filas.map((f: any) => f.paciente),
    pantallaControles.sinControl.map((c) => c.patientName),
  );
  assert.deepEqual(r.datos.sinControl.filas.map((f: any) => f.paciente), ["Beto Munoz"]);
  assert.deepEqual([r.datos.urgentes, r.datos.casosActivos], [1, pantallaControles.casosActivos]);
  assert.match(r.resumen, /Beto Munoz/);
  assert.match(r.resumen, /hace 60 días/);
  assert.match(r.resumen, /Yo no agendo/);
  // Elías terminó su tratamiento: no tiene control futuro, y NO se pasó de nada.
  assert.doesNotMatch(todo(r), /Elias/);
});

test("casos activos y terminados: el T1 del Tablero, y el desglose por estado", async () => {
  const { db } = montar();
  const ctx = admin(db);
  const tablero = await loadOrthoTableroData(CL_NORTE, TZ_NORTE, visor(ctx));
  const r = await ok(ortoControles, ctx, { que: "casos" });

  assert.equal(r.datos.casos.activos, tablero.activeCasesCount);
  assert.deepEqual(
    [r.datos.casos.activos, r.datos.casos.terminados, r.datos.casos.abandonaron, r.datos.casos.total],
    [5, 1, 1, 7],
  );
  assert.deepEqual(r.datos.casos.porEstado, [
    { estado: "En curso", casos: 4 },
    { estado: "Retención", casos: 1 },
    { estado: "Completado", casos: 1 },
    { estado: "Abandono", casos: 1 },
  ]);
  assert.match(r.resumen, /5 casos activos de ortodoncia, 1 terminado y 1 en abandono/);
  assert.match(r.resumen, /\(4 en curso, 1 en retención, 1 completado, 1 en abandono\)/);
  assert.ok(r.resumen.includes(`(${ENLACES_ORTO.pacientes})`));
});

test("🔴 quién debe mensualidades y cuánto: las filas y los totales de la pantalla de Cobranza", async () => {
  const { db } = montar();
  const ctx = admin(db);
  const { cases } = await loadOrthoCases(CL_NORTE, TZ_NORTE, visor(ctx));
  const filas = filasDeCobranza(cases, hoyEnZona(new Date(), TZ_NORTE));
  const resumen = resumenDeCobranza(filas);

  const r = await ok(ortoCobranza, ctx, { que: "deben" });
  const d = r.datos.deben;
  assert.deepEqual(d.vencido, { casos: resumen.vencido.casos, pagos: resumen.vencido.cuotas, importe: resumen.vencido.importe });
  assert.deepEqual(d.porVencer, resumen.porVencer);
  assert.equal(d.porCobrar, resumen.porCobrar);
  assert.deepEqual(
    d.deudores.filas.map((f: any) => [f.paciente, f.vencido, f.pagosVencidos, f.diasDeAtraso]),
    filas.filter((f) => f.situacion === "vencido").map((f) => [f.patientName, f.vencido, f.cuotasVencidas, f.diasDeAtraso]),
  );

  // Y lo que tiene que dar. Dora está en PAGO POR CONTROL: debe un control de $800.
  assert.deepEqual(
    d.deudores.filas.map((f: any) => [f.paciente, f.vencido, f.pagosVencidos]),
    [
      ["Paula Restringida", 6000, 3],
      ["Ana Perez", 2000, 1],
      ["Dora Sanchez", 800, 1],
    ],
  );
  assert.deepEqual(d.vencido, { casos: 3, pagos: 5, importe: 8800 });
  assert.match(r.resumen, /3 casos deben mensualidades de ortodoncia: \$8,800 vencidos/);
  assert.match(r.resumen, /- Ana Perez — \$2,000, 1 pago vencido/);
  assert.match(r.resumen, /Yo no cobro ni mando recordatorios/);
  assert.ok(r.resumen.includes(`(${ENLACES_ORTO.cobranza})`));
});

test("🔴 cuánto entra este mes: las cifras del Tablero, cada una con su nombre", async () => {
  const { db } = montar();
  const ctx = admin(db);
  const tablero = await loadOrthoTableroData(CL_NORTE, TZ_NORTE, visor(ctx));
  const r = await ok(ortoCobranza, ctx, { que: "este_mes" });
  const m = r.datos.esteMes;

  assert.equal(m.mes, tablero.monthlyProjection[0].monthKey);
  assert.equal(m.porVencerEnElMes, tablero.monthlyProjection[0].amountMxn);
  // Lo cobrado: las barras de «Producción del mes», una por doctor, y su suma.
  assert.deepEqual(
    m.cobradoPorDoctor,
    tablero.productionByDoctor.map((p) => ({ doctor: p.doctorName, importe: p.amountMxn })),
  );
  assert.equal(m.cobradoEnElMes, tablero.productionByDoctor.reduce((s, p) => s + p.amountMxn, 0));
  assert.deepEqual(m.vencido, { casos: tablero.overdue.count, importe: tablero.overdue.amountMxn });
  assert.deepEqual(m.mesSiguiente, {
    mes: tablero.monthlyProjection[1].monthKey,
    importe: tablero.monthlyProjection[1].amountMxn,
  });
  // Lo vencido NO se suma a lo que «entra»: se dice aparte, y se dice qué es.
  assert.match(r.resumen, /ya cobrados en el mes/);
  assert.match(r.resumen, /vencidos sin cobrar/);
  assert.match(r.resumen, /proyección, no dinero recibido/);
  assert.match(r.resumen, /Yo no cobro/);
});

/* ═══════════════════════════════════════════════════════════════════════
   2. NO ESCRIBE NADA
   ═══════════════════════════════════════════════════════════════════════ */

test("🔴 solo lectura: todas las preguntas del encargo, contra una base que revienta si alguien escribe", async () => {
  const { db, escrituras } = montar();
  for (const p of PREGUNTAS) await ok(p.tool, admin(db), p.params);
  for (const patientId of ["p-dora", "p-beto", "p-carla", "p-elias", "p-priv", "p-inact-2", "p-inact-3"]) {
    await ok(ortoCaso, admin(db), { patientId });
  }
  assert.deepEqual(escrituras, [], `hubo escrituras: ${escrituras.join(", ")}`);
  assert.ok(db.contador.llamadas.length > 40, "la prueba no llegó a leer");
  for (const l of db.contador.llamadas) assert.ok(OPS_DE_LECTURA.has(l.op), `${l.modelo}.${l.op} no es una lectura`);
});

test("🔴 solo lectura: el SQL crudo del módulo pasa el candado del motor (si no, en vivo saldría «falló»)", async () => {
  const { db } = montar();
  for (const p of PREGUNTAS) await ok(p.tool, admin(db), p.params);
  await ok(ortoCaso, admin(db), { patientId: "p-dora" });

  assert.ok(pantalla.consultasSql.length >= 4, "no se llegó a consultar en SQL crudo");
  for (const c of pantalla.consultasSql) {
    // El candado ve la plantilla con los valores como parámetros.
    const comoLoVeElCandado = c.texto.replace(/ \? /g, " $1 ");
    assert.equal(esSqlDeLectura(comoLoVeElCandado), true, `el candado frenaría: ${c.texto.slice(0, 140)}`);
  }
});

test("🔴 solo lectura: el código de las herramientas no nombra ninguna escritura ni ninguna server action", () => {
  const carpeta = path.join(process.cwd(), "src/lib/sabina/tools");
  for (const archivo of ["orto-comun.ts", "orto-motor.ts", "orto-caso.ts", "orto-controles.ts", "orto-cobranza.ts"]) {
    // Sin comentarios: ahí sí se nombra lo que Sabina NO hace.
    const codigo = readFileSync(path.join(carpeta, archivo), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    for (const prohibido of [
      /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/,
      /\$executeRaw|\$transaction/,
      /\bfetch\s*\(/,
      /@\/app\/actions\//,
      /definirAccion/,
      /whatsapp\/(send|queue)|sendWhatsApp/i,
    ]) {
      assert.doesNotMatch(codigo, prohibido, `${archivo} nombra ${prohibido}`);
    }
  }
});

test("🔴 solo lectura, por el motor entero: le piden cobrar y agendar, y no sale ninguna propuesta", async () => {
  const { db, escrituras } = montar();
  const turnos = [
    turno([{ type: "tool_use", id: "tu_1", name: "orto_cobranza", input: { que: "deben" } }], "tool_use"),
    turno([{ type: "tool_use", id: "tu_2", name: "orto_controles", input: { que: "sin_control" } }], "tool_use"),
    turno([{ type: "text", text: "Ana Perez debe $2,000 y Beto Munoz lleva 60 días sin control." }], "end_turn"),
  ];
  let i = 0;
  const salida = await ejecutarSabina({
    ctx: admin(db),
    pregunta: "cóbrale a Ana su mensualidad y agéndale a Beto su control",
    tools: SABINA_TOOLS,
    llamar: async () => turnos[Math.min(i++, turnos.length - 1)],
  });

  assert.deepEqual(salida.herramientasUsadas, ["orto_cobranza", "orto_controles"]);
  assert.equal((salida.propuestas ?? []).length, 0, "una consulta de ortodoncia produjo una propuesta");
  assert.deepEqual(escrituras, []);
  // El modelo se comió los dos enlaces: los pone el motor.
  assert.ok(salida.respuesta.includes(`(${ENLACES_ORTO.cobranza})`), salida.respuesta);
  assert.ok(salida.respuesta.includes(`(${ENLACES_ORTO.controles})`), salida.respuesta);
  assert.match(salida.respuesta, /Yo solo lo consulto/);
});

/* ═══════════════════════════════════════════════════════════════════════
   3. PERMISOS
   ═══════════════════════════════════════════════════════════════════════ */

test("🔴 sin la key del módulo: `sin_permiso`, y no se consulta nada", async () => {
  const { db } = montar();
  const ctx = sesion(db, { role: "DOCTOR", userId: U_DOC_N, permissionsOverride: sinEstas("DOCTOR", "specialties.orthodontics") });
  for (const p of PREGUNTAS) {
    const r = await correrHerramienta(p.tool, ctx, p.params);
    assert.deepEqual(r, { ok: false, motivo: "sin_permiso", permiso: "specialties.orthodontics" }, p.dice);
  }
  assert.equal(db.contador.llamadas.length, 0, "se consultó la base sin el permiso del módulo");
  assert.equal(pantalla.consultasSql.length, 0);
});

test("🔴 recepción: el caso SIN lo clínico, diciéndolo — y lo clínico ni se lee", async () => {
  const { db } = montar();
  const r = await ok(ortoCaso, recepcion(db), { patientId: "p-ana" });
  const d = r.datos;

  assert.equal(d.clinico, null, "recepción no tiene medicalRecord.view");
  assert.deepEqual(d.omitidas, [{ seccion: "fase, arco, higiene y alineadores", permiso: "medicalRecord.view" }]);
  // Lo que sí es suyo: el estado del caso, los controles y las mensualidades.
  assert.deepEqual([d.caso.estado, d.caso.mes, d.caso.de], ["En curso", 7, 24]);
  assert.ok(d.controles?.proximo);
  assert.equal(d.cobranza.vencido, 2000);

  assert.doesNotMatch(todo(r), /Nivelación|NiTi|16x22|gingivitis|placa|MODERADA/i);
  assert.match(r.resumen, /NO tienes acceso a: fase, arco, higiene y alineadores \(falta medicalRecord\.view\)/);
  for (const clinico of ["orthoWireStep.findMany", "orthoTreatmentCard.findMany", "orthodonticAligner.findFirst"]) {
    assert.ok(!leidos(db).includes(clinico), `recepción hizo leer ${clinico}`);
  }

  // Que tenga una valoración registrada también es expediente.
  const valorada = await ok(ortoCaso, recepcion(db), { patientId: "p-inact-3" });
  assert.equal(valorada.datos.tieneValoracion, false);
  assert.doesNotMatch(todo(valorada), /valoración/i);
  assert.match(valorada.resumen, /no tiene un caso de ortodoncia abierto/);

  // Los alineadores de Dora también son clínicos.
  const dora = await ok(ortoCaso, recepcion(db), { patientId: "p-dora" });
  assert.equal(dora.datos.clinico, null);
  assert.doesNotMatch(todo(dora), /Invisalign|trae el \d|esperado/i);
});

test("🔴 recepción, por el motor: si el modelo se calla lo que faltó, el motor lo dice", async () => {
  const { db } = montar();
  const turnos = [
    turno([{ type: "tool_use", id: "tu_1", name: "orto_caso", input: { patientId: "p-ana" } }], "tool_use"),
    turno([{ type: "text", text: "Ana va en el mes 7 de 24 y debe $2,000." }], "end_turn"),
  ];
  let i = 0;
  const salida = await ejecutarSabina({
    ctx: recepcion(db),
    pregunta: "¿cómo va el caso de Ana?",
    tools: SABINA_TOOLS,
    llamar: async () => turnos[Math.min(i++, turnos.length - 1)],
  });
  assert.ok(salida.respuesta.includes(fraseSinPermiso("medicalRecord.view")), salida.respuesta);
  assert.ok(salida.respuesta.includes("(/dashboard/patients/p-ana?tab=ortodoncia)"), salida.respuesta);
});

test("🔴 doctor: la paciente restringida no existe para él — ni su caso, ni su control, ni su deuda", async () => {
  const { db } = montar();
  const ctx = doctor(db);

  // Ni por su id ni por su nombre: y la respuesta es la misma que para alguien que no existe.
  for (const params of [{ patientId: "p-priv" }, { paciente: "Paula Restringida" }, { paciente: "P0006" }]) {
    const caso = await ok(ortoCaso, ctx, params);
    assert.match(caso.datos.noEncontrado, /No encuentro a .* entre los pacientes que puedes ver/);
    assert.equal(caso.datos.caso, null);
    assert.doesNotMatch(todo(caso), /En curso|6,?000|mes \d/, "salió algo del caso de la restringida");
  }
  const inventado = await ok(ortoCaso, ctx, { patientId: "no-existe" });
  assert.equal(inventado.datos.noEncontrado, (await ok(ortoCaso, ctx, { patientId: "p-priv" })).datos.noEncontrado);

  for (const p of PREGUNTAS.filter((x) => x.tool !== ortoCaso)) {
    const r = await ok(p.tool, ctx, p.params);
    assert.doesNotMatch(todo(r), /Paula|Restringida/, `${p.dice}: salió la paciente restringida`);
  }

  // Y los totales son los de SUS pacientes visibles: sin los $6,000 de Paula.
  const deben = (await ok(ortoCobranza, ctx, { que: "deben" })).datos.deben;
  assert.deepEqual(deben.vencido, { casos: 2, pagos: 2, importe: 2800 });
  const casos = (await ok(ortoControles, ctx, { que: "casos" })).datos.casos;
  assert.equal(casos.activos, 4);
  const hoy = (await ok(ortoControles, ctx, { que: "hoy" })).datos;
  assert.deepEqual(hoy.resumenHoy, { enPie: 1, atendidos: 1, faltaron: 0, cancelados: 1 });

  // La administradora sí la ve: el filtro es la visibilidad, no que falte el dato.
  assert.match(todo(await ok(ortoCobranza, admin(db), { que: "deben" })), /Paula Restringida/);
  assert.equal((await ok(ortoCaso, admin(db), { patientId: "p-priv" })).datos.paciente, "Paula Restringida");
});

test("🔴 un paciente archivado por ARCO no tiene caso que contar", async () => {
  const { db } = montar();
  for (const params of [{ patientId: "p-borrado" }, { paciente: "Borrado ARCO" }]) {
    const r = await ok(ortoCaso, admin(db), params);
    assert.match(r.datos.noEncontrado, /No encuentro a/);
    assert.equal(r.datos.paciente, null);
  }
});

test("🔴 sin facturación: `orto_cobranza` dice `sin_permiso` sin leer, y el caso sale sin el dinero", async () => {
  const { db } = montar();
  const ctx = sesion(db, { role: "DOCTOR", userId: U_DOC_N, permissionsOverride: sinEstas("DOCTOR", "billing.view") });

  for (const que of ["deben", "este_mes"]) {
    const r = await correrHerramienta(ortoCobranza, ctx, { que });
    assert.deepEqual(r, { ok: false, motivo: "sin_permiso", permiso: "billing.view" });
  }
  assert.equal(db.contador.llamadas.length, 0, "se leyó la cobranza sin billing.view");

  const caso = await ok(ortoCaso, ctx, { patientId: "p-ana" });
  assert.equal(caso.datos.cobranza, null);
  assert.deepEqual(caso.datos.omitidas, [{ seccion: "mensualidades", permiso: "billing.view" }]);
  assert.equal(caso.datos.clinico.fase, "Nivelación", "lo clínico sí es suyo");
  assert.doesNotMatch(todo(caso), /2,000|16,000|"vencido"/);
});

test("🔴 sin agenda: no salen los controles (y se dice), pero contar casos sí", async () => {
  const { db } = montar();
  const ctx = sesion(db, { role: "DOCTOR", userId: U_DOC_N, permissionsOverride: sinEstas("DOCTOR", "agenda.view") });

  for (const que of ["hoy", "semana", "sin_control"]) {
    const r = await ok(ortoControles, ctx, { que });
    assert.deepEqual(r.datos.omitidas, [{ seccion: "controles de ortodoncia", permiso: "agenda.view" }]);
    assert.equal(r.datos.controles, null);
    assert.equal(r.datos.sinControl, null);
    assert.doesNotMatch(todo(r), /Ana|Beto|Dora|Carla/);
    assert.match(r.resumen, /NO tienes acceso a: controles de ortodoncia/);
  }
  assert.ok(!leidos(db).includes("appointment.findMany"), "se leyó la agenda sin agenda.view");

  assert.equal((await ok(ortoControles, ctx, { que: "casos" })).datos.casos.activos, 4);
});

test("🔴 si fue el Super Admin quien se lo quitó a Sabina, la frase no dice «no tienes acceso»", async () => {
  const { db } = montar();
  const ctx = sesion(db, {
    permissionsOverride: sinEstas("ADMIN", "billing.view", "medicalRecord.view"),
    sabina: { apagada: false, quitadas: ["billing.view", "medicalRecord.view"] },
  });
  const r = await ok(ortoCaso, ctx, { patientId: "p-ana" });
  assert.deepEqual(r.datos.omitidas, [
    { seccion: "fase, arco, higiene y alineadores", permiso: "medicalRecord.view", causa: "sabina" },
    { seccion: "mensualidades", permiso: "billing.view", causa: "sabina" },
  ]);
  assert.doesNotMatch(r.resumen, /NO tienes acceso/);
  assert.ok(r.resumen.includes(fraseSinPermiso("billing.view", "sabina")), r.resumen);
  assert.ok(r.resumen.includes(fraseSinPermiso("medicalRecord.view", "sabina")), r.resumen);
});

/* ═══════════════════════════════════════════════════════════════════════
   4. NO CRUZA DE CLÍNICA
   ═══════════════════════════════════════════════════════════════════════ */

test("🔴 aislamiento: el norte no ve nada del sur, y el sur no ve nada del norte", async () => {
  const { db } = montar();

  for (const p of PREGUNTAS) {
    const r = await ok(p.tool, admin(db), p.params);
    assert.doesNotMatch(todo(r), /SUR|Sofia|99,?999/, `${p.dice}: se coló la clínica del sur`);
  }
  // El paciente del sur, pedido desde el norte con su id: no existe.
  for (const params of [{ patientId: "p-sur-1" }, { paciente: "Sofia SUR" }, { paciente: "S0001" }]) {
    const r = await ok(ortoCaso, admin(db), params);
    assert.match(r.datos.noEncontrado, /No encuentro a/, JSON.stringify(params));
    assert.doesNotMatch(todo(r), /ARCO DEL SUR|99,?999|TMA/);
  }

  const sur = adminDelSur(db);
  for (const p of PREGUNTAS.filter((x) => x.tool !== ortoCaso)) {
    const r = await ok(p.tool, sur, p.params);
    assert.doesNotMatch(todo(r), /Ana|Beto|Carla|Dora|Elias|Paula/, `${p.dice}: se coló la clínica del norte`);
  }
  assert.match((await ok(ortoCaso, sur, { paciente: "Ana Perez" })).datos.noEncontrado, /No encuentro a/);
  assert.match((await ok(ortoCaso, sur, { patientId: "p-ana" })).datos.noEncontrado, /No encuentro a/);

  // Y el sur sí ve lo suyo: el filtro es la clínica, no que la herramienta venga vacía.
  const suyo = await ok(ortoCaso, sur, { patientId: "p-sur-1" });
  assert.equal(suyo.datos.paciente, "Sofia SUR");
  assert.equal(suyo.datos.clinico.arco, "TMA ARCO DEL SUR (superior e inferior)");
  assert.equal((await ok(ortoCobranza, sur, { que: "deben" })).datos.deben.vencido.casos, 1);
});

test("🔴 aislamiento: cada consulta en SQL crudo sale con el clinicId de la sesión", async () => {
  const { db } = montar();
  for (const p of PREGUNTAS) await ok(p.tool, adminDelSur(db), { ...p.params, patientId: "p-sur-1" });
  const conClinica = pantalla.consultasSql.filter((c) => c.valores.length > 0);
  assert.ok(conClinica.length >= 3, "no se llegó a consultar");
  for (const c of conClinica) assert.equal(c.valores[0], CL_SUR, c.texto.slice(0, 120));
});

/* ═══════════════════════════════════════════════════════════════════════
   5. SIN EL MÓDULO
   ═══════════════════════════════════════════════════════════════════════ */

test("🔴 sede sin el módulo: dice que no está contratado, da el enlace, y no lee ni un caso", async () => {
  for (const clinicId of [CL_SIN_MODULO, CL_VENCIDA]) {
    const { db } = montar();
    const ctx = sesion(db, { clinicId });
    for (const p of PREGUNTAS) {
      const r = await ok(p.tool, ctx, { ...p.params, patientId: "p-sin-1" });
      assert.equal(r.datos.modulo, "no_contratado", `${clinicId} · ${p.dice}`);
      assert.match(r.resumen, /no tiene contratado el módulo de Ortodoncia/);
      assert.ok(r.resumen.includes(`(${ENLACES_ORTO.contratar})`), r.resumen);
      assert.doesNotMatch(todo(r), /Nora|SINMODULO/, "salió un caso de una sede sin el módulo");
      assert.deepEqual(p.tool.avisoObligatorio!(r.datos)?.marca, "contrat");
    }
    // Lo único que se miró: si la sede tiene el módulo.
    assert.deepEqual(Array.from(new Set(leidos(db))), ["clinicModule.findFirst"]);
    assert.equal(pantalla.consultasSql.length, 0);
  }
});

test("🔴 sin el módulo, por el motor: si el modelo dice «no hay casos», el motor añade que no está contratado", async () => {
  const { db } = montar();
  const turnos = [
    turno([{ type: "tool_use", id: "tu_1", name: "orto_controles", input: { que: "casos" } }], "tool_use"),
    turno([{ type: "text", text: "No encontré casos de ortodoncia." }], "end_turn"),
  ];
  let i = 0;
  const salida = await ejecutarSabina({
    ctx: sesion(db, { clinicId: CL_SIN_MODULO }),
    pregunta: "¿cuántos casos de ortodoncia tengo?",
    tools: SABINA_TOOLS,
    llamar: async () => turnos[Math.min(i++, turnos.length - 1)],
  });
  assert.match(salida.respuesta, /no tiene contratado el módulo de Ortodoncia/);
  assert.ok(salida.respuesta.includes(`(${ENLACES_ORTO.contratar})`), salida.respuesta);
});

test("una clínica que no es dental: el módulo no es suyo, y no se consulta nada", async () => {
  const { db } = montar();
  const ctx = sesion(db, { clinicCategory: "MEDICINE" });
  for (const p of PREGUNTAS) {
    const r = await ok(p.tool, ctx, p.params);
    assert.equal(r.datos.modulo, "no_es_dental");
    assert.match(r.resumen, /clínicas dentales/);
  }
  assert.equal(db.contador.llamadas.length, 0);
});

/* ═══════════════════════════════════════════════════════════════════════
   6. EL ENLACE
   ═══════════════════════════════════════════════════════════════════════ */

test("cada respuesta lleva el enlace a la pantalla donde se hace, y el motor lo pone si falta", async () => {
  const { db } = montar();
  const esperado: Record<string, string> = {
    "orto_caso": "/dashboard/patients/p-ana?tab=ortodoncia",
    "orto_controles:hoy": ENLACES_ORTO.controles,
    "orto_controles:semana": ENLACES_ORTO.controles,
    "orto_controles:sin_control": ENLACES_ORTO.controles,
    "orto_controles:casos": ENLACES_ORTO.pacientes,
    "orto_cobranza:deben": ENLACES_ORTO.cobranza,
    "orto_cobranza:este_mes": ENLACES_ORTO.cobranza,
  };
  for (const p of PREGUNTAS) {
    const r = await ok(p.tool, admin(db), p.params);
    const ruta = esperado[p.params.que ? `${p.tool.nombre}:${p.params.que}` : p.tool.nombre];
    const aviso = p.tool.avisoObligatorio!(r.datos)!;
    assert.equal(aviso.marca, ruta, p.dice);
    assert.ok(aviso.frase.includes(`](${ruta})`), aviso.frase);
    assert.ok(r.resumen.includes(`(${ruta})`), `${p.dice}: el resumen no lleva el enlace`);

    // Sin el enlace, el motor lo añade; con él, no lo repite.
    const sin = garantizarAvisosObligatorios("Aquí va el dato.", [aviso]);
    assert.ok(sin.includes(`](${ruta})`), sin);
    const con = garantizarAvisosObligatorios(`Aquí va el dato. Se hace en [la pantalla](${ruta}).`, [aviso]);
    assert.equal(con.split(ruta).length - 1, 1, con);
  }
});
