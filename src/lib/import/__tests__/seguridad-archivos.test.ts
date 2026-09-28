/**
 * ws1-t12 — seguridad de los archivos que sube el importador (pedido extra de
 * Rafael sobre esta tarea): solo .csv/.xlsx reales por CONTENIDO (no por
 * extensión), sin macros, sin archivos cifrados, protección contra bombas zip
 * en .xlsx (tamaño descomprimido / nº de entradas), nombres de archivo
 * saneados, y el neutralizador de inyección de fórmulas para si algún día se
 * reexporta un valor importado a un .csv/.xlsx descargable.
 *
 * Run: npx tsx --test src/lib/import/__tests__/seguridad-archivos.test.ts
 *
 * `validateSpreadsheet` recorre el ZIP de un .xlsx A MANO (sin exceljs, para
 * no descomprimir nada de lo que se está rechazando): los .xlsx "maliciosos"
 * de aquí se construyen con `construirZipFalso`, un escritor de ZIP mínimo
 * (método "stored", sin compresión) que permite MENTIR sobre el tamaño
 * descomprimido declarado — exactamente el campo que una bomba zip falsea.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSpreadsheet } from "../../validate-upload";
import { sanitizeUploadFileName, neutralizeFormulaPrefix } from "../spreadsheet-safety";

// ---------------------------------------------------------------------------
// Escritor de ZIP mínimo (sin compresión) para construir .xlsx "maliciosos".
// ---------------------------------------------------------------------------
function u16(n: number): Buffer { const b = Buffer.alloc(2); b.writeUInt16LE(n & 0xffff, 0); return b; }
function u32(n: number): Buffer { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b; }

interface EntradaFalsa {
  name: string;
  content: Buffer;
  /** Mentir sobre el tamaño descomprimido declarado (bomba zip). Por defecto, el real. */
  declaredUncompressed?: number;
}

function construirZipFalso(entradas: EntradaFalsa[]): ArrayBuffer {
  const locales: Buffer[] = [];
  const centrales: Buffer[] = [];
  let offset = 0;
  for (const e of entradas) {
    const nombre = Buffer.from(e.name, "utf8");
    const sinComprimir = e.declaredUncompressed ?? e.content.length;
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0x21),
      u32(0), u32(e.content.length), u32(sinComprimir),
      u16(nombre.length), u16(0),
      nombre, e.content,
    ]);
    locales.push(local);
    const central = Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0x21),
      u32(0), u32(e.content.length), u32(sinComprimir),
      u16(nombre.length), u16(0), u16(0), u16(0), u16(0), u32(0),
      u32(offset),
      nombre,
    ]);
    centrales.push(central);
    offset += local.length;
  }
  const cdStart = offset;
  const cd = Buffer.concat(centrales);
  const eocd = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(entradas.length), u16(entradas.length),
    u32(cd.length), u32(cdStart), u16(0),
  ]);
  const buf = Buffer.concat([...locales, cd, eocd]);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
}

function bytesDe(arr: number[]): ArrayBuffer {
  return Uint8Array.from(arr).buffer;
}

// ---------------------------------------------------------------------------

test("un .xlsx normal (una hoja, sin macros) pasa", async () => {
  const zip = construirZipFalso([
    { name: "[Content_Types].xml", content: Buffer.from("<Types/>") },
    { name: "xl/worksheets/sheet1.xml", content: Buffer.from("<worksheet/>") },
  ]);
  assert.equal(await validateSpreadsheet(zip, "xlsx"), null);
});

test("un .xlsx con xl/vbaProject.bin (macros) se rechaza aunque la extensión diga .xlsx", async () => {
  const zip = construirZipFalso([
    { name: "[Content_Types].xml", content: Buffer.from("<Types/>") },
    { name: "xl/vbaProject.bin", content: Buffer.from([0, 1, 2, 3]) },
  ]);
  const err = await validateSpreadsheet(zip, "xlsx");
  assert.match(err ?? "", /macro/i);
});

test("bomba zip: una entrada declara un tamaño descomprimido disparatado frente al real", async () => {
  const zip = construirZipFalso([
    { name: "xl/worksheets/sheet1.xml", content: Buffer.from("x".repeat(20)), declaredUncompressed: 200 * 1024 * 1024 },
  ]);
  const err = await validateSpreadsheet(zip, "xlsx");
  assert.match(err ?? "", /excesivo|bomba/i);
});

test("bomba zip: el TOTAL descomprimido de varias entradas «razonables» por separado excede el tope", async () => {
  const contenido = Buffer.alloc(1024 * 1024, 1); // 1 MB real por entrada
  const entradas: EntradaFalsa[] = [];
  for (let i = 0; i < 3; i++) {
    // Cada una: 1 MB real → 90 MB declarados (ratio 90, bajo el umbral de 200 por entrada),
    // pero las 3 juntas (270 MB) superan el tope agregado de 250 MB.
    entradas.push({ name: `xl/worksheets/sheet${i}.xml`, content: contenido, declaredUncompressed: 90 * 1024 * 1024 });
  }
  const zip = construirZipFalso(entradas);
  const err = await validateSpreadsheet(zip, "xlsx");
  assert.match(err ?? "", /descomprimido/i);
});

test("demasiadas entradas internas (bomba de muchos archivos diminutos)", async () => {
  const entradas: EntradaFalsa[] = [];
  for (let i = 0; i < 2001; i++) entradas.push({ name: `f${i}`, content: Buffer.from("x") });
  const zip = construirZipFalso(entradas);
  const err = await validateSpreadsheet(zip, "xlsx");
  assert.match(err ?? "", /entradas/i);
});

test("un .xlsx cifrado (contenedor OLE2/CFB) se rechaza con un mensaje propio, no como «.xlsx inválido» a secas", async () => {
  const cfb = bytesDe([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const err = await validateSpreadsheet(cfb, "xlsx");
  assert.match(err ?? "", /cifrad|contraseñ/i);
});

test("un ejecutable renombrado a .xlsx se rechaza (firma MZ)", async () => {
  const exe = bytesDe([0x4d, 0x5a, 0, 0, 0, 0, 0, 0]);
  const err = await validateSpreadsheet(exe, "xlsx");
  assert.match(err ?? "", /ejecutable/i);
});

test("un .xlsx sin firma ZIP (texto plano renombrado) se rechaza", async () => {
  const texto = bytesDe(Array.from(Buffer.from("nombre,telefono\nJuan,555\n")));
  const err = await validateSpreadsheet(texto, "xlsx");
  assert.ok(err);
});

test("un .csv de texto plano normal pasa", async () => {
  const csv = bytesDe(Array.from(Buffer.from("nombre,telefono\nJuan,555\n")));
  assert.equal(await validateSpreadsheet(csv, "csv"), null);
});

test("un ejecutable renombrado a .csv se rechaza", async () => {
  const exe = bytesDe([0x7f, 0x45, 0x4c, 0x46, 0, 0, 0, 0]);
  const err = await validateSpreadsheet(exe, "csv");
  assert.match(err ?? "", /ejecutable/i);
});

// ---------------------------------------------------------------------------
// Nombre de archivo saneado.
// ---------------------------------------------------------------------------

test("sanitizeUploadFileName: quita ruta, caracteres de control y recorta la longitud", () => {
  assert.equal(sanitizeUploadFileName("pacientes.csv"), "pacientes.csv");
  assert.equal(sanitizeUploadFileName("/etc/passwd"), "passwd");
  assert.equal(sanitizeUploadFileName("..\\..\\windows\\system32\\evil.csv"), "evil.csv");
  assert.equal(sanitizeUploadFileName("archivo\x00\x01.csv"), "archivo.csv");
  assert.equal(sanitizeUploadFileName(""), "archivo");
  assert.equal(sanitizeUploadFileName("a".repeat(300) + ".csv").length <= 180, true);
});

// ---------------------------------------------------------------------------
// Neutralización de inyección de fórmulas (para cuando se reexporte un valor importado).
// ---------------------------------------------------------------------------

test("neutralizeFormulaPrefix: antepone comilla a =, +, -, @ y deja lo demás igual", () => {
  assert.equal(neutralizeFormulaPrefix("=cmd|'/c calc'!A1"), "'=cmd|'/c calc'!A1");
  assert.equal(neutralizeFormulaPrefix("+1+1"), "'+1+1");
  assert.equal(neutralizeFormulaPrefix("-1"), "'-1");
  assert.equal(neutralizeFormulaPrefix("@SUM(1,1)"), "'@SUM(1,1)");
  assert.equal(neutralizeFormulaPrefix("Juan Pérez"), "Juan Pérez");
  assert.equal(neutralizeFormulaPrefix(""), "");
});

test("MAX_SHEETS: un .xlsx con más de 60 pestañas se rechaza al leerlo (bomba de hojas)", async () => {
  const ExcelJS = (await import("exceljs")).default;
  const { parseSpreadsheet, MAX_SHEETS } = await import("../engine");
  const wb = new ExcelJS.Workbook();
  for (let i = 0; i < MAX_SHEETS + 1; i++) wb.addWorksheet(`Hoja${i}`);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const file = new File([buf], "muchas-hojas.xlsx");
  await assert.rejects(() => parseSpreadsheet(file), /pestañas/i);
});
