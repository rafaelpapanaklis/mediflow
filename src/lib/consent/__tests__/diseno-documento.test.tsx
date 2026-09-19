/**
 * EL CONSENTIMIENTO CON EL LENGUAJE DE LOS DOCUMENTOS DEL PACIENTE (ws1-t3).
 *
 * Run: npm run test:consent-diseno
 *
 *   · una carta VIEJA —sin huella, sin doctor guardado, con el texto escrito a
 *     mano y sin secciones numeradas— se abre en la hoja nueva, se imprime
 *     (la copia de papel es esa misma hoja) y sale en el PDF, entera;
 *   · sin firmar, PDF y hoja llevan las líneas en blanco del paciente y del
 *     doctor (y las dos de testigos); firmada, solo quien firmó;
 *   · sin CURP, el renglón sale etiquetado y vacío: nunca "undefined", "null"
 *     ni un dato inventado;
 *   · la carta usa lo COMÚN (hoja, barra, aviso, impresión) y no una copia.
 *
 * El PDF se lee DE VERDAD (`renderToBuffer` + los flujos del archivo) y la hoja
 * se PINTA con React; no se mira el árbol.
 */
import Module from "node:module";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { ConsentDocument, type ConsentDocumentProps } from "@/lib/pdf/consent-document";
import { textoVisiblePorPagina } from "@/lib/pdf/__tests__/_texto-del-pdf";
import { buildSignatureBlocks, type SignatureBlocksInput } from "../signers";
import { buildConsentDocumento, type ConsentDocumentSource } from "../documento";
import { consentTextToBodyHtml } from "../template-html";

const SRC = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

// ── La hoja se pinta con los textos de verdad y las clases tal cual ────────
const dict = JSON.parse(leer("i18n/dictionaries/es.json")) as Record<string, unknown>;
function t(clave: string, vars?: Record<string, unknown>): string {
  let nodo: unknown = dict;
  for (const parte of clave.split(".")) nodo = (nodo as Record<string, unknown> | undefined)?.[parte];
  if (nodo && typeof nodo === "object") nodo = (nodo as Record<string, string>)[Number(vars?.count) === 1 ? "one" : "other"];
  if (typeof nodo !== "string") return clave;
  return nodo.replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? ""));
}
const M = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
const cargarOriginal = M._load;
const clasesTalCual = new Proxy({}, { get: (_, k) => String(k) });
M._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request.endsWith(".module.css")) return { __esModule: true, default: clasesTalCual };
  if (request.endsWith("i18n/i18n-provider")) return { useT: () => t };
  // `next/font` solo existe dentro del compilador de Next: aquí bastan las clases.
  if (request.endsWith("menu-dos-niveles/clases")) return { CLASES_MENU: "clasesMenu" };
  if (request.endsWith("ui/confirm-dialog")) return { useConfirm: () => async () => true };
  return cargarOriginal.call(this, request, parent, isMain);
};
const { ConsentHoja, rutasDeConsentimiento } =
  require("@/components/dashboard/patient-detail/consent-documento") as typeof import("@/components/dashboard/patient-detail/consent-documento");

// ── Los datos ──────────────────────────────────────────────────────────────

/** Como las 4 de producción: texto libre, sin secciones, sin huella y sin doctor guardado. */
const TEXTO_VIEJO = [
  "Yo, Ana López, autorizo la extracción del tercer molar inferior derecho.",
  "Me explicaron los riesgos <y> las alternativas & estoy de acuerdo.",
  "",
  "• Inflamación durante tres días",
  "• Sangrado leve",
].join("\n");

const TEXTO_NUEVO = [
  "CARTA DE CONSENTIMIENTO INFORMADO",
  "",
  "Establecimiento: Clínica Demo",
  "",
  "3. ACTO QUE SE AUTORIZA",
  "Procedimiento: Extracción dental simple",
  "",
  "12. FIRMAS",
  "Firman el paciente y el estomatólogo responsable.",
].join("\n");

const VIEJA: ConsentDocumentSource = {
  id: "cns_viejo_0001",
  procedure: "Extracción de tercer molar",
  content: TEXTO_VIEJO,
  createdAt: new Date("2026-03-02T16:00:00Z"),
  expiresAt: new Date("2026-03-09T16:00:00Z"),
  timeZone: "America/Mexico_City",
  clinicName: "Rafael Clinica",
  clinicAddress: null,
  clinicCity: null,
  clinicPhone: null,
  clinicLogoUrl: null,
  patientName: "Ana López",
  patientNumber: null,
  patientCurp: null,
  patientCurpStatus: null,
  signerName: null,
  signerRelation: null,
  doctorName: "",
  doctorLicense: null,
  doctorSpecialtyLicense: null,
  doctorSpecialty: null,
  signedAt: new Date("2026-03-02T16:20:00Z"),
  doctorSignedAt: null,
  revokedAt: null,
  revokedReason: null,
  contentHash: null,
  signedIp: null,
};

const FIRMA_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function bloques(src: ConsentDocumentSource, over: Partial<SignatureBlocksInput> = {}) {
  return buildSignatureBlocks({
    patientName: src.patientName,
    signerName: src.signerName,
    signerRelation: src.signerRelation,
    doctorName: src.doctorName,
    signedAt: src.signedAt,
    doctorSignedAt: src.doctorSignedAt,
    witness1Name: null, witness1SignedAt: null, witness2Name: null, witness2SignedAt: null,
    patientSig: src.signedAt ? FIRMA_PNG : null,
    doctorSig: src.doctorSignedAt ? FIRMA_PNG : null,
    witness1Sig: null, witness2Sig: null,
    ...over,
  });
}

function propsPdf(src: ConsentDocumentSource): ConsentDocumentProps {
  return {
    clinicName: src.clinicName, clinicAddress: src.clinicAddress, clinicCity: src.clinicCity,
    clinicPhone: src.clinicPhone, clinicEmail: null, logoDataUrl: null,
    procedure: src.procedure, place: src.clinicCity, issuedAt: src.createdAt.toISOString(),
    timeZone: src.timeZone,
    patientName: src.patientName, patientNumber: src.patientNumber, patientCurp: src.patientCurp,
    signerName: src.signerName, signerRelation: src.signerRelation,
    doctorName: src.doctorName || null, doctorLicense: src.doctorLicense,
    doctorSpecialtyLicense: src.doctorSpecialtyLicense, doctorSpecialty: src.doctorSpecialty,
    content: src.content, signatures: bloques(src),
    contentHash: src.contentHash, signedIp: src.signedIp, signedUserAgent: null,
    signedAt: src.signedAt ? src.signedAt.toISOString() : null,
    revokedAt: src.revokedAt ? src.revokedAt.toISOString() : null, revokedReason: src.revokedReason,
  };
}

async function textoDelPdf(src: ConsentDocumentSource): Promise<string> {
  const pdf = await renderToBuffer(<ConsentDocument {...propsPdf(src)} />);
  return textoVisiblePorPagina(pdf).join(" ");
}

const AHORA = new Date("2026-09-19T12:00:00Z");
const hoja = (src: ConsentDocumentSource) =>
  renderToStaticMarkup(<ConsentHoja doc={buildConsentDocumento(src, bloques(src), AHORA)} />);

const SIN_BASURA = /undefined|null|NaN|\[object/;

const NUEVA_SIN_FIRMAR: ConsentDocumentSource = {
  ...VIEJA,
  id: "cns_nueva_0001",
  content: TEXTO_NUEVO,
  procedure: "Extracción dental simple",
  clinicName: "Clínica Demo",
  doctorName: "Dra. Marta Ruiz",
  doctorLicense: "1234567",
  doctorSpecialty: "Endodoncia",
  patientNumber: "P-0042",
  patientCurp: "LOAA900101MDFPNN09",
  signedAt: null,
  contentHash: "abc123",
};

// ═══════════════════════════════════════════════════════════════════════════

describe("una carta VIEJA en la pantalla nueva", () => {
  it("se abre: la hoja trae el texto entero, escapado, y ninguna basura", () => {
    const doc = buildConsentDocumento(VIEJA, bloques(VIEJA), AHORA);
    assert.equal(doc.status, "SIGNED");
    assert.equal(doc.tipo, null, "el texto viejo no trae título: lo pone la pantalla");
    const html = hoja(VIEJA);
    assert.ok(html.includes("autorizo la extracción del tercer molar inferior derecho"));
    assert.ok(html.includes("los riesgos &lt;y&gt; las alternativas &amp; estoy de acuerdo"), "el texto no salió escapado");
    assert.ok(html.includes("<li>Inflamación durante tres días</li>"));
    assert.ok(html.includes(t("consentDoc.kind")), "sin título propio, el sello es el de la pantalla");
    assert.ok(html.includes("Extracción de tercer molar"));
    assert.doesNotMatch(html, SIN_BASURA);
  });

  it("sin doctor guardado: la hoja pone la raya donde el PDF la pone, no un hueco mudo", async () => {
    const doc = buildConsentDocumento(VIEJA, bloques(VIEJA), AHORA);
    assert.equal(doc.encabezado.doctorNombre, "______");
    assert.match(await textoDelPdf(VIEJA), /ESTOMATÓLOGO RESPONSABLE\s*______/);
  });

  it("sin huella ni IP, la evidencia no las inventa", () => {
    const html = hoja(VIEJA);
    assert.ok(!html.includes("SHA-256"));
    assert.ok(!html.includes("IP "));
    assert.ok(html.includes(t("consentDoc.evidenceDigital")));
  });

  it("se imprime: la copia de papel es ESA hoja, en el portal común y sin barra", () => {
    const visor = leer("components/dashboard/patient-detail/consent-documento.tsx");
    assert.match(visor, /const hoja = <ConsentHoja doc=\{doc\} \/>;/);
    const portal = visor.slice(visor.indexOf("createPortal("));
    assert.match(portal, /ATRIBUTO_IMPRESION/);
    assert.match(portal, /CSS_IMPRESION/);
    assert.match(portal, /\{hoja\}/);
    assert.ok(!portal.slice(0, portal.indexOf("document.body")).includes("DocumentoAcciones"), "la barra no va en la copia de papel");
  });

  it("sale en el PDF, entera y sin basura", async () => {
    const texto = await textoDelPdf(VIEJA);
    assert.match(texto, /autorizo la extracción del tercer molar inferior derecho/);
    assert.match(texto, /Sangrado leve/);
    assert.match(texto, /Rafael Clinica/);
    assert.match(texto, /Firmado el /);
    assert.doesNotMatch(texto, SIN_BASURA);
  });

  it("las cuatro acciones pegan a las rutas de la carta, y sin permiso no hay envío", () => {
    assert.deepEqual(rutasDeConsentimiento("c1", { whatsapp: true, correo: true }), {
      pdf: "/api/consent/c1/pdf",
      whatsapp: "/api/consent/c1/send-whatsapp",
      correo: "/api/consent/c1/email",
    });
    assert.deepEqual(rutasDeConsentimiento("c1", { whatsapp: false, correo: false }), {
      pdf: "/api/consent/c1/pdf", whatsapp: null, correo: null,
    });
  });
});

describe("las dos firmas, en las dos vías", () => {
  it("SIN firmar: PDF con las líneas en blanco de paciente y doctor (y dos testigos)", async () => {
    const texto = await textoDelPdf(NUEVA_SIN_FIRMAR);
    assert.match(texto, /PACIENTE.*Ana López/);
    assert.match(texto, /ESTOMATÓLOGO RESPONSABLE.*Dra\. Marta Ruiz/);
    assert.equal((texto.match(/Fecha: ____/g) ?? []).length, 4);
    assert.doesNotMatch(texto, /Firmado el /);
    assert.doesNotMatch(texto, /Firma pendiente/);
    assert.match(texto, /firma autógrafa/);
  });

  it("SIN firmar: la hoja que se imprime lleva las mismas cuatro líneas en blanco", () => {
    const html = hoja(NUEVA_SIN_FIRMAR);
    assert.equal(html.split(t("consentDoc.dateBlank")).length - 1, 4);
    assert.ok(!html.includes("<img"), "no hay ninguna firma que pintar");
    assert.ok(html.includes("Testigo 1") && html.includes("Testigo 2"));
    assert.ok(html.includes(t("consentDoc.evidencePaper")));
  });

  it("FIRMADA por los dos: solo ellos, con su fecha, y ni una línea por llenar", async () => {
    const src = {
      ...NUEVA_SIN_FIRMAR,
      signedAt: new Date("2026-09-18T15:30:00Z"),
      doctorSignedAt: new Date("2026-09-18T16:00:00Z"),
    };
    const texto = await textoDelPdf(src);
    assert.equal((texto.match(/Firmado el /g) ?? []).length, 2);
    assert.doesNotMatch(texto, /TESTIGO/);
    assert.doesNotMatch(texto, /Fecha: ____/);

    const html = hoja(src);
    assert.equal(html.split("<img").length - 1, 2, "dos firmas, dos imágenes");
    assert.ok(!html.includes("Testigo"));
    assert.ok(!html.includes(t("consentDoc.dateBlank")));
    assert.ok(!html.includes(t("consentDoc.signaturePending")));
  });

  it("firmó el paciente y el doctor todavía no: al doctor le falta FIRMAR, no llenar una fecha", async () => {
    const src = { ...NUEVA_SIN_FIRMAR, signedAt: new Date("2026-09-18T15:30:00Z") };
    const texto = await textoDelPdf(src);
    assert.equal((texto.match(/Firmado el /g) ?? []).length, 1);
    assert.match(texto, /Firma pendiente/);
    assert.doesNotMatch(texto, /Fecha: ____/);
    const html = hoja(src);
    assert.equal(html.split("<img").length - 1, 1);
    assert.ok(html.includes(t("consentDoc.signaturePending")));
  });

  it("con representante legal firma él, y la hoja lo dice", () => {
    const src = { ...NUEVA_SIN_FIRMAR, signerName: "Luis López", signerRelation: "padre" };
    const html = hoja(src);
    assert.ok(html.includes("Representante legal"));
    assert.ok(html.includes("Luis López (padre)"));
  });

  it("revocada: la hoja lo dice arriba, con su motivo", () => {
    const src = {
      ...NUEVA_SIN_FIRMAR,
      signedAt: new Date("2026-09-18T15:30:00Z"),
      revokedAt: new Date("2026-09-19T10:00:00Z"),
      revokedReason: "El paciente cambió de opinión",
    };
    const doc = buildConsentDocumento(src, bloques(src), AHORA);
    assert.equal(doc.status, "REVOKED");
    const html = hoja(src);
    assert.ok(html.includes("El paciente cambió de opinión"));
    assert.ok(html.indexOf("revocado") < html.indexOf("cuerpo"), "el aviso de revocación va antes del texto");
  });
});

describe("sin CURP", () => {
  it("PDF: «CURP: ______», etiquetado y vacío", async () => {
    const texto = await textoDelPdf(VIEJA);
    assert.match(texto, /CURP: ______/);
    assert.match(texto, /ID del paciente: ______/);
    assert.match(texto, /Cédula profesional: ______/);
    assert.match(texto, /Dirección: ______/);
    assert.doesNotMatch(texto, SIN_BASURA);
  });

  it("hoja: el renglón CURP sale con su raya para llenar, no con un valor", () => {
    const html = hoja(VIEJA);
    const curp = html.slice(html.indexOf("CURP:"));
    assert.ok(html.includes("CURP:"), "el renglón no puede desaparecer");
    assert.match(curp.slice(0, 200), new RegExp(`class="raya"[^>]*aria-label="${t("documentosPaciente.hoja.blank")}"`));
    assert.doesNotMatch(html, SIN_BASURA);
  });

  it("el aviso nombra el CURP entre lo que falta; a un extranjero no se le reclama", () => {
    const claves = (s: ConsentDocumentSource) => buildConsentDocumento(s, bloques(s), AHORA).faltantes.map((f) => f.key);
    // La vieja no guardó doctor: no se manda a nadie a Equipo a capturar la cédula de nadie.
    assert.deepEqual(claves(VIEJA), ["clinicAddress", "clinicLogo", "patientCurp"]);
    assert.deepEqual(
      claves({ ...VIEJA, doctorName: "Dra. Marta Ruiz" }),
      ["clinicAddress", "clinicLogo", "doctorLicense", "doctorSpecialty", "patientCurp"],
    );
    const extranjero = { ...VIEJA, patientCurpStatus: "FOREIGN" };
    assert.ok(!claves(extranjero).includes("patientCurp"));
    assert.ok(!hoja(extranjero).includes("CURP:"), "sin CURP que llenar, no hay renglón");
  });
});

describe("usa lo común, no una copia", () => {
  const visor = leer("components/dashboard/patient-detail/consent-documento.tsx");
  const css = leer("components/dashboard/patient-detail/consent-documento.module.css");

  it("hoja, barra, aviso e impresión salen de documentos-paciente/", () => {
    for (const pieza of ["documento-hoja", "documento-acciones", "aviso-datos-faltantes", "impresion"]) {
      assert.ok(visor.includes(`documentos-paciente/${pieza}"`), `no importa ${pieza}`);
    }
    assert.ok(!/window\.print|<a[^>]+download/.test(visor), "imprimir y descargar son de la barra común");
  });

  it("ni un hex a mano en la pantalla", () => {
    const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(sinComentarios(css), /#[0-9a-fA-F]{3,8}\b/);
    assert.doesNotMatch(sinComentarios(visor), /#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });

  it("el cuerpo de la carta solo usa etiquetas sin atributos", () => {
    const html = consentTextToBodyHtml(TEXTO_NUEVO + "\n<script>alert(1)</script>");
    assert.ok(!html.includes("<script"));
    assert.doesNotMatch(html, /<[a-z0-9]+\s[^>]*>/i);
    assert.ok(!html.includes("<h1"), "el título lo pone la hoja, no el cuerpo");
    assert.ok(html.includes("<h2>3. ACTO QUE SE AUTORIZA</h2>"));
  });
});
