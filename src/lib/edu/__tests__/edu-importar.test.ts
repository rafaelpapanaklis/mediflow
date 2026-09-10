/**
 * WS2-T5 · IMPORTAR PADRÓN y LA SEDE EN EL ALTA (H-112).
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-importar.test.ts
 *
 * ═══════════════════════════════════════════════════════════════════════
 * Dos clases de prueba, como en el resto del vertical:
 *
 *  · EJECUTADAS — `importar-core.ts` es puro a propósito (la pantalla pinta
 *    la simulación con la MISMA función que el servidor vuelve a correr
 *    antes de crear), así que el mapeo de columnas y la detección de
 *    choques se corren de verdad, con los casos que trae un Excel real.
 *  · DE FUENTE — lo que vive dentro de una función que importa prisma o
 *    exceljs no se puede cargar aquí sin base de datos. Se lee el archivo y
 *    se comprueba que la llamada esté puesta, con los comentarios quitados:
 *    un archivo se juzga por lo que HACE.
 *
 * 🔴 LA PRUEBA QUE MÁS IMPORTA es la de «un solo escritor»: si algún día
 * `importar.ts` o `equipo.ts` escriben `edu_user_campus_access` por su
 * cuenta, esta prueba se pone roja. En esa tabla la AUSENCIA de filas
 * concede MÁS acceso, y dos sitios decidiendo qué significa "vacío" es el
 * H-112 multiplicado por dos.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EDU_IMPORT_CAMPOS,
  EDU_IMPORT_CHUNK,
  EDU_IMPORT_ROL,
  eduImportAplicaMapeo,
  eduImportAutodetecta,
  eduImportCredencialesTexto,
  eduImportEsEntidad,
  eduImportFilasListas,
  eduImportNormaliza,
  eduImportResumen,
  eduImportSaneaMapeo,
  eduImportSimula,
  eduImportSinExistentes,
  eduImportValidaMapeo,
  type EduImportResultado,
} from "../importar-core";

const RAIZ = join(__dirname, "..", "..", "..", "..");

function crudo(...tramos: string[]): string {
  return readFileSync(join(RAIZ, ...tramos), "utf8");
}

function fuente(...tramos: string[]): string {
  return crudo(...tramos)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "");
}

const CORE = "src/lib/edu/importar-core.ts";
const SERVIDOR = "src/lib/edu/importar.ts";
const EQUIPO = "src/lib/edu/equipo.ts";
const CAMPUS = "src/lib/edu/campus.ts";
const PANTALLA = "src/components/edu/padron/importar-padron.tsx";
const EQUIPO_PANTALLA = "src/components/edu/equipo/equipo-screen.tsx";
const RUTA_SIMULAR = "src/app/api/instituto/padron/importar/route.ts";
const RUTA_CONFIRMAR = "src/app/api/instituto/padron/importar/confirmar/route.ts";

// ═══════════════════════════════════════════════════════════════════════
// 1 · EL MAPEO DE COLUMNAS
// ═══════════════════════════════════════════════════════════════════════

test("autodetección: los encabezados de un Excel real, con acentos y separadores", () => {
  const columnas = ["Nombre(s)", "Apellidos", "Correo electrónico", "MATRÍCULA", "Semestre", "Cel"];
  const mapeo = eduImportAutodetecta(columnas, "alumnos");
  assert.equal(mapeo["Apellidos"], "lastName");
  assert.equal(mapeo["Correo electrónico"], "email");
  assert.equal(mapeo["MATRÍCULA"], "matricula");
  assert.equal(mapeo["Semestre"], "semester");
  // "Nombre(s)" y "Cel" NO se reconocen, y eso está bien: lo que no se
  // reconoce se pregunta, no se adivina. Adivinar una columna mal crea
  // doscientas cuentas con el apellido en el correo.
  assert.equal(mapeo["Nombre(s)"], undefined);
  assert.equal(mapeo["Cel"], undefined);
});

test("autodetección: acentos, mayúsculas, guiones bajos y espacios dan igual", () => {
  assert.equal(eduImportNormaliza("Apellido_Paterno"), "apellidopaterno");
  assert.equal(eduImportNormaliza("  CORREO   ELECTRÓNICO "), "correoelectronico");
  const mapeo = eduImportAutodetecta(["apellido paterno", "e-mail", "Teléfono"], "docentes");
  assert.equal(mapeo["apellido paterno"], "lastName");
  assert.equal(mapeo["Teléfono"], "phone");
});

test("autodetección: dos columnas al mismo campo — gana la PRIMERA", () => {
  // Excel desambigua los encabezados repetidos con _1. La segunda se queda
  // sin mapear y la pantalla la enseña sin asignar, que es lo que hay que
  // ver: si pisara a la primera, el valor guardado dependería del orden.
  const mapeo = eduImportAutodetecta(["Correo", "Correo_1"], "docentes");
  assert.equal(mapeo["Correo"], "email");
  assert.equal(mapeo["Correo_1"], undefined);
});

test("el mapeo del navegador se SANEA: nada inventado llega al create", () => {
  const columnas = ["A", "B"];
  const sucio = {
    A: "email",
    B: "isActive", // campo que este motor no escribe
    C: "firstName", // columna que no existe en el archivo
    __proto__: "role",
  };
  const limpio = eduImportSaneaMapeo(sucio, columnas, "docentes");
  assert.deepEqual(limpio, { A: "email" });
  assert.equal(eduImportSaneaMapeo(null, columnas, "docentes").A, undefined);
  assert.deepEqual(eduImportSaneaMapeo(["email"], columnas, "docentes"), {});
});

test("faltan columnas obligatorias: se DICE cuáles, no «formato inválido»", () => {
  const problema = eduImportValidaMapeo({ A: "email" }, "alumnos");
  assert.ok(problema);
  assert.match(problema ?? "", /Nombre/);
  assert.match(problema ?? "", /Apellidos/);
  assert.match(problema ?? "", /Matrícula/);
  // Con todo lo obligatorio puesto, ni un problema.
  assert.equal(
    eduImportValidaMapeo(
      { A: "firstName", B: "lastName", C: "email", D: "matricula" },
      "alumnos",
    ),
    null,
  );
  // Un docente NO lleva matrícula: exigírsela sería pedirle un dato que no
  // tiene.
  assert.equal(
    eduImportValidaMapeo({ A: "firstName", B: "lastName", C: "email" }, "docentes"),
    null,
  );
});

test("aplicar el mapeo: lo vacío no pisa, y la primera columna no vacía gana", () => {
  const filas = eduImportAplicaMapeo(
    [
      { N: "Ana", A: "Ruiz", C: "  " },
      { N: "Beto", A: "Sosa", C: "beto@x.mx" },
    ],
    { N: "firstName", A: "lastName", C: "email" },
  );
  assert.equal(filas[0].email, undefined, "una celda con espacios es una celda vacía");
  assert.equal(filas[1].email, "beto@x.mx");
});

// ═══════════════════════════════════════════════════════════════════════
// 2 · LA SIMULACIÓN — qué se crearía y qué chocaría
// ═══════════════════════════════════════════════════════════════════════

function alumno(over: Record<string, unknown> = {}) {
  return { firstName: "Ana", lastName: "Ruiz", email: "ana@x.mx", matricula: "A-01", ...over };
}

test("simulación: un archivo limpio sale entero listo, con el semestre por defecto", () => {
  const filas = eduImportSimula({
    entidad: "alumnos",
    filas: [alumno(), alumno({ email: "beto@x.mx", matricula: "A-02", firstName: "Beto" })],
    semestrePorDefecto: 3,
  });
  const r = eduImportResumen(filas);
  assert.deepEqual(r, { total: 2, listas: 2, conError: 0, chocan: 0 });
  assert.equal(filas[0].datos.semester, 3, "sin columna de semestre manda el del asistente");
  assert.equal(filas[0].datos.matricula, "A-01");
  // La primera fila de datos es el renglón 2 del archivo (bajo el encabezado).
  assert.equal(filas[0].linea, 2);
  assert.equal(filas[1].linea, 3);
});

test("simulación: el semestre del ARCHIVO manda sobre el del asistente", () => {
  const filas = eduImportSimula({
    entidad: "alumnos",
    filas: [alumno({ semester: "5" })],
    semestrePorDefecto: 1,
  });
  assert.equal(filas[0].datos.semester, 5);

  const malo = eduImportSimula({ entidad: "alumnos", filas: [alumno({ semester: "99" })] });
  assert.equal(malo[0].estado, "error");
  assert.match(malo[0].problemas.join(" "), /entre 1 y 20/);
});

test("simulación: la matrícula se normaliza (MAYÚSCULAS, sin espacios)", () => {
  const filas = eduImportSimula({ entidad: "alumnos", filas: [alumno({ matricula: " a-0 1 " })] });
  assert.equal(filas[0].datos.matricula, "A-01");
  // Sin ella, un alumno no se puede inscribir.
  const sin = eduImportSimula({ entidad: "alumnos", filas: [alumno({ matricula: "" })] });
  assert.equal(sin[0].estado, "error");
  assert.match(sin[0].problemas.join(" "), /matrícula/i);
});

test("simulación: un renglón ilegible NO tira el archivo, y dice de QUIÉN es", () => {
  const filas = eduImportSimula({
    entidad: "alumnos",
    filas: [alumno(), alumno({ email: "esto-no-es-un-correo", matricula: "A-02" }), alumno({ email: "c@x.mx", matricula: "A-03" })],
  });
  assert.equal(filas[1].estado, "error");
  assert.match(filas[1].problemas.join(" "), /correo/i);
  // El nombre viaja igual: una lista de errores sin nombre no se corrige.
  assert.equal(filas[1].datos.firstName, "Ana");
  assert.equal(eduImportResumen(filas).listas, 2);
});

test("🔴 simulación: el correo REPETIDO dentro del archivo se marca en el SEGUNDO", () => {
  // Sin esto, la cuenta se crearía la primera vez y fallaría la segunda con
  // un error de base de datos que nadie relacionaría con el renglón 47.
  const filas = eduImportSimula({
    entidad: "alumnos",
    filas: [alumno(), alumno({ matricula: "A-02" }), alumno({ matricula: "A-03" })],
  });
  assert.equal(filas[0].estado, "ok");
  assert.equal(filas[1].estado, "choca");
  assert.equal(filas[2].estado, "choca", "el TERCERO también, no solo el segundo");
  assert.match(filas[1].problemas.join(" "), /dos veces en el archivo/);
});

test("🔴 simulación: la MATRÍCULA repetida en el archivo también choca", () => {
  // Es única por instituto y es lo que se imprime en la credencial: dos
  // alumnos con la misma es un problema que aparece meses después.
  const filas = eduImportSimula({
    entidad: "alumnos",
    filas: [alumno(), alumno({ email: "beto@x.mx" })],
  });
  assert.equal(filas[1].estado, "choca");
  assert.match(filas[1].problemas.join(" "), /A-01 aparece dos veces/);
});

test("🔴 simulación: choca contra lo que YA existe en el instituto", () => {
  const existente = eduImportSinExistentes();
  existente.correosDelInstituto.add("ana@x.mx");
  existente.matriculas.add("A-02");

  const filas = eduImportSimula({
    entidad: "alumnos",
    filas: [alumno(), alumno({ email: "beto@x.mx", matricula: "A-02" }), alumno({ email: "c@x.mx", matricula: "A-03" })],
    existente,
  });
  assert.equal(filas[0].estado, "choca");
  assert.match(filas[0].problemas.join(" "), /Ya hay alguien con ese correo/);
  assert.equal(filas[1].estado, "choca");
  assert.match(filas[1].problemas.join(" "), /A-02 ya está en uso/);
  assert.equal(filas[2].estado, "ok");
  assert.deepEqual(eduImportResumen(filas), { total: 3, listas: 1, conError: 0, chocan: 2 });
});

test("simulación: quien YA tiene cuenta en DaleControl se crea, con AVISO", () => {
  // No es un choque: se le enlaza su cuenta y NO se le enseña contraseña
  // temporal. Quien importa tiene que saberlo antes, o buscará cuarenta
  // contraseñas y encontrará treinta y ocho.
  const existente = eduImportSinExistentes();
  existente.correosDeOtroProducto.add("ana@x.mx");
  const filas = eduImportSimula({ entidad: "alumnos", filas: [alumno()], existente });
  assert.equal(filas[0].estado, "ok");
  assert.equal(filas[0].problemas.length, 0);
  assert.match(filas[0].avisos.join(" "), /entra con la suya de siempre/);
});

test("simulación de DOCENTES: sin matrícula y con rol DOCENTE", () => {
  const filas = eduImportSimula({
    entidad: "docentes",
    filas: [{ firstName: "Luis", lastName: "Paz", email: "luis@x.mx", phone: "5544332211" }],
  });
  assert.equal(filas[0].estado, "ok");
  assert.equal(filas[0].datos.matricula, undefined);
  assert.equal(filas[0].datos.phone, "5544332211");
  assert.equal(EDU_IMPORT_ROL.docentes, "DOCENTE");
  assert.equal(EDU_IMPORT_ROL.alumnos, "ALUMNO");
});

test("simulación: el teléfono malo rebota el renglón (misma regla que el alta)", () => {
  const filas = eduImportSimula({
    entidad: "docentes",
    filas: [{ firstName: "Luis", lastName: "Paz", email: "luis@x.mx", phone: "sin-numeros" }],
  });
  assert.equal(filas[0].estado, "error");
});

test("`eduImportFilasListas` devuelve SOLO las que se van a crear", () => {
  const filas = eduImportSimula({
    entidad: "alumnos",
    filas: [alumno(), alumno({ email: "mal" }), alumno({ matricula: "A-09", email: "z@x.mx" })],
  });
  const listas = eduImportFilasListas(filas);
  assert.equal(listas.length, 2);
  assert.ok(listas.every((f) => f.estado === "ok"));
});

test("la entidad viene de un catálogo CERRADO", () => {
  assert.equal(eduImportEsEntidad("alumnos"), true);
  assert.equal(eduImportEsEntidad("docentes"), true);
  assert.equal(eduImportEsEntidad("pacientes"), false);
  assert.equal(eduImportEsEntidad(null), false);
});

test("la tabla de credenciales se pega en columnas y no miente con una celda vacía", () => {
  const r: EduImportResultado[] = [
    { linea: 2, ok: true, name: "Ana Ruiz", email: "ana@x.mx", matricula: "A-01", tempPassword: "Edu-ABCD-EFG2", reused: false, inscrito: true, error: null },
    { linea: 3, ok: true, name: "Beto Sosa", email: "beto@x.mx", matricula: "A-02", tempPassword: null, reused: true, inscrito: true, error: null },
    { linea: 4, ok: false, name: "Mal", email: "mal@x.mx", matricula: null, tempPassword: null, reused: false, inscrito: false, error: "choca" },
  ];
  const texto = eduImportCredencialesTexto(r, "alumnos");
  const lineas = texto.split("\n");
  assert.equal(lineas.length, 3, "el encabezado y las DOS creadas; la fallida no");
  assert.equal(lineas[0].split("\t").length, 4);
  assert.match(lineas[1], /Edu-ABCD-EFG2/);
  assert.match(lineas[2], /contraseña de siempre/, "una celda vacía se leería como «no se creó»");
  // Los docentes no llevan columna de matrícula.
  assert.equal(eduImportCredencialesTexto(r, "docentes").split("\n")[0].split("\t").length, 3);
});

// ═══════════════════════════════════════════════════════════════════════
// 3 · EL SERVIDOR NO INVENTA CAMINOS DE ESCRITURA
// ═══════════════════════════════════════════════════════════════════════

test("🔴 (fuente): importar NO crea cuentas por su cuenta — llama al alta de siempre", () => {
  const src = fuente(SERVIDOR);
  assert.match(src, /createEduTeamMember\(/, "un importador con su propio create se salta el guardia de DIRECCION, el índice de búsqueda y la bitácora");
  assert.match(src, /createEduStudent\(/, "la ficha académica se crea por el mismo camino que «Inscribir estudiante»");
  assert.doesNotMatch(
    src,
    /prisma\.eduUser\.create\(/,
    "importar volvió a escribir edu_users a mano",
  );
  assert.doesNotMatch(src, /prisma\.eduStudent\.create\(/);
  // Y no toca Supabase Auth por su cuenta.
  assert.doesNotMatch(src, /admin\.auth\.admin/);
});

test("🔴 (fuente): el servidor NO se fía de la simulación del navegador", () => {
  const src = fuente(SERVIDOR);
  // eduImportCrear vuelve a correr la simulación con la base fresca.
  const crear = src.slice(src.indexOf("export async function eduImportCrear"));
  assert.match(crear, /eduImportSimula\(/);
  assert.match(crear, /leeExistente\(/);
  // Y respeta el tope por petición.
  assert.match(crear, /EDU_IMPORT_CHUNK/);
});

test("(fuente): el archivo se valida por su FIRMA, no por la extensión", () => {
  const src = fuente(SERVIDOR);
  assert.match(src, /validateSpreadsheet\(/);
  assert.match(src, /exceljs/, "exceljs y no SheetJS: dos vulnerabilidades ALTAS sin arreglo");
  assert.doesNotMatch(src, /xlsx["']\s*\)/);
});

test("(fuente): los DOS endpoints exigen los DOS permisos", () => {
  for (const ruta of [RUTA_SIMULAR, RUTA_CONFIRMAR]) {
    const src = fuente(ruta);
    assert.match(src, /eduApiGuard\("equipo\.manage"\)/, `${ruta} no exige equipo.manage`);
    assert.match(
      src,
      /assertEduPermission\(g\.ctx, "padron\.manage"\)/,
      `${ruta} no exige padron.manage para alumnos`,
    );
  }
});

test("(fuente): el asistente sube el archivo ANTES de crear nada, y crea por trozos", () => {
  const src = fuente(PANTALLA);
  assert.match(src, /\/api\/instituto\/padron\/importar["']/);
  assert.match(src, /\/api\/instituto\/padron\/importar\/confirmar/);
  assert.match(src, /EDU_IMPORT_CHUNK/);
  // Y el panel de credenciales NO se cierra solo.
  assert.match(src, /Ya las copié/);
});

// ═══════════════════════════════════════════════════════════════════════
// 4 · H-112 · LA SEDE EN EL ALTA, Y UN SOLO ESCRITOR
// ═══════════════════════════════════════════════════════════════════════

test("🔴 H-112: `edu_user_campus_access` tiene UN SOLO escritor, y es campus.ts", () => {
  // En esa tabla la AUSENCIA de filas concede MÁS acceso ("sin filas =
  // todas las sedes"), así que dos sitios decidiendo qué significa "vacío"
  // es el H-112 multiplicado por dos.
  const dir = join(RAIZ, "src/lib/edu");
  const culpables: string[] = [];
  for (const archivo of readdirSync(dir)) {
    if (!archivo.endsWith(".ts") || archivo === "campus.ts") continue;
    const src = fuente("src/lib/edu", archivo);
    if (/eduUserCampusAccess\.(create|createMany|upsert|delete|deleteMany|update|updateMany)/.test(src)) {
      culpables.push(archivo);
    }
  }
  assert.deepEqual(
    culpables,
    [],
    `estos archivos escriben edu_user_campus_access sin pasar por campus.ts: ${culpables.join(", ")}`,
  );
});

test("🔴 H-112: el alta escribe la persona y sus sedes en la MISMA transacción", () => {
  const src = fuente(EQUIPO);
  const alta = src.slice(
    src.indexOf("export async function createEduTeamMember"),
    src.indexOf("export async function createEduTeamMembers"),
  );
  assert.match(alta, /prisma\.\$transaction/);
  assert.match(alta, /setEduUserCampuses\(ctx, creada\.id, campusIds, tx\)/);
});

test("H-112: la lista de equipo trae las sedes de cada persona, y la pantalla las DICE", () => {
  const src = fuente(EQUIPO);
  assert.match(src, /campusAccess: \{ select: \{ campusId: true \} \}/);
  assert.match(src, /campusIds: u\.campusAccess\.map/);

  const pantalla = fuente(EQUIPO_PANTALLA);
  assert.match(pantalla, /SelectorSedes/);
  assert.match(pantalla, /Entra a todas las sedes/, "el caso que sorprende tiene que estar escrito");
  // El selector solo se pinta con DOS sedes o más: casi todas las escuelas
  // tienen una y para ellas esta ola no existe.
  assert.match(pantalla, /sedes\.length < 2/);
});

test("H-112: vacío significa TODAS, y el servidor lo devuelve DICHO", () => {
  const src = fuente(CAMPUS);
  const setter = src.slice(src.indexOf("export async function setEduUserCampuses"));
  assert.match(setter, /abrioTodas: campusIds\.length === 0/);
  // El reemplazo es completo (borra y escribe), no un diff.
  assert.match(setter, /deleteMany\(\{ where: \{ institutionId, userId: uid \} \}\)/);
});

// ═══════════════════════════════════════════════════════════════════════
// 5 · H-04 · EL RASTRO DE QUIÉN TOCÓ UNA CUENTA
// ═══════════════════════════════════════════════════════════════════════

test("🔴 H-04: TODAS las escrituras de edu_users dejan quién y cuándo", () => {
  const src = fuente(EQUIPO);
  const escritores = [
    "createEduTeamMember",
    "setEduTeamMemberActive",
    "setEduTeamMemberPermissions",
    "updateEduTeamMember",
    "resetEduTeamMemberPassword",
  ];
  for (const nombre of escritores) {
    const desde = src.indexOf(`export async function ${nombre}`);
    assert.notEqual(desde, -1, `no se encontró ${nombre}: ¿lo renombraron?`);
    const siguiente = src.indexOf("\nexport ", desde + 1);
    const cuerpo = src.slice(desde, siguiente === -1 ? undefined : siguiente);
    assert.match(
      cuerpo,
      /rastro\(ctx,/,
      `${nombre} escribe edu_users sin dejar quién la tocó (H-04)`,
    );
  }
  // Y `rastro` es lo que dice ser.
  assert.match(src, /updatedById: ctx\.eduUserId, updatedByAt: now/);
});

test("🔴 H-04: el override y el rol que se pierden quedan guardados", () => {
  const src = fuente(EQUIPO);
  assert.match(src, /permissionsOverridePrevious: anterior/, "el override que reemplaza otro");
  assert.match(src, /permissionsOverridePrevious: overrideAnterior/, "el que borra el cambio de rol");
  assert.match(src, /rolePrevious: persona\.role as EduRole/);
  assert.match(src, /roleChangedAt: now/);
});

test("🔴 bitácora: toda escritura relevante del equipo llama a eduAudit", () => {
  const src = fuente(EQUIPO);
  for (const nombre of [
    "createEduTeamMember",
    "setEduTeamMemberActive",
    "setEduTeamMemberPermissions",
    "updateEduTeamMember",
    "resetEduTeamMemberPassword",
    "setEduTeamMemberCampuses",
  ]) {
    const desde = src.indexOf(`export async function ${nombre}`);
    const siguiente = src.indexOf("\nexport ", desde + 1);
    const cuerpo = src.slice(desde, siguiente === -1 ? undefined : siguiente);
    assert.match(cuerpo, /eduAudit\(auditor\(ctx\)/, `${nombre} no escribe bitácora`);
  }
  // La contraseña NUNCA entra a la bitácora, ni la vieja ni la nueva.
  assert.doesNotMatch(src, /after: \{[^}]*tempPassword/);
  // Y la importación deja su propio renglón: "¿de dónde salieron estas 40?".
  assert.match(fuente(SERVIDOR), /eduAudit\(auditor\(ctx\)/);
});

// ═══════════════════════════════════════════════════════════════════════
// 6 · EL CORE ES PURO
// ═══════════════════════════════════════════════════════════════════════

test("importar-core.ts es PURO: ni prisma, ni exceljs, ni un new Date() escondido", () => {
  const src = fuente(CORE);
  assert.doesNotMatch(src, /from "@\/lib\/prisma"/);
  assert.doesNotMatch(src, /exceljs/);
  assert.doesNotMatch(src, /server-only/);
  assert.doesNotMatch(src, /new Date\(\)/);
  // Y reusa la validación del alta en vez de escribir la suya.
  assert.match(src, /eduTeamMemberInput\(/);
  assert.ok(EDU_IMPORT_CHUNK > 0 && EDU_IMPORT_CHUNK <= 50);
  assert.ok(EDU_IMPORT_CAMPOS.alumnos.some((c) => c.key === "matricula" && c.requerido));
  assert.ok(!EDU_IMPORT_CAMPOS.docentes.some((c) => c.key === "matricula"));
});
