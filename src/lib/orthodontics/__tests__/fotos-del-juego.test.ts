/**
 * Ortodoncia — quitar foto y fotos extra (ws1-t12): reglas puras, el SQL y la
 * forma del código que no se puede probar sin navegador.
 *
 * Run: npm run test:orto-fotos-juego
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ETIQUETA_MAX,
  EXTRAS_MAX_POR_JUEGO,
  MOTIVO_MAX,
  SLOT_A_VISTA,
  columnaDeVista,
  faltaLaColumnaDeFotos,
  faltaLaTablaDeFotos,
  SLOTS_EN_EXTRAS,
  esVistaEnExtras,
  limpiarEtiqueta,
  limpiarMotivo,
  nombreDeExtra,
} from "../fotos-del-juego";

const RAIZ = join(__dirname, "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");

test("cada una de las 8 vistas guardables tiene su columna; las otras 2 y lo raro, ninguna", () => {
  const esperado: Record<string, string> = {
    normal: "photoFrontalId",
    lateral: "photoProfileId",
    sonrisa: "photoSmileId",
    frontal: "photoIntraFrontalId",
    lat_der: "photoIntraLateralRId",
    lat_izq: "photoIntraLateralLId",
    oclusal_sup: "photoOcclusalUpperId",
    oclusal_inf: "photoOcclusalLowerId",
  };
  assert.equal(Object.keys(SLOT_A_VISTA).length, 8);
  for (const [slot, col] of Object.entries(esperado)) assert.equal(columnaDeVista(slot), col, slot);
  for (const raro of ["sobremordida", "resalte", "", "photoFrontalId", "__proto__", "constructor", "toString"]) {
    assert.equal(columnaDeVista(raro), null, raro);
  }
});

test("motivo y etiqueta: texto de una línea, recortado, y vacío → null", () => {
  assert.equal(limpiarMotivo("  no era \n el   paciente "), "no era el paciente");
  assert.equal(limpiarMotivo(""), null);
  assert.equal(limpiarMotivo("   \n "), null);
  assert.equal(limpiarMotivo(undefined), null);
  assert.equal(limpiarMotivo(42), null);
  assert.equal(limpiarMotivo("x".repeat(MOTIVO_MAX + 50))!.length, MOTIVO_MAX);
  assert.equal(limpiarEtiqueta("y".repeat(ETIQUETA_MAX + 10))!.length, ETIQUETA_MAX);
  assert.equal(limpiarEtiqueta(" Frenillo "), "Frenillo");
});

test("nombre de una extra: su etiqueta o «Extra N»", () => {
  assert.equal(nombreDeExtra("Frenillo", 0), "Frenillo");
  assert.equal(nombreDeExtra(null, 0), "Extra 1");
  assert.equal(nombreDeExtra("  ", 2), "Extra 3");
  assert.ok(EXTRAS_MAX_POR_JUEGO >= 10);
});

test("tabla que falta: reconoce el error de Postgres/Prisma y nada más", () => {
  assert.equal(faltaLaTablaDeFotos({ code: "P2010", meta: { code: "42P01" } }), true);
  assert.equal(faltaLaTablaDeFotos({ code: "42P01" }), true);
  assert.equal(faltaLaTablaDeFotos(new Error('relation "ortho_photo_extras" does not exist')), true);
  assert.equal(faltaLaTablaDeFotos(new Error("timeout")), false);
  assert.equal(faltaLaTablaDeFotos(null), false);
});

test("el SQL es plano, aditivo e idempotente: no borra ni altera nada existente", () => {
  const sql = leer("sql/ortodoncia-fotos-quitadas-y-extra.sql")
    .replace(/--.*$/gm, "")
    .replace(/ON (UPDATE|DELETE) CASCADE/g, "");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "ortho_photo_removals"/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "ortho_photo_extras"/);
  // Quién, cuándo y por qué, en las dos.
  for (const col of ['"removedById"', '"removedAt"', '"reason"', '"removedReason"']) assert.ok(sql.includes(col), col);
  assert.equal((sql.match(/CREATE INDEX/g) ?? []).length, (sql.match(/CREATE INDEX IF NOT EXISTS/g) ?? []).length);
  assert.doesNotMatch(sql, /\b(DROP|DELETE|TRUNCATE|UPDATE)\b/i);
  assert.doesNotMatch(sql, /DO\s+\$\$/);
  assert.doesNotMatch(sql, /ALTER TABLE "(?!ortho_photo_(removals|extras)")/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
});

test("las acciones: 'use server' solo exporta async, todo por la clínica de la sesión y nada se borra", () => {
  const src = leer("src/app/actions/orthodontics/fotosDelJuego.ts");
  assert.match(src, /^"use server";/);
  const exportados = [...src.matchAll(/^export (\w+)/gm)].map((m) => m[1]);
  assert.deepEqual(exportados, ["async", "async", "async"]);
  assert.match(src, /clinicId: ctx\.clinicId/);
  assert.match(src, /canViewPatient\(/);
  assert.doesNotMatch(src, /clinicId:\s*(input|parsed)/);
  assert.doesNotMatch(src, /\.delete\(|\.deleteMany\(|DELETE FROM/i);
  assert.doesNotMatch(src, /patientFile\.(delete|update)/);
});

test("la subida ya no pisa el archivo de una foto quitada: cada subida lleva su propio nombre", () => {
  const ruta = leer("src/app/api/orthodontics/photos/upload/route.ts");
  assert.doesNotMatch(ruta, /\$\{set\.id\}-\$\{safeView\}`/);
  assert.match(ruta, /\$\{set\.id\}-\$\{safeView\}-\$\{unico\}/);
});

test("el cargador trae las extras por clínica y las firma en la misma tanda que las vistas", () => {
  const loader = leer("src/lib/orthodontics/redesign/loader.ts");
  assert.match(loader, /cargarExtrasDeJuegos\(\s*clinicId,/);
  assert.match(loader, /allUrls\.push\(e\.fileUrl\)/);
  const db = leer("src/lib/orthodontics/fotos-del-juego-db.ts");
  assert.match(db, /if \(!clinicId \|\| setIds\.length === 0\) return/);
  assert.match(db, /e\."clinicId" = \$\{clinicId\}/);
  assert.match(db, /e\."removedAt" IS NULL/);
  assert.match(db, /catch \(e\)/, "sin la tabla la ficha se pinta igual");
});

test("pantalla: «Quitar foto» con confirmación y motivo en cada vista, y «Agregar fotos extra» después de las 10", () => {
  const ui = leer("src/components/specialties/orthodontics/redesign/sections/SectionPhotos.tsx");
  // Confirmación con motivo opcional, accesible.
  assert.match(ui, /role="alertdialog"/);
  assert.match(ui, /Motivo \(opcional\)/);
  assert.match(ui, /maxLength=\{MOTIVO_MAX\}/);
  // «Quitar foto» en la vista, en el visor y en las extras.
  const slot = ui.slice(ui.indexOf("function PhotoSlot("), ui.indexOf("function PhotoLightbox("));
  assert.match(slot, /Quitar foto/);
  const visor = ui.slice(ui.indexOf("function PhotoLightbox("), ui.indexOf("function HistoricalSetCard"));
  assert.match(visor, /Quitar foto/);
  // Extras: varias a la vez, con nombre opcional, en el juego y en «Ver juego completo».
  const extras = ui.slice(ui.indexOf("function FotosExtra("));
  assert.match(extras, /multiple/);
  assert.match(extras, /Nombre \(opcional\)/);
  assert.match(extras, /Agregar fotos extra/);
  assert.match(extras, /Quitar foto/);
  assert.equal((ui.match(/<FotosExtra/g) ?? []).length, 2, "en la rejilla y en el juego completo");
  // Después de la última vista (las intraorales, que terminan en Oclusal superior) y antes de los juegos por etapa.
  const iIntra = ui.indexOf('title="Intraorales · 7 vistas"');
  const iExtra = ui.indexOf("<FotosExtra");
  const iJuegos = ui.indexOf("Juegos de fotos por etapa");
  assert.ok(iIntra > 0 && iIntra < iExtra && iExtra < iJuegos);
  // La última vista del catálogo es Oclusal superior.
  const catalogo = leer("src/components/specialties/orthodontics/redesign/sections/PhotoSlotIcon.tsx");
  const ids = [...catalogo.matchAll(/^\s*\{ id: "(\w+)", label: "[^"]+", group:/gm)].map((m) => m[1]);
  assert.equal(ids.at(-1), "oclusal_sup");
});

test("las 10 vistas se guardan: 8 en su columna y sobremordida/resalte en la tabla de extras, sin solaparse", () => {
  const catalogo = leer("src/components/specialties/orthodontics/redesign/sections/PhotoSlotIcon.tsx");
  const ids = [...catalogo.matchAll(/^\s*\{ id: "(\w+)", label: "[^"]+", group:/gm)].map((m) => m[1]!);
  assert.equal(ids.length, 10);
  for (const id of ids) {
    // Cada vista tiene exactamente un destino.
    assert.equal(Number(columnaDeVista(id) !== null) + Number(esVistaEnExtras(id)), 1, id);
  }
  assert.deepEqual([...SLOTS_EN_EXTRAS].sort(), ["resalte", "sobremordida"]);
  for (const raro of ["", "normal", "constructor", "__proto__", null, undefined, 3]) assert.equal(esVistaEnExtras(raro), false);
});

test("columna que falta (segundo SQL sin pegar): se reconoce el 42703 y nada más", () => {
  assert.equal(faltaLaColumnaDeFotos({ code: "P2010", meta: { code: "42703" } }), true);
  assert.equal(faltaLaColumnaDeFotos(new Error('column e."slotId" does not exist')), true);
  assert.equal(faltaLaColumnaDeFotos(new Error("timeout")), false);
  assert.equal(faltaLaColumnaDeFotos(null), false);
});

test("el segundo SQL es aditivo e idempotente y solo toca ortho_photo_extras", () => {
  const sql = leer("sql/ortodoncia-fotos-sobremordida-resalte.sql")
    .replace(/--.*$/gm, "");
  assert.match(sql, /ALTER TABLE IF EXISTS "ortho_photo_extras" ADD COLUMN IF NOT EXISTS "slotId" text/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS/);
  assert.match(sql, /WHERE "slotId" IS NOT NULL AND "removedAt" IS NULL/);
  assert.doesNotMatch(sql, /\b(DROP|DELETE|TRUNCATE|UPDATE|INSERT)\b/i);
  assert.doesNotMatch(sql, /DO\s+\$\$/);
  assert.doesNotMatch(sql, /ortho_photo_sets/, "no toca las columnas del juego");
  assert.equal((sql.match(/ALTER TABLE/g) ?? []).length, 1);
});

test("la lectura vuelve a poner la foto en su casilla y tolera que falte la columna", () => {
  const db = leer("src/lib/orthodontics/fotos-del-juego-db.ts");
  assert.match(db, /e\."slotId"/);
  assert.match(db, /faltaLaColumnaDeFotos\(e\)/, "sin la columna se leen las extras como antes");
  const loader = leer("src/lib/orthodontics/redesign/loader.ts");
  assert.match(loader, /esVistaEnExtras\(e\.slotId\)/);
  assert.match(loader, /slots\[e\.slotId\] = \{ url, uploadedAt: cuando \}/);
  // La foto de una vista NO se cuela en la lista de extras.
  assert.match(loader, /if \(e\.slotId && esVistaEnExtras\(e\.slotId\)\) \{[\s\S]*?continue;/);
});

test("la pestaña ya no rechaza sobremordida/resalte: sube y elige del expediente por la tabla de extras", () => {
  const tab = leer("src/components/specialties/orthodontics/redesign/OrthodonticsPatientTab.tsx");
  assert.equal((tab.match(/const enExtras = esVistaEnExtras\(slotId\);/g) ?? []).length, 2, "subir y elegir existente");
  // Las dos ligan por agregarFotoExtra; ahora con las banderas de una-accion.ts (una fila por foto).
  assert.equal((tab.match(/agregarFotoExtra\(\{ setId, fileId, slot: slotId, (parteDeUnaAccion: true|juegoNuevo) \}\)/g) ?? []).length, 2);
  assert.doesNotMatch(tab, /if \(!view\) \{/);
  const ui = leer("src/components/specialties/orthodontics/redesign/sections/SectionPhotos.tsx");
  assert.doesNotMatch(ui, /Aún no se guarda/);
  assert.doesNotMatch(ui, /sinColumna/);
});
