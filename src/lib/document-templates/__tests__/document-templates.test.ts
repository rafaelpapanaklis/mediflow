/**
 * WS1-T1 · Administración → Plantillas.
 *
 * Run: npm run test:document-templates
 *
 * Lo que se prueba es lo que puede hacer daño:
 *  · el HTML de una plantilla se pinta en la pantalla de OTRA persona y en un
 *    PDF: lo que no está en la lista blanca no llega a guardarse;
 *  · dos plantillas del mismo tipo no se llaman igual en la misma clínica;
 *  · una clínica no ve (ni edita, ni borra) las plantillas de otra;
 *  · borrar una plantilla no rompe un documento ya hecho con ella.
 *
 * El servicio es el REAL. Solo se sustituye la base por una falsa que evalúa
 * el `where` que recibe; un `where` que no sabe evaluar LANZA, así una prueba
 * no puede pasar por accidente.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { sanitizeTemplateHtml, isBlankHtml, ALLOWED_TAGS } from "../sanitize";
import { DOCUMENT_MARKERS } from "../markers";
import { interpolateDocumentHtml } from "../interpolate";
import { DOCUMENT_TEMPLATE_KINDS } from "../kinds";
import {
  createTemplate,
  deleteTemplate,
  getTemplate,
  listTemplates,
  templateErrorCode,
  updateTemplate,
  type TemplateDb,
} from "../service";
import { interpolateConsent } from "@/lib/consent/templates";

/* ─── la base falsa ────────────────────────────────────────────────────── */

interface Fila {
  id: string;
  clinicId: string;
  kind: string;
  name: string;
  body: string;
  isActive: boolean;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

let filas: Fila[] = [];
let secuencia = 0;

const CLAVES_WHERE = new Set(["id", "clinicId", "kind", "deletedAt", "isActive", "name", "NOT"]);

function cumple(f: Fila, where: Record<string, any>): boolean {
  for (const clave of Object.keys(where)) {
    if (!CLAVES_WHERE.has(clave)) throw new Error(`base falsa: where.${clave} no está soportado`);
  }
  if ("clinicId" in where && where.clinicId === undefined) {
    throw new Error("base falsa: clinicId undefined — en Prisma esto NO filtra");
  }
  if ("id" in where && f.id !== where.id) return false;
  if ("clinicId" in where && f.clinicId !== where.clinicId) return false;
  if ("kind" in where && f.kind !== where.kind) return false;
  if ("isActive" in where && f.isActive !== where.isActive) return false;
  if ("deletedAt" in where) {
    if (where.deletedAt !== null) throw new Error("base falsa: deletedAt solo acepta null");
    if (f.deletedAt !== null) return false;
  }
  if ("name" in where) {
    const n = where.name;
    if (typeof n === "string") {
      if (f.name !== n) return false;
    } else if (n && n.mode === "insensitive" && typeof n.equals === "string") {
      if (f.name.toLowerCase() !== n.equals.toLowerCase()) return false;
    } else {
      throw new Error("base falsa: forma de where.name no soportada");
    }
  }
  if ("NOT" in where && cumple(f, where.NOT)) return false;
  return true;
}

function choqueDeUnico(candidata: Pick<Fila, "clinicId" | "kind" | "name">, exceptoId?: string): void {
  // Igual que el @@unique de la base: exacto, y SIN mirar deletedAt.
  const choca = filas.some(
    (f) =>
      f.id !== exceptoId &&
      f.clinicId === candidata.clinicId &&
      f.kind === candidata.kind &&
      f.name === candidata.name,
  );
  if (choca) throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
}

const db = {
  documentTemplate: {
    async findMany({ where }: any) {
      return filas
        .filter((f) => cumple(f, where))
        .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name))
        .map((f) => ({ ...f }));
    },
    async findFirst({ where }: any) {
      const f = filas.find((x) => cumple(x, where));
      return f ? { ...f } : null;
    },
    async create({ data }: any) {
      choqueDeUnico(data);
      const ahora = new Date();
      const f: Fila = {
        id: `tpl_${++secuencia}`,
        isActive: true,
        createdById: null,
        createdAt: ahora,
        updatedAt: ahora,
        deletedAt: null,
        ...data,
      };
      filas.push(f);
      return { ...f };
    },
    async update({ where, data }: any) {
      const f = filas.find((x) => x.id === where.id);
      if (!f) throw new Error("base falsa: update sin fila");
      choqueDeUnico({ clinicId: f.clinicId, kind: f.kind, name: data.name ?? f.name }, f.id);
      Object.assign(f, data, { updatedAt: new Date() });
      return { ...f };
    },
  },
} as unknown as TemplateDb;

const A = "clinica_a";
const B = "clinica_b";

beforeEach(() => {
  filas = [];
  secuencia = 0;
});

async function crear(clinicId: string, name: string, kind = "CONSENTIMIENTO", body = "<p>Texto</p>") {
  const r = await createTemplate(db, clinicId, "u_1", { kind, name, body });
  assert.ok(r.ok, `no se pudo crear «${name}»`);
  return r.ok === true ? r.template : (undefined as never);
}

/* ─── 1. el saneado ────────────────────────────────────────────────────── */

test("saneado: <script> se va con todo y su contenido; el texto de alrededor se queda", () => {
  const out = sanitizeTemplateHtml('<p>Hola</p><script>alert("x")</script><p>Adiós</p>');
  assert.equal(out, "<p>Hola</p><p>Adiós</p>");
});

test("saneado: onclick= y cualquier otro atributo desaparecen, la etiqueta permitida sigue", () => {
  const out = sanitizeTemplateHtml(
    `<p onclick="robar()" style="color:red" class="x" data-y='1'>Texto <b onmouseover=alert(1)>fuerte</b></p>`,
  );
  assert.equal(out, "<p>Texto <b>fuerte</b></p>");
});

test("saneado: img, a href, iframe, style y svg no sobreviven; el texto del enlace sí", () => {
  const out = sanitizeTemplateHtml(
    '<p>Ver <a href="javascript:alert(1)">aquí</a><img src=x onerror=alert(1)></p>' +
      "<style>p{display:none}</style><iframe src=//evil></iframe><svg><script>1</script></svg>",
  );
  assert.equal(out, "<p>Ver aquí</p>");
});

test("saneado: ningún vector conocido deja un atributo ni una etiqueta fuera de la lista", () => {
  const vectores = [
    "<ScRiPt>alert(1)</sCrIpT>",
    "<script src=//evil.js>",
    "<scr<script>ipt>alert(1)</scr</script>ipt>",
    '<p title="a>b" onclick="x()">hola</p>',
    "<p/onclick=alert(1)>hola</p>",
    '<b style="background:url(javascript:alert(1))">x</b>',
    "<img src=x onerror=alert(1)//",
    "<svg/onload=alert(1)>",
    "<math><mi xlink:href=javascript:alert(1)>x</mi></math>",
    "<!--<p>--><script>alert(1)</script>",
    "&lt;script&gt;alert(1)&lt;/script&gt;",
    "&#60;script&#62;alert(1)&#60;/script&#62;",
    "<u\u0000 onclick=x>t</u>",
    "<form action=//evil><input name=pin></form>",
    '<p>uno</p><object data="x"></object><embed src="x">',
  ];
  const permitidas = new Set(ALLOWED_TAGS);
  for (const v of vectores) {
    const out = sanitizeTemplateHtml(v);
    for (const m of out.matchAll(/<\/?([a-z0-9]+)([^>]*)>/gi)) {
      assert.ok(permitidas.has(m[1].toLowerCase()), `etiqueta <${m[1]}> en la salida de: ${v}`);
      assert.equal(m[2], "", `atributos «${m[2]}» en la salida de: ${v}`);
    }
    // Todo `<` que quede es de una etiqueta de la lista; lo demás va escapado.
    assert.ok(!/<(?!\/?(?:p|br|b|strong|i|em|u|ul|ol|li|h1|h2|h3)>)/i.test(out), `"<" crudo en: ${out}`);
  }
});

test("saneado: lo escapado sigue siendo texto y sanear dos veces da lo mismo", () => {
  const una = sanitizeTemplateHtml("<p>&lt;script&gt;alert(1)&lt;/script&gt; 3 < 5 & O'Brien</p>");
  assert.equal(una, "<p>&lt;script&gt;alert(1)&lt;/script&gt; 3 &lt; 5 &amp; O&#39;Brien</p>");
  assert.equal(sanitizeTemplateHtml(una), una);
});

test("saneado: conserva todo lo que el editor sabe hacer y cierra lo que quedó abierto", () => {
  const html =
    "<h1>Título</h1><h2>Sub</h2><h3>Menor</h3><p><b>n</b><strong>n</strong><i>c</i><em>c</em><u>s</u><br></p>" +
    "<ul><li>uno</li></ul><ol><li>dos</li></ol>";
  assert.equal(sanitizeTemplateHtml(html), html);
  assert.equal(sanitizeTemplateHtml("<p><b>sin cerrar"), "<p><b>sin cerrar</b></p>");
  assert.equal(sanitizeTemplateHtml("<div>párrafo del navegador</div>"), "<p>párrafo del navegador</p>");
});

test("saneado: los marcadores [NOMBRE_PACIENTE] pasan intactos", () => {
  assert.equal(sanitizeTemplateHtml("<p>Yo, [NOMBRE_PACIENTE], acepto.</p>"), "<p>Yo, [NOMBRE_PACIENTE], acepto.</p>");
});

test("saneado: entradas que no son texto dan cadena vacía, y vacío es vacío", () => {
  for (const v of [undefined, null, 42, {}, []]) assert.equal(sanitizeTemplateHtml(v), "");
  assert.ok(isBlankHtml("<p><br></p>"));
  assert.ok(isBlankHtml("<p>&nbsp; </p>"));
  assert.ok(!isBlankHtml("<p>a</p>"));
});

test("saneado: un cuerpo hostil no le cuesta al servidor tiempo cuadrático", () => {
  // Con la regex de antes, cada `<` sin cerrar barría hasta el final del texto.
  const hostiles = [
    "<a".repeat(100_000),
    "<a ".repeat(60_000) + '"',
    `<a '"`.repeat(40_000) + ">",
    "<script>".repeat(25_000),
    "<script></script x".repeat(10_000),
    "<".repeat(200_000),
    "<b>".repeat(30_000) + "</p>".repeat(27_000),
  ];
  for (const h of hostiles) {
    const t0 = performance.now();
    const out = sanitizeTemplateHtml(h);
    const ms = performance.now() - t0;
    assert.ok(ms < 1500, `${h.slice(0, 12)}… tardó ${Math.round(ms)} ms`);
    assert.ok(!/<(?!\/?(?:p|br|b|strong|i|em|u|ul|ol|li|h1|h2|h3)>)/i.test(out));
  }
});

test("saneado: el cierre de una etiqueta descartada se encuentra aunque haya «İ» antes", () => {
  // toLowerCase() alarga «İ»: buscar sobre una copia en minúsculas descuadraría las posiciones.
  assert.equal(sanitizeTemplateHtml("<p>İİİİ</p><SCRIPT>x</SCRIPT ><p>fin</p>"), "<p>İİİİ</p><p>fin</p>");
});

test("un cuerpo desmedido se rechaza ANTES de sanearlo", async () => {
  const r = await createTemplate(db, A, "u_1", { kind: "CONSENTIMIENTO", name: "Enorme", body: "<p>" + "a".repeat(200_001) + "</p>" });
  assert.equal(templateErrorCode(r), "BODY_TOO_LONG");
});

/* ─── 2. guardar sanea ─────────────────────────────────────────────────── */

test("una plantilla con <script> u onclick= se GUARDA sin eso (alta y edición)", async () => {
  const sucio = '<p onclick="x()">Acepto</p><script>fetch("//evil")</script>';
  const alta = await createTemplate(db, A, "u_1", { kind: "CONSENTIMIENTO", name: "Endodoncia", body: sucio });
  assert.ok(alta.ok);
  assert.equal(filas[0].body, "<p>Acepto</p>");

  const edicion = await updateTemplate(db, A, filas[0].id, { body: `<h2 onload=x>Nuevo</h2><img src=x onerror=y>` });
  assert.ok(edicion.ok);
  assert.equal(filas[0].body, "<h2>Nuevo</h2>");
});

test("un cuerpo que tras sanear queda vacío no se guarda", async () => {
  const r = await createTemplate(db, A, "u_1", { kind: "CONSENTIMIENTO", name: "Vacía", body: "<script>x</script><p><br></p>" });
  assert.ok(!r.ok);
  assert.equal(templateErrorCode(r), "BODY_REQUIRED");
  assert.equal(filas.length, 0);
});

test("tipo inválido y nombre vacío se rechazan antes de tocar la base", async () => {
  const t = await createTemplate(db, A, "u_1", { kind: "RECETA", name: "X", body: "<p>x</p>" });
  assert.equal(templateErrorCode(t), "KIND_INVALID");
  const n = await createTemplate(db, A, "u_1", { kind: "NOTA_EVOLUCION", name: "   ", body: "<p>x</p>" });
  assert.equal(templateErrorCode(n), "NAME_REQUIRED");
  assert.deepEqual([...DOCUMENT_TEMPLATE_KINDS], ["NOTA_EVOLUCION", "CONSENTIMIENTO"]);
});

/* ─── 3. nombres únicos por clínica y tipo ─────────────────────────────── */

test("dos plantillas del mismo tipo no pueden llamarse igual en la misma clínica", async () => {
  await crear(A, "Endodoncia");
  for (const repetido of ["Endodoncia", "  endodoncia ", "ENDODONCIA"]) {
    const r = await createTemplate(db, A, "u_1", { kind: "CONSENTIMIENTO", name: repetido, body: "<p>x</p>" });
    assert.equal(templateErrorCode(r), "NAME_TAKEN", `«${repetido}» debió chocar`);
    assert.equal(r.ok === false && r.status, 409);
  }
  assert.equal(filas.length, 1);
});

test("el mismo nombre SÍ cabe en el otro tipo y en otra clínica", async () => {
  await crear(A, "Endodoncia", "CONSENTIMIENTO");
  await crear(A, "Endodoncia", "NOTA_EVOLUCION");
  await crear(B, "Endodoncia", "CONSENTIMIENTO");
  assert.equal(filas.length, 3);
});

test("renombrar a un nombre ya usado choca; renombrarse a sí misma no", async () => {
  await crear(A, "Endodoncia");
  const otra = await crear(A, "Extracción");
  const choque = await updateTemplate(db, A, otra.id, { name: "endodoncia" });
  assert.equal(templateErrorCode(choque), "NAME_TAKEN");
  const misma = await updateTemplate(db, A, otra.id, { name: "Extracción", body: "<p>otro</p>" });
  assert.ok(misma.ok);
});

test("si la carrera la pierde en la base (P2002), también es NAME_TAKEN y no un 500", async () => {
  await crear(A, "Endodoncia");
  const sinPrechequeo = {
    documentTemplate: { ...(db as any).documentTemplate, findMany: async () => [] },
  } as unknown as TemplateDb;
  const r = await createTemplate(sinPrechequeo, A, "u_1", { kind: "CONSENTIMIENTO", name: "Endodoncia", body: "<p>x</p>" });
  assert.equal(templateErrorCode(r), "NAME_TAKEN");
});

test("un nombre con % o _ no hace de comodín: «Endo%» no choca con «Endodoncia»", async () => {
  await crear(A, "Endodoncia");
  for (const nombre of ["Endo%", "Endodonci_", "%"]) {
    const r = await createTemplate(db, A, "u_1", { kind: "CONSENTIMIENTO", name: nombre, body: "<p>x</p>" });
    assert.equal(templateErrorCode(r), null, `«${nombre}» es un nombre libre`);
  }
});

/* ─── 4. aislamiento por clínica ───────────────────────────────────────── */

test("una clínica no ve las plantillas de otra", async () => {
  await crear(A, "De A");
  const deB = await crear(B, "De B");

  assert.deepEqual((await listTemplates(db, A, { includeInactive: true })).map((t) => t.name), ["De A"]);
  assert.deepEqual((await listTemplates(db, B)).map((t) => t.name), ["De B"]);
  assert.equal(await getTemplate(db, A, deB.id), null);
});

test("una clínica no edita ni borra la plantilla de otra, aunque sepa su id", async () => {
  const deB = await crear(B, "De B");
  const edicion = await updateTemplate(db, A, deB.id, { name: "Secuestrada", body: "<p>x</p>" });
  assert.equal(templateErrorCode(edicion), "NOT_FOUND");
  const borrado = await deleteTemplate(db, A, deB.id);
  assert.equal(templateErrorCode(borrado), "NOT_FOUND");
  assert.equal(filas[0].name, "De B");
  assert.equal(filas[0].deletedAt, null);
});

test("sin clinicId se corta ANTES de consultar (clinicId: undefined no filtra en Prisma)", async () => {
  await crear(A, "De A");
  for (const malo of [undefined, null, ""]) {
    await assert.rejects(() => listTemplates(db, malo as any), /clinicId ausente/);
    await assert.rejects(() => getTemplate(db, malo as any, "tpl_1"), /clinicId ausente/);
    await assert.rejects(() => createTemplate(db, malo as any, null, { kind: "CONSENTIMIENTO", name: "x", body: "<p>x</p>" }), /clinicId ausente/);
    await assert.rejects(() => updateTemplate(db, malo as any, "tpl_1", { name: "x" }), /clinicId ausente/);
    await assert.rejects(() => deleteTemplate(db, malo as any, "tpl_1"), /clinicId ausente/);
  }
});

test("la ficha del paciente pide por tipo y solo recibe las activas de ese tipo", async () => {
  await crear(A, "Consent 1", "CONSENTIMIENTO");
  const nota = await crear(A, "Nota 1", "NOTA_EVOLUCION");
  const apagada = await crear(A, "Nota apagada", "NOTA_EVOLUCION");
  await updateTemplate(db, A, apagada.id, { isActive: false });

  assert.deepEqual((await listTemplates(db, A, { kind: "NOTA_EVOLUCION" })).map((t) => t.id), [nota.id]);
  assert.equal((await listTemplates(db, A, { kind: "NOTA_EVOLUCION", includeInactive: true })).length, 2);
});

/* ─── 5. borrar no rompe documentos ────────────────────────────────────── */

test("borrar una plantilla NO rompe un documento ya hecho con ella", async () => {
  const tpl = await crear(A, "Endodoncia", "CONSENTIMIENTO", "<p>Yo, [NOMBRE_PACIENTE], acepto.</p>");

  // Lo que hace la ficha del paciente al crear el documento: COPIA, no referencia.
  const documento = {
    templateId: tpl.id as string | null,
    title: tpl.name,
    body: interpolateDocumentHtml(tpl.body, { clinicName: "Clínica A", patientName: "Ana Ruiz" }),
  };

  const borrado = await deleteTemplate(db, A, tpl.id);
  assert.ok(borrado.ok);

  // La plantilla ya no sale en ninguna lista ni se puede abrir…
  assert.equal((await listTemplates(db, A, { includeInactive: true })).length, 0);
  assert.equal(await getTemplate(db, A, tpl.id), null);
  // …pero la fila sigue en la base (borrado lógico): el FK del documento no queda colgando.
  assert.equal(filas.length, 1);
  assert.ok(filas[0].deletedAt instanceof Date);
  // Y el documento se lee igual que antes, con o sin plantilla.
  assert.equal(documento.title, "Endodoncia");
  assert.equal(documento.body, "<p>Yo, Ana Ruiz, acepto.</p>");
});

test("el schema deja templateId nullable y con SetNull, y el SQL dice lo mismo", () => {
  const raiz = process.cwd();
  const schema = readFileSync(join(raiz, "prisma/schema.prisma"), "utf8");
  const modelo = schema.slice(schema.indexOf("model PatientDocument {"));
  const cuerpo = modelo.slice(0, modelo.indexOf("\n}\n"));
  assert.match(cuerpo, /templateId\s+String\?/);
  assert.match(cuerpo, /template\s+DocumentTemplate\?\s+@relation\(fields: \[templateId\], references: \[id\], onDelete: SetNull\)/);
  assert.match(cuerpo, /body\s+String\s+@db\.Text/);
  assert.match(cuerpo, /title\s+String/);

  const sql = readFileSync(join(raiz, "sql/document-templates-2-tablas.sql"), "utf8");
  assert.match(sql, /"templateId" TEXT,/);
  assert.match(sql, /"patient_documents_templateId_fkey"[\s\S]*?ON DELETE SET NULL/);
  // SQL plano: el editor de Supabase no digiere bloques DO, y el enum va aparte.
  assert.ok(!/\bDO\s+\$/.test(sql), "el SQL de tablas no debe llevar bloques DO $$");
  assert.ok(!/CREATE TYPE/.test(sql), "el CREATE TYPE va en su propio archivo");
  const enumSql = readFileSync(join(raiz, "sql/document-templates-1-enum.sql"), "utf8");
  assert.match(enumSql, /CREATE TYPE "DocumentTemplateKind" AS ENUM \('NOTA_EVOLUCION', 'CONSENTIMIENTO'\);/);
  assert.ok(!/\bDO\s+\$/.test(enumSql));
});

test("después de borrar «Endodoncia» se puede volver a crear «Endodoncia»", async () => {
  const primera = await crear(A, "Endodoncia");
  await deleteTemplate(db, A, primera.id);
  const segunda = await createTemplate(db, A, "u_1", { kind: "CONSENTIMIENTO", name: "Endodoncia", body: "<p>v2</p>" });
  assert.ok(segunda.ok, "el @@unique de la base no mira deletedAt: el nombre tiene que haberse liberado");
});

test("nadie puede dejar una plantilla sin poder borrarse ocupando su nombre de borrada", async () => {
  const victima = await crear(A, "Endodoncia");
  await crear(A, `Endodoncia (eliminada ${victima.id})`);
  const r = await deleteTemplate(db, A, victima.id);
  assert.equal(templateErrorCode(r), null);
  assert.equal(await getTemplate(db, A, victima.id), null);
});

/* ─── 6. marcadores ────────────────────────────────────────────────────── */

test("cada marcador que enseña el popup lo sustituye de verdad interpolateConsent", () => {
  for (const { token } of DOCUMENT_MARKERS) {
    assert.match(token, /^\[[A-Z_]+\]$/);
    const out = interpolateConsent(`x ${token} y`, {
      clinicName: "Clínica", patientName: "Ana", patientAge: 30, patientNumber: "P1",
      doctorName: "Dr. X", doctorLicense: "123", signerName: "Tutor", signerRelation: "Madre",
      place: "CDMX", date: "1 de enero de 2026",
    });
    assert.ok(!out.includes(token), `${token} no lo sustituye interpolateConsent`);
  }
});

test("al rellenar, los datos del paciente se escapan: un nombre no se vuelve etiqueta", () => {
  const out = interpolateDocumentHtml("<p>[NOMBRE_PACIENTE] y [NOMBRE_PACIENTE]</p>", {
    clinicName: "C",
    patientName: '<img src=x onerror="alert(1)">',
  });
  assert.ok(!out.includes("<img"));
  assert.equal(out.match(/&lt;img/g)?.length, 2, "reemplazo global, las dos veces");
});

/* ─── 7. saneador v2: la tabla cerrada del editor de documentos ────────── */
//
// Lo que entra con el editor nuevo (Tiptap): tablas, imagen por clave, columnas,
// línea de firma, salto de página, sangría, alineación y tamaño de letra. Cada
// etiqueta con SUS atributos enumerados y nada más. La salida se valida con un
// lector ESTRICTO (abajo): cualquier etiqueta, atributo o valor fuera de la
// tabla, o un `<`, `>`, `"` o `'` crudo en el texto, tumba la prueba.

const ARCHIVO = "documentos/clinica_qa_prueba/img_1.webp";

const TEXTO_ATRS = {
  "data-sangria": /^[1-6]$/,
  "data-alineacion": /^(izquierda|centro|derecha|justificado)$/,
};
const CELDA_ATRS = {
  colspan: /^([2-9]|1[0-9]|20)$/,
  rowspan: /^([2-9]|[1-9][0-9]|100)$/,
};
const ATRIBUTOS_DE: Record<string, Record<string, RegExp>> = {
  p: TEXTO_ATRS, h1: TEXTO_ATRS, h2: TEXTO_ATRS, h3: TEXTO_ATRS,
  br: {}, b: {}, strong: {}, i: {}, em: {}, u: {}, ul: {}, ol: {}, li: {},
  table: {}, thead: {}, tbody: {}, tr: {}, th: CELDA_ATRS, td: CELDA_ATRS,
  span: { "data-tamano": /^(10|11|12|14|16|18|24)$/ },
  img: {
    "data-archivo": /^documentos\/[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{1,128}\.webp$/,
    "data-ancho": /^(chico|medio|completo)$/,
    "data-alineacion": /^(izquierda|centro|derecha)$/,
    alt: /^[^"'<>]*$/,
  },
  div: {
    "data-tipo": /^(columnas|columna|linea-firma|salto-pagina)$/,
    "data-n": /^[23]$/,
    "data-lado": /^(izquierda|centro|derecha)$/,
  },
};
// Sin su atributo, estas no salen nunca.
const OBLIGATORIO: Record<string, string> = { img: "data-archivo", span: "data-tamano", div: "data-tipo" };

function assertSegura(out: string, origen: string): void {
  const resto = out.replace(/<(\/?)([a-z0-9]+)((?: [a-z-]+="[^"]*")*)>/g, (_todo, cierre: string, tag: string, attrs: string) => {
    const permitidos = ATRIBUTOS_DE[tag];
    assert.ok(permitidos, `<${tag}> en la salida de: ${origen}`);
    if (cierre) {
      assert.equal(attrs, "", `cierre con atributos en: ${origen}`);
      assert.ok(tag !== "br" && tag !== "img", `</${tag}> en: ${origen}`);
      return "";
    }
    const vistos = new Set<string>();
    for (const [, nombre, valor] of attrs.matchAll(/ ([a-z-]+)="([^"]*)"/g)) {
      assert.ok(!vistos.has(nombre), `atributo repetido ${nombre} en: ${origen}`);
      vistos.add(nombre);
      assert.ok(permitidos[nombre], `atributo ${nombre} en <${tag}> de: ${origen}`);
      assert.match(valor, permitidos[nombre], `valor «${valor}» de ${nombre} en: ${origen}`);
    }
    if (OBLIGATORIO[tag]) assert.ok(vistos.has(OBLIGATORIO[tag]), `<${tag}> sin ${OBLIGATORIO[tag]} en: ${origen}`);
    return "";
  });
  assert.ok(!/[<>"']/.test(resto), `carácter crudo «${resto.match(/[<>"']/)?.[0]}» en el texto de: ${origen}`);
  // Más allá del tope de ENTRADA la segunda pasada corta, como siempre (y el CRUD ya lo rechazó por largo).
  if (out.length <= MAX_INPUT_LENGTH) {
    assert.equal(sanitizeTemplateHtml(out), out, `sanear dos veces cambia el resultado de: ${origen}`);
  }
}

const tabla = (celda: string) => `<table><tbody><tr>${celda}</tr></tbody></table>`;

/** [entrada, salida exacta esperada]. Cada uno es un ataque o un intento de colarse por la tabla nueva. */
const ATAQUES: [string, string][] = [
  // imagen: solo por clave, nunca src
  ["<img src=x onerror=alert(1)>", ""],
  [`<img src="javascript:alert(1)" data-archivo="${ARCHIVO}">`, `<img data-archivo="${ARCHIVO}">`],
  [`<img data-archivo="${ARCHIVO}" onerror="alert(1)" onload=alert(2) srcset="x 1x">`, `<img data-archivo="${ARCHIVO}">`],
  [`<img src="data:image/svg+xml,<svg onload=alert(1)>" data-archivo="${ARCHIVO}">`, `<img data-archivo="${ARCHIVO}">`],
  ['<img data-archivo="documentos/../../etc/passwd.webp">', ""],
  ['<img data-archivo="documentos/clinica/../otra.webp">', ""],
  ['<img data-archivo="documentos/clinica/sub/img.webp">', ""],
  ['<img data-archivo="clinical-photos/clinica/img.webp">', ""],
  ['<img data-archivo="documentos/clinica/img.svg">', ""],
  ['<img data-archivo="documentos/clinica/img.webp?x=1">', ""],
  ['<img data-archivo="https://evil.example/documentos/clinica/img.webp">', ""],
  ['<img data-archivo="/documentos/clinica/img.webp">', ""],
  ['<img data-archivo="documentos/clinica/img.webp ">', ""],
  ['<img data-archivo="documentos%2Fclinica%2Fimg.webp">', ""],
  ['<img data-archivo="documentos/clinica/img.WEBP">', ""],
  ['<img data-archivo="documentos&#47;clinica&#x2f;img&#46;webp">', '<img data-archivo="documentos/clinica/img.webp">'],
  // atributo repetido: gana el PRIMERO, como en el navegador
  [`<img data-archivo="${ARCHIVO}" data-archivo="javascript:alert(1)">`, `<img data-archivo="${ARCHIVO}">`],
  [`<img data-archivo="javascript:alert(1)" data-archivo="${ARCHIVO}">`, ""],
  [`<p data-sangria="2" data-sangria="9" onclick=x onclick=y>t</p>`, '<p data-sangria="2">t</p>'],
  // alt: texto, siempre escapado
  [`<img data-archivo="${ARCHIVO}" alt="x&quot; onerror=&quot;alert(1)">`, `<img data-archivo="${ARCHIVO}" alt="x&quot; onerror=&quot;alert(1)">`],
  [`<img data-archivo="${ARCHIVO}" alt='<script>alert(1)</script>'>`, `<img data-archivo="${ARCHIVO}" alt="&lt;script&gt;alert(1)&lt;/script&gt;">`],
  [`<img data-archivo="${ARCHIVO}" data-ancho="enorme" data-alineacion="center" alt>`, `<img data-archivo="${ARCHIVO}" alt="">`],
  // una imagen con un data: enorme se va entera: ni la etiqueta ni su base64 quedan como texto
  [`<p>a</p><img src="data:image/png;base64,${"QUFB".repeat(2000)}" onerror=alert(1)><p>b</p>`, "<p>a</p><p>b</p>"],
  // href / data: / javascript:
  ['<a href="javascript:alert(1)">x</a>', "x"],
  ['<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>', "x"],
  ['<a href="jav&#x09;ascript:alert(1)">x</a>', "x"],
  ['<base href="javascript:/"><meta http-equiv="refresh" content="0;url=javascript:alert(1)"><link rel=stylesheet href=//evil>', ""],
  // style: nunca sale; solo text-align se LEE (a un valor de la tabla)
  ['<p style="background:url(javascript:alert(1))">x</p>', "<p>x</p>"],
  ['<p style="text-align:center;background:url(javascript:alert(1))">x</p>', '<p data-alineacion="centro">x</p>'],
  ['<p style="text-align: expression(alert(1))">x</p>', "<p>x</p>"],
  ['<p style="text-align: constructor">x</p>', "<p>x</p>"],
  ['<h2 style="TEXT-ALIGN: RIGHT !important">x</h2>', '<h2 data-alineacion="derecha">x</h2>'],
  ['<span style="font-size:14pt">x</span>', "x"],
  // data-* fuera de la lista
  ['<span data-tamano="13">a</span><span data-tamano="14px">b</span><span data-tamano="1e1">c</span><span data-tamano=" 14">d</span>', "abcd"],
  ['<span data-tamano="14" onmouseover="alert(1)" style="color:red">x</span>', '<span data-tamano="14">x</span>'],
  ['<p data-sangria="7">a</p><p data-sangria="-1">b</p><p data-sangria="1.5">c</p><p data-sangria="0">d</p><p data-sangria=`2`>e</p>', "<p>a</p><p>b</p><p>c</p><p>d</p><p>e</p>"],
  ['<p data-alineacion="center">a</p><p data-alineacion="Centro">b</p>', "<p>a</p><p>b</p>"],
  ['<div data-tipo="columnas" data-n="4" onclick="x"><div data-tipo="columna">a</div></div>', '<div data-tipo="columnas"><div data-tipo="columna">a</div></div>'],
  ['<div data-tipo="linea-firma" data-lado="javascript:x" class="x">Firma</div>', '<div data-tipo="linea-firma">Firma</div>'],
  ['<div data-tipo="iframe">x</div><div data-tipo="SALTO-PAGINA">y</div>', "<p>x</p><p>y</p>"],
  // tablas: spans numéricos acotados
  [tabla('<td colspan="1e9" rowspan="99999">x</td>'), tabla("<td>x</td>")],
  [tabla('<td colspan="21">a</td><td colspan="-1">b</td><td colspan="2abc">c</td><td colspan="0x10">d</td><td colspan=" 3">e</td><td colspan="03">f</td>'),
    tabla("<td>a</td><td>b</td><td>c</td><td>d</td><td>e</td><td>f</td>")],
  [tabla('<td colspan="20" rowspan="100">a</td><td rowspan="101">b</td>'), tabla('<td colspan="20" rowspan="100">a</td><td>b</td>')],
  ['<table background="javascript:alert(1)" style="x"><tr onclick=x><td background=x style="x">y</td></tr></table>', "<table><tr><td>y</td></tr></table>"],
  // svg / math / iframe / object / embed: fuera con todo y contenido
  ["<svg><script>alert(1)</script></svg><svg/onload=alert(1)><p>ok</p>", ""],
  ["<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>", ""],
  ['<iframe srcdoc="<script>alert(1)</script>"></iframe><object data="javascript:alert(1)"></object><embed src="javascript:alert(1)">', ""],
  // mutation XSS: lo que el navegador re-interpreta al volver a leer
  ['<noscript><p title="</noscript><img src=x onerror=alert(1)>">', "&quot;&gt;"],
  ["<template><img src=x onerror=alert(1)></template>t", "t"],
  ["<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>", ""],
  ['<svg><p><style><img src=x onerror=alert(1)></style></p></svg>', ""],
  ["<xmp><img src=x onerror=alert(1)></xmp><title><img src=x onerror=alert(1)></title><textarea><img src=x></textarea>", ""],
  ["<plaintext><img src=x onerror=alert(1)>", ""],
  // comentarios (también los condicionales de IE)
  ["<!--[if gte IE 4]><script>alert(1)</script><![endif]-->x", "x"],
  ["<![if !IE]><img src=x onerror=alert(1)><![endif]>y", "y"],
  ["<!--><img src=x onerror=alert(1)>-->z", "z"],
  // entidades y mayúsculas
  ["&lt;img src=x onerror=alert(1)&gt;", "&lt;img src=x onerror=alert(1)&gt;"],
  ["&#x3C;script&#x3E;alert(1)&#x3C;/script&#x3E;", "&lt;script&gt;alert(1)&lt;/script&gt;"],
  ["<IMG SRC=x ONERROR=alert(1)><P ONCLICK=alert(1) DATA-SANGRIA=2>x</P>", '<p data-sangria="2">x</p>'],
  [`<IMG DATA-ARCHIVO="${ARCHIVO}" DATA-ANCHO=chico>`, `<img data-archivo="${ARCHIVO}" data-ancho="chico">`],
  // los dos átomos del editor no dejan pasar lo que lleven dentro
  ['<div data-tipo="salto-pagina"><img src=x onerror=alert(1)><b>texto oculto</b></div><p>sigue</p>', '<div data-tipo="salto-pagina"></div><p>sigue</p>'],
  ['<span data-marcador="NOMBRE_PACIENTE"><script>alert(1)</script>Ana</span>', "[NOMBRE_PACIENTE]"],
  ['<span data-marcador="x&quot;><img src=x onerror=alert(1)>">t</span>', "t"],
  // basura de control
  ["<im\u0000g src=x onerror=alert(1)>", ""],
  ["<p/style=\"x\"/onclick=\"y\">t</p>", "<p>t</p>"],
  [`<img<script>alert(1)</script> data-archivo="${ARCHIVO}">`, "&lt;img data-archivo=&quot;" + ARCHIVO + "&quot;&gt;"],
];

test("v2: la batería de ataques sale neutralizada, exacta y con la salida validada", () => {
  assert.ok(ATAQUES.length >= 40, `solo ${ATAQUES.length} casos`);
  for (const [entrada, esperado] of ATAQUES) {
    const out = sanitizeTemplateHtml(entrada);
    assert.equal(out, esperado, `entrada: ${entrada.slice(0, 160)}`);
    assertSegura(out, entrada.slice(0, 160));
  }
});

test("v2: <li><p>x</p></li> de Tiptap se guarda como <li>x</li>, y sus otras formas", () => {
  const casos: [string, string][] = [
    ["<ul><li><p>uno</p></li><li><p>dos</p></li></ul>", "<ul><li>uno</li><li>dos</li></ul>"],
    ["<ol><li><p><strong>a</strong> b</p></li></ol>", "<ol><li><strong>a</strong> b</li></ol>"],
    // dos párrafos en un ítem (pegado): un renglón con salto, no dos viñetas
    ["<ul><li><p>a</p><p>b</p></li></ul>", "<ul><li>a<br>b</li></ul>"],
    // sublista: el texto del ítem, luego la sublista, sin <br> de más
    ["<ul><li><p>a</p><ul><li><p>a.1</p></li></ul><p>a.2</p></li></ul>", "<ul><li>a<ul><li>a.1</li></ul>a.2</li></ul>"],
    ["<ul><li><p></p></li></ul>", "<ul><li></li></ul>"],
    // con alineación o sangría el párrafo se queda: perderla sería peor que el <p>
    ['<ul><li><p style="text-align: center">x</p></li></ul>', '<ul><li><p data-alineacion="centro">x</p></li></ul>'],
    // el div que el navegador mete en un ítem, igual
    ["<ul><li><div>x</div></li></ul>", "<ul><li>x</li></ul>"],
    // fuera de una lista, un <p> es un <p>
    ["<td><p>x</p></td>", "<p>x</p>"],
  ];
  for (const [entrada, esperado] of casos) {
    assert.equal(sanitizeTemplateHtml(entrada), esperado, entrada);
    assertSegura(esperado, entrada);
  }
});

test("v2: lo demás que escribe Tiptap 3.32 se normaliza a la tabla", () => {
  const casos: [string, string][] = [
    // TableKit: style de anchos, colgroup, colwidth y los spans por omisión
    [
      '<table style="min-width: 75px"><colgroup><col style="min-width: 25px"><col style="width: 120px"></colgroup><tbody><tr>' +
        '<th colspan="1" rowspan="1"><p>Pieza</p></th><th colspan="2" rowspan="1" colwidth="120,80" style="text-align: center"><p>Hallazgo</p></th>' +
        '</tr></tbody></table>',
      '<table><tbody><tr><th><p>Pieza</p></th><th colspan="2"><p>Hallazgo</p></th></tr></tbody></table>',
    ],
    // celdas y filas fuera de su sitio: la etiqueta se va, el texto se queda
    ["<tr><td>a</td></tr><td>b</td><thead><th>c</th></thead>", "abc"],
    ["<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>b</td></tr></tbody></table>", "<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>b</td></tr></tbody></table>"],
    // línea de firma: el envoltorio del editor se va, el renglón se queda
    [
      '<div data-lado="derecha" data-tipo="linea-firma" class="linea-firma"><div class="firma-texto">Dra. Ana</div></div>',
      '<div data-tipo="linea-firma" data-lado="derecha">Dra. Ana</div>',
    ],
    ['<div data-tipo="linea-firma"><p>Nombre</p><p>Cédula</p></div>', '<div data-tipo="linea-firma">Nombre<br>Cédula</div>'],
    ['<div data-tipo="linea-firma"><ul><li>x</li></ul><table><tr><td>y</td></tr></table></div>', '<div data-tipo="linea-firma">x<br>y</div>'],
    // salto de página: el rótulo del editor no es texto del documento
    ['<div data-tipo="salto-pagina" class="salto-manual" contenteditable="false"><span>Nueva página</span></div>', '<div data-tipo="salto-pagina"></div>'],
    // un salto sin cerrar no se come lo que viene
    ['<div data-tipo="salto-pagina"><p>sigue</p>', '<div data-tipo="salto-pagina"></div><p>sigue</p>'],
    // una ficha sin cerrar tampoco: el cierre del párrafo la termina y el texto de después se queda
    ['<p><span data-marcador="FECHA">x</p>t<p>b</p>', "<p>[FECHA]</p>t<p>b</p>"],
    // la ficha del marcador vuelve a ser [CLAVE]
    [
      '<p>Yo, <span class="marcador" data-marcador="NOMBRE_PACIENTE" data-etiqueta="Nombre del paciente" data-ejemplo="María" contenteditable="false"></span>, acepto.</p>',
      "<p>Yo, [NOMBRE_PACIENTE], acepto.</p>",
    ],
    // columnas: la clase se va; una columna suelta es un párrafo
    [
      '<div data-n="3" data-tipo="columnas" class="columnas"><div data-tipo="columna" class="columna"><p>a</p></div><div data-tipo="columna"><p>b</p></div><div data-tipo="columna"><p>c</p></div></div>',
      '<div data-tipo="columnas" data-n="3"><div data-tipo="columna"><p>a</p></div><div data-tipo="columna"><p>b</p></div><div data-tipo="columna"><p>c</p></div></div>',
    ],
    ['<div data-tipo="columna">suelta</div>', "<p>suelta</p>"],
    // TextAlign y la sangría propia; el tamaño como data-tamano
    ['<p style="text-align: justify" data-sangria="3">x <span data-tamano="18">y</span></p>', '<p data-sangria="3" data-alineacion="justificado">x <span data-tamano="18">y</span></p>'],
    // StarterKit trae más marcas de las que se guardan: su texto se queda
    ["<p><s>tachado</s> <code>c</code> <a href=\"https://x\">enlace</a></p><blockquote><p>cita</p></blockquote><hr>", "<p>tachado c enlace</p><p>cita</p>"],
    // un span sin tamaño se va sin llevarse el tamaño del de fuera
    ['<span data-tamano="18">a<span class="x">b</span>c</span>', '<span data-tamano="18">abc</span>'],
  ];
  for (const [entrada, esperado] of casos) {
    assert.equal(sanitizeTemplateHtml(entrada), esperado, entrada);
    assertSegura(esperado, entrada);
  }
});

test("v2: como mucho 40 imágenes por documento; las de más se van", () => {
  const una = (n: number) => `<img data-archivo="documentos/c1/img_${n}.webp">`;
  const out = sanitizeTemplateHtml(Array.from({ length: 45 }, (_, n) => una(n)).join(""));
  assert.equal(out.match(/<img /g)?.length, 40);
  assert.ok(out.includes("img_39.webp") && !out.includes("img_40.webp"), "se quedan las primeras 40");
});

test("v2: con la clínica de la sesión, una imagen de otra clínica no se guarda", () => {
  const html = '<img data-archivo="documentos/clinica_a/x.webp"><img data-archivo="documentos/clinica_b/y.webp">';
  assert.equal(sanitizeTemplateHtml(html, { clinicId: "clinica_a" }), '<img data-archivo="documentos/clinica_a/x.webp">');
  assert.equal(sanitizeTemplateHtml(html, { clinicId: "" }), "");
  assert.equal(sanitizeTemplateHtml(html).match(/<img /g)?.length, 2, "sin clínica, solo el patrón");
});

test("v2: el alt no hace crecer la etiqueta más allá de lo que el saneado vuelve a leer", () => {
  const out = sanitizeTemplateHtml(`<img data-archivo="${ARCHIVO}" alt="${"&quot;".repeat(5000)}">`);
  assertSegura(out, "alt de comillas");
  assert.ok(out.length < 1024, `etiqueta de ${out.length}`);
  // El corte justo tras un espacio no deja un espacio que la segunda pasada quitaría (hallazgo del refutador).
  assertSegura(sanitizeTemplateHtml(`<img data-archivo="${ARCHIVO}" alt="${"a".repeat(599)} bb">`), "alt cortado tras un espacio");
  const emoji = sanitizeTemplateHtml(`<img data-archivo="${ARCHIVO}" alt="${"😀".repeat(400)}">`);
  assert.ok(!/[\ud800-\udbff]"/.test(emoji), "no corta un emoji por la mitad");
});

test("v2: una imagen o una firma cuentan como contenido; un salto solo, no", () => {
  assert.ok(!isBlankHtml(`<img data-archivo="${ARCHIVO}">`));
  assert.ok(!isBlankHtml('<div data-tipo="linea-firma">Dra. Ana</div>'));
  assert.ok(isBlankHtml('<div data-tipo="salto-pagina"></div><p></p>'));
  assert.ok(isBlankHtml("<table><tr><td><p></p></td></tr></table>"));
});

/* ─── 8. lo viejo no cambia ────────────────────────────────────────────── */

import { sanearV1, isBlankHtmlV1 } from "./_saneador-v1";
import { CONSENT_TEMPLATES, buildConsentTemplateText } from "@/lib/consent/templates";
import { consentHtmlToText, consentTextToBodyHtml, consentTextToHtml } from "@/lib/consent/template-html";
import { MAQUETA_CONSENTIMIENTO, MAQUETA_NOTA, MAQUETA_PLANTILLA } from "./_maqueta-lo-que-se-guardaria";

/** Las cartas de fábrica tal y como se siembran, y como las pinta la hoja. */
function htmlViejoReal(): [string, string][] {
  const corpus: [string, string][] = [];
  for (const p of CONSENT_TEMPLATES) {
    const texto = buildConsentTemplateText(p.key);
    corpus.push([`plantilla precargada «${p.label}»`, consentTextToHtml(texto)]);
    corpus.push([`carta en la hoja «${p.label}»`, consentTextToBodyHtml(texto)]);
  }
  // Lo que deja la importación (`textToNoteHtml`): párrafos con <br> y texto escapado.
  corpus.push(["nota importada", "<p>Paciente refiere dolor en el 36 &amp; sensibilidad.<br>Se indica Rx.</p><p>Control en 4 semanas.</p>"]);
  // Lo que escribe el contenteditable de hoy (Plantillas y Nota de evolución).
  corpus.push([
    "contenteditable de hoy",
    "<h1>Título</h1><h2>Sub</h2><h3>Menor</h3><p><b>n</b><strong>n</strong><i>c</i><em>c</em><u>s</u><br></p>" +
      "<ul><li>uno</li><li>dos<ul><li>dentro</li></ul></li></ul><ol><li>x</li></ol><p><br></p><div>del navegador</div>" +
      "<p>Yo, [NOMBRE_PACIENTE], acepto. 3 &lt; 5 &amp; O'Brien &nbsp;</p>",
  ]);
  return corpus;
}

test("ida y vuelta: las plantillas precargadas y las cartas de fábrica salen IGUAL que con el saneador de antes", () => {
  const corpus = htmlViejoReal();
  assert.ok(corpus.length >= 2 * CONSENT_TEMPLATES.length);
  for (const [nombre, html] of corpus) {
    const v1 = sanearV1(html);
    assert.equal(sanitizeTemplateHtml(html), v1, nombre);
    assert.equal(sanitizeTemplateHtml(v1), v1, `${nombre}: idempotente`);
    assert.equal(isBlankHtml(v1), isBlankHtmlV1(v1), nombre);
  }
});

test("ida y vuelta: consentHtmlToText, interpolateConsent e interpolateDocumentHtml no cambian con lo viejo", () => {
  const vars = {
    clinicName: "Clínica <Sol> & Luna", patientName: "Ana O'Neil", patientAge: 34, patientNumber: "P-7",
    doctorName: 'Dr. "X"', doctorLicense: "123", signerName: "Tutor", signerRelation: "Madre",
    place: "Mérida", date: "1 de enero de 2026",
  };
  // interpolateDocumentHtml de antes, con el saneador de antes (misma receta que interpolate.ts).
  const interpolarV1 = (html: string) => {
    const seguras = { ...vars } as Record<string, unknown>;
    for (const [k, v] of Object.entries(seguras)) if (typeof v === "string") seguras[k] = escapeHtml(v);
    return sanearV1(interpolateConsent(sanearV1(html), seguras as any));
  };
  for (const [nombre, html] of htmlViejoReal()) {
    assert.equal(consentHtmlToText(sanitizeTemplateHtml(html)), consentHtmlToText(sanearV1(html)), nombre);
    assert.equal(interpolateConsent(sanitizeTemplateHtml(html), vars), interpolateConsent(sanearV1(html), vars), nombre);
    assert.equal(interpolateDocumentHtml(html, vars), interpolarV1(html), nombre);
  }
});

/** Generador determinista: mismas pruebas en cada corrida. */
function azar(semilla: number) {
  let s = semilla >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

import { escapeHtml, MAX_INPUT_LENGTH } from "../sanitize";

test("diferencial: 3000 árboles de HTML viejo (con atributos basura) dan lo mismo que el saneador de antes", () => {
  const r = azar(20261021);
  const elegir = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const TEXTOS = ["Hola", "3 < 5", "O'Brien & Co", "&amp;", "&nbsp;", "[NOMBRE_PACIENTE]", "  ", "ñandú İ", "&lt;b&gt;", "\n", "a > b", '"cita"'];
  const BASURA = ['', ' class="x"', ' style="color:red"', ' onclick="alert(1)"', ' id=a', " data-y='1'", ' title="a>b"', " dir=ltr"];
  const BLOQUES = ["p", "h1", "h2", "h3", "div", "ul", "ol"];
  const MARCAS = ["b", "strong", "i", "em", "u"];
  const nodo = (prof: number, padre: string): string => {
    if (prof > 4 || r() < 0.3) return r() < 0.15 ? "<br>" : elegir(TEXTOS);
    let tag = padre === "ul" || padre === "ol" ? "li" : r() < 0.5 ? elegir(MARCAS) : elegir(BLOQUES);
    // Lo que el v2 normaliza a propósito (<li><p>, <li><div>) queda fuera de la comparación.
    if (padre === "li" && (tag === "p" || tag === "div")) tag = "b";
    const hijos = Array.from({ length: 1 + Math.floor(r() * 3) }, () => nodo(prof + 1, tag)).join("");
    return `<${tag}${elegir(BASURA)}>${hijos}</${tag}>`;
  };
  for (let k = 0; k < 3000; k++) {
    const html = Array.from({ length: 1 + Math.floor(r() * 4) }, () => nodo(0, "")).join("");
    assert.equal(sanitizeTemplateHtml(html), sanearV1(html), html);
  }
});

test("fuzz: 4000 sopas hostiles con las etiquetas nuevas salen válidas e idempotentes", () => {
  const r = azar(7);
  const elegir = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const PIEZAS = [
    "<p>", "</p>", "<li>", "</li>", "<ul>", "</ul>", "<table>", "</table>", "<tr>", "</tr>", "<td colspan=\"3\">", "</td>",
    "<th rowspan='2'>", "<tbody>", "</tbody>", "<span data-tamano=\"14\">", "<span>", "</span>", "<b>", "</b>", "<br>",
    `<img data-archivo="${ARCHIVO}" alt="x">`, "<img src=x onerror=alert(1)>", "<div data-tipo=\"columnas\" data-n=\"2\">",
    "<div data-tipo=\"columna\">", "<div data-tipo=\"linea-firma\" data-lado=\"centro\">", "<div data-tipo=\"salto-pagina\">",
    "<div>", "</div>", "<span data-marcador=\"FECHA\">", "<p data-sangria=\"3\" style=\"text-align:right\">", "<h2>", "</h2>",
    "<script>", "</script>", "<svg>", "<!--", "-->", "<", ">", "\"", "'", "&", "&lt;", "&#60;", "texto", " ", "<p onclick=x",
    "<a href=javascript:x>", "</a>", "<noscript>", "</noscript>", "<style>", "<img data-archivo='documentos/../x.webp'>",
  ];
  for (let k = 0; k < 4000; k++) {
    const html = Array.from({ length: 1 + Math.floor(r() * 40) }, () => elegir(PIEZAS)).join("");
    assertSegura(sanitizeTemplateHtml(html), html);
  }
});

test("v2: un cuerpo hostil con las etiquetas nuevas tampoco cuesta tiempo cuadrático", () => {
  const hostiles = [
    `<img src="`.repeat(40_000),
    `<img src="data:${"A".repeat(150_000)}`,
    `<img data-archivo="${ARCHIVO}">`.repeat(5_000),
    '<div data-tipo="salto-pagina">'.repeat(20_000),
    '<span data-marcador="FECHA">'.repeat(20_000),
    "<span>".repeat(60_000) + "</b>".repeat(10_000),
    "<td>".repeat(60_000),
    '<div data-tipo="linea-firma">'.repeat(20_000) + "<p>x".repeat(10_000),
    "<table><tr><td>".repeat(15_000),
    "<li><p>".repeat(30_000),
    `<p style="${"text-align:center;".repeat(50)}">`.repeat(200),
  ];
  for (const h of hostiles) {
    const t0 = performance.now();
    const out = sanitizeTemplateHtml(h);
    const ms = performance.now() - t0;
    assert.ok(ms < 1500, `${h.slice(0, 24)}… tardó ${Math.round(ms)} ms`);
    assertSegura(out, h.slice(0, 24));
  }
});

/* ─── 9. la maqueta: «Lo que se guardaría» pasa entero ─────────────────── */

/** Texto visible de un HTML, sin etiquetas, para comparar que no se perdió nada. */
function textoVisible(html: string): string {
  return html
    .replace(/<span>Nueva página<\/span>/g, "") // el rótulo del salto en el editor
    .replace(/<[^>]*>/g, " ")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}
const cuenta = (html: string, patron: RegExp) => html.match(patron)?.length ?? 0;

test("maqueta: lo que el editor enseña en «Lo que se guardaría» pasa entero en los tres contextos", () => {
  const ESTRUCTURA: [string, RegExp][] = [
    ["tablas", /<table>/g], ["celdas", /<t[hd][ >]/g], ["encabezados", /<th[ >]/g], ["ítems", /<li>/g],
    ["columnas", /data-tipo="columnas"/g], ["columna", /data-tipo="columna"/g], ["firmas", /data-tipo="linea-firma"/g],
    ["saltos", /data-tipo="salto-pagina"/g], ["sangrías", /data-sangria="1"/g], ["títulos", /<h[123]>/g],
    ["negritas", /<strong>/g], ["marcadores", /\[[A-Z_]+\]/g],
  ];
  for (const [nombre, html] of [["plantilla", MAQUETA_PLANTILLA], ["nota", MAQUETA_NOTA], ["consentimiento", MAQUETA_CONSENTIMIENTO]] as const) {
    // El contrato con P4: la imagen se guarda por su clave y la src la pone el cliente.
    const conClave = html.replace(/<img src="[^"]*"/g, `<img src="/api/documentos/imagenes/${ARCHIVO}" data-archivo="${ARCHIVO}"`);
    const out = sanitizeTemplateHtml(conClave);
    assertSegura(out, nombre);
    assert.equal(textoVisible(out), textoVisible(conClave), `${nombre}: se perdió texto`);
    for (const [que, patron] of ESTRUCTURA) {
      assert.equal(cuenta(out, patron), cuenta(conClave, patron), `${nombre}: ${que}`);
    }
    assert.equal(cuenta(out, /<img /g), cuenta(html, /<img /g), `${nombre}: imágenes`);
    assert.ok(!/src=|class=|style=|contenteditable/.test(out), `${nombre}: quedó un atributo del editor`);
    // Tal cual sale de la maqueta (imagen como data:), lo único que se cae es la imagen sin clave.
    const crudo = sanitizeTemplateHtml(html);
    assert.equal(crudo, out.replace(/<img [^>]*>/g, ""), `${nombre}: sin clave solo se va la imagen`);
    // Y la nota se rellena igual que siempre.
    const lleno = interpolateDocumentHtml(conClave, { clinicName: "Clínica QA", patientName: "Ana <b>", place: "Mérida" });
    assert.ok(!lleno.includes("[NOMBRE_PACIENTE]") && !lleno.includes("<b>") && cuenta(lleno, /<table>/g) === cuenta(out, /<table>/g), nombre);
  }
  // La alineación del título de la carta (style de TextAlign) se conserva como data-alineacion.
  assert.ok(sanitizeTemplateHtml(MAQUETA_CONSENTIMIENTO).startsWith('<p data-alineacion="centro"><strong>CARTA DE CONSENTIMIENTO INFORMADO</strong></p>'));
});
