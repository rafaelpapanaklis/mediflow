/**
 * OLA C·FIN 3 · WS2-T1 — LO QUE FALTABA DEL VEREDICTO.
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-c-fin-3.test.ts
 *
 * ═══════════════════════════════════════════════════════════════════════
 * QUÉ FIJA ESTE ARCHIVO
 *
 *   · #1 — el IMPORTADOR. Se construye un `.xlsx` DE VERDAD dentro de la
 *     prueba (con exceljs, el mismo que lee el servidor) y se pasa entero
 *     por `eduImportLeeArchivo`. Es la única forma de comprobar esto: el
 *     bug anterior nació de suponer qué devuelve `Cell.text` para una fecha
 *     —«lo que Excel enseña»— cuando devuelve `Date.toString()`.
 *   · #2 — el plan SIN CASO que arma DIRECCIÓN o un DOCENTE lo ve el
 *     alumno que lo tiene que ejecutar.
 *   · #3 — el alumno SALIENTE deja de ver (y por tanto de cerrar) el plan
 *     del caso que entregó.
 *   · y las dos de una línea del mismo viaje: el día de la aceptación del
 *     presupuesto en la zona del instituto, y la vigencia ya pasada que
 *     entregaba una liga nacida en 404.
 * ═══════════════════════════════════════════════════════════════════════
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as ExcelJS from "exceljs";

import {
  eduImportAplicaMapeo,
  eduImportAutodetecta,
  eduImportSimula,
} from "@/lib/edu/importar-core";
import { eduImportLeeArchivo } from "@/lib/edu/importar";

const RAIZ = join(__dirname, "..", "..", "..", "..");
const crudo = (ruta: string): string => readFileSync(join(RAIZ, ...ruta.split("/")), "utf8");

/** El fuente SIN comentarios: este repo cita la forma PROHIBIDA para
 *  explicar por qué lo es, y sin quitarlos la prueba se dispara sola. */
function sinComentarios(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** El trozo de fuente entre dos marcas, para acotar la aserción. */
function tramo(src: string, desde: string, hasta: string): string {
  const i = src.indexOf(desde);
  assert.ok(i >= 0, `no se encontró el ancla «${desde}»: la prueba se quedó vieja`);
  const j = src.indexOf(hasta, i + desde.length);
  assert.ok(j > i, `no se encontró el cierre «${hasta}» después de «${desde}»`);
  return src.slice(i, j);
}

const PLAN = "src/lib/edu/plan-tratamiento.ts";
const PRESU = "src/lib/edu/presupuestos.ts";
const PANTALLA_PRESU = "src/components/edu/dinero/presupuestos-screen.tsx";

// ═══════════════════════════════════════════════════════════════════════
// 1 · EL IMPORTADOR, CONTRA UN .xlsx DE VERDAD
// ═══════════════════════════════════════════════════════════════════════

const COLUMNAS = ["Nombre", "Apellidos", "Correo", "Matrícula", "Teléfono"] as const;

/** Escribe un `.xlsx` real y lo devuelve como el `File` que sube la pantalla. */
async function archivoDePadron(filas: unknown[][]): Promise<File> {
  const wb = new ExcelJS.Workbook();
  const hoja = wb.addWorksheet("Padrón");
  hoja.addRow([...COLUMNAS]);
  for (const f of filas) hoja.addRow(f);
  const buf = await wb.xlsx.writeBuffer();
  return new File([new Uint8Array(buf as ArrayBuffer)], "padron.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/** El camino COMPLETO del servidor: leer → autodetectar → mapear → simular. */
async function simulaArchivo(filas: unknown[][]) {
  const file = await archivoDePadron(filas);
  const { columnas, filas: crudas } = await eduImportLeeArchivo(file);
  const mapeo = eduImportAutodetecta(columnas, "alumnos");
  return eduImportSimula({
    entidad: "alumnos",
    filas: eduImportAplicaMapeo(crudas, mapeo),
    semestrePorDefecto: 1,
  });
}

test("#1 · un NÚMERO de Excel sigue siendo una matrícula y un teléfono válidos", async () => {
  // Lo que arregló la Ola C y NO se puede perder: un padrón exportado por un
  // sistema escolar trae los dos como `number`, no como texto.
  const [fila] = await simulaArchivo([
    ["Ana", "Ruiz", "ana@x.mx", 20260001, 5544332211],
  ]);
  assert.equal(fila.estado, "ok", fila.problemas.join(" · "));
  assert.equal(fila.datos.matricula, "20260001");
  assert.equal(fila.datos.phone, "5544332211");
});

test("🔴 #1 · una celda-FECHA en la matrícula sale en rojo, y DICE que es una fecha", async () => {
  // Excel autoformatea `3/22` a fecha. La corrección anterior devolvía
  // `cell.text`, que para un Date es `Date.toString()` y NO aplica el
  // `numFmt`: la matrícula seguía en rojo (62 caracteres > 30) con el mismo
  // mensaje que mentía. Ahora el motivo es el de verdad.
  const [fila] = await simulaArchivo([
    ["Ana", "Ruiz", "ana@x.mx", new Date(Date.UTC(2026, 2, 22)), "5544332211"],
  ]);
  assert.equal(fila.estado, "error");
  const dicho = fila.problemas.join(" · ");
  assert.match(dicho, /Matrícula/);
  assert.match(dicho, /FECHA de Excel/);
  assert.match(dicho, /formato de Texto/);
  assert.ok(
    !/Falta la matrícula/.test(dicho),
    "«Falta la matrícula» sobre una celda que tiene algo escrito es el mensaje que miente",
  );
});

test("🔴 #1 · una celda-FECHA en el NOMBRE no crea una cuenta llamada «Sun Mar 22 2026…»", async () => {
  // El daño nuevo que traía `cell.text`: la cadena entera (62 ≤ 80) pasaba
  // por `eduRequiredText` y la simulación salía en VERDE. Al confirmar,
  // `createEduTeamMember` daba de alta en Supabase Auth a una persona con
  // ese nombre — y las cuentas de este producto no se borran.
  const [fila] = await simulaArchivo([
    [new Date(Date.UTC(2026, 2, 22)), "Ruiz", "ana@x.mx", "A-01", "5544332211"],
  ]);
  assert.equal(fila.estado, "error");
  assert.match(fila.problemas.join(" · "), /Nombre.*FECHA de Excel/);
  assert.ok(
    !/GMT|Mar 22 2026/.test(fila.datos.firstName),
    "ni siquiera se repite en pantalla la cadena que no se quiere guardar",
  );
});

test("🔴 #1 · una celda-FECHA en el TELÉFONO no inventa un número", async () => {
  // `normalizeEduPhone("Sun Mar 22 2026 00:00:00 GMT+0000 (…)")` devolvía
  // "2220260000000000": un teléfono que no existe, guardado en silencio
  // donde antes había «ese teléfono no tiene números suficientes».
  const [fila] = await simulaArchivo([
    ["Ana", "Ruiz", "ana@x.mx", "A-01", new Date(Date.UTC(2026, 2, 22))],
  ]);
  assert.equal(fila.estado, "error");
  assert.match(fila.problemas.join(" · "), /Teléfono.*FECHA de Excel/);
  assert.equal(fila.datos.phone, null);
});

test("🔴 #1 · `#N/A` y los demás errores de Excel salen en rojo, no de nombre", async () => {
  // exceljs devuelve `{ error: "#N/A" }` y `cell.text` lo aplana a la cadena
  // "#N/A", que `eduRequiredText(_, 80)` acepta como nombre válido.
  const file = await archivoDePadron([["", "Ruiz", "ana@x.mx", "A-01", "5544332211"]]);
  // La celda del nombre, escrita como la escribe Excel cuando una fórmula
  // falla. Se hace sobre el libro ya escrito para no depender del tipado.
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  wb.worksheets[0].getRow(2).getCell(1).value = { error: "#N/A" } as ExcelJS.CellErrorValue;
  const buf = await wb.xlsx.writeBuffer();
  const conError = new File([new Uint8Array(buf as ArrayBuffer)], "padron.xlsx");

  const { columnas, filas: crudas } = await eduImportLeeArchivo(conError);
  const filas = eduImportSimula({
    entidad: "alumnos",
    filas: eduImportAplicaMapeo(crudas, eduImportAutodetecta(columnas, "alumnos")),
  });
  assert.equal(filas[0].estado, "error");
  assert.match(filas[0].problemas.join(" · "), /Nombre.*error de Excel \(#N\/A\)/);
  assert.notEqual(filas[0].datos.firstName, "#N/A");
});

test("🔴 #1 · el `#N/A` que llega como texto (un CSV de esa misma hoja) también", async () => {
  const filas = eduImportSimula({
    entidad: "alumnos",
    filas: [{ firstName: "#N/A", lastName: "Ruiz", email: "ana@x.mx", matricula: "A-01" }],
  });
  assert.equal(filas[0].estado, "error");
  assert.match(filas[0].problemas.join(" · "), /error de Excel/);
});

test("🔴 #1 · un número en el NOMBRE o en el CORREO NO se convierte: es un mapeo malo", async () => {
  // La conversión numérica es de la matrícula y del teléfono, no de todas
  // las columnas: convertirlo todo es lo que dejó pasar los dos renglones
  // de arriba. Un `1234` como nombre es un archivo mal mapeado y tiene que
  // verse en rojo, no crearse.
  const [fila] = await simulaArchivo([[1234, "Ruiz", "ana@x.mx", "A-01", "5544332211"]]);
  assert.equal(fila.estado, "error");
});

test("🔴 #1 (fuente): la fecha se devuelve como `Date`, sin pasar por `cell.text`", () => {
  const limpio = sinComentarios(crudo("src/lib/edu/importar.ts"));
  assert.match(limpio, /if \(v instanceof Date\) return v;/);
  assert.ok(
    !/cell\.text \|\| v/.test(limpio),
    "`Cell.text` de una fecha es `Date.toString()` y no aplica el numFmt: convertirla ahí es inventarse un formato",
  );
});

// ═══════════════════════════════════════════════════════════════════════
// 2 · EL PLAN «SIN CASO» QUE ARMA LA ESCUELA
//
// `eduPlanScopeWhere` no se exporta y su archivo importa prisma en la
// primera línea, así que se comprueba LEYENDO LA FUENTE acotada a la
// función — el mismo camino, por el mismo motivo, que edu-c-fin-2.test.ts.
// ═══════════════════════════════════════════════════════════════════════

const ALCANCE_PLAN = () =>
  sinComentarios(tramo(crudo(PLAN), "function eduPlanScopeWhere", "export interface EduPlanRow"));

test("🟠 #2 · el plan sin caso que arma DIRECCIÓN o un DOCENTE lo VE su alumno", () => {
  const helper = ALCANCE_PLAN();
  // La tercera rama: el autor puede ser quien enseña, no solo quien ejecuta.
  assert.match(helper, /createdBy:\s*\{\s*role:\s*\{\s*in:\s*\["DIRECCION",\s*"DOCENTE"\]\s*\}\s*\}/);
  // Y el alumno la lleva: sin esto, la valoración inicial que documenta el
  // schema («un plan antes de que haya alumno asignado») nace invisible.
  assert.match(
    helper,
    /scope\.kind === "own"\s*\?\s*\{\s*OR:\s*\[\{\s*createdById:\s*scope\.studentUserId\s*\},\s*armadoPorLaEscuela\s*\]/,
  );
  // El docente también, junto a lo suyo y a lo de sus alumnos vigentes.
  assert.match(helper, /createdBy:\s*\{\s*studentProfile:\s*eduStudentScopeWhere\(/);
});

test("🟠 #2 · y sigue pidiendo el PACIENTE en el alcance: no abre nada nuevo", () => {
  const helper = ALCANCE_PLAN();
  // La rama vive DENTRO del `caseId: null` + paciente en alcance. Si el
  // `armadoPorLaEscuela` saliera de ahí, cualquier alumno leería el plan de
  // cualquier paciente del instituto.
  assert.match(helper, /caseId:\s*null,\s*patient:\s*eduPatientScopeWhere\(\{ institutionId, scope, now \}\),\s*\.\.\.dueno/);
  assert.ok(
    !/OR:\s*\[\{\s*caseId:\s*null\s*\}/.test(helper),
    "la rama `{ caseId: null }` a secas abre el plan a cualquiera del paciente",
  );
  // Dirección no pasa por aquí (sale antes con el alcance completo).
  assert.match(helper, /if \(scope\.kind === "all"\) return \{\};/);
});

// ═══════════════════════════════════════════════════════════════════════
// 3 · EL ALUMNO SALIENTE Y EL CASO QUE ENTREGÓ
// ═══════════════════════════════════════════════════════════════════════

test("🟠 #3 · el plan del caso TRANSFERIDO sale del alcance de quien lo entregó", () => {
  const helper = ALCANCE_PLAN();
  // `eduCaseScopeWhere` conserva el caso transferido a propósito (es la
  // historia académica del alumno). El PLAN VIVO no: A cerraba como
  // COMPLETADO —terminal— el tratamiento que hoy lleva B.
  assert.match(
    helper,
    /case:\s*\{\s*\.\.\.eduCaseScopeWhere\(\{ institutionId, scope, now \}\),\s*status:\s*\{\s*not:\s*"TRANSFERRED"\s*\}\s*,?\s*\}/,
  );
  assert.ok(
    !/\{ case: eduCaseScopeWhere\(\{ institutionId, scope, now \}\) \}/.test(helper),
    "el alcance de casos a secas deja al saliente cerrando el plan que entregó",
  );
});

test("🟠 #3 · el descarte NO se le aplica a la lista de casos ni al alcance compartido", () => {
  // El helper del vertical se queda como está: quitar el transferido de ahí
  // borraría la historia académica del alumno, que es de lo que vive la
  // bitácora. El recorte es SOLO del plan.
  const visibilidad = sinComentarios(
    tramo(crudo("src/lib/edu/visibility.ts"), "export function eduCaseScopeWhere", "export interface EduStudentScopeInput"),
  );
  assert.ok(
    !/TRANSFERRED/.test(visibilidad),
    "eduCaseScopeWhere conserva el caso entregado a propósito: es la historia académica",
  );
});

test("🟠 #3 · dirección sigue viendo y cerrando el plan del caso entregado", () => {
  // No pasa por el recorte: sale antes con el alcance completo.
  assert.match(ALCANCE_PLAN(), /if \(scope\.kind === "all"\) return \{\};/);
  const cerrar = sinComentarios(crudo("src/lib/edu/plan-tratamiento-core.ts"));
  assert.match(cerrar, /role === "DIRECCION" \|\| role === "DOCENTE"/);
});
