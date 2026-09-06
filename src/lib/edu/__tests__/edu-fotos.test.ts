/**
 * DaleControl INSTITUCIONAL — LAS FOTOS CLÍNICAS (Ola B).
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-fotos.test.ts
 *
 * Todo sin base de datos: funciones puras, un par de `where` y lecturas
 * del código fuente para lo que no se puede comprobar de otra forma sin
 * levantar Postgres (el ORDEN de las comprobaciones dentro de la subida,
 * por ejemplo). Es el mismo reparto que ya usan edu-almacenamiento.test.ts
 * y edu-auditoria.test.ts, y por la misma razón: un `where` correcto que
 * nadie llama es exactamente igual de inseguro que uno equivocado.
 *
 * Lo que fija:
 *  1. las uniones de types.ts == los enums de Prisma (chequeo de TIPOS);
 *  2. la VALIDACIÓN de la subida: MIME, vacío y el tope de 25 MB;
 *  3. 🔴 el PATH: lo compone el servidor, lleva el institutionId adelante
 *     y no se puede escapar de la carpeta del paciente;
 *  4. la AGRUPACIÓN por etapa y el PAR A/B del comparador — la misma
 *     regla que PhotoCompareSlider, escrita aquí y con prueba;
 *  5. 🔴 el ORDEN de la subida: magic number y cuota ANTES de escribir un
 *     byte, y la fila DESPUÉS de subir;
 *  6. 🔴 la CUOTA suma las fotos vivas y NO las dadas de baja;
 *  7. 🔴 el vertical no importa ni una línea del dental.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  EduPhotoStage as PrismaPhotoStage,
  EduPhotoType as PrismaPhotoType,
  EduPregnancy as PrismaPregnancy,
  EduContactPreference as PrismaContactPreference,
  EduHabitLevel as PrismaHabitLevel,
} from "@prisma/client";
import {
  EDU_MAX_PHOTO_BYTES,
  EDU_MAX_PHOTO_LABEL,
  EDU_PHOTO_ACCEPT,
  EDU_PHOTO_JPEG_QUALITY,
  EDU_PHOTO_MAX_EDGE,
  EDU_PHOTO_MAX_ROWS,
  EDU_PHOTO_MIME,
  EDU_PHOTO_SIGNED_URL_TTL_SECONDS,
  EDU_PHOTO_THUMB_EDGE,
  EDU_PHOTO_THUMB_QUALITY,
  eduAgruparFotosPorEtapa,
  eduContarFotosPorEtapa,
  eduIsPhotoMime,
  eduParFotosComparador,
  eduParseCapturedAt,
  eduParsePhotoStage,
  eduParsePhotoType,
  eduPhotoExtForMime,
  eduPhotoPathBelongsTo,
  eduPhotoPathIsSafe,
  eduPhotoPathPrefix,
  eduPhotoStoragePath,
  eduPhotoThumbPath,
  eduPuedeCompararFotos,
  eduSafePhotoFileName,
  eduValidarFotoSubida,
  type EduPhotoRow,
} from "../fotos-core";
import {
  eduAlmCabe,
  eduAlmacenamientoFotosWhere,
  eduAlmacenamientoWhere,
} from "../almacenamiento-core";
import { EDU_SIGNED_URL_TTL_SECONDS } from "../estudios-core";
import {
  EDU_PHOTO_STAGES,
  EDU_PHOTO_STAGE_LABELS,
  EDU_PHOTO_TYPES,
  EDU_PHOTO_TYPE_LABELS,
  EDU_CONTACT_PREFERENCES,
  EDU_CONTACT_PREFERENCE_LABELS,
  EDU_HABIT_LEVELS,
  EDU_HABIT_LEVEL_LABELS,
  EDU_PREGNANCY_LABELS,
  EDU_PREGNANCY_VALUES,
  type EduContactPreference,
  type EduHabitLevel,
  type EduPhotoStage,
  type EduPhotoType,
  type EduPregnancy,
} from "../types";

// ─────────────────────────────────────────────────────────────────────
// 0 · Candado de TIPOS: las uniones de types.ts == los enums de Prisma.
//     Si una ola agrega un valor al schema y no lo agrega a types.ts (o
//     al revés), `tsc --noEmit` falla aquí. En runtime esto no existe.
// ─────────────────────────────────────────────────────────────────────
type Exacto<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

const _stage: Exacto<EduPhotoStage, PrismaPhotoStage> = true;
const _type: Exacto<EduPhotoType, PrismaPhotoType> = true;
const _pregnancy: Exacto<EduPregnancy, PrismaPregnancy> = true;
const _contacto: Exacto<EduContactPreference, PrismaContactPreference> = true;
const _habito: Exacto<EduHabitLevel, PrismaHabitLevel> = true;
void _stage;
void _type;
void _pregnancy;
void _contacto;
void _habito;

const RAIZ = join(__dirname, "..", "..", "..", "..");

function crudo(...tramos: string[]): string {
  return readFileSync(join(RAIZ, ...tramos), "utf8");
}

/**
 * El código SIN sus comentarios. Varias pruebas miran el fuente, y un
 * comentario que EXPLICA por qué algo no se hace no puede hacerlas
 * fallar: entonces la única forma de pasar sería no explicarlo.
 */
function sinComentarios(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

const INST = "inst_1";
const OTRO_INST = "inst_2";
const PAC = "pac_1";
const OTRO_PAC = "pac_2";

// ─────────────────────────────────────────────────────────────────────
// 1 · CADA ETIQUETA TIENE SU VALOR, Y NINGUNA PANTALLA PINTA EL ENUM
// ─────────────────────────────────────────────────────────────────────

test("las cuatro etapas y las diez vistas tienen etiqueta en español", () => {
  assert.equal(EDU_PHOTO_STAGES.length, 4);
  assert.equal(EDU_PHOTO_TYPES.length, 10);
  for (const s of EDU_PHOTO_STAGES) {
    assert.ok(EDU_PHOTO_STAGE_LABELS[s], `falta la etiqueta de ${s}`);
    // La etiqueta NO puede ser el valor del enum: es lo que impide que
    // una pantalla pinte "PRE" donde tiene que decir "Antes".
    assert.notEqual(EDU_PHOTO_STAGE_LABELS[s], s);
  }
  for (const t of EDU_PHOTO_TYPES) {
    assert.ok(EDU_PHOTO_TYPE_LABELS[t], `falta la etiqueta de ${t}`);
    assert.notEqual(EDU_PHOTO_TYPE_LABELS[t], t);
  }
});

test("los tres enums nuevos de la ficha también traen su etiqueta", () => {
  for (const v of EDU_PREGNANCY_VALUES) assert.ok(EDU_PREGNANCY_LABELS[v]);
  for (const v of EDU_CONTACT_PREFERENCES) assert.ok(EDU_CONTACT_PREFERENCE_LABELS[v]);
  for (const v of EDU_HABIT_LEVELS) assert.ok(EDU_HABIT_LEVEL_LABELS[v]);
  // 🔴 `DESCONOCIDO` existe en los dos que describen al paciente, y la
  // columna ADEMÁS es nullable: null = nadie preguntó · DESCONOCIDO = se
  // preguntó y no se sabe. Confundir esos dos estados es el bug.
  assert.ok(EDU_PREGNANCY_VALUES.includes("DESCONOCIDO"));
  assert.ok(EDU_HABIT_LEVELS.includes("DESCONOCIDO"));
  // Y "NINGUNO" es una RESPUESTA, no un hueco: el paciente dijo que no
  // quiere que le escriban.
  assert.ok(EDU_CONTACT_PREFERENCES.includes("NINGUNO"));
});

test("el orden de las etapas ES el orden de la galería: antes → después", () => {
  assert.deepEqual(EDU_PHOTO_STAGES, ["PRE", "DURANTE", "POST", "CONTROL"]);
});

// ─────────────────────────────────────────────────────────────────────
// 2 · LA VALIDACIÓN DE LA SUBIDA
// ─────────────────────────────────────────────────────────────────────

test("solo pasan las cinco imágenes que el producto acepta", () => {
  for (const m of EDU_PHOTO_MIME) assert.equal(eduIsPhotoMime(m), true, m);
  for (const m of ["application/pdf", "image/gif", "application/zip", "text/plain", "", null]) {
    assert.equal(eduIsPhotoMime(m), false, String(m));
  }
  // HEIC/HEIF están porque es lo que produce un iPhone por omisión: sin
  // ellos, la mitad de las fotos de una clínica rebotan antes de empezar.
  assert.ok(eduIsPhotoMime("image/heic"));
  assert.ok(eduIsPhotoMime("image/heif"));
});

test("el `accept` del input sale de la MISMA lista, no de una copia", () => {
  assert.equal(EDU_PHOTO_ACCEPT, EDU_PHOTO_MIME.join(","));
});

test("un PDF disfrazado, un archivo vacío y uno de 26 MB se rechazan CON PALABRAS", () => {
  const formato = eduValidarFotoSubida({ mime: "application/pdf", size: 1000 });
  assert.ok(formato && /no se acepta/i.test(formato));

  const vacio = eduValidarFotoSubida({ mime: "image/jpeg", size: 0 });
  assert.ok(vacio && /vac/i.test(vacio));

  const grande = eduValidarFotoSubida({ mime: "image/jpeg", size: EDU_MAX_PHOTO_BYTES + 1 });
  assert.ok(grande);
  // El mensaje dice cuánto pesa y cuál es el tope: quien sube tiene al
  // paciente en el sillón y "no se pudo subir" lo deja mirando la pantalla.
  assert.match(grande, /25\.0 MB/);
  assert.match(grande, new RegExp(EDU_MAX_PHOTO_LABEL));
});

test("justo en el tope pasa, y un byte más no", () => {
  assert.equal(eduValidarFotoSubida({ mime: "image/jpeg", size: EDU_MAX_PHOTO_BYTES }), null);
  assert.notEqual(eduValidarFotoSubida({ mime: "image/jpeg", size: EDU_MAX_PHOTO_BYTES + 1 }), null);
});

test("el tope son 25 MB y los parámetros de compresión son los del dental", () => {
  assert.equal(EDU_MAX_PHOTO_BYTES, 25 * 1024 * 1024);
  assert.equal(EDU_PHOTO_MAX_EDGE, 2400);
  assert.equal(EDU_PHOTO_JPEG_QUALITY, 85);
  assert.equal(EDU_PHOTO_THUMB_EDGE, 300);
  assert.equal(EDU_PHOTO_THUMB_QUALITY, 80);
});

test("el TTL de la URL firmada es EL MISMO que el de los estudios, importado", () => {
  // Dos números para lo mismo es cómo se llega a que la galería caduque a
  // los 5 minutos y el visor a los 60.
  assert.equal(EDU_PHOTO_SIGNED_URL_TTL_SECONDS, EDU_SIGNED_URL_TTL_SECONDS);
  const core = sinComentarios(crudo("src", "lib", "edu", "fotos-core.ts"));
  assert.match(core, /EDU_SIGNED_URL_TTL_SECONDS/);
});

test("la etapa y la vista que manda el cliente se validan contra el enum", () => {
  assert.equal(eduParsePhotoStage("POST"), "POST");
  assert.equal(eduParsePhotoStage("post"), null);
  assert.equal(eduParsePhotoStage("BORRAR TODO"), null);
  assert.equal(eduParsePhotoStage(undefined), null);
  assert.equal(eduParsePhotoType("OCLUSAL_SUP"), "OCLUSAL_SUP");
  assert.equal(eduParsePhotoType({ a: 1 }), null);
});

test("una fecha de toma en el FUTURO se rechaza; una de ayer pasa", () => {
  const ahora = new Date("2026-09-06T12:00:00.000Z");
  assert.ok(eduParseCapturedAt("2026-09-05T10:00:00.000Z", ahora));
  // Un dedazo en el año ordena mal el comparador para siempre.
  assert.equal(eduParseCapturedAt("2036-01-01T00:00:00.000Z", ahora), null);
  assert.equal(eduParseCapturedAt("no soy una fecha", ahora), null);
  // Vacío no es un error: quien llama cae a "ahora".
  assert.equal(eduParseCapturedAt("", ahora), null);
  // Un día de margen para no pelearse con la zona del navegador.
  assert.ok(eduParseCapturedAt("2026-09-06T20:00:00.000Z", ahora));
});

// ─────────────────────────────────────────────────────────────────────
// 3 · 🔴 EL PATH — lo compone el servidor y no se puede escapar de él
// ─────────────────────────────────────────────────────────────────────

test("el institutionId va ADELANTE, como en los estudios", () => {
  // Con `fotos/<institutionId>/…` un listado por el prefijo `fotos/`
  // cruzaría institutos. Con esto, listar `<inst>/` da todo lo de una
  // escuela y nada de las demás.
  assert.equal(eduPhotoPathPrefix(INST, PAC), "inst_1/fotos/pac_1/");
  const path = eduPhotoStoragePath(INST, PAC, "uuid-1", "frontal.jpg");
  assert.equal(path, "inst_1/fotos/pac_1/uuid-1-frontal.jpg");
  assert.ok(path.startsWith(INST + "/"));
});

test("la miniatura vive en la MISMA carpeta que su foto", () => {
  // Dar de baja una foto tiene que poder llevarse su miniatura sin
  // buscarla en otro sitio, y las dos caen dentro del mismo `belongsTo`.
  const thumb = eduPhotoThumbPath(INST, PAC, "uuid-1");
  assert.equal(thumb, "inst_1/fotos/pac_1/uuid-1-thumb.webp");
  assert.equal(eduPhotoPathBelongsTo(thumb, INST, PAC), true);
});

test("un path de otra escuela o de otro paciente NO pertenece", () => {
  const path = eduPhotoStoragePath(INST, PAC, "u1", "a.jpg");
  assert.equal(eduPhotoPathBelongsTo(path, INST, PAC), true);
  assert.equal(eduPhotoPathBelongsTo(path, OTRO_INST, PAC), false);
  assert.equal(eduPhotoPathBelongsTo(path, INST, OTRO_PAC), false);
  // Sin instituto o sin paciente NUNCA pertenece: un "" que se cuele no
  // puede convertirse en "cualquiera".
  assert.equal(eduPhotoPathBelongsTo(path, "", PAC), false);
  assert.equal(eduPhotoPathBelongsTo(path, INST, ""), false);
});

test("`../` y los caracteres raros no pasan el saneo del path", () => {
  assert.equal(eduPhotoPathIsSafe("inst_1/fotos/pac_1/../../otra/x.jpg"), false);
  assert.equal(eduPhotoPathIsSafe("inst_1/fotos/pac_1/x y.jpg"), false);
  assert.equal(eduPhotoPathIsSafe("inst_1/fotos/pac_1/x'.jpg"), false);
  assert.equal(eduPhotoPathIsSafe(""), false);
  assert.equal(eduPhotoPathIsSafe("a".repeat(401)), false);
  assert.equal(eduPhotoPathIsSafe("inst_1/fotos/pac_1/u-frontal.jpg"), true);
  // Y un `..` escondido tampoco pertenece a la carpeta, aunque el prefijo
  // coincida.
  assert.equal(eduPhotoPathBelongsTo("inst_1/fotos/pac_1/../pac_2/x.jpg", INST, PAC), false);
});

test("el nombre del archivo se sanea y se le pone la extensión del binario GUARDADO", () => {
  // El binario que se sube es el COMPRIMIDO: un ".heic" en el path de un
  // JPEG es una mentira que el visor acaba creyéndose.
  assert.equal(eduSafePhotoFileName("IMG_4821.HEIC", "jpg"), "img_4821.jpg");
  assert.equal(eduSafePhotoFileName("mi foto ñ.png", "jpg"), "mi_foto_.jpg");
  assert.equal(eduSafePhotoFileName("", "jpg"), "foto.jpg");
  assert.equal(eduSafePhotoFileName("///", "jpg"), "foto.jpg");
  assert.equal(eduSafePhotoFileName(null, "webp"), "foto.webp");
  // Y lo que sale SIEMPRE cabe en un path seguro.
  for (const raw of ["../../etc/passwd", "a'b\"c;.jpg", "  .  ", "ñ".repeat(200)]) {
    const path = eduPhotoStoragePath(INST, PAC, "u1", eduSafePhotoFileName(raw, "jpg"));
    assert.equal(eduPhotoPathIsSafe(path), true, `path inseguro con ${raw}`);
    assert.equal(eduPhotoPathBelongsTo(path, INST, PAC), true, `se escapó con ${raw}`);
  }
});

test("cada MIME aceptado tiene su extensión, y lo desconocido cae a jpg", () => {
  assert.equal(eduPhotoExtForMime("image/jpeg"), "jpg");
  assert.equal(eduPhotoExtForMime("image/png"), "png");
  assert.equal(eduPhotoExtForMime("image/webp"), "webp");
  assert.equal(eduPhotoExtForMime("image/heic"), "heic");
  assert.equal(eduPhotoExtForMime("image/heif"), "heif");
  assert.equal(eduPhotoExtForMime("lo que sea"), "jpg");
});

// ─────────────────────────────────────────────────────────────────────
// 4 · LA GALERÍA Y EL COMPARADOR
// ─────────────────────────────────────────────────────────────────────

function foto(id: string, stage: EduPhotoStage, capturedAt: string): EduPhotoRow {
  return {
    id,
    photoType: "FRONTAL",
    stage,
    capturedAt,
    capturedLabel: "",
    mime: "image/jpeg",
    sizeBytes: 1000,
    sizeLabel: "1000 B",
    width: null,
    height: null,
    notes: null,
    caseId: null,
    caseProgramName: null,
    uploadedById: "u1",
    uploadedByName: "Alumna",
    createdAt: capturedAt,
    url: "",
    thumbUrl: "",
  };
}

test("la galería devuelve SIEMPRE los cuatro grupos, incluidos los vacíos", () => {
  // Esconder el grupo "Antes" cuando está vacío es no decirle a nadie que
  // falta el antes, que es justo lo que hay que ver.
  const grupos = eduAgruparFotosPorEtapa([foto("a", "POST", "2026-03-01T00:00:00Z")]);
  assert.equal(grupos.length, 4);
  assert.deepEqual(
    grupos.map((g) => g.stage),
    ["PRE", "DURANTE", "POST", "CONTROL"],
  );
  assert.equal(grupos[0].rows.length, 0);
  assert.equal(grupos[2].rows.length, 1);
});

test("dentro de cada grupo van de la más antigua a la más reciente", () => {
  const grupos = eduAgruparFotosPorEtapa([
    foto("nueva", "PRE", "2026-05-01T00:00:00Z"),
    foto("vieja", "PRE", "2026-01-01T00:00:00Z"),
  ]);
  assert.deepEqual(
    grupos[0].rows.map((r) => r.id),
    ["vieja", "nueva"],
  );
});

test("🔴 el par A/B es el MISMO que propone el comparador del dental", () => {
  // A = la primera PRE · B = la última POST o CONTROL.
  const rows = [
    foto("pre1", "PRE", "2026-01-01T00:00:00Z"),
    foto("pre2", "PRE", "2026-01-15T00:00:00Z"),
    foto("dur", "DURANTE", "2026-02-01T00:00:00Z"),
    foto("post", "POST", "2026-03-01T00:00:00Z"),
    foto("ctrl", "CONTROL", "2026-06-01T00:00:00Z"),
  ];
  const par = eduParFotosComparador(rows);
  assert.equal(par.a?.id, "pre1");
  assert.equal(par.b?.id, "ctrl");
  assert.equal(eduPuedeCompararFotos(rows), true);
});

test("sin PRE, A es la más antigua; sin POST ni CONTROL, B es la más reciente", () => {
  const rows = [
    foto("b", "DURANTE", "2026-02-01T00:00:00Z"),
    foto("a", "DURANTE", "2026-01-01T00:00:00Z"),
  ];
  const par = eduParFotosComparador(rows);
  assert.equal(par.a?.id, "a");
  assert.equal(par.b?.id, "b");
});

test("🔴 una sola foto CONTROL no se compara consigo misma", () => {
  // Sin el descarte `p.id !== a.id`, el deslizador no movería nada y eso
  // se ve exactamente igual que un bug.
  const rows = [foto("solo", "CONTROL", "2026-03-01T00:00:00Z")];
  const par = eduParFotosComparador(rows);
  assert.equal(par.a?.id, "solo");
  assert.equal(par.b?.id, "solo");
  // Y la pantalla puede DECIR que hace falta otra foto en vez de caerse.
  assert.equal(eduPuedeCompararFotos(rows), false);
});

test("sin fotos, el par son dos nulls y nadie revienta", () => {
  const par = eduParFotosComparador([]);
  assert.equal(par.a, null);
  assert.equal(par.b, null);
  assert.equal(eduPuedeCompararFotos([]), false);
  assert.deepEqual(eduContarFotosPorEtapa([]), { PRE: 0, DURANTE: 0, POST: 0, CONTROL: 0 });
});

test("el orden es ESTABLE con fechas empatadas (si no, el par baila solo)", () => {
  const mismos = "2026-04-01T00:00:00Z";
  const a = eduParFotosComparador([
    foto("z", "PRE", mismos),
    foto("a", "PRE", mismos),
    foto("p", "POST", "2026-05-01T00:00:00Z"),
  ]);
  const b = eduParFotosComparador([
    foto("a", "PRE", mismos),
    foto("z", "PRE", mismos),
    foto("p", "POST", "2026-05-01T00:00:00Z"),
  ]);
  assert.equal(a.a?.id, b.a?.id);
  assert.equal(a.a?.id, "a");
});

test("las píldoras cuentan por etapa", () => {
  const rows = [
    foto("1", "PRE", "2026-01-01T00:00:00Z"),
    foto("2", "PRE", "2026-01-02T00:00:00Z"),
    foto("3", "POST", "2026-02-01T00:00:00Z"),
  ];
  assert.deepEqual(eduContarFotosPorEtapa(rows), { PRE: 2, DURANTE: 0, POST: 1, CONTROL: 0 });
});

test("el techo de la galería se lee MAX + 1 para poder DECIR que se cortó", () => {
  assert.equal(EDU_PHOTO_MAX_ROWS, 200);
  const server = sinComentarios(crudo("src", "lib", "edu", "fotos.ts"));
  assert.match(server, /take: EDU_PHOTO_MAX_ROWS \+ 1/);
  assert.match(server, /truncated/);
});

// ─────────────────────────────────────────────────────────────────────
// 5 · 🔴 EL ORDEN DE LA SUBIDA — lo que no se puede probar sin base,
//     se prueba leyendo el archivo (igual que edu-auditoria.test.ts).
// ─────────────────────────────────────────────────────────────────────

const SERVER = sinComentarios(crudo("src", "lib", "edu", "fotos.ts"));

test("🔴 el MIME se comprueba por NÚMERO MÁGICO y no por lo que declare el navegador", () => {
  // `file.type` lo elige el cliente: un .exe renombrado a .jpg lo declara
  // como quiera.
  assert.match(SERVER, /validateMagicNumber\(bytes, \[\.\.\.EDU_PHOTO_MIME\]\)/);
  // Y se reusa el helper compartido del repo, no una copia.
  assert.match(SERVER, /from "@\/lib\/validate-upload"/);
});

test("🔴 la CUOTA se comprueba ANTES de escribir un byte en el bucket", () => {
  const iCuota = SERVER.indexOf("eduAlmCabe(medidor, bytes.length)");
  const iSubida = SERVER.indexOf("await eduStorageUpload(path, comprimida.body");
  assert.ok(iCuota > 0, "no está el corte de cuota en fotos.ts");
  assert.ok(iSubida > 0, "no está la subida al bucket");
  assert.ok(iCuota < iSubida, "la cuota se comprueba DESPUÉS de subir: eso ya gastó el espacio");
  // 507 y no 413: la foto no es grande, la escuela no tiene sitio.
  assert.match(SERVER, /eduAlmRechazo\(medidor, bytes\.length\),\s*507/);
});

test("🔴 el número mágico va ANTES que la cuota y que la compresión", () => {
  const iMagico = SERVER.indexOf("validateMagicNumber");
  const iCuota = SERVER.indexOf("getEduAlmacenamientoMedidor(institutionId)");
  const iSharp = SERVER.indexOf("comprimirFoto(bytes");
  assert.ok(iMagico > 0 && iCuota > iMagico, "la cuota se consulta antes de saber si es una imagen");
  assert.ok(iSharp > iMagico, "se comprime antes de saber si es una imagen");
});

test("🔴 la FILA se crea DESPUÉS de subir el binario", () => {
  const iSubida = SERVER.indexOf("await eduStorageUpload(path, comprimida.body");
  const iFila = SERVER.indexOf("prisma.eduClinicalPhoto.create");
  assert.ok(iFila > iSubida, "la fila se crea antes de subir: un fallo dejaría una foto fantasma");
});

test("🔴 el PATH lo compone el servidor con el institutionId de la SESIÓN", () => {
  assert.match(SERVER, /requireInstitution\(ctx\)/);
  assert.match(SERVER, /randomUUID\(\)/);
  assert.match(SERVER, /eduPhotoStoragePath\(\s*institutionId,\s*pid,\s*uuid,/);
  // El cliente NUNCA propone un path: si lo hiciera, bastaría con teclear
  // el de otra escuela para escribir en su carpeta.
  assert.equal(/input\??\.path/.test(SERVER), false);
});

test("🔴 el alcance es el CLÍNICO en las cuatro puertas, y caja no ve fotos", () => {
  assert.match(SERVER, /eduClinicalScope\(ctx\)/);
  assert.match(SERVER, /eduPatientScopeWhere\(\{ institutionId, scope, now \}\)/);
  // Y el caso al que se engancha una foto también pasa por el alcance: no
  // se puede colgar de un caso que quien sube no puede ver.
  assert.match(SERVER, /eduCaseScopeWhere\(\{ institutionId, scope, now \}\)/);
});

test("🔴 el listado esconde las dadas de baja EN EL `where`, no con un filter", () => {
  // Un recorte que vive fuera de la consulta es un recorte que el
  // siguiente findMany se olvida de copiar.
  const i = SERVER.indexOf("export async function listEduPatientPhotos");
  const j = SERVER.indexOf("export interface EduPhotoForViewer");
  assert.ok(i > 0 && j > i);
  const cuerpo = SERVER.slice(i, j);
  assert.match(cuerpo, /deletedAt: null/);
});

test("🔴 dar de baja EXIGE motivo y NO borra el binario", () => {
  const i = SERVER.indexOf("export async function softDeleteEduPatientPhoto");
  assert.ok(i > 0);
  const cuerpo = SERVER.slice(i);
  // Los tres campos van juntos: fecha, autor y motivo.
  assert.match(cuerpo, /deletedAt: now, deletedById: ctx\.eduUserId, deleteReason: reason/);
  // Sin motivo, 400 con palabras.
  assert.match(cuerpo, /if \(!reason\)/);
  // Y nada de destruir evidencia clínica.
  assert.equal(/eduStorageRemove/.test(cuerpo), false);
});

test("dar de baja dos veces contesta 'ya estaba', no 'no existe'", () => {
  // Un 404 le haría creer a alguien que perdió una foto.
  assert.match(SERVER, /ya estaba dada de baja/);
});

test("una foto dada de baja ya no se corrige ni se firma su URL", () => {
  const iPatch = SERVER.indexOf("export async function updateEduPatientPhoto");
  assert.ok(iPatch > 0);
  assert.match(SERVER.slice(iPatch), /foto\.deletedAt/);
  const iUrl = SERVER.indexOf("export async function getEduPhotoSignedUrl");
  const iUpload = SERVER.indexOf("export interface EduPhotoUploadInput");
  assert.ok(iUrl > 0 && iUpload > iUrl);
  assert.match(SERVER.slice(iUrl, iUpload), /410/);
});

// ─────────────────────────────────────────────────────────────────────
// 6 · 🔴 LA CUOTA — las fotos suman, y las dadas de baja no
// ─────────────────────────────────────────────────────────────────────

test("el `where` de las fotos lleva UNA llave más: deletedAt null", () => {
  assert.deepEqual(eduAlmacenamientoFotosWhere(INST), { institutionId: INST, deletedAt: null });
  // Y el de los estudios sigue teniendo solo la del instituto: la cuota es
  // por INSTITUTO y las sedes no la dividen.
  assert.deepEqual(eduAlmacenamientoWhere(INST), { institutionId: INST });
});

test("🔴 un institutionId vacío revienta en vez de sumar el consumo del vecino", () => {
  // En Prisma, `where: { institutionId: undefined }` NO devuelve cero
  // filas: BORRA el filtro y devuelve las de TODAS las escuelas.
  assert.throws(() => eduAlmacenamientoFotosWhere(""), /institutionId/);
  assert.throws(
    () => eduAlmacenamientoFotosWhere(undefined as unknown as string),
    /institutionId/,
  );
});

test("🔴 la cuota suma las DOS tablas en la MISMA bolsa", () => {
  const server = sinComentarios(crudo("src", "lib", "edu", "almacenamiento.ts"));
  assert.match(server, /prisma\.eduStudy\.aggregate/);
  assert.match(server, /prisma\.eduClinicalPhoto\.aggregate/);
  // El de fotos usa el `where` del punto único, con su deletedAt dentro.
  assert.match(server, /eduAlmacenamientoFotosWhere\(institutionId\)/);
  // Y el /admin cuenta lo mismo que el panel de dirección.
  assert.match(server, /prisma\.eduClinicalPhoto\.groupBy/);
});

test("una foto que no cabe en lo que le queda a la escuela se rechaza", () => {
  const medidor = { usadoBytes: 0, cuotaBytes: 10 * 1024 * 1024, estudios: 0, fotos: 0 };
  assert.equal(eduAlmCabe(medidor, 5 * 1024 * 1024), true);
  assert.equal(eduAlmCabe(medidor, 20 * 1024 * 1024), false);
});

test("el medidor CONFIESA que ahora cuenta también las fotos", () => {
  const core = crudo("src", "lib", "edu", "almacenamiento-core.ts");
  assert.match(core, /FOTOS\s+CLÍNICAS|FOTOS/);
  // Y sigue diciendo que las firmas de consentimiento no entran: no se
  // estiman bytes.
  assert.match(core, /no inventa bytes/);
});

// ─────────────────────────────────────────────────────────────────────
// 7 · 🔴 NADA DEL DENTAL — el vertical no importa ni una línea
// ─────────────────────────────────────────────────────────────────────

const PROPIOS = [
  ["src", "lib", "edu", "fotos-core.ts"],
  ["src", "lib", "edu", "fotos.ts"],
  ["src", "app", "api", "instituto", "pacientes", "[id]", "fotos", "route.ts"],
  ["src", "app", "api", "instituto", "pacientes", "[id]", "fotos", "[fotoId]", "route.ts"],
  ["src", "app", "api", "instituto", "pacientes", "[id]", "fotos", "[fotoId]", "url", "route.ts"],
];

test("🔴 cero imports de clinical-shared, de app/actions y de components/dashboard", () => {
  // Rafael lo pidió con todas sus letras: si el dental cambia, el
  // instituto NO cambia. Se MIRÓ `ClinicalPhoto` para no olvidar nada y no
  // se importa ni una línea.
  for (const tramos of PROPIOS) {
    const src = crudo(...tramos);
    const ruta = tramos.join("/");
    assert.equal(/@\/lib\/clinical-shared/.test(src), false, `${ruta} importa clinical-shared`);
    assert.equal(/@\/app\/actions/.test(src), false, `${ruta} importa app/actions`);
    assert.equal(/@\/components\/dashboard/.test(src), false, `${ruta} importa components/dashboard`);
    assert.equal(/from "@\/lib\/storage"/.test(src), false, `${ruta} usa el bucket del dental`);
  }
});

test("🔴 el bucket es `edu-files` y se llega a él por el helper del vertical", () => {
  const server = crudo("src", "lib", "edu", "fotos.ts");
  assert.match(server, /from "@\/lib\/edu\/storage"/);
  // Nunca se guarda una URL en la base: caduca. Se firma al leer.
  assert.match(sinComentarios(server), /eduSignRead/);
  assert.equal(/blobUrl|thumbnailUrl/.test(server), false);
});

// ─────────────────────────────────────────────────────────────────────
// 8 · LOS ENDPOINTS — permiso, y ninguna key nueva
// ─────────────────────────────────────────────────────────────────────

test("las tres rutas pasan por el guard, con los permisos que YA existen", () => {
  const lista = crudo("src", "app", "api", "instituto", "pacientes", "[id]", "fotos", "route.ts");
  const detalle = crudo(
    "src", "app", "api", "instituto", "pacientes", "[id]", "fotos", "[fotoId]", "route.ts",
  );
  const url = crudo(
    "src", "app", "api", "instituto", "pacientes", "[id]", "fotos", "[fotoId]", "url", "route.ts",
  );

  assert.match(lista, /eduApiGuard\("estudios\.view"\)/);
  assert.match(lista, /eduApiGuard\("estudios\.upload"\)/);
  // Corregir la etapa cambia lo que enseña el comparador: es escritura.
  assert.match(detalle, /eduApiGuard\("estudios\.upload"\)/);
  assert.match(url, /eduApiGuard\("estudios\.view"\)/);

  // 🔴 NINGUNA key nueva: `permissions.ts` no se toca en esta casilla.
  for (const src of [lista, detalle, url]) {
    assert.equal(/["']fotos\./.test(src), false, "se coló una key de permiso fotos.*");
  }
});

test("las tres rutas son force-dynamic: sirven URL que caducan", () => {
  for (const tramos of PROPIOS.slice(2)) {
    const src = crudo(...tramos);
    assert.match(src, /export const dynamic = "force-dynamic"/, tramos.join("/"));
    // Y nodejs, no edge: sharp es un módulo nativo.
    assert.match(src, /export const runtime = "nodejs"/, tramos.join("/"));
  }
});

test("la subida corta por tamaño ANTES de leer el arrayBuffer", () => {
  // Cargar 500 MB en memoria para después decir que no caben es la forma
  // más cara de rechazar algo.
  const lista = sinComentarios(
    crudo("src", "app", "api", "instituto", "pacientes", "[id]", "fotos", "route.ts"),
  );
  const iTope = lista.indexOf("file.size > EDU_MAX_PHOTO_BYTES");
  const iLeer = lista.indexOf("await file.arrayBuffer()");
  assert.ok(iTope > 0 && iLeer > iTope, "se lee el binario antes de comprobar el tope");
});

// ─────────────────────────────────────────────────────────────────────
// 9 · EL .SQL DICE LO MISMO QUE EL ESQUEMA
// ─────────────────────────────────────────────────────────────────────

const SQL = crudo("sql", "edu-ola-b.sql");
const SCHEMA = crudo("prisma", "schema.prisma");

/**
 * El SQL sin sus comentarios `--`. Las tres pruebas de abajo buscan
 * palabras peligrosas (DROP, RENAME, `$$`) y el encabezado del archivo las
 * NOMBRA para explicar que no se usan: sin esto, la única forma de pasar
 * sería no documentar la regla.
 */
const SQL_SIN_COMENTARIOS = SQL.replace(/^\s*--.*$/gm, " ");

test("el .sql crea la tabla, sus tres índices y sus cinco llaves foráneas", () => {
  assert.match(SQL, /CREATE TABLE IF NOT EXISTS "edu_clinical_photos"/);
  assert.match(SQL, /"edu_clinical_photos_patient_idx"/);
  assert.match(SQL, /"edu_clinical_photos_etapa_idx"/);
  assert.match(SQL, /CREATE UNIQUE INDEX IF NOT EXISTS "edu_clinical_photos_path_key"/);
  for (const fk of ["institutionId", "patientId", "caseId", "uploadedById", "deletedById"]) {
    assert.match(SQL, new RegExp(`"edu_clinical_photos_${fk}_fkey"`), fk);
  }
});

test("🔴 el .sql es IDEMPOTENTE: nada se crea sin comprobar antes", () => {
  // Correrlo dos veces no puede fallar: cada CREATE lleva su IF NOT
  // EXISTS y cada enum y cada FK van dentro de su DO $edu$ … EXCEPTION.
  for (const m of SQL.match(/^CREATE TABLE .*/gm) ?? []) {
    assert.match(m, /IF NOT EXISTS/, m);
  }
  for (const m of SQL.match(/^CREATE (UNIQUE )?INDEX .*/gm) ?? []) {
    assert.match(m, /IF NOT EXISTS/, m);
  }
  for (const m of SQL.match(/^ {2}ADD COLUMN.*/gm) ?? []) {
    assert.match(m, /IF NOT EXISTS/, m);
  }
  const creaTipos = SQL_SIN_COMENTARIOS.match(/CREATE TYPE /g) ?? [];
  const bloques =
    SQL_SIN_COMENTARIOS.match(/EXCEPTION\s+WHEN duplicate_object THEN NULL;/g) ?? [];
  assert.equal(creaTipos.length, 5, "tienen que ser cinco enums");
  // Cinco enums + nueve llaves foráneas, cada uno con su bloque.
  assert.equal(bloques.length, 14);
  // Y el delimitador con nombre, nunca $$ pelado (el parser de Supabase
  // rompe con $$ anidado).
  assert.equal(/\$\$/.test(SQL_SIN_COMENTARIOS), false);
  assert.match(SQL_SIN_COMENTARIOS, /\$edu\$/);
});

test("⛔ el .sql SOLO AÑADE: ni un DROP de tabla, columna o índice", () => {
  // Lo único que se permite es el DROP POLICY que ya trae la ola 3 para
  // el bucket, y aquí ni eso: este archivo no toca policies.
  assert.equal(
    /DROP TABLE|DROP COLUMN|DROP INDEX|DROP TYPE|TRUNCATE|DELETE FROM/i.test(SQL_SIN_COMENTARIOS),
    false,
  );
  // Ni renombra ni cambia tipos.
  assert.equal(/RENAME|ALTER COLUMN/i.test(SQL_SIN_COMENTARIOS), false);
  // La ÚNICA escritura de datos es el backfill de una columna que acaba de
  // nacer, y solo donde está vacía.
  const updates = SQL_SIN_COMENTARIOS.match(/^UPDATE /gm) ?? [];
  assert.equal(updates.length, 2, "solo el backfill del odontograma y los MIME del bucket");
});

test("las columnas nuevas de las cuatro tablas están en el .sql Y en el esquema", () => {
  const columnas: Array<[string, string]> = [
    ["edu_studies", "deletedAt"],
    ["edu_studies", "deletedById"],
    ["edu_studies", "deleteReason"],
    ["edu_studies", "takenAt"],
    ["edu_studies", "annotations"],
    ["edu_odontogram_entries", "deletedAt"],
    ["edu_odontogram_entries", "deletedById"],
    ["edu_odontogram_entries", "firstRecordedAt"],
    ["edu_records", "deletedAt"],
    ["edu_records", "deletedById"],
  ];
  for (const [, col] of columnas) {
    assert.match(SQL, new RegExp(`ADD COLUMN IF NOT EXISTS "${col}"`), col);
  }
  assert.match(SCHEMA, /firstRecordedAt DateTime\? @db\.Timestamptz\(3\)/);
});

test("las 23 columnas nuevas del paciente están en el .sql Y en el esquema", () => {
  const columnas = [
    "addressStreet", "addressNeighborhood", "addressCity", "addressState", "addressZip",
    "guardianName", "guardianRelation", "guardianPhone",
    "insuranceProvider", "insurancePolicy",
    "phone2", "curp",
    "familyHistory", "personalNonPathologicalHistory",
    "habitsTobacco", "habitsAlcohol", "habitsBruxism", "habitsNotes",
    "pregnancy", "isChild", "privacyNoticeAcceptedAt", "contactPreference", "updatedById",
  ];
  assert.equal(columnas.length, 23);
  for (const col of columnas) {
    assert.match(SQL, new RegExp(`ADD COLUMN IF NOT EXISTS "${col}"`), `.sql: ${col}`);
    assert.match(SCHEMA, new RegExp(`\\b${col}\\b`), `schema: ${col}`);
  }
});

test("🔴 TODO lo nuevo es nullable o trae default (el código ya desplegado compila igual)", () => {
  // La única columna nueva NOT NULL de una tabla que YA EXISTÍA es
  // `isChild`, y trae DEFAULT false — que hace de backfill.
  const nuevas = SQL.match(/ADD COLUMN IF NOT EXISTS "[^"]+"[^,;]*/g) ?? [];
  assert.ok(nuevas.length >= 33);
  for (const linea of nuevas) {
    if (/NOT NULL/.test(linea)) {
      assert.match(linea, /DEFAULT/, `columna nueva NOT NULL sin default: ${linea}`);
    }
  }
});

test("el .sql y el esquema dicen la misma tabla y el mismo bucket", () => {
  assert.match(SCHEMA, /@@map\("edu_clinical_photos"\)/);
  assert.match(SCHEMA, /model EduClinicalPhoto \{/);
  // El bucket es el del vertical, y la ola solo le AGREGA dos MIME.
  assert.match(SQL, /storage\.buckets/);
  assert.match(SQL, /'image\/heic', 'image\/heif'/);
  assert.match(SQL, /WHERE id = 'edu-files'/);
});

test("el backfill de firstRecordedAt es idempotente (solo toca lo que está en NULL)", () => {
  assert.match(SQL, /SET "firstRecordedAt" = "createdAt"\s*\n\s*WHERE "firstRecordedAt" IS NULL;/);
});
