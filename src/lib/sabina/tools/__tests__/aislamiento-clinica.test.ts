/**
 * 🔴 LA PRUEBA QUE MÁS IMPORTA — ninguna herramienta de Sabina devuelve datos de
 * otra clínica.
 *
 * Run: npm run test:sabina-aislamiento
 *
 * Dos clínicas sembradas (`./siembra`) y las DIEZ herramientas corridas contra
 * las dos, en los dos sentidos. La comprobación no es «el total cuadra»: es que
 * en el JSON completo de la respuesta no aparezca NI UNA de las marcas de la
 * clínica de al lado. Los datos de la vecina están puestos para chillar —
 * apellido "SUR", un tratamiento llamado "TRATAMIENTO DEL SUR", un saldo de
 * $99,999— así que una fuga no se puede confundir con un dato propio.
 *
 * Y para que la prueba no sea un adorno, la última parte demuestra que el
 * instrumento DETECTA la fuga: consultando el doble sin `clinicId` —el fallo
 * exacto de la regla (c) de CLAUDE.md, donde Prisma descarta la clave y devuelve
 * todas las clínicas— salen las filas de las dos.
 */

import "./preparar";
import { test } from "node:test";
import assert from "node:assert/strict";

import { CATALOGO_SABINA, ejecutarHerramienta } from "../index";
import { sumarDias } from "../fechas";
import {
  HOY_N,
  HOY_S,
  CL_NORTE,
  CL_SUR,
  adminNorte,
  adminSur,
  base,
} from "./siembra";

/** Parámetros válidos por herramienta, para poder recorrer el catálogo entero. */
function paramsDe(nombre: string, hoy: string): Record<string, unknown> {
  const desde = sumarDias(hoy, -30);
  switch (nombre) {
    case "citas_del_dia":
      return { fecha: hoy };
    case "agenda_ocupacion":
    case "ausencias":
      return { desde, hasta: hoy };
    case "pacientes_nuevos":
    case "ingresos_por_periodo":
    case "tratamientos_por_ingreso":
      return { desde: sumarDias(hoy, -10), hasta: hoy };
    case "buscar_paciente":
      // Una letra que aparece en pacientes de las DOS clínicas: si hubiera fuga,
      // el buscador es la puerta más ancha por la que se vería.
      return { termino: "o" };
    default:
      return {};
  }
}

/** Marcas que SOLO existen en la clínica del sur. */
const MARCAS_SUR = ["SUR", "99999", "S0001", "S0002", "S0003", "9981110001", "50000"];

/** Marcas que SOLO existen en la clínica del norte. */
const MARCAS_NORTE = [
  "Perez",
  "Munoz",
  "P0001",
  "P0002",
  "Endodoncia",
  "Resina",
  "Blanqueamiento",
  "Masivo",
  "5598765432",
  "Restringida",
];

function sinMarcas(json: string, marcas: string[], herramienta: string, de: string): void {
  for (const m of marcas) {
    assert.equal(
      json.indexOf(m) === -1,
      true,
      `FUGA DE TENANT: ${herramienta} devolvió "${m}", que es de ${de}`,
    );
  }
}

test("las diez herramientas existen y ninguna acepta clinicId por parámetro", () => {
  assert.equal(CATALOGO_SABINA.length, 10, "el catálogo del contrato son diez herramientas");

  for (const tool of CATALOGO_SABINA) {
    // 🔴 Si una herramienta aceptara `clinicId`, el modelo podría mandarle el de
    // otra clínica. El esquema tiene que RECHAZARLO o ignorarlo: en ningún caso
    // puede llegar a la consulta. zod con `.object()` estricto lo estrapea.
    const parseado = tool.parametros.safeParse({ clinicId: "cl-de-otra-persona" });
    if (parseado.success) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(parseado.data as object, "clinicId"),
        false,
        `${tool.nombre} deja pasar un clinicId por parámetro`,
      );
    }
    assert.equal(typeof tool.descripcion, "string");
    assert.equal(tool.descripcion.length > 60, true, `${tool.nombre}: la descripción es lo que el modelo lee para elegir; que diga algo`);
    assert.equal(typeof tool.permiso, "string");
  }
});

test("🔴 NORTE nunca ve nada del SUR — las diez herramientas", async () => {
  const db = base();
  const ctx = adminNorte(db);

  for (const tool of CATALOGO_SABINA) {
    const r = await ejecutarHerramienta(tool.nombre, ctx, paramsDe(tool.nombre, HOY_N));
    assert.equal(
      r.ok,
      true,
      `${tool.nombre} no devolvió datos de su propia clínica (${JSON.stringify(r)}) — sin eso la prueba de fuga no vale`,
    );
    sinMarcas(JSON.stringify(r), MARCAS_SUR, tool.nombre, "la clínica del sur");
  }
});

test("🔴 SUR nunca ve nada del NORTE — las diez herramientas", async () => {
  const db = base();
  const ctx = adminSur(db);

  for (const tool of CATALOGO_SABINA) {
    const r = await ejecutarHerramienta(tool.nombre, ctx, paramsDe(tool.nombre, HOY_S));
    assert.equal(r.ok, true, `${tool.nombre} no devolvió datos de la clínica del sur (${JSON.stringify(r)})`);
    sinMarcas(JSON.stringify(r), MARCAS_NORTE, tool.nombre, "la clínica del norte");
  }
});

test("🔴 sin clinicId en la sesión NO se consulta: se corta antes", async () => {
  const db = base();
  const roto = { ...adminNorte(db), clinicId: "" };

  for (const tool of CATALOGO_SABINA) {
    const r = await ejecutarHerramienta(tool.nombre, roto, paramsDe(tool.nombre, HOY_N));
    assert.equal(r.ok, false, `${tool.nombre} consultó con la sesión a medias`);
    assert.equal((r as any).motivo, "error");
    assert.match((r as any).detalle, /sesion_invalida/);
  }
  // Y no llegó ni una consulta a la base: el corte es ANTES, no después.
  assert.equal(db.contador.llamadas.length, 0, "se consultó la base sin clinicId de sesión");
});

test("🔴 sin userId tampoco: la visibilidad por paciente depende de quién pregunta", async () => {
  const db = base();
  const roto = { ...adminNorte(db), userId: "" };
  const r = await ejecutarHerramienta("citas_del_dia", roto, { fecha: HOY_N });
  assert.equal(r.ok, false);
  assert.match((r as any).detalle, /sesion_invalida/);
});

test("el instrumento SÍ detecta la fuga: sin clinicId, el doble devuelve las dos clínicas", async () => {
  const db = base();

  // Con el filtro puesto: solo las del norte.
  const propias = await db.appointment.findMany({
    where: { clinicId: CL_NORTE },
    select: { id: true, clinicId: true },
  });
  const clinicasPropias = {};
  for (const a of propias) clinicasPropias[a.clinicId] = true;
  assert.deepEqual(Object.keys(clinicasPropias), [CL_NORTE]);

  // 🔴 Y así es como se ve el fallo de la regla (c): `clinicId: undefined` NO
  // filtra — Prisma descarta la clave. Si una herramienta lo hiciera, esta
  // prueba de fuga la pillaría, porque el doble se comporta igual.
  const fugadas = await db.appointment.findMany({
    where: { clinicId: undefined },
    select: { id: true, clinicId: true },
  });
  const clinicasFugadas = {};
  for (const a of fugadas) clinicasFugadas[a.clinicId] = true;
  assert.deepEqual(
    Object.keys(clinicasFugadas).sort(),
    [CL_NORTE, CL_SUR].sort(),
    "el doble tiene que reproducir el fallo de `clinicId: undefined`, o la prueba de fuga no demuestra nada",
  );
});
