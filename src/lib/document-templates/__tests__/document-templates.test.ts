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
