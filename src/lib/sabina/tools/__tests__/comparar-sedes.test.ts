/**
 * COMPARAR SEDES — que sea IMPOSIBLE leer una sede que no es tuya.
 *
 * Run: npm run test:sabina-sedes
 *
 * La pregunta que gobierna este archivo no es «¿compara bien?». Es «¿por qué
 * vía podría salir una clínica ajena?», y cada bloque cierra una:
 *
 *   1 · la vía normal        — se pide la comparación y punto
 *   2 · la vía del modelo    — el modelo manda a propósito el id de otro cliente
 *   3 · la vía del parámetro — el modelo inventa `sede`, `sedeId`, `sucursal`
 *   4 · la vía del salto     — se llama a `ejecutar` a pelo, saltándose el zod
 *   5 · la vía de la ficha   — una sede que FUE tuya y ya no lo es
 *   6 · la vía del jefe      — la sede hermana de tu jefe, en la que no tienes ficha
 *   7 · la vía del where     — que ninguna consulta salga sin filtro de clínica
 *
 * Y dos que no son de fuga pero vuelven falsa la respuesta si fallan: el permiso
 * por sede (regla 3 del contrato: sin permiso se DICE) y el caso de quien tiene
 * una sola sede, que tiene que seguir viendo exactamente lo de hoy.
 */

import "./preparar";
import { test } from "node:test";
import assert from "node:assert/strict";

import { correrHerramienta } from "../base";
import { compararSedes, type DatosComparar } from "../comparar-sedes";
import { sedesVisibles, TOPE_SEDES } from "../../sedes";
import { validarLlamada } from "../../engine-core";
import { getEffectivePermissions } from "@/lib/auth/permissions";
import { crearBase, type Datos, type Fila } from "./doble-base";
import { CL_NORTE, CL_SUR, TZ_NORTE, U_ADMIN_N, U_ADMIN_S } from "./siembra";
import {
  AUSENCIAS_DE_RAFA_EN_SUR,
  CIFRAS_PROHIBIDAS,
  CIFRAS_VENCIDA,
  CITAS_DE_RAFA_EN_SUR,
  CL_AJENA,
  CL_EXSEDE,
  CL_VENCIDA,
  NOMBRE_VENCIDA,
  NOMBRE_AJENA,
  NOMBRE_EXSEDE,
  NOMBRE_NORTE,
  NOMBRE_SUR,
  SB_RAFA,
  U_RAFA_EX,
  U_RAFA_S,
  ajenoEnSuClinica,
  baseDeSedes,
  datosDeSedes,
  lupeEnNorte,
  rafaEnNorte,
  rafaEnSur,
} from "./sedes-siembra";
import type { SabinaCtx } from "../../tipos";

/* ── utilería ────────────────────────────────────────────────────────── */

const DEL_ADMIN = getEffectivePermissions({ role: "ADMIN", permissionsOverride: [] });
const SIN_FACTURACION = DEL_ADMIN.filter((k) => k !== "billing.view");

async function comparar(ctx: SabinaCtx, params: unknown = {}) {
  return correrHerramienta(compararSedes, ctx, params);
}

/** Los datos, o el fallo con su detalle, para que el mensaje del assert sirva. */
function datosDe(r: any): DatosComparar {
  assert.equal(r.ok, true, `la herramienta no contestó: ${JSON.stringify(r)}`);
  return r.datos as DatosComparar;
}

/** Los nombres de sede que salieron, en orden. */
function nombres(d: DatosComparar): string[] {
  return d.sedes.map((s) => s.nombre);
}

/**
 * 🔴 EL ASSERT QUE IMPORTA. Recorre el resultado ENTERO —datos y resumen— y
 * comprueba que no aparece por ningún lado nada de las clínicas prohibidas: ni
 * su id, ni su nombre, ni ninguna de sus cifras imposibles. No mira campo por
 * campo a propósito: un campo nuevo que alguien añada mañana también entra.
 */
function nadaAjeno(r: any, contexto: string): void {
  const texto = JSON.stringify(r);
  for (const prohibido of [CL_AJENA, CL_EXSEDE, NOMBRE_AJENA, NOMBRE_EXSEDE, U_RAFA_EX]) {
    assert.equal(
      texto.includes(prohibido),
      false,
      `${contexto}: se coló «${prohibido}» → ${texto.slice(0, 600)}`,
    );
  }
  for (const cifra of CIFRAS_PROHIBIDAS) {
    assert.equal(
      texto.includes(String(cifra)),
      false,
      `${contexto}: se coló la cifra ${cifra}, que solo existe en una clínica ajena`,
    );
  }
}

/* ══════════════════════════════════════════════════════════════════════
 * 1 · LA VÍA NORMAL — la pregunta de Rafael
 * ══════════════════════════════════════════════════════════════════════ */

test("«¿cómo va Altabrisa contra la otra?» — salen sus DOS sedes, con nombre y números", async () => {
  const db = baseDeSedes();
  const r = await comparar(rafaEnNorte(db));
  const d = datosDe(r);

  assert.deepEqual(nombres(d), [NOMBRE_NORTE, NOMBRE_SUR], "la activa va primera");
  assert.equal(d.totalSedes, 2);
  assert.equal(d.truncado, false);

  // 🔴 Cada sede trae LOS SUYOS. No basta con que sean distintos: se cotejan
  // contra lo que contesta `ingresos_por_periodo` a secas en cada sede, con la
  // sesión parada allí. Si se cruzaran, esto lo caza.
  assert.ok(d.sedes[0].ingresos, "Altabrisa sin ingresos");
  assert.ok(d.sedes[1].ingresos, "Centro sin ingresos");
  const { ingresosPorPeriodo } = await import("../ingresos-por-periodo");
  const rango = { desde: d.desde, hasta: d.hasta, agrupar: "mes" as const };
  const soloNorte: any = await correrHerramienta(ingresosPorPeriodo, rafaEnNorte(baseDeSedes()), rango);
  const soloSur: any = await correrHerramienta(ingresosPorPeriodo, rafaEnSur(baseDeSedes()), rango);
  assert.equal(d.sedes[0].ingresos!.netos, soloNorte.datos.ingresosNetos, "los netos de Altabrisa no son los suyos");
  assert.equal(d.sedes[1].ingresos!.netos, soloSur.datos.ingresosNetos, "los netos de Centro no son los suyos");
  assert.notEqual(soloNorte.datos.ingresosNetos, soloSur.datos.ingresosNetos, "la siembra no distingue las sedes");
  assert.deepEqual(d.sedes[0].omitidas, [], "el ADMIN lo ve todo en su sede");

  // El resumen lleva los NOMBRES, que es lo que se lee. Nunca un id.
  assert.ok((r as any).resumen.includes(NOMBRE_NORTE), (r as any).resumen);
  assert.ok((r as any).resumen.includes(NOMBRE_SUR), (r as any).resumen);
  assert.equal((r as any).resumen.includes(CL_NORTE), false, "el resumen enseñó un id");

  nadaAjeno(r, "la vía normal");
});

test("da igual en qué sede esté parada la sesión: desde Centro se ven las mismas dos", async () => {
  const db = baseDeSedes();
  const d = datosDe(await comparar(rafaEnSur(db)));
  assert.deepEqual(nombres(d), [NOMBRE_SUR, NOMBRE_NORTE], "ahora la activa es Centro");
  assert.equal(d.totalSedes, 2);
});

test("«¿en cuál se cae más gente?» y «¿dónde se factura más?» — métricas por separado", async () => {
  const db = baseDeSedes();

  const citas = datosDe(await comparar(rafaEnNorte(db), { metrica: "citas" }));
  for (const s of citas.sedes) {
    assert.ok(s.citas, `${s.nombre} sin citas`);
    assert.equal(s.ingresos, null, `${s.nombre}: con metrica=citas no se piden ingresos`);
    assert.equal(s.porCobrar, null, `${s.nombre}: con metrica=citas no se pide el saldo`);
  }

  const dbDinero = baseDeSedes();
  const dinero = datosDe(await comparar(rafaEnNorte(dbDinero), { metrica: "dinero" }));
  for (const s of dinero.sedes) {
    assert.ok(s.ingresos, `${s.nombre} sin ingresos`);
    assert.ok(s.porCobrar, `${s.nombre} sin saldo por cobrar`);
    assert.equal(s.citas, null, `${s.nombre}: con metrica=dinero no se piden citas`);
  }
  // Menos consultas que `todo`: el parámetro existe para ahorrar base, no por gusto.
  const dbTodo = baseDeSedes();
  datosDe(await comparar(rafaEnNorte(dbTodo), { metrica: "todo" }));
  assert.ok(
    dbDinero.contador.llamadas.length < dbTodo.contador.llamadas.length,
    `metrica=dinero (${dbDinero.contador.llamadas.length}) costó tanto como todo (${dbTodo.contador.llamadas.length})`,
  );
  assert.ok(
    db.contador.llamadas.length < dbTodo.contador.llamadas.length,
    "metrica=citas costó tanto como todo",
  );
});

/* ══════════════════════════════════════════════════════════════════════
 * 2 · LA VÍA DEL MODELO — que pida a propósito la clínica de otro cliente
 * ══════════════════════════════════════════════════════════════════════ */

test("🔴 el modelo manda el clinicId de OTRO CLIENTE: se retira y la respuesta es la misma", async () => {
  const db = baseDeSedes();

  const v = validarLlamada([compararSedes], "comparar_sedes", {
    metrica: "dinero",
    clinicId: CL_AJENA,
    clinic_id: CL_AJENA,
    tenantId: CL_AJENA,
  });
  assert.equal(v.ok, true, `el motor no aceptó la llamada: ${JSON.stringify(v)}`);
  assert.deepEqual(
    (v as any).retirados.sort(),
    ["clinicId", "clinic_id", "tenantId"].sort(),
    "el motor tiene que RETIRAR los ids de clínica antes de validar",
  );
  assert.equal(
    JSON.stringify((v as any).params).includes(CL_AJENA),
    false,
    "el id ajeno sobrevivió a la validación",
  );

  const r = await comparar(rafaEnNorte(db), (v as any).params);
  assert.deepEqual(nombres(datosDe(r)), [NOMBRE_NORTE, NOMBRE_SUR]);
  nadaAjeno(r, "el modelo mandó un clinicId ajeno");
});

test("🔴 el modelo manda el id ajeno saltándose el saneo del motor: tampoco sale", async () => {
  const db = baseDeSedes();
  // Directo a la herramienta, sin pasar por `sanearArgumentos`. `.strict()` lo
  // tumba antes de ejecutar nada.
  const r = await comparar(rafaEnNorte(db), { clinicId: CL_AJENA });
  assert.equal(r.ok, false);
  assert.equal((r as any).motivo, "error");
  assert.ok((r as any).detalle.includes("parametros_invalidos"), (r as any).detalle);
  nadaAjeno(r, "id ajeno directo a la herramienta");
});

/* ══════════════════════════════════════════════════════════════════════
 * 3 · LA VÍA DEL PARÁMETRO — que se invente una forma de nombrar la sede
 * ══════════════════════════════════════════════════════════════════════ */

test("🔴 no hay NINGUNA forma de nombrar una sede: sede, sedeId, sucursal, clinica… se rechazan", async () => {
  const db = baseDeSedes();
  const inventos: Array<Record<string, unknown>> = [
    { sede: NOMBRE_AJENA },
    { sedeId: CL_AJENA },
    { sedes: [CL_NORTE, CL_AJENA] },
    { sucursal: NOMBRE_AJENA },
    { sucursalId: CL_AJENA },
    { clinica: NOMBRE_AJENA },
    { clinicas: [CL_AJENA] },
    { nombre_sede: NOMBRE_AJENA },
    { incluir: [CL_AJENA] },
  ];

  for (const invento of inventos) {
    const etiqueta = Object.keys(invento)[0];

    // Por el motor: la llamada NO se ejecuta.
    const v = validarLlamada([compararSedes], "comparar_sedes", invento);
    assert.equal(v.ok, false, `«${etiqueta}» pasó la validación del motor`);
    assert.equal((v as any).motivo, "parametros", etiqueta);

    // Y por la herramienta: tampoco.
    const r = await comparar(rafaEnNorte(db), invento);
    assert.equal(r.ok, false, `«${etiqueta}» se ejecutó`);
    nadaAjeno(r, `el modelo inventó «${etiqueta}»`);
  }

  // Ni una consulta a la base por ninguno de los inventos.
  assert.equal(db.contador.llamadas.length, 0, "se consultó la base con parámetros inventados");
});

/* ══════════════════════════════════════════════════════════════════════
 * 4 · LA VÍA DEL SALTO — llamar a `ejecutar` a pelo, sin zod
 * ══════════════════════════════════════════════════════════════════════ */

test("🔴 aunque alguien se salte el zod y le meta ids ajenos, las sedes salen de la sesión", async () => {
  const db = baseDeSedes();
  // `ejecutar` se llama directo, con basura extra dentro de los params. Es lo
  // que pasaría si mañana alguien llamara a la herramienta desde otro sitio sin
  // pasar por el runner. Las sedes NO se leen de los params: se leen del ctx.
  const d = (await compararSedes.ejecutar(rafaEnNorte(db), {
    metrica: "todo",
    clinicId: CL_AJENA,
    sedes: [CL_AJENA, CL_EXSEDE],
  } as any)) as DatosComparar;

  assert.deepEqual(nombres(d), [NOMBRE_NORTE, NOMBRE_SUR]);
  nadaAjeno(d, "llamada directa con ids ajenos");
});

test("🔴 `sedesVisibles` recibe UN argumento y es el ctx de la sesión", async () => {
  const db = baseDeSedes();
  assert.equal(sedesVisibles.length, 1, "alguien le añadió un segundo parámetro a sedesVisibles");

  const ctx = rafaEnNorte(db);
  const v = await sedesVisibles(ctx);
  assert.deepEqual(v.sedes.map((s) => s.clinicId), [CL_NORTE, CL_SUR]);

  // La sede activa se mira con el MISMO objeto ctx que armó la sesión, no con
  // uno recalculado: es lo que garantiza que para quien tiene una sola sede
  // esto sea literalmente el camino de siempre.
  assert.equal(v.sedes[0].ctx, ctx, "el ctx de la sede activa se recalculó");

  // Y la hermana lleva SU clinicId y SU ficha, nunca los de la activa.
  assert.equal(v.sedes[1].ctx.clinicId, CL_SUR);
  assert.equal(v.sedes[1].ctx.userId, U_RAFA_S);
  assert.notEqual(v.sedes[1].ctx.clinicId, ctx.clinicId);
});

/* ══════════════════════════════════════════════════════════════════════
 * 5 · LA VÍA DE LA FICHA — la sede que FUE tuya
 * ══════════════════════════════════════════════════════════════════════ */

test("🔴 una sede hermana con la ficha DESACTIVADA no sale (isActive no es decorativo)", async () => {
  const db = baseDeSedes();

  // La fila existe: misma persona, misma sede, `isActive: false`.
  const fila = datosDeSedes().users!.find((u: Fila) => u.id === U_RAFA_EX);
  assert.ok(fila, "la siembra perdió la ficha desactivada; la prueba no mediría nada");
  assert.equal(fila!.supabaseId, SB_RAFA, "tiene que ser LA MISMA persona para que la prueba muerda");
  assert.equal(fila!.isActive, false);

  const r = await comparar(rafaEnNorte(db));
  assert.deepEqual(nombres(datosDe(r)), [NOMBRE_NORTE, NOMBRE_SUR]);
  nadaAjeno(r, "sede con la ficha desactivada");
});

test("🔴 el otro cliente ve SU clínica y solo la suya — y nada de las de Rafael", async () => {
  const db = baseDeSedes();
  const r = await comparar(ajenoEnSuClinica(db));
  const d = datosDe(r);

  assert.deepEqual(nombres(d), [NOMBRE_AJENA]);
  assert.equal(d.totalSedes, 1);

  const texto = JSON.stringify(r);
  for (const prohibido of [CL_NORTE, CL_SUR, NOMBRE_NORTE, NOMBRE_SUR]) {
    assert.equal(texto.includes(prohibido), false, `el ajeno vio «${prohibido}»`);
  }
});

/* ══════════════════════════════════════════════════════════════════════
 * 6 · LA VÍA DEL JEFE — la hermana de tu jefe no es tuya
 * ══════════════════════════════════════════════════════════════════════ */

test("🔴 la recepcionista solo tiene ficha en una sede: NO hereda la sede hermana de su jefe", async () => {
  const db = baseDeSedes();
  const r = await comparar(lupeEnNorte(db));
  const d = datosDe(r);

  assert.deepEqual(nombres(d), [NOMBRE_NORTE], "Lupe vio una sede que no es suya");
  assert.equal(d.totalSedes, 1);
  // Y se lo dice, en vez de dar un número suelto como si fuera una comparación.
  assert.ok(
    (r as any).resumen.includes("una sede"),
    `el resumen no avisa de que no hay con qué comparar: ${(r as any).resumen}`,
  );
  // Su jefe, en la misma base, sí ve las dos: la diferencia es la ficha, no la clínica.
  assert.equal(datosDe(await comparar(rafaEnNorte(baseDeSedes()))).sedes.length, 2);
});

test("quien tiene una sola sede ve exactamente lo de hoy: los MISMOS números que su propia clínica", async () => {
  const db = baseDeSedes();
  const ctx = lupeEnNorte(db);

  const d = datosDe(await comparar(ctx, { metrica: "citas" }));
  assert.equal(d.sedes.length, 1);

  // Lo mismo que contesta `ausencias` a secas, con el mismo ctx y el mismo rango.
  const { ausencias } = await import("../ausencias");
  const solo: any = await correrHerramienta(ausencias, ctx, { desde: d.desde, hasta: d.hasta });
  assert.equal(d.sedes[0].citas!.agendadas, solo.datos.citasAgendadas);
  assert.equal(d.sedes[0].citas!.ausencias, solo.datos.ausencias.total);
});

/* ══════════════════════════════════════════════════════════════════════
 * 7 · LA VÍA DEL WHERE — ninguna consulta sin filtro de clínica
 * ══════════════════════════════════════════════════════════════════════ */

/** Los modelos que llevan `clinicId` y NUNCA se pueden consultar sin filtro. */
const CON_TENANT = ["patient", "appointment", "invoice", "record", "prescription", "patientFile"];

/**
 * Envuelve el doble para quedarse con el `where` de cada consulta. Es lo único
 * que permite comprobar la regla de verdad: que no hay un `findMany` sin
 * `clinicId` (que en Prisma devolvería el sistema entero), no solo que el
 * resultado salió bien.
 */
function espiar(db: any): { db: any; wheres: Array<{ modelo: string; where: string }> } {
  const wheres: Array<{ modelo: string; where: string }> = [];
  const espia: any = { contador: db.contador };
  for (const clave of Object.keys(db)) {
    const valor = db[clave];
    if (clave === "contador" || typeof valor !== "object" || valor === null) {
      espia[clave] = valor;
      continue;
    }
    const delegado: any = {};
    for (const op of Object.keys(valor)) {
      delegado[op] = async (args: any = {}) => {
        wheres.push({ modelo: clave, where: JSON.stringify(args?.where ?? null) });
        return valor[op](args);
      };
    }
    espia[clave] = delegado;
  }
  return { db: espia, wheres };
}

test("🔴 ninguna consulta de datos sale sin filtro de clínica, y ninguna nombra una clínica ajena", async () => {
  const cruda = baseDeSedes();
  const { db, wheres } = espiar(cruda);
  const ctx = rafaEnNorte(cruda);
  const r = await comparar({ ...ctx, db }, { metrica: "todo" });
  datosDe(r);

  assert.ok(wheres.length > 20, `apenas se consultó la base (${wheres.length}): la prueba no mediría nada`);

  const permitidas = [CL_NORTE, CL_SUR];
  for (const q of wheres) {
    // (a) Nada apunta jamás a una clínica prohibida, en ningún modelo.
    for (const prohibida of [CL_AJENA, CL_EXSEDE]) {
      assert.equal(
        q.where.includes(prohibida),
        false,
        `${q.modelo}: se consultó con la clínica prohibida ${prohibida} → ${q.where}`,
      );
    }
    // (b) Y toda consulta de DATOS lleva el filtro de una de las sedes propias.
    // `user` y `clinic` quedan fuera a propósito: son justo las dos lecturas
    // que resuelven QUIÉN es y QUÉ sedes tiene, y se filtran por identidad
    // (`supabaseId`) o por la lista ya calculada, no por una clínica.
    if (CON_TENANT.indexOf(q.modelo) !== -1) {
      assert.ok(
        permitidas.some((id) => q.where.includes(id)),
        `${q.modelo} se consultó SIN filtro de clínica → ${q.where}`,
      );
    }
  }

  // (c) 🔴 Y ninguna consulta de datos mezcla las DOS sedes propias. Una sede se
  // mira con su ctx y con ningún otro; un `in: [norte, sur]` en una tabla de
  // pacientes o facturas sería exactamente el atajo que este diseño evita.
  for (const q of wheres) {
    if (CON_TENANT.indexOf(q.modelo) === -1) continue;
    assert.equal(
      q.where.includes(CL_NORTE) && q.where.includes(CL_SUR),
      false,
      `${q.modelo} consultó las dos sedes a la vez → ${q.where}`,
    );
  }
  // Y las dos sedes SÍ se consultaron por separado: si no, (c) sería vacuo.
  for (const id of [CL_NORTE, CL_SUR]) {
    assert.ok(
      wheres.some((q) => CON_TENANT.indexOf(q.modelo) !== -1 && q.where.includes(id)),
      `no se consultó ninguna tabla de datos con ${id}`,
    );
  }

  // La lectura de identidad es la única que cruza clínicas, y se filtra por
  // persona: si algún día deja de llevar `supabaseId`, esto lo caza.
  const deUsuarios = wheres.filter((q) => q.modelo === "user");
  assert.ok(deUsuarios.length > 0);
  assert.ok(
    deUsuarios.some((q) => q.where.includes(SB_RAFA)),
    `la lectura de sedes no se filtró por persona: ${JSON.stringify(deUsuarios)}`,
  );
});

/* ══════════════════════════════════════════════════════════════════════
 * 8 · EL PERMISO — sin él se DICE, y no se lee una fila
 * ══════════════════════════════════════════════════════════════════════ */

test("🔴 sin la key de la herramienta: sin_permiso, y sin tocar la base", async () => {
  const db = baseDeSedes();
  const ctx = rafaEnNorte(db, { permissionsOverride: ["agenda.view"] });

  const r = await comparar(ctx, {});
  assert.deepEqual(r, { ok: false, motivo: "sin_permiso", permiso: "today.view" });
  assert.equal(db.contador.llamadas.length, 0, "se leyó la base sin permiso");
});

test("🔴 permiso POR SEDE: sin facturación en Centro, Centro no trae dinero y se DICE", async () => {
  // A Rafael le recortaron `billing.view` en la ficha de Centro. En Altabrisa
  // sigue siendo ADMIN con todo.
  const datos: Datos = datosDeSedes();
  datos.users = datos.users!.map((u: Fila) =>
    u.id === U_RAFA_S ? { ...u, permissionsOverride: SIN_FACTURACION } : u,
  );
  const db = crearBase(datos);

  const r = await comparar(rafaEnNorte(db), { metrica: "dinero" });
  const d = datosDe(r);

  const altabrisa = d.sedes[0];
  const centro = d.sedes[1];
  assert.equal(altabrisa.nombre, NOMBRE_NORTE);
  assert.ok(altabrisa.ingresos, "Altabrisa tenía que traer ingresos");
  assert.deepEqual(altabrisa.omitidas, []);

  assert.equal(centro.nombre, NOMBRE_SUR);
  assert.equal(centro.ingresos, null, "Centro trajo ingresos sin permiso");
  assert.equal(centro.porCobrar, null, "Centro trajo el saldo sin permiso");
  assert.deepEqual(centro.omitidas, [{ seccion: "ingresos y por cobrar", permiso: "billing.view" }]);

  // 🔴 Y se dice, con el nombre de la sede: callarlo dejaría a Rafael creyendo
  // que Centro no facturó nada.
  const resumen = (r as any).resumen as string;
  assert.ok(resumen.includes("NO tienes acceso"), resumen);
  assert.ok(resumen.includes(NOMBRE_SUR), `el aviso no dice en qué sede: ${resumen}`);
  assert.ok(resumen.includes("billing.view"), resumen);
});

test("🔴 cada trozo se gatea con la key que DECLARA su herramienta, y sin ella no sale", async () => {
  // Aquí se llama a `ejecutar` DIRECTO, y `ejecutar` no vuelve a mirar el
  // `permiso` del catálogo: ese chequeo vive en `correrHerramienta`. O sea que
  // la key con la que se gatea cada trozo aquí es la única que lo protege.
  const { ingresosPorPeriodo } = await import("../ingresos-por-periodo");
  const { pacientesConDeuda } = await import("../pacientes-con-deuda");
  const { ausencias } = await import("../ausencias");
  const { agendaOcupacion } = await import("../agenda-ocupacion");
  const { pacientesNuevos } = await import("../pacientes-nuevos");

  const casos = [
    { tool: ingresosPorPeriodo, metrica: "dinero", campo: "ingresos" },
    { tool: pacientesConDeuda, metrica: "dinero", campo: "porCobrar" },
    { tool: ausencias, metrica: "citas", campo: "citas" },
    { tool: agendaOcupacion, metrica: "ocupacion", campo: "ocupacion" },
    { tool: pacientesNuevos, metrica: "pacientes", campo: "pacientes" },
  ] as const;

  for (const caso of casos) {
    // La key se quita EN LAS DOS fichas: en la de la sesión y en la de la sede
    // hermana. Así se comprueba el gateo por los dos caminos —el ctx de la
    // sesión y el ctx derivado— y no solo por uno.
    const sinEsa = DEL_ADMIN.filter((k) => k !== caso.tool.permiso);
    const datos: Datos = datosDeSedes();
    datos.users = datos.users!.map((u: Fila) =>
      u.id === U_RAFA_S ? { ...u, permissionsOverride: sinEsa } : u,
    );
    const db = crearBase(datos);

    const d = datosDe(
      await comparar(rafaEnNorte(db, { permissionsOverride: sinEsa }), { metrica: caso.metrica }),
    );
    for (const sede of d.sedes) {
      assert.equal(
        (sede as any)[caso.campo],
        null,
        `sin ${caso.tool.permiso}, ${sede.nombre} trajo «${caso.campo}» igualmente`,
      );
      assert.ok(
        sede.omitidas.some((o) => o.permiso === caso.tool.permiso),
        `sin ${caso.tool.permiso} (${caso.tool.nombre}), ${sede.nombre} no lo dijo: ${JSON.stringify(sede.omitidas)}`,
      );
    }
  }

  // 🔴 CANARIO. Hoy las dos de dinero declaran la MISMA key, así que una prueba
  // de comportamiento no puede distinguir «cada una con la suya» de «las dos
  // con la de los ingresos». El código las gatea por separado a propósito; si
  // algún día estas keys dejan de coincidir, esta línea salta y hay que venir a
  // comprobar que el gateo sigue siendo el de cada una.
  assert.equal(
    pacientesConDeuda.permiso,
    ingresosPorPeriodo.permiso,
    "las dos de dinero ya no comparten key: comprueba que cada trozo se gatea con la SUYA",
  );
});

test("🔴 el recorte de Sabina es el de CADA sede: lo que el Super Admin de Centro le quitó allí", async () => {
  // El Super Admin de Centro apagó la facturación de Sabina para la ficha de
  // Rafael EN CENTRO. El usuario SÍ tiene la key: la frase tiene que ser la de
  // «el Super Admin no deja a Sabina», no «no tienes acceso».
  const db = crearBase(
    datosDeSedes({
      sabinaUserPermissions: [
        { userId: U_RAFA_S, clinicId: CL_SUR, enabled: true, permissions: SIN_FACTURACION },
      ],
    }),
  );

  const r = await comparar(rafaEnNorte(db), { metrica: "dinero" });
  const d = datosDe(r);

  assert.ok(d.sedes[0].ingresos, "Altabrisa no tenía recorte");
  assert.equal(d.sedes[1].ingresos, null, "Centro trajo dinero con el recorte puesto");
  assert.deepEqual(d.sedes[1].omitidas, [
    { seccion: "ingresos y por cobrar", permiso: "billing.view", causa: "sabina" },
  ]);

  const resumen = (r as any).resumen as string;
  assert.ok(resumen.includes("Super Admin"), resumen);
  assert.equal(
    resumen.includes("NO tienes acceso"),
    false,
    `le dice «no tienes acceso» a quien SÍ lo tiene: ${resumen}`,
  );
});

test("un recorte de Sabina en la sede ACTIVA no se contagia a la hermana, ni al revés", async () => {
  // Fila para la ficha de Altabrisa, no para la de Centro.
  const db = crearBase(
    datosDeSedes({
      sabinaUserPermissions: [
        { userId: U_ADMIN_N, clinicId: CL_NORTE, enabled: true, permissions: SIN_FACTURACION },
      ],
    }),
  );
  // El ctx de la sesión ya viene recortado por `crearSabinaCtx` en producción;
  // aquí se reproduce a mano, que es lo que hace el resto de las pruebas.
  const d = datosDe(
    await comparar(rafaEnNorte(db, { permissionsOverride: SIN_FACTURACION }), { metrica: "dinero" }),
  );

  assert.equal(d.sedes[0].ingresos, null, "Altabrisa trajo dinero con el recorte puesto");
  assert.ok(d.sedes[1].ingresos, "el recorte de Altabrisa se contagió a Centro");
});

test("🔴 doctor en una sede y admin en otra: el recorte usa la ficha de ALLÍ, con números", async () => {
  // Rafael es ADMIN en Altabrisa y DOCTOR en Centro. En Centro, `ausencias`
  // tiene que devolver SOLO las citas de la ficha de Centro (U_RAFA_S), no las
  // de toda la clínica ni las de la ficha de Altabrisa.
  const datos: Datos = datosDeSedes();
  datos.users = datos.users!.map((u: Fila) => (u.id === U_RAFA_S ? { ...u, role: "DOCTOR" } : u));
  const r = await comparar(rafaEnNorte(crearBase(datos)), { metrica: "citas" });
  const d = datosDe(r);

  assert.equal(d.sedes[0].alcance, "clinica", "en Altabrisa es ADMIN");
  assert.equal(d.sedes[1].alcance, "propio", "en Centro es DOCTOR: solo lo suyo");

  // 🔴 EL NÚMERO. Son exactamente las citas de U_RAFA_S en Centro. Con la ficha
  // equivocada —la de Altabrisa, o la de Sara— estos dos conteos cambian.
  assert.equal(d.sedes[1].citas!.agendadas, CITAS_DE_RAFA_EN_SUR);
  assert.equal(d.sedes[1].citas!.ausencias, AUSENCIAS_DE_RAFA_EN_SUR);

  // Y con la ficha de ADMIN en Centro se ven MÁS: las de Sara también. Si los
  // dos conteos fueran iguales, lo de arriba no probaría nada.
  const comoAdmin = datosDe(await comparar(rafaEnNorte(baseDeSedes()), { metrica: "citas" }));
  assert.ok(
    comoAdmin.sedes[1].citas!.agendadas > CITAS_DE_RAFA_EN_SUR,
    `el ADMIN de Centro ve ${comoAdmin.sedes[1].citas!.agendadas}, igual que el doctor: el recorte no se nota`,
  );

  const resumen = (r as any).resumen as string;
  assert.ok(resumen.includes("doctor"), `no avisa del alcance distinto: ${resumen}`);
  assert.ok(resumen.includes(NOMBRE_SUR), resumen);
});

test("con el mismo rol en las dos, el alcance es el mismo y no hay aviso de doctor", async () => {
  const db = baseDeSedes();
  const r = await comparar(rafaEnNorte(db), { metrica: "citas" });
  const d = datosDe(r);
  assert.deepEqual(d.sedes.map((s) => s.alcance), ["clinica", "clinica"]);
  assert.equal((r as any).resumen.includes("eres doctor"), false, (r as any).resumen);
});

/* ══════════════════════════════════════════════════════════════════════
 * 8 bis · EL GATE COMERCIAL — una sede suspendida no se mira, y se dice
 * ══════════════════════════════════════════════════════════════════════ */

test("🔴 una sede propia con el PLAN VENCIDO no se mira: hoy tampoco se puede entrar a ella", async () => {
  const db = baseDeSedes({ conSedeVencida: true });
  const r = await comparar(rafaEnNorte(db), { metrica: "todo" });
  const d = datosDe(r);

  // Ni sus números ni su fila.
  assert.deepEqual(nombres(d), [NOMBRE_NORTE, NOMBRE_SUR]);
  const texto = JSON.stringify(r);
  for (const cifra of CIFRAS_VENCIDA) {
    assert.equal(texto.includes(String(cifra)), false, `se coló dinero de la sede vencida: ${cifra}`);
  }
  assert.equal(texto.includes(CL_VENCIDA), false, "se coló el id de la sede vencida");

  // 🔴 Pero SÍ se dice que existe y por qué no entra: callarla haría creer que
  // esa sede no facturó nada, cuando lo que pasa es que está suspendida.
  assert.deepEqual(d.vencidas, [NOMBRE_VENCIDA]);
  const resumen = (r as any).resumen as string;
  assert.ok(resumen.includes(NOMBRE_VENCIDA), resumen);
  assert.ok(resumen.includes("plan vencido"), resumen);

  // Y no se cuenta como sede comparable ni dispara el aviso del tope.
  assert.equal(d.totalSedes, 2, "la vencida no es una sede comparable");
  assert.equal(d.truncado, false);
});

test("una sede al corriente NO se filtra por este gate (el gate es el plan, no el capricho)", async () => {
  // La misma siembra sin la opción: las dos sedes de siempre siguen saliendo.
  const d = datosDe(await comparar(rafaEnNorte(baseDeSedes()), { metrica: "citas" }));
  assert.deepEqual(nombres(d), [NOMBRE_NORTE, NOMBRE_SUR]);
  assert.deepEqual(d.vencidas, []);
});

/* ══════════════════════════════════════════════════════════════════════
 * 8 ter · QUE NO SE LEA MAL — el dinero y el alcance, etiquetados
 * ══════════════════════════════════════════════════════════════════════ */

test("🔴 el saldo por cobrar va aparte de los ingresos y se dice que es ACUMULADO, no del periodo", async () => {
  const db = baseDeSedes();
  const r = await comparar(rafaEnNorte(db), { metrica: "dinero" });
  const d = datosDe(r);

  for (const s of d.sedes) {
    assert.ok(s.ingresos, `${s.nombre} sin ingresos`);
    assert.ok(s.porCobrar, `${s.nombre} sin saldo`);
    // El conteo de pagos NO se llama «cobros» a secas: junto a tres importes se
    // leería como pesos.
    assert.equal(typeof s.ingresos!.numeroDeCobros, "number");
    assert.equal((s.ingresos as any).cobros, undefined, "volvió el campo ambiguo `cobros`");
    assert.equal((s as any).dinero, undefined, "volvió el objeto `dinero` que mezclaba periodo y acumulado");
  }

  const conSaldo = d.sedes.filter((s) => s.porCobrar!.total > 0);
  assert.ok(conSaldo.length > 0, "la siembra no tiene saldo; la prueba no mediría nada");
  const resumen = (r as any).resumen as string;
  assert.ok(resumen.includes("acumulado"), `el saldo se presenta como si fuera del periodo: ${resumen}`);
});

test("🔴 el aviso de «eres doctor» NO dice que el dinero sea tuyo (ese no lleva recorte de rol)", async () => {
  const datos: Datos = datosDeSedes();
  datos.users = datos.users!.map((u: Fila) => (u.id === U_RAFA_S ? { ...u, role: "DOCTOR" } : u));
  const r = await comparar(rafaEnNorte(crearBase(datos)), { metrica: "todo" });
  const resumen = (r as any).resumen as string;

  assert.ok(resumen.includes("CITAS"), `el aviso no acota a qué aplica: ${resumen}`);
  assert.ok(
    resumen.includes("el dinero sí es el de la sede completa"),
    `el aviso deja creer que los ingresos del doctor son solo suyos: ${resumen}`,
  );
});

test("sin nada que el rol de doctor recorte, no se suelta el aviso de doctor", async () => {
  const datos: Datos = datosDeSedes();
  datos.users = datos.users!.map((u: Fila) => (u.id === U_RAFA_S ? { ...u, role: "DOCTOR" } : u));
  // `dinero` no lleva recorte de rol: el aviso sobraría y confundiría.
  const r = await comparar(rafaEnNorte(crearBase(datos)), { metrica: "dinero" });
  assert.equal((r as any).resumen.includes("eres doctor"), false, (r as any).resumen);
});

test("🔴 con Sabina APAGADA en la sede hermana, la frase NOMBRA la sede", async () => {
  const db = crearBase(
    datosDeSedes({
      sabinaUserPermissions: [{ userId: U_RAFA_S, clinicId: CL_SUR, enabled: false, permissions: [] }],
    }),
  );
  const r = await comparar(rafaEnNorte(db), { metrica: "dinero" });
  const d = datosDe(r);

  assert.ok(d.sedes[0].ingresos, "Altabrisa tenía que seguir contestando");
  assert.equal(d.sedes[1].ingresos, null, "Centro contestó con Sabina apagada allí");

  const resumen = (r as any).resumen as string;
  assert.ok(resumen.includes(NOMBRE_SUR), `la frase no dice de qué sede habla: ${resumen}`);
  assert.ok(resumen.includes("apagó a Sabina"), resumen);
});

/* ══════════════════════════════════════════════════════════════════════
 * 9 · EL TOPE — y que se diga
 * ══════════════════════════════════════════════════════════════════════ */

test("con más sedes que el tope, se comparan las primeras y se DICE cuántas quedaron fuera", async () => {
  const datos: Datos = datosDeSedes();
  const extra: Fila[] = [];
  const clinicasExtra: Fila[] = [];
  for (let i = 0; i < TOPE_SEDES + 2; i++) {
    const id = `cl-extra-${i}`;
    clinicasExtra.push({ id, name: `Sede ${i}`, timezone: TZ_NORTE, category: "DENTAL" });
    extra.push({
      id: `u-extra-${i}`, clinicId: id, supabaseId: SB_RAFA, role: "ADMIN",
      firstName: "Rafael", lastName: `Extra${i}`, isActive: true, permissionsOverride: [],
    });
  }
  datos.clinics = [...datos.clinics!, ...clinicasExtra];
  datos.users = [...datos.users!, ...extra];

  const r = await comparar(rafaEnNorte(crearBase(datos)), { metrica: "citas" });
  const d = datosDe(r);

  assert.equal(d.sedes.length, TOPE_SEDES);
  assert.equal(d.totalSedes, TOPE_SEDES + 4, "2 propias + 8 extra");
  assert.equal(d.truncado, true);
  assert.equal(d.sedes[0].nombre, NOMBRE_NORTE, "la activa nunca se queda fuera del tope");
  assert.ok((r as any).resumen.includes(`de tus ${d.totalSedes} sedes`), (r as any).resumen);
});

test("🔴 una ficha que apunta a una clínica que no existe se descarta (no se enseña un id)", async () => {
  const datos: Datos = datosDeSedes();
  // La ficha de Centro sigue ahí; la fila de la clínica, no.
  datos.clinics = datos.clinics!.filter((c: Fila) => c.id !== CL_SUR);
  const r = await comparar(rafaEnNorte(crearBase(datos)), { metrica: "citas" });
  const d = datosDe(r);

  assert.deepEqual(nombres(d), [NOMBRE_NORTE], "se enseñó una sede que no se puede nombrar");
  assert.equal(
    JSON.stringify(r).includes(CL_SUR),
    false,
    "se coló el id de la sede sin nombre; un cuid no es una respuesta",
  );
  // No se calla: la lista no está completa y hay que decirlo.
  assert.equal(d.truncado, true);
  assert.ok((r as any).resumen.includes("de tus 2 sedes"), (r as any).resumen);
});

test("🔴 si falla la consulta de UNA sede, se marca y las demás siguen saliendo", async () => {
  const cruda = baseDeSedes();
  // Un doble que revienta al pedir los DATOS de Centro (no al resolver la
  // sede): es lo que haría un timeout del pooler a mitad de la comparación.
  const DATOS = ["appointment", "invoice", "patient", "payment"];
  const roto: any = { contador: cruda.contador };
  for (const clave of Object.keys(cruda as any)) {
    const valor = (cruda as any)[clave];
    if (clave === "contador" || typeof valor !== "object" || valor === null) {
      roto[clave] = valor;
      continue;
    }
    const delegado: any = {};
    for (const op of Object.keys(valor)) {
      delegado[op] = async (args: any = {}) => {
        const w = JSON.stringify(args?.where ?? null);
        if (DATOS.indexOf(clave) !== -1 && w.includes(CL_SUR)) {
          throw new Error("timeout simulado del pooler");
        }
        return valor[op](args);
      };
    }
    roto[clave] = delegado;
  }

  const ctx = rafaEnNorte(cruda);
  const r = await comparar({ ...ctx, db: roto }, { metrica: "citas" });
  const d = datosDe(r);

  assert.equal(d.sedes.length, 2, "se perdió la sede que sí se podía leer");
  assert.ok(d.sedes[0].citas, "Altabrisa se cayó con la de al lado");
  assert.equal(d.sedes[0].fallo, undefined);

  assert.equal(d.sedes[1].nombre, NOMBRE_SUR);
  assert.equal(d.sedes[1].fallo, true, "la sede que falló no se marcó");
  assert.equal(d.sedes[1].citas, null);

  // 🔴 Y se dice: una sede en blanco sin marca se lee como una sede sin actividad.
  const resumen = (r as any).resumen as string;
  assert.ok(resumen.includes("No pude leer"), resumen);
  assert.ok(resumen.includes(NOMBRE_SUR), resumen);
});

test("🔴 si falla RESOLVER una sede (su recorte de Sabina), se cae de la lista y se dice", async () => {
  const cruda = baseDeSedes();
  const roto: any = { ...(cruda as any) };
  roto.sabinaUserPermission = {
    async findFirst() {
      throw new Error("timeout simulado del pooler");
    },
  };

  const ctx = rafaEnNorte(cruda);
  const r = await comparar({ ...ctx, db: roto }, { metrica: "citas" });
  const d = datosDe(r);

  // La activa sobrevive (su ctx no se recalcula, así que no lee ese recorte).
  assert.deepEqual(nombres(d), [NOMBRE_NORTE]);
  assert.ok(d.sedes[0].citas, "se perdió también la sede activa");
  assert.equal(d.truncado, true, "la lista quedó incompleta y no se dijo");
  assert.ok((r as any).resumen.includes("de tus 2 sedes"), (r as any).resumen);
});

/* ══════════════════════════════════════════════════════════════════════
 * 10 · FALLAR CERRADO — ante la duda, solo la sede activa
 * ══════════════════════════════════════════════════════════════════════ */

test("🔴 si no se puede resolver quién es (sin supabaseId), se cae a la sede activa y a nada más", async () => {
  const datos: Datos = datosDeSedes();
  // Se le quita la identidad a la ficha de la sesión: ya no hay por dónde
  // saber qué otras sedes son suyas.
  datos.users = datos.users!.map((u: Fila) => (u.id === U_ADMIN_N ? { ...u, supabaseId: null } : u));
  const db = crearBase(datos);

  const r = await comparar(rafaEnNorte(db));
  const d = datosDe(r);
  assert.deepEqual(nombres(d), [NOMBRE_NORTE], "sin identidad salió más de una sede");
  nadaAjeno(r, "sin supabaseId");
});

test("🔴 con la sesión a medias no se consulta NADA (clinicId undefined no filtra en Prisma)", async () => {
  const db = baseDeSedes();
  for (const roto of [{ clinicId: "" }, { clinicId: undefined as any }, { userId: "" }]) {
    const r = await comparar(rafaEnNorte(db, roto), {});
    assert.equal(r.ok, false, `${JSON.stringify(roto)} devolvió datos`);
    assert.equal((r as any).motivo, "error");
    assert.ok((r as any).detalle.includes("sesion_invalida"), (r as any).detalle);
  }
  assert.equal(db.contador.llamadas.length, 0, "se consultó la base con la sesión a medias");
});

test("🔴 una sesión incoherente (el userId no es de esa clínica) no resuelve otras sedes", async () => {
  const db = baseDeSedes();
  // El ctx dice «clínica Altabrisa, usuario Sara», y Sara es de Centro. Es la
  // forma que tendría una sesión manipulada o desincronizada. La persona se
  // resuelve cotejando las DOS claves, así que no se resuelve nadie: solo la
  // sede activa, que es lo más estrecho posible.
  const d = datosDe(await comparar(rafaEnNorte(db, { userId: U_ADMIN_S })));
  assert.deepEqual(nombres(d), [NOMBRE_NORTE], "una sesión incoherente abrió otra sede");
  assert.equal(d.totalSedes, 1);
});

test("🔴 `sedesVisibles` llamada a pelo con la sesión rota LANZA, antes de consultar", async () => {
  // La herramienta ya corta antes (el runner y `definirHerramienta` llaman a
  // `exigirSesion`), pero esta función es pública y mañana la llamará otro
  // sitio. Su propia guarda tiene que existir y tiene que morder.
  const db = baseDeSedes();
  const sano = rafaEnNorte(db);
  for (const roto of [{ clinicId: "" }, { clinicId: undefined as any }, { userId: "" }, { timezone: "" }]) {
    await assert.rejects(
      () => sedesVisibles({ ...sano, ...roto }),
      /sesion_invalida/,
      `sedesVisibles consultó con ${JSON.stringify(roto)}`,
    );
  }
  assert.equal(db.contador.llamadas.length, 0, "se consultó la base con la sesión rota");
});

test("🔴 la lista de sedes nunca sale vacía y siempre lleva la activa", async () => {
  for (const armar of [rafaEnNorte, rafaEnSur, lupeEnNorte, ajenoEnSuClinica]) {
    const db = baseDeSedes();
    const ctx = armar(db);
    const v = await sedesVisibles(ctx);
    assert.ok(v.sedes.length >= 1, "lista vacía");
    assert.equal(v.sedes[0].clinicId, ctx.clinicId, "la activa no va primera");
    assert.equal(v.sedes[0].esActiva, true);
    assert.equal(
      v.sedes.filter((s) => s.esActiva).length,
      1,
      "más de una sede marcada como activa",
    );
  }
});
