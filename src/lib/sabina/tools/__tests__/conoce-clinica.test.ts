/**
 * LAS DOS DE «QUE CONOZCA SU CLÍNICA» (ws1-t5): `procedimientos_y_precios` y
 * `equipo_clinica`.
 *
 *   npm run test:sabina-conoce-clinica
 *
 * Las tres obligatorias del contrato, para cada una:
 *  (a) no cruza de clínica — con el doble de dos clínicas sembradas;
 *  (b) sin permiso devuelve `sin_permiso` y NO lee ni una fila;
 *  (c) no escribe — el doble ni siquiera expone `create` (`SabinaDb` es de
 *      solo lectura por tipos), y aquí se comprueba además que la herramienta
 *      NO siembra el catálogo, que es lo que sí hace `GET /api/procedures`.
 *
 * Y lo específico del área, que es donde está el dinero:
 *  · el precio sale de `basePrice` TAL CUAL, sin redondear ni recalcular;
 *  · «resina» coincide con tres filas y las devuelve las TRES, con la orden
 *    de no elegir — la trampa 1 de Rafael;
 *  · un procedimiento sin duración se dice, no se inventa;
 *  · un procedimiento DE BAJA no se cobra ni se menciona;
 *  · el catálogo VACÍO no es «sin datos»: es una respuesta con contenido.
 */

import "./preparar";
import { test } from "node:test";
import assert from "node:assert/strict";

import { procedimientosYPrecios } from "../procedimientos-y-precios";
import { equipoClinica } from "../equipo-clinica";
import { correrHerramienta } from "../base";
import { CL_NORTE, adminNorte, adminSur, base, conPermisos, datosDePrueba, doctorNorte } from "./siembra";
import { crearBase, type BaseDoble } from "./doble-base";
import type { SabinaCtx, SabinaTool } from "../../tipos";

/* Las dos viven en `CONSULTAS` (engine-catalog.ts) y no en `CATALOGO_SABINA`, que
   es la lista que fijan las pruebas de contrato de «las diez». Así que aquí se
   corren por el runner directamente, que es el mismo camino que usa el motor. */
const correrProcedimientos = (ctx: SabinaCtx, params: unknown = {}) =>
  correrHerramienta(procedimientosYPrecios, ctx, params);
const correrEquipo = (ctx: SabinaCtx, params: unknown = {}) => correrHerramienta(equipoClinica, ctx, params);

/** Las dos, para los recorridos que valen igual en cualquiera de ellas. */
const LAS_DOS: ReadonlyArray<SabinaTool<any, any>> = [procedimientosYPrecios, equipoClinica];

/* ══════════════════════════════════════════════════════════════════════
 * procedimientos_y_precios — el dinero
 * ══════════════════════════════════════════════════════════════════════ */

test("el precio y la duración salen de la base TAL CUAL, y la duración se ofrece para agendar", async () => {
  const r = await correrProcedimientos(adminNorte(base()), { busqueda: "limpieza" });
  assert.equal(r.ok, true);
  if (!r.ok) return;

  assert.equal(r.datos.procedimientos.total, 1);
  const p = r.datos.procedimientos.filas[0];
  assert.equal(p.nombre, "Profilaxis (limpieza)");
  assert.equal(p.precio, 800); // `basePrice`, sin tocar
  assert.equal(p.duracionMinutos, 40);
  assert.match(r.resumen, /\$800/);
  // Lo que ata esto con agendar: la duración, dicha para que la pase.
  assert.match(r.resumen, /duracionMinutos: 40/);
});

test("🔴 tres «resina» = tres precios: los devuelve los tres y ORDENA no elegir", async () => {
  const r = await correrProcedimientos(adminNorte(base()), { busqueda: "resina" });
  assert.equal(r.ok, true);
  if (!r.ok) return;

  assert.equal(r.datos.procedimientos.total, 3);
  assert.deepEqual(
    r.datos.procedimientos.filas.map((f) => f.precio).sort((a, b) => a - b),
    [700, 950, 1200],
  );
  assert.match(r.resumen, /no elijas t/i);
  // Los tres, con su precio, en el resumen que lee el modelo.
  for (const monto of ["$700", "$950", "$1,200"]) assert.ok(r.resumen.includes(monto), `falta ${monto}`);
});

test("buscar sin acentos encuentra lo acentuado («extraccion» → «Extracción simple»)", async () => {
  const r = await correrProcedimientos(adminNorte(base()), { busqueda: "extraccion" });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.datos.procedimientos.filas[0]?.nombre, "Extracción simple");
  assert.equal(r.datos.procedimientos.filas[0]?.precio, 850);
});

test("sin duración configurada se DICE, no se inventa un número", async () => {
  const r = await correrProcedimientos(adminNorte(base()), { busqueda: "blanqueamiento" });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.datos.procedimientos.filas[0].duracionMinutos, null);
  assert.match(r.resumen, /no le configur|sin duraci/i);
  assert.doesNotMatch(r.resumen, /duracionMinutos: \d/);
});

test("un procedimiento DE BAJA no sale: no se cobra lo que la clínica desactivó", async () => {
  const r = await correrProcedimientos(adminNorte(base()), { busqueda: "corona" });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.motivo, "sin_datos"); // hay catálogo, pero nada coincide
});

test("el catálogo entero: solo los activos de ESTA clínica, y con el aviso de precio de lista", async () => {
  const r = await correrProcedimientos(adminNorte(base()), {});
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.datos.procedimientos.total, 7); // 8 sembrados − 1 de baja
  assert.equal(r.datos.enElCatalogo, 7);

  const aviso = procedimientosYPrecios.avisoObligatorio?.(r.datos);
  assert.ok(aviso, "un precio sin el aviso de «precio de lista» no puede salir");
  assert.match(aviso!.frase, /precio de lista/);
});

test("filtrar por categoría usa la de la clínica", async () => {
  const r = await correrProcedimientos(adminNorte(base()), { categoria: "aesthetic" });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.datos.procedimientos.total, 1);
  assert.equal(r.datos.procedimientos.filas[0].nombre, "Blanqueamiento");
});

test("🔴 catálogo VACÍO no es «sin datos»: lo dice, y NO lo siembra", async () => {
  // La clínica del norte sin catálogo. `GET /api/procedures` sembraría 26
  // procedimientos aquí; Sabina no puede escribir ni una fila.
  const datos = datosDePrueba();
  const db = crearBase({ ...datos, procedureCatalogs: [] });
  const r = await correrProcedimientos(adminNorte(db), { busqueda: "limpieza" });

  assert.equal(r.ok, true, "el catálogo vacío se contesta, no se calla");
  if (!r.ok) return;
  assert.equal(r.datos.enElCatalogo, 0);
  assert.match(r.resumen, /vac/i);
  assert.match(r.resumen, /No inventes/i);
  // Nada de escribir: ni una llamada que no sea de lectura.
  const ops = db.contador.llamadas.filter((l) => l.modelo === "procedureCatalog").map((l) => l.op);
  assert.ok(ops.length > 0, "no leyó el catálogo");
  assert.deepEqual(
    ops.filter((o) => o !== "findMany" && o !== "count"),
    [],
    "la herramienta hizo algo que no es leer",
  );
});

test("🔴 con el catálogo recortado se DICE, también cuando solo queda una coincidencia", async () => {
  // 620 procedimientos: el tope de lectura (500) deja fuera las últimas
  // categorías. La peor salida posible sería dar UN precio con tono de
  // respuesta cerrada habiendo más fuera del corte.
  const datos = datosDePrueba();
  const relleno = Array.from({ length: 620 }, (_, i) => ({
    id: `pc-n-relleno-${i}`,
    clinicId: CL_NORTE,
    name: `Relleno ${String(i).padStart(4, "0")}`,
    category: "aaa-primero",
    basePrice: 100 + i,
    duration: 15,
    description: null,
    isActive: true,
  }));
  const db = crearBase({ ...datos, procedureCatalogs: [...relleno, ...datos.procedureCatalogs!] });

  const uno = await correrProcedimientos(adminNorte(db), { busqueda: "Relleno 0001" });
  assert.equal(uno.ok, true);
  if (!uno.ok) return;
  assert.equal(uno.datos.lecturaRecortada, true);
  assert.equal(uno.datos.enElCatalogo, 627);
  assert.match(uno.resumen, /puede haber m/i, "dio un precio como si fuera el único");

  const todo = await correrProcedimientos(adminNorte(db), {});
  assert.equal(todo.ok, true);
  if (!todo.ok) return;
  assert.match(todo.resumen, /627/);
});

/* ══════════════════════════════════════════════════════════════════════
 * equipo_clinica
 * ══════════════════════════════════════════════════════════════════════ */

test("«¿quién hace ortodoncia?» encuentra a quien la lleva en specialty", async () => {
  const r = await correrEquipo(adminNorte(base()), { busqueda: "ortodoncia" });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  // Omar tiene la misma especialidad pero está DE BAJA: no cuenta.
  assert.equal(r.datos.equipo.total, 1);
  assert.equal(r.datos.equipo.filas[0].nombre, "Hugo Salas");
  assert.equal(r.datos.equipo.filas[0].rol, "Doctor");
});

test("la especialidad de NOM-024 también se encuentra, y «fuera de la agenda» se dice", async () => {
  const r = await correrEquipo(adminNorte(base()), { busqueda: "endodoncia" });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.datos.equipo.filas[0].nombre, "Nadia Rojas");
  assert.equal(r.datos.equipo.filas[0].especialidad, "Endodoncia");
  assert.equal(r.datos.equipo.filas[0].enAgenda, false);
  assert.match(r.resumen, /fuera de la agenda/);
});

test("buscar por servicio («brackets») encuentra a quien lo hace", async () => {
  const r = await correrEquipo(adminNorte(base()), { busqueda: "brackets" });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.datos.equipo.total, 1);
  assert.equal(r.datos.equipo.filas[0].nombre, "Hugo Salas");
});

test("con team.view (ADMIN): el equipo entero activo, y cuántos pueden llevar citas", async () => {
  const r = await correrEquipo(adminNorte(base()), {});
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.datos.alcance, "equipo");
  assert.equal(r.datos.enElAlcance, 4); // 5 del norte − Omar, de baja
  assert.equal(r.datos.doctores, 2);
  assert.match(r.resumen, /rol de Doctor/);
});

test("🔴 SIN team.view el alcance se recorta a los doctores, y se DICE", async () => {
  // Lupe, recepción con los permisos por default: en el panel recibe un 403 de
  // GET /api/team y el selector de «Nueva cita» solo le enseña doctores. El
  // organigrama —quién es el Dueño, quién Recepción— no es suyo.
  const r = await correrEquipo(conPermisos(base(), ["agenda.view"]), {});
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.datos.alcance, "doctores");
  assert.equal(r.datos.enElAlcance, 2);
  const nombres = r.datos.equipo.filas.map((f) => f.nombre);
  assert.deepEqual(nombres.sort(), ["Hugo Salas", "Nadia Rojas"]);
  for (const fuera of ["Rita Admin", "Lupe Mesa"]) {
    assert.ok(!JSON.stringify(r.datos).includes(fuera), `se coló ${fuera}`);
  }
  // Regla 3: el recorte no se omite en silencio.
  assert.match(r.resumen, /solo a los doctores/i);
  assert.match(r.resumen, /no tienes permiso/i);
});

test("soloDoctores recorta también para quien sí tiene team.view", async () => {
  const r = await correrEquipo(adminNorte(base()), { soloDoctores: true });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.datos.equipo.total, 2);
  assert.ok(r.datos.equipo.filas.every((f) => f.esDoctor));
  assert.doesNotMatch(r.resumen, /solo a los doctores/i); // lo pidió él, no es un recorte
});

test("una clínica de UN doctor no se queda sin nombre en el resumen", async () => {
  const datos = datosDePrueba();
  const db = crearBase({ ...datos, users: datos.users!.filter((u) => u.id !== "u-doc2-n") });
  const r = await correrEquipo(conPermisos(db, ["agenda.view"]), {});
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.datos.equipo.total, 1);
  assert.match(r.resumen, /Hugo Salas/, "el resumen se quedó en «1 doctor activo:»");
  assert.doesNotMatch(r.resumen, /activos?:$/);
});

test("🔴 sin ningún usuario con rol Doctor NO es «sin datos»: se dice por qué", async () => {
  const datos = datosDePrueba();
  const db = crearBase({ ...datos, users: datos.users!.filter((u) => u.role !== "DOCTOR") });
  const r = await correrEquipo(conPermisos(db, ["agenda.view"]), { soloDoctores: true });
  assert.equal(r.ok, true, "«no hay doctores» es una respuesta, no un hueco");
  if (!r.ok) return;
  assert.equal(r.datos.enElAlcance, 0);
  assert.match(r.resumen, /solo agenda citas con doctores/);
});

test("🔴 no salen correo, teléfono, cédula ni permisos: solo lo que contesta la pregunta", async () => {
  const r = await correrEquipo(adminNorte(base()), {});
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const claves = Object.keys(r.datos.equipo.filas[0]).sort();
  assert.deepEqual(claves, ["enAgenda", "esDoctor", "especialidad", "nombre", "rol", "servicios"]);
  const texto = JSON.stringify(r.datos);
  for (const prohibido of ["email", "phone", "cedula", "permissionsOverride", "@"]) {
    assert.ok(!texto.includes(prohibido), `se coló ${prohibido}`);
  }
});

/* ══════════════════════════════════════════════════════════════════════
 * (a) AISLAMIENTO — la clínica del norte nunca ve a la del sur
 * ══════════════════════════════════════════════════════════════════════ */

test("🔴 el norte no ve el catálogo del sur, ni el sur el del norte", async () => {
  const norte = await correrProcedimientos(adminNorte(base()), {});
  assert.equal(norte.ok, true);
  if (!norte.ok) return;
  assert.ok(!JSON.stringify(norte.datos).includes("SUR"), "se coló el catálogo del sur");
  assert.ok(!norte.datos.procedimientos.filas.some((f) => f.precio === 99999));

  const sur = await correrProcedimientos(adminSur(base()), {});
  assert.equal(sur.ok, true);
  if (!sur.ok) return;
  assert.equal(sur.datos.procedimientos.total, 1);
  assert.equal(sur.datos.procedimientos.filas[0].nombre, "Limpieza SUR");
  assert.ok(!JSON.stringify(sur.datos).includes("Profilaxis"));
});

test("🔴 el norte no ve al equipo del sur, ni el sur al del norte", async () => {
  const norte = await correrEquipo(adminNorte(base()), { busqueda: "ortodoncia" });
  assert.equal(norte.ok, true);
  if (!norte.ok) return;
  assert.ok(!JSON.stringify(norte.datos).includes("Sur"), "se coló Sara Sur");

  const sur = await correrEquipo(adminSur(base()), {});
  assert.equal(sur.ok, true);
  if (!sur.ok) return;
  assert.equal(sur.datos.enElAlcance, 1);
  assert.equal(sur.datos.equipo.filas[0].nombre, "Sara Sur");
  assert.ok(!JSON.stringify(sur.datos).includes("Hugo"));
});

test("🔴 un ctx sin clinicId NO consulta (con `undefined` Prisma devolvería las dos clínicas)", async () => {
  const db = base();
  for (const tool of LAS_DOS) {
    const r = await correrHerramienta(tool, { ...adminNorte(db), clinicId: "" } as SabinaCtx, {});
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.motivo, "error");
    assert.match(r.detalle, /clinicId/);
  }
  assert.deepEqual(db.contador.llamadas, [], "consultó sin sesión");
});

/* ══════════════════════════════════════════════════════════════════════
 * (b) SIN PERMISO — se DICE, y sin tocar la base
 * ══════════════════════════════════════════════════════════════════════ */

test("🔴 sin billing.view: `sin_permiso` con la key, y CERO consultas", async () => {
  const db = base();
  const r = await correrProcedimientos(conPermisos(db, ["agenda.view", "patients.view"]), { busqueda: "limpieza" });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.motivo, "sin_permiso");
  assert.equal(r.permiso, "billing.view");
  assert.deepEqual(db.contador.llamadas, [], "leyó la base sin permiso");
});

test("🔴 sin agenda.view: `sin_permiso` con la key, y CERO consultas", async () => {
  const db = base();
  const r = await correrEquipo(conPermisos(db, ["billing.view"]), { busqueda: "ortodoncia" });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.motivo, "sin_permiso");
  assert.equal(r.permiso, "agenda.view");
  assert.deepEqual(db.contador.llamadas, [], "leyó la base sin permiso");
});

test("el DOCTOR —el que pregunta «¿cuánto le cobro por una resina?»— SÍ puede, con su rol por default", async () => {
  const r = await correrProcedimientos(doctorNorte(base()), { busqueda: "resina" });
  assert.equal(r.ok, true, "con `procedures.view` esta herramienta nacería muerta para el doctor");
  const e = await correrEquipo(doctorNorte(base()), { busqueda: "ortodoncia" });
  assert.equal(e.ok, true);
});

/* ══════════════════════════════════════════════════════════════════════
 * El contrato de la herramienta
 * ══════════════════════════════════════════════════════════════════════ */

test("ninguna de las dos acepta `clinicId` del modelo", () => {
  for (const tool of LAS_DOS) {
    const claves = Object.keys((tool.parametros as any).shape ?? {});
    assert.ok(!claves.includes("clinicId"), `${tool.nombre} acepta clinicId`);
  }
});

test("un parámetro absurdo es un error explicado, no una consulta a ciegas", async () => {
  const db = base();
  const r = await correrProcedimientos(adminNorte(db), { busqueda: "x" }); // min 2
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.motivo, "error");
  assert.match(r.detalle, /parametros_invalidos/);
  assert.deepEqual(db.contador.llamadas, []);
});

test("menos de 7 consultas por herramienta: el pooler no se satura", async () => {
  const db: BaseDoble = base();
  await correrProcedimientos(adminNorte(db), {});
  assert.ok(db.contador.llamadas.length < 7, `${db.contador.llamadas.length} consultas`);
  const db2: BaseDoble = base();
  await correrEquipo(adminNorte(db2), {});
  assert.ok(db2.contador.llamadas.length < 7, `${db2.contador.llamadas.length} consultas`);
});
