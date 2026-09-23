/**
 * WS1-T1 · El consentimiento empieza EN BLANCO, como la nota de evolución.
 *
 * Run: npm run test:consent-en-blanco
 *
 * Rafael: «Necesito que esté por default en blanco así como la nota de
 * evolución y luego te deje elegir plantilla.» Antes el alta OBLIGABA a elegir
 * un procedimiento del catálogo, y una clínica sin plantillas no podía crear
 * ninguna carta. Estas pruebas FALLAN si vuelve el peaje:
 *  · la hoja en blanco sale del servidor con su CABECERA y sin tocar plantillas;
 *  · se crea una carta sin `templateId`, se FIRMA y sale entera en el PDF, con
 *    la cabecera y las cuatro líneas de firma;
 *  · cargar una plantilla sobre la hoja vacía la rellena, y sobre texto NO lo
 *    pisa: va debajo;
 *  · una clínica SIN plantillas crea su carta igual.
 *
 * Las rutas, el generador de la carta y el PDF son los REALES. Solo la base (y
 * la sesión, el almacenamiento y la imagen de la firma) son dobles, y un `where`
 * que no sabe evaluar LANZA: una prueba no pasa por accidente.
 */
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import Module from "node:module";
import path from "node:path";
import { combinarConPlantilla } from "@/lib/patient-documents/combinar-plantilla";
import { consentSeedTemplates } from "@/lib/consent/seed-templates";
import { textoVisiblePorPagina } from "@/lib/pdf/__tests__/_texto-del-pdf";

const RAIZ = path.join(__dirname, "../../../../..");
const leer = (ruta: string) => readFileSync(path.join(RAIZ, ruta), "utf8");

/* ─── la base falsa ────────────────────────────────────────────────────── */

type Fila = Record<string, any>;
let tablas: Record<string, Fila[]> = {};
let secuencia = 0;
/** Cuántas veces se leyó la tabla de plantillas. La hoja en blanco: cero. */
let lecturasDePlantilla = 0;

function cumple(f: Fila, where: Fila, modelo: string): boolean {
  for (const [clave, esperado] of Object.entries(where ?? {})) {
    if (esperado === undefined) {
      throw new Error(`base falsa: ${modelo}.where.${clave} es undefined (no filtraría nada)`);
    }
    if (esperado !== null && typeof esperado === "object" && !(esperado instanceof Date)) {
      throw new Error(`base falsa: ${modelo}.where.${clave} usa un operador que no sé evaluar`);
    }
    if ((f[clave] ?? null) !== esperado) return false;
  }
  return true;
}

function modelo(nombre: string, relaciones: Record<string, (f: Fila) => Fila | null> = {}) {
  const filas = () => (tablas[nombre] ??= []);
  const conRelaciones = (f: Fila, incluye?: Fila) => {
    const out: Fila = { ...f };
    // Solo las RELACIONES se resuelven; un `select` de columnas deja la fila entera.
    for (const r of Object.keys(incluye ?? {})) if (relaciones[r]) out[r] = relaciones[r](f);
    return out;
  };
  return {
    findFirst: async ({ where, include }: Fila) => {
      if (nombre === "documentTemplate") lecturasDePlantilla++;
      const f = filas().find((x) => cumple(x, where, nombre));
      return f ? conRelaciones(f, include) : null;
    },
    findUnique: async ({ where, select }: Fila) => {
      const f = filas().find((x) => cumple(x, where, nombre));
      return f ? conRelaciones(f, select) : null;
    },
    findMany: async ({ where }: Fila) => {
      if (nombre === "documentTemplate") lecturasDePlantilla++;
      return filas().filter((x) => cumple(x, where, nombre));
    },
    count: async ({ where }: Fila) => {
      if (nombre === "documentTemplate") lecturasDePlantilla++;
      return filas().filter((x) => cumple(x, where, nombre)).length;
    },
    create: async ({ data }: Fila) => {
      const f: Fila = {
        id: `${nombre}_${++secuencia}`, createdAt: new Date(), deletedAt: null,
        viewedAt: null, signedAt: null, signatureUrl: null, doctorSignedAt: null, doctorSignatureUrl: null,
        witness1Name: null, witness1SignedAt: null, witness1SignatureUrl: null,
        witness2Name: null, witness2SignedAt: null, witness2SignatureUrl: null,
        revokedAt: null, revokedReason: null, signedIp: null, signedUserAgent: null,
        ...data,
      };
      filas().push(f);
      return { ...f };
    },
    createMany: async ({ data }: Fila) => {
      for (const d of data) filas().push({ id: `${nombre}_${++secuencia}`, isActive: true, deletedAt: null, ...d });
      return { count: data.length };
    },
    updateMany: async ({ where, data }: Fila) => {
      const hits = filas().filter((x) => cumple(x, where, nombre));
      for (const f of hits) Object.assign(f, data);
      return { count: hits.length };
    },
  };
}

const prismaDoble = {
  patient: modelo("patient"),
  clinic: modelo("clinic"),
  user: modelo("user"),
  documentTemplate: modelo("documentTemplate"),
  consentForm: modelo("consentForm", {
    patient: (f) => tablas.patient.find((p) => p.id === f.patientId) ?? null,
    clinic: (f) => tablas.clinic.find((c) => c.id === f.clinicId) ?? null,
  }),
};

/** La sesión: la clínica sale de AQUÍ, nunca del cuerpo. */
let sesion = { clinicId: "cA", userId: "dA", role: "DOCTOR" };

const dobles = new Map<string, unknown>([
  [path.join(RAIZ, "src/lib/prisma.ts"), { prisma: prismaDoble }],
  [path.join(RAIZ, "src/lib/auth-context.ts"), { getAuthContext: async () => sesion }],
  [path.join(RAIZ, "src/lib/auth/require-permission.ts"), { denyIfMissingPermission: () => null }],
  [path.join(RAIZ, "src/lib/rate-limit.ts"), { rateLimit: () => null }],
  [path.join(RAIZ, "src/lib/audit.ts"), { logMutation: async () => undefined }],
  [path.join(RAIZ, "src/lib/patient-visibility.ts"), { assertPatientVisible: async () => null }],
  [path.join(RAIZ, "src/lib/storage.ts"), { signMaybeUrl: async () => "", BUCKETS: { PATIENT_FILES: "patient-files" } }],
  [
    path.join(RAIZ, "src/lib/consent/signature.ts"),
    {
      validateSignatureDataUrl: async (v: unknown) =>
        typeof v === "string" && v.startsWith("data:image/png")
          ? { error: null, buffer: Buffer.from("png") }
          : { error: "Firma inválida", status: 400 },
      uploadSignature: async (p: string) => p,
      signaturePath: (clinicId: string, id: string, quien: string) => `${clinicId}/${id}/${quien}.png`,
    },
  ],
]);
const M = Module as unknown as {
  _load: (req: string, parent: unknown, isMain: boolean) => unknown;
  _resolveFilename: (req: string, parent: unknown, isMain: boolean) => string;
};
const cargaOriginal = M._load;
M._load = function (req, parent, isMain) {
  if (req === "server-only" || req === "client-only") return {};
  let resuelto: string | null = null;
  try { resuelto = M._resolveFilename(req, parent, isMain); } catch { resuelto = null; }
  if (resuelto && dobles.has(resuelto)) return dobles.get(resuelto);
  return cargaOriginal.call(this, req, parent, isMain);
};

// Los `import` estáticos se izan por encima del parche: las rutas se cargan aquí.
let NextRequest: typeof import("next/server").NextRequest;
let crearCarta: typeof import("@/app/api/consent/route").POST;
let preview: typeof import("@/app/api/consent/preview/route").GET;
let plantillas: typeof import("@/app/api/consent/templates/route").GET;
let firmar: typeof import("@/app/api/consent/public/[token]/route").POST;
let leerPublica: typeof import("@/app/api/consent/public/[token]/route").GET;
let loadConsentDocumento: typeof import("@/lib/consent/consent-pdf").loadConsentDocumento;
let buildConsentPdf: typeof import("@/lib/consent/consent-pdf").buildConsentPdf;
let encabezadoDeCarta: typeof import("@/lib/consent/documento").encabezadoDeCarta;
let buildConsentDocumento: typeof import("@/lib/consent/documento").buildConsentDocumento;
before(async () => {
  ({ NextRequest } = await import("next/server"));
  ({ POST: crearCarta } = await import("@/app/api/consent/route"));
  ({ GET: preview } = await import("@/app/api/consent/preview/route"));
  ({ GET: plantillas } = await import("@/app/api/consent/templates/route"));
  ({ POST: firmar, GET: leerPublica } = await import("@/app/api/consent/public/[token]/route"));
  ({ loadConsentDocumento, buildConsentPdf } = await import("@/lib/consent/consent-pdf"));
  ({ encabezadoDeCarta, buildConsentDocumento } = await import("@/lib/consent/documento"));
});

/* ─── el mundo ─────────────────────────────────────────────────────────── */

const LIBRE = [
  "Se me explicó que la extracción del 38 consiste en retirar la muela del juicio bajo anestesia local.",
  "",
  "Riesgos: dolor, inflamación, sangrado y, con poca frecuencia, adormecimiento del labio.",
  "Alternativa: vigilarla con radiografías cada seis meses.",
].join("\n");

beforeEach(() => {
  secuencia = 0;
  lecturasDePlantilla = 0;
  sesion = { clinicId: "cA", userId: "dA", role: "DOCTOR" };
  tablas = {
    clinic: [
      { id: "cA", name: "Sonrisas del Valle", address: "Av. Juárez 12", city: "Puebla", phone: "222 555 0101",
        email: null, logoUrl: null, timezone: "America/Mexico_City" },
      // La clínica SIN plantillas: las borró todas (el `count` del sembrado las
      // sigue viendo, así que no se le vuelven a sembrar).
      { id: "cSIN", name: "Consultorio Ruiz", address: null, city: null, phone: null,
        email: null, logoUrl: null, timezone: null },
    ],
    patient: [
      { id: "p1", clinicId: "cA", firstName: "Ana", lastName: "López", dob: new Date("1990-01-01"),
        patientNumber: "P-0042", curp: "loaa900101mdfpnn09", curpStatus: null },
      { id: "p5", clinicId: "cSIN", firstName: "Beto", lastName: "Sáenz", dob: new Date("1985-05-05"),
        patientNumber: "7", curp: null, curpStatus: null },
    ],
    user: [
      { id: "dA", clinicId: "cA", isActive: true, firstName: "Laura", lastName: "Pérez",
        cedulaProfesional: "1234567", cedulaEspecialidad: null, especialidad: "Cirugía maxilofacial" },
      { id: "dS", clinicId: "cSIN", isActive: true, firstName: "Iván", lastName: "Ruiz",
        cedulaProfesional: null, cedulaEspecialidad: null, especialidad: null },
    ],
    documentTemplate: [
      ...consentSeedTemplates().slice(0, 2).map((t, i) => ({
        id: `t${i}`, clinicId: "cA", kind: "CONSENTIMIENTO", name: t.name, body: t.body, isActive: true, deletedAt: null,
      })),
      { id: "t_borrada", clinicId: "cSIN", kind: "CONSENTIMIENTO", name: "Vieja", body: "<p>x</p>",
        isActive: false, deletedAt: new Date("2026-09-01") },
    ],
    consentForm: [],
  };
});

const req = (url: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, body === undefined
    ? undefined
    : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

async function json(res: Response) {
  return { status: res.status, body: await res.json() };
}

/* ─── la hoja en blanco ────────────────────────────────────────────────── */

test("la hoja en blanco sale con su CABECERA y el texto vacío, sin leer ninguna plantilla", async () => {
  const { status, body } = await json(await preview(req("/api/consent/preview?patientId=p1&doctorId=dA")));
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.content, "");
  assert.equal(body.procedure, "");
  assert.equal(body.templateId, null);
  assert.equal(lecturasDePlantilla, 0, "la hoja en blanco no pasa por ninguna plantilla");

  const e = body.encabezado;
  assert.equal(e.pacienteNombre, "Ana López");
  assert.equal(e.pacienteCurp, "LOAA900101MDFPNN09");
  assert.equal(e.pacienteNumero, "P-0042");
  assert.equal(e.doctorNombre, "Laura Pérez");
  assert.equal(e.cedula, "1234567");
  assert.equal(e.doctorEspecialidad, "Cirugía maxilofacial");
  assert.equal(e.clinicaNombre, "Sonrisas del Valle");
  assert.equal(e.clinicaDireccion, "Av. Juárez 12, Puebla");
  assert.match(e.fecha, /de 2026$/);
  // El aviso de lo que falta, igual que con plantilla: aquí, el logo.
  assert.deepEqual(body.missing.map((m: Fila) => m.key), ["clinicLogo"]);
});

test("la cabecera del alta es la MISMA función que la de la carta guardada", () => {
  const src = {
    id: "x", procedure: "Endodoncia", content: "texto", createdAt: new Date("2026-09-19T18:00:00Z"),
    expiresAt: new Date("2026-09-26T18:00:00Z"), timeZone: "America/Mexico_City",
    clinicName: "Sonrisas del Valle", clinicAddress: null, clinicCity: "Puebla", clinicPhone: null, clinicLogoUrl: null,
    patientName: "Ana López", patientNumber: null, patientCurp: null, patientCurpStatus: "FOREIGN",
    signerName: null, signerRelation: null, doctorName: "", doctorLicense: null,
    doctorSpecialtyLicense: null, doctorSpecialty: null, signedAt: null, doctorSignedAt: null,
    revokedAt: null, revokedReason: null, contentHash: null, signedIp: null,
  };
  assert.deepEqual(encabezadoDeCarta(src), buildConsentDocumento(src, []).encabezado);
  // Sin doctor, la raya (como el PDF), no un hueco mudo.
  assert.equal(encabezadoDeCarta(src).doctorNombre.startsWith("_"), true);
});

/* ─── crear una en blanco y firmarla ───────────────────────────────────── */

test("se crea una carta EN BLANCO (sin templateId), se firma y sale entera en la hoja y en el PDF", async () => {
  const alta = await json(await crearCarta(req("/api/consent", {
    patientId: "p1", doctorId: "dA", procedure: "Extracción del tercer molar", content: LIBRE,
  })));
  assert.equal(alta.status, 201, JSON.stringify(alta.body));
  assert.equal(lecturasDePlantilla, 0, "una carta libre no toca la tabla de plantillas");

  const fila = tablas.consentForm[0];
  assert.equal(fila.clinicId, "cA", "la clínica de la SESIÓN");
  assert.equal(fila.content, LIBRE, "se guarda EXACTAMENTE lo escrito");
  assert.equal(fila.procedure, "Extracción del tercer molar", "el acto es el que enseñaba la hoja");
  assert.equal(fila.procedureKey, null);
  assert.equal(fila.contentHash, createHash("sha256").update(LIBRE, "utf8").digest("hex"));

  // El paciente la abre y firma desde su liga.
  const leida = await json(await leerPublica(req(`/api/consent/public/${fila.token}`), { params: { token: fila.token } }));
  assert.equal(leida.body.content, LIBRE);
  const firma = await json(await firmar(
    req(`/api/consent/public/${fila.token}`, { signatureDataUrl: "data:image/png;base64,AAAA" }),
    { params: { token: fila.token } },
  ));
  assert.equal(firma.status, 200, JSON.stringify(firma.body));
  assert.ok(fila.signedAt instanceof Date);
  assert.equal(fila.content, LIBRE, "firmar no toca el texto");

  // La hoja del panel: la cabecera y las firmas salen aunque el texto sea libre.
  const doc = await loadConsentDocumento(fila.id, "cA");
  assert.ok(doc);
  assert.equal(doc.status, "SIGNED");
  assert.equal(doc.titulo, "Extracción del tercer molar");
  assert.equal(doc.encabezado.doctorNombre, "Laura Pérez");
  assert.equal(doc.encabezado.pacienteCurp, "LOAA900101MDFPNN09");
  assert.ok(doc.html.includes("vigilarla con radiografías"));
  assert.deepEqual(doc.firmas.map((f) => f.role), ["Paciente", "Estomatólogo responsable"]);
  assert.ok(doc.firmas[0].firmadoEl, "la del paciente, ya firmada");

  // Y el PDF, leído de verdad.
  const pdf = await buildConsentPdf(fila.id, "cA");
  assert.ok(pdf);
  const texto = textoVisiblePorPagina(pdf.buffer).join(" ").replace(/\s+/g, " ");
  for (const debe of [
    "Sonrisas del Valle", "Ana López", "LOAA900101MDFPNN09", "P-0042", "Laura Pérez", "1234567",
    "Cirugía maxilofacial", "Puebla, a", "Extracción del tercer molar", "vigilarla con radiografías",
    "PACIENTE", "ESTOMATÓLOGO RESPONSABLE", "firmado electrónicamente", `SHA-256): ${fila.contentHash}`,
  ]) {
    assert.ok(texto.includes(debe), `el PDF no trae «${debe}»: ${texto}`);
  }
});

test("sin firmar, el PDF de una carta libre trae las CUATRO líneas de firma para el papel", async () => {
  await crearCarta(req("/api/consent", { patientId: "p1", procedure: "Limpieza", content: "Texto propio." }));
  const pdf = await buildConsentPdf(tablas.consentForm[0].id, "cA");
  const texto = textoVisiblePorPagina(pdf!.buffer).join(" ");
  assert.match(texto, /PACIENTE[\s\S]*ESTOMATÓLOGO RESPONSABLE[\s\S]*TESTIGO 1[\s\S]*TESTIGO 2/);
  assert.equal((texto.match(/Fecha: ____/g) ?? []).length, 4);
});

test("sin el nombre del acto la carta libre NO se crea: es su título y lo que se autoriza", async () => {
  for (const cuerpo of [{ content: LIBRE }, { content: LIBRE, procedure: "   " }, { procedure: "Limpieza", content: "  " }]) {
    const r = await json(await crearCarta(req("/api/consent", { patientId: "p1", ...cuerpo })));
    assert.equal(r.status, 400, JSON.stringify(cuerpo));
  }
  assert.equal(tablas.consentForm.length, 0);
});

test("un menor sigue necesitando representante legal, aunque la carta sea libre", async () => {
  tablas.patient[0].dob = new Date("2015-03-03");
  const sin = await json(await crearCarta(req("/api/consent", { patientId: "p1", procedure: "Sellador", content: LIBRE })));
  assert.equal(sin.status, 400);
  const con = await json(await crearCarta(req("/api/consent", {
    patientId: "p1", procedure: "Sellador", content: LIBRE, signerName: "Rosa López", signerRelation: "madre",
  })));
  assert.equal(con.status, 201, JSON.stringify(con.body));
});

/* ─── la plantilla: opcional, y no pisa ────────────────────────────────── */

test("cargar una plantilla sobre la hoja VACÍA la rellena con los datos del caso", async () => {
  const { body } = await json(await preview(req("/api/consent/preview?patientId=p1&doctorId=dA&templateId=t0")));
  assert.equal(body.templateId, "t0");
  assert.equal(body.procedure, tablas.documentTemplate[0].name);
  assert.ok(body.content.includes("Nombre del paciente: Ana López"));
  assert.ok(body.content.includes("Nombre: Laura Pérez"));
  assert.ok(!/\[[A-Z_]+\]/.test(body.content), "ningún marcador sin rellenar");
  // La cabecera viene también con plantilla: es la misma hoja.
  assert.equal(body.encabezado.doctorNombre, "Laura Pérez");

  const r = combinarConPlantilla("", "", body.content, "\n\n");
  assert.deepEqual(r, { html: body.content, anadida: false });
  // Y también con solo saltos de línea: sin TEXTO la hoja sigue vacía.
  assert.equal(combinarConPlantilla("\n\n  ", "\n\n  ", body.content, "\n\n").anadida, false);
});

test("cargar una plantilla sobre texto escrito NO lo pisa: va debajo, tras una línea en blanco", async () => {
  const { body } = await json(await preview(req("/api/consent/preview?patientId=p1&templateId=t1")));
  const escrito = "Pieza 36 con fractura vertical.\n";
  const r = combinarConPlantilla(escrito, escrito, body.content, "\n\n");
  assert.equal(r.anadida, true);
  assert.ok(r.html.startsWith("Pieza 36 con fractura vertical.\n\nCARTA DE CONSENTIMIENTO"), r.html.slice(0, 80));
  assert.ok(r.html.endsWith(body.content));

  // Y lo combinado se guarda ENTERO, con el acto que se escribió a mano.
  const alta = await json(await crearCarta(req("/api/consent", {
    patientId: "p1", templateId: "t1", procedure: "Endodoncia del 36", content: r.html,
  })));
  assert.equal(alta.status, 201, JSON.stringify(alta.body));
  assert.equal(tablas.consentForm[0].content, r.html);
  assert.equal(tablas.consentForm[0].procedure, "Endodoncia del 36", "gana el acto que enseñaba la hoja");
});

test("la nota de evolución sigue igual: sin separador, el HTML se pega tal cual", () => {
  assert.deepEqual(
    combinarConPlantilla("<p>Escrito.</p>", "Escrito.", "<p>Plantilla</p>"),
    { html: "<p>Escrito.</p><p>Plantilla</p>", anadida: true },
  );
});

test("una plantilla de OTRA clínica no se carga ni se cuela en el alta", async () => {
  sesion = { clinicId: "cSIN", userId: "dS", role: "DOCTOR" };
  const p = await preview(req("/api/consent/preview?patientId=p5&templateId=t0"));
  assert.equal(p.status, 404);
  const alta = await crearCarta(req("/api/consent", { patientId: "p5", templateId: "t0", procedure: "X", content: "Y" }));
  assert.equal(alta.status, 404);
  assert.equal(tablas.consentForm.length, 0);
});

/* ─── una clínica sin plantillas escribe igual ─────────────────────────── */

test("una clínica SIN plantillas: la lista sale vacía y aun así abre la hoja y crea su carta", async () => {
  sesion = { clinicId: "cSIN", userId: "dS", role: "DOCTOR" };
  const lista = await json(await plantillas(req("/api/consent/templates")));
  assert.deepEqual(lista.body, { templates: [], fallback: false });

  const hoja = await json(await preview(req("/api/consent/preview?patientId=p5&doctorId=dS")));
  assert.equal(hoja.status, 200, JSON.stringify(hoja.body));
  assert.equal(hoja.body.encabezado.pacienteNombre, "Beto Sáenz");
  assert.equal(hoja.body.encabezado.doctorNombre, "Iván Ruiz");

  const alta = await json(await crearCarta(req("/api/consent", {
    patientId: "p5", procedure: "Resina en el 11", content: "Texto de la clínica, escrito a mano.",
  })));
  assert.equal(alta.status, 201, JSON.stringify(alta.body));
  assert.equal(tablas.consentForm[0].clinicId, "cSIN");
  assert.equal(tablas.consentForm[0].doctorId, "dS", "sin elegir doctor, responde quien la crea");
});

/* ─── el peaje no vuelve ───────────────────────────────────────────────── */

test("el servidor no exige plantilla ni en la vista previa ni en el alta", () => {
  const prev = leer("src/app/api/consent/preview/route.ts");
  assert.ok(!/!template && !templateId/.test(prev), "la vista previa vuelve a exigir plantilla");
  assert.ok(!prev.includes("template!."), "la vista previa vuelve a dar por hecha la plantilla");
});

test("la pantalla abre la HOJA, la plantilla es un botón del editor y no manda a Plantillas", () => {
  const tab = leer("src/components/dashboard/patient-detail/consents-tab.tsx");
  const editor = leer("src/components/dashboard/patient-detail/consent-editor.tsx");
  for (const [nombre, src] of [["consents-tab", tab], ["consent-editor", editor]] as const) {
    assert.ok(src.startsWith('"use client";'), nombre);
    assert.ok(!src.includes("/dashboard/plantillas"), `${nombre}: ese enlace era el callejón`);
    assert.ok(!src.includes("fieldTemplate"), `${nombre}: vuelve el selector obligatorio`);
  }
  assert.ok(tab.includes("<ConsentEditor"), "«Nuevo consentimiento» abre el editor");
  assert.ok(/abrirNueva[\s\S]*urlPreviewCarta\(\{ patientId, doctorId: doctorInicial \}\)/.test(tab),
    "la hoja se pide SIN templateId");
  // Lo compartido con la nota: el mismo menú y la misma regla de no pisar.
  assert.ok(editor.includes("<MenuPlantillas"));
  assert.ok(leer("src/components/dashboard/nota-evolucion/nota-evolucion-panel.tsx").includes("<MenuPlantillas"));
  assert.ok(editor.includes('combinarConPlantilla(texto, texto, rellena.content, "\\n\\n")'));
  // `templateId` solo viaja si se usó una plantilla.
  assert.ok(editor.includes("...(plantillaUsada.current ? { templateId: plantillaUsada.current } : {})"));
  // Lo que se firma es lo que se ve: el acto y el texto de la hoja, sin recortes.
  assert.ok(editor.includes("procedure: acto.trim(),") && editor.includes("content: texto,"));
});

test("es.json y en.json llevan las claves del editor, las mismas y sin vacías", () => {
  const es = JSON.parse(leer("src/i18n/dictionaries/es.json")).patients.consents;
  const en = JSON.parse(leer("src/i18n/dictionaries/en.json")).patients.consents;
  assert.deepEqual(Object.keys(es.editor).sort(), Object.keys(en.editor).sort());
  for (const d of [es, en]) {
    for (const [k, v] of Object.entries(d.editor)) assert.ok(typeof v === "string" && v.trim(), `editor.${k}`);
    assert.ok(d.editor.templateApplied.includes("{name}"));
    assert.equal(d.templatesEmpty, undefined, "el aviso que mandaba a Administración → Plantillas ya no existe");
    assert.ok(!/Plantillas|Templates/.test(d.editor.templatesEmpty.replace(/plantillas?|templates?/g, "")),
      "el aviso de «sin plantillas» no manda a ninguna parte");
  }
});
