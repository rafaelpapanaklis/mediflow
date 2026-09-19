/**
 * LAS SALIDAS DE UN DOCUMENTO DEL PACIENTE: PDF, WhatsApp, imprimir y el aviso.
 *
 * Run: npm run test:documento-salidas
 *
 *   · el PDF de una nota firmada trae el texto TAL Y COMO SE FIRMÓ, no el de la
 *     plantilla (que además ni se consulta);
 *   · sin logo o sin cédula, el PDF deja el hueco etiquetado y NO inventa nada;
 *   · mandar por WhatsApp fuera de la ventana de 24 h no falla en silencio;
 *   · la barra de acciones NO sale al imprimir;
 *   · el aviso de faltantes es UNO, y el consentimiento usa el mismo.
 *
 * El PDF se lee DE VERDAD (`renderToBuffer` + los flujos del archivo), no el
 * árbol de React.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { getNota, faltantesDe, leerEncabezado, type NotaDb } from "@/app/api/patient-documents/_lib/service";
import { notaParaPdf } from "@/app/api/patient-documents/_lib/nota-pdf";
import { renderizarPdf, nombreDeArchivo } from "../pdf";
import { htmlABloques, htmlATexto } from "../html-a-bloques";
import { correoDelDocumento, explicarFalloDeWhatsApp, mensajeDeWhatsApp } from "../envio";
import { datosFaltantes, RAYA_PARA_LLENAR } from "../faltantes";
import { missingConsentData, CONSENT_BLANK } from "@/lib/consent/document-data";
import { decideSendMode } from "@/lib/whatsapp/send-mode";
import { WhatsAppBlockedError } from "@/lib/whatsapp/errors";
import { ATRIBUTO_ACCIONES, ATRIBUTO_IMPRESION, CSS_IMPRESION } from "@/components/dashboard/documentos-paciente/impresion";
import { textoVisiblePorPagina } from "@/lib/pdf/__tests__/_texto-del-pdf";
import { makePng } from "@/lib/pdf/__tests__/_imagenes-de-prueba";

const TEXTO_PLANTILLA = "TEXTO DE LA PLANTILLA que nadie firmó";
const TEXTO_FIRMADO = "Paciente refiere dolor en el 36. Se realiza pulpotomía de urgencia.";

const FOTO_COMPLETA = {
  pacienteNombre: "Ana López", fecha: "19 de septiembre de 2026", clinicaNombre: "Dental Sol",
  logoUrl: "https://cdn/logo.png", doctorNombre: "Laura Pérez", cedula: "1234567",
  clinicaDireccion: "Calle 60 #123, Mérida, Yucatán", clinicaTelefono: "999 123 4567",
  doctorEspecialidad: "Endodoncia", doctorCedulaEspecialidad: "7654321",
  pacienteNumero: "P-0042", pacienteCurp: "LOAA900101MYNPNN09", pacienteSinCurp: false,
};

/** Una base que SOLO sabe devolver la fila de la nota. Tocar la plantilla revienta. */
function baseCon(fila: Record<string, unknown>): NotaDb {
  const prohibido = (que: string) => () => {
    throw new Error(`leer una nota no puede consultar ${que}`);
  };
  return {
    patientDocument: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        where.id === fila.id && where.clinicId === fila.clinicId && where.kind === fila.kind ? { ...fila } : null,
    },
    documentTemplate: { findFirst: prohibido("la plantilla"), findMany: prohibido("la plantilla") },
    patient: { findFirst: prohibido("el paciente") },
    clinic: { findUnique: prohibido("la clínica") },
    user: { findFirst: prohibido("el doctor") },
  } as unknown as NotaDb;
}

function fila(encabezado: Record<string, unknown>, body = `<p>${TEXTO_FIRMADO}</p>`) {
  return {
    id: "nota-0001-abcdef", clinicId: "cA", kind: "NOTA_EVOLUCION", title: "Nota de urgencia",
    status: "SIGNED", signedAt: new Date("2026-09-19T20:30:00Z"), createdAt: new Date("2026-09-19T20:00:00Z"),
    doctorId: "dA", templateId: "plantilla-1", encabezado, body,
  };
}

async function textoDelPdf(encabezado: Record<string, unknown>, logo: Buffer | null = null, body?: string) {
  const nota = await getNota(baseCon(fila(encabezado, body)), "cA", "nota-0001-abcdef");
  assert.ok(nota);
  const doc = notaParaPdf(nota, "America/Mexico_City");
  const pdf = await renderizarPdf(
    doc,
    logo ? { dataUrl: `data:image/png;base64,${logo.toString("base64")}`, aspect: 2 } : null,
  );
  return { pdf, texto: textoVisiblePorPagina(pdf).join(" "), doc };
}

describe("el PDF de una nota firmada", () => {
  it("trae el texto tal y como se firmó, no el de la plantilla", async () => {
    const { texto } = await textoDelPdf(FOTO_COMPLETA);
    assert.ok(texto.includes("Se realiza pulpotomía de urgencia"), texto);
    assert.ok(!texto.includes(TEXTO_PLANTILLA));
    assert.ok(texto.includes("Nota de urgencia"));
    assert.ok(texto.includes("Ana López") && texto.includes("Laura Pérez"));
    assert.ok(texto.includes("1234567") && texto.includes("Endodoncia") && texto.includes("P-0042"));
    assert.ok(texto.includes("Firmada electrónicamente"));
    // 20:30 UTC son las 14:30 en México: la hora sale en la zona de la clínica.
    assert.ok(/14:30|2:30/.test(texto), texto);
    assert.ok(texto.includes("Página 1 de 1"));
  });

  it("conserva negritas, listas y títulos del texto firmado", async () => {
    const { texto } = await textoDelPdf(
      FOTO_COMPLETA, null,
      "<h2>Plan</h2><p>Tomar <b>ibuprofeno</b> 400 mg</p><ol><li>Reposo</li><li>Control en 7 días</li></ol>",
    );
    for (const s of ["Plan", "ibuprofeno", "1.", "Reposo", "2.", "Control en 7 días"]) assert.ok(texto.includes(s), s);
  });

  it("un borrador lo dice y no presume de firma", async () => {
    const nota = await getNota(baseCon({ ...fila(FOTO_COMPLETA), status: "DRAFT", signedAt: null }), "cA", "nota-0001-abcdef");
    const texto = textoVisiblePorPagina(await renderizarPdf(notaParaPdf(nota!, null), null)).join(" ");
    assert.ok(/borrador/i.test(texto));
    assert.ok(!texto.includes("Firmada electrónicamente"));
  });

  it("no cruza clínicas: con otro clinicId la nota no existe", async () => {
    assert.equal(await getNota(baseCon(fila(FOTO_COMPLETA)), "cB", "nota-0001-abcdef"), null);
  });
});

describe("sin logo o sin cédula", () => {
  const SIN = { ...FOTO_COMPLETA, logoUrl: null, cedula: null, doctorEspecialidad: null, pacienteCurp: null };

  it("deja el hueco etiquetado y NO inventa nada", async () => {
    const { pdf, texto } = await textoDelPdf(SIN);
    assert.ok(texto.includes(`Cédula profesional: ${RAYA_PARA_LLENAR}`), texto);
    assert.ok(texto.includes(`Especialidad: ${RAYA_PARA_LLENAR}`));
    assert.ok(texto.includes(`CURP: ${RAYA_PARA_LLENAR}`));
    for (const inventado of ["N/A", "undefined", "null", "Sin cédula", "S/N"]) {
      assert.ok(!texto.includes(inventado), `el PDF imprime «${inventado}»`);
    }
    // Sin logo no hay imagen ni recuadro: manda el nombre de la clínica.
    assert.ok(!pdf.toString("latin1").includes("/Subtype /Image"));
    assert.ok(texto.includes("Dental Sol"));
  });

  it("con logo, el logo sí se pinta", async () => {
    const { pdf } = await textoDelPdf(FOTO_COMPLETA, makePng(200, 100));
    assert.ok(pdf.toString("latin1").includes("/Subtype /Image"));
  });

  it("una nota firmada ANTES de hoy (foto vieja) se lee sin inventar los campos nuevos", async () => {
    const vieja = leerEncabezado({ pacienteNombre: "Ana", fecha: "1 de enero", clinicaNombre: "X", doctorNombre: "Y", cedula: "1" });
    assert.equal(vieja.clinicaDireccion, null);
    assert.equal(vieja.doctorEspecialidad, null);
    assert.equal(vieja.pacienteSinCurp, false);
  });

  it("el paciente extranjero no tiene renglón de CURP ni aviso de CURP", async () => {
    const e = { ...FOTO_COMPLETA, pacienteCurp: null, pacienteSinCurp: true };
    const { texto } = await textoDelPdf(e);
    assert.ok(!texto.includes("CURP"));
    assert.deepEqual(faltantesDe(leerEncabezado(e)), []);
  });
});

describe("WhatsApp fuera de la ventana de 24 h", () => {
  it("con la ventana cerrada el envío se BLOQUEA antes de llamar a Meta (no cuesta)", () => {
    const d = decideSendMode({ kind: "system", windowOpen: false, templates: {}, params: null });
    assert.equal(d.mode, "blocked");
    // Y con cualquier plantilla que la clínica tenga configurada, sigue bloqueado:
    // una nota clínica jamás sale como plantilla de pago.
    const conPlantillas = decideSendMode({
      kind: "system", windowOpen: false, params: null,
      templates: { quote_ready: { name: "dc_presupuesto_listo", lang: "es_MX" } } as never,
    });
    assert.equal(conPlantillas.mode, "blocked");
    assert.equal(decideSendMode({ kind: "system", windowOpen: true, templates: {}, params: null }).mode, "text");
  });

  it("no falla en silencio: 409, su propio código, el motivo y qué hacer", () => {
    const d = decideSendMode({ kind: "system", windowOpen: false, templates: {}, params: null });
    assert.equal(d.mode, "blocked");
    const f = explicarFalloDeWhatsApp(new WhatsAppBlockedError(d.mode === "blocked" ? d.reason : ""));
    assert.equal(f.status, 409);
    assert.equal(f.code, "WA_FUERA_DE_VENTANA");
    assert.ok(f.error.startsWith("No se envió."));
    assert.ok(f.error.includes("24 h"));
    assert.ok(/correo|PDF/.test(f.error));
  });

  it("un fallo de Meta tampoco se calla", () => {
    const f = explicarFalloDeWhatsApp(new Error("(#131026) Message undeliverable"));
    assert.equal(f.status, 502);
    assert.ok(f.error.includes("131026"));
  });

  it("la ruta manda con kind «system», explica el fallo y la pantalla lo deja escrito", () => {
    const ruta = leer("src/app/api/patient-documents/[id]/whatsapp/route.ts");
    assert.ok(/kind:\s*"system"/.test(ruta));
    assert.ok(ruta.includes("explicarFalloDeWhatsApp(err)"));
    assert.ok(ruta.includes('denyIfMissingPermission(ctx, "whatsapp.send")'));
    assert.ok(ruta.includes("soloFirmadas("));
    const barra = leer("src/components/dashboard/documentos-paciente/documento-acciones.tsx");
    assert.ok(barra.includes('role={estado.tono === "bien" ? "status" : "alert"}'));
    assert.ok(barra.includes("json.error"));
  });
});

const leer = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

describe("imprimir", () => {
  it("al imprimir solo queda la copia de la hoja; la barra de acciones NO sale", () => {
    const print = CSS_IMPRESION.slice(CSS_IMPRESION.indexOf("@media print"));
    assert.ok(print.includes(`body > *:not([${ATRIBUTO_IMPRESION}]) { display: none !important; }`));
    assert.ok(print.includes(`[${ATRIBUTO_ACCIONES}] { display: none !important; }`));
    // En pantalla la copia no se ve.
    assert.ok(CSS_IMPRESION.slice(0, CSS_IMPRESION.indexOf("@media print")).includes(`[${ATRIBUTO_IMPRESION}] { display: none; }`));
  });

  it("la barra lleva su marca y la copia de papel no monta la barra", () => {
    const barra = leer("src/components/dashboard/documentos-paciente/documento-acciones.tsx");
    assert.ok(barra.includes("[ATRIBUTO_ACCIONES]"));
    assert.ok(barra.includes("window.print()"));
    assert.ok(!/window\.open|document\.write/.test(barra), "imprimir no abre ventanas con HTML a mano");
    const visor = leer("src/components/dashboard/documentos-paciente/documento-visor.tsx");
    const portal = visor.slice(visor.indexOf("createPortal("));
    assert.ok(portal.includes("[ATRIBUTO_IMPRESION]"));
    assert.ok(!portal.includes("<DocumentoAcciones"));
  });

  it("la hoja de estilos no tiene ni un hex y en papel la hoja es blanca", () => {
    const css = leer("src/components/dashboard/documentos-paciente/documento.module.css");
    assert.deepEqual(css.match(/#[0-9a-fA-F]{3,8}\b/g), null);
    assert.ok(/@media print[\s\S]*--doc-papel: white/.test(css));
    assert.ok(css.includes(":global(.dark) .raiz"));
  });
});

describe("el aviso de faltantes es uno solo", () => {
  it("el consentimiento usa la MISMA función y la misma raya", () => {
    assert.equal(missingConsentData, datosFaltantes);
    assert.equal(CONSENT_BLANK, RAYA_PARA_LLENAR);
    const puerta = leer("src/components/dashboard/patient-detail/consent-missing-notice.tsx");
    assert.ok(puerta.includes("AvisoDatosFaltantes"));
    const panel = leer("src/components/dashboard/nota-evolucion/nota-evolucion-panel.tsx");
    assert.ok(panel.includes("AvisoDatosFaltantes"));
  });

  it("la nota avisa de dirección, logo, cédula, especialidad y CURP, con su sitio", () => {
    const f = faltantesDe(leerEncabezado({ pacienteNombre: "Ana", clinicaNombre: "X", doctorNombre: "Y" }));
    assert.deepEqual(f, [
      { key: "clinicAddress", fixIn: "settings" },
      { key: "clinicLogo", fixIn: "settings" },
      { key: "doctorLicense", fixIn: "team" },
      { key: "doctorSpecialty", fixIn: "team" },
      { key: "patientCurp", fixIn: "patient" },
    ]);
    assert.deepEqual(faltantesDe(leerEncabezado(FOTO_COMPLETA)), []);
  });
});

describe("piezas sueltas", () => {
  it("htmlABloques entiende la lista blanca del saneado y decodifica entidades", () => {
    const b = htmlABloques("<p>a &amp; b &lt;c&gt;<br>d</p><ul><li>uno<ul><li>dentro</li></ul></li></ul>suelto");
    assert.equal(b[0].tramos.map((t) => t.texto).join(""), "a & b <c>\nd");
    assert.deepEqual(b.slice(1).map((x) => (x.tipo === "item" ? [x.marca, x.nivel] : x.tipo)), [["•", 0], ["•", 1], "parrafo"]);
    assert.deepEqual(htmlABloques("<p><br></p>"), []);
    assert.equal(htmlATexto("<p>Hola</p><ol><li>x</li></ol>"), "Hola\n\n1. x");
  });

  it("el nombre del archivo viaja sin acentos ni espacios", () => {
    assert.equal(nombreDeArchivo({ id: "abcdef1234", titulo: "Nota de evolución — Ñandú" }), "nota-de-evolucion-nandu-abcdef12.pdf");
  });

  it("el correo escapa lo que no es el cuerpo y el WhatsApp no lleva datos clínicos", () => {
    const d = {
      tipo: "Nota de evolución", titulo: "Nota <script>", fecha: "19 de septiembre", clinicaNombre: "Sol & Luna",
      pacienteNombre: "Ana", doctorNombre: "Laura", cedula: null, cuerpoHtml: `<p>${TEXTO_FIRMADO}</p>`,
    };
    const c = correoDelDocumento(d);
    assert.ok(c.html.includes("Nota &lt;script&gt;") && c.html.includes("Sol &amp; Luna"));
    assert.ok(c.html.includes(TEXTO_FIRMADO) && c.text.includes(TEXTO_FIRMADO));
    assert.ok(!c.html.includes("Cédula profesional"));
    assert.ok(!mensajeDeWhatsApp(d).includes("pulpotomía"));
  });
});
