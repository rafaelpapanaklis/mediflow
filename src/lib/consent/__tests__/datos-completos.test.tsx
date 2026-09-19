/**
 * EL CONSENTIMIENTO CON TODOS SUS DATOS — y con huecos honestos cuando faltan.
 *
 * Run: npm run test:consent-datos
 *
 * La carta lleva CURP e ID del paciente, cédula(s) y especialidad del doctor, y
 * dirección y logo de la clínica. Medido contra producción el 19-sep-2026 casi
 * ninguna clínica tiene todo eso capturado, así que lo que aquí se fija es lo
 * que pasa cuando FALTA, que es el caso normal:
 *   · sin CURP la línea sale etiquetada y con raya — nunca "undefined", "null"
 *     ni un CURP inventado;
 *   · el ID que se imprime es `patientNumber` (el folio), no el id interno;
 *   · con cédula profesional Y de especialidad salen las dos, etiquetadas;
 *   · el aviso de datos incompletos nombra EXACTAMENTE los que faltan.
 *
 * Se comprueba en las dos superficies: el TEXTO de la carta (lo que se ve en
 * pantalla y se firma) y el PDF de verdad (`renderToBuffer`), que es el papel.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToBuffer } from "@react-pdf/renderer";
import { buildConsentContent, interpolateConsent } from "../templates";
import { parseConsentText } from "../render";
import { buildSignatureBlocks } from "../signers";
import {
  CONSENT_BLANK,
  doctorCredentialLines,
  missingConsentData,
  patientIdentityLines,
} from "../document-data";
import { ConsentDocument, type ConsentDocumentProps } from "@/lib/pdf/consent-document";
import { textoVisiblePorPagina } from "@/lib/pdf/__tests__/_texto-del-pdf";

/** Un cuid como los de `Patient.id`: lo que NUNCA debe salir impreso. */
const INTERNAL_ID = "cmf3k2x9p0001l808abcd1234";
const CURP = "LOAA900101MDFPNN09";

const FULL = {
  fullIdentification: true,
  clinicName: "Clínica Demo",
  clinicAddress: "Av. Reforma 100",
  clinicCity: "Ciudad de México",
  timezone: "America/Mexico_City",
  patientName: "Ana López",
  patientAge: 34,
  patientNumber: "P-0042",
  patientCurp: CURP,
  doctorName: "Dra. Marta Ruiz",
  doctorLicense: "1234567",
  doctorSpecialtyLicense: "7654321",
  doctorSpecialty: "Endodoncia",
};

const NOTHING_INVENTED = /undefined|null|NaN|N\/A|\[object/;

function pdfProps(over: Partial<ConsentDocumentProps> = {}): ConsentDocumentProps {
  return {
    clinicName: "Clínica Demo",
    clinicAddress: "Av. Reforma 100",
    clinicCity: "Ciudad de México",
    clinicPhone: null,
    clinicEmail: null,
    logoDataUrl: null,
    procedure: "Extracción dental simple",
    place: "Ciudad de México",
    issuedAt: "2026-09-18T15:00:00Z",
    timeZone: "America/Mexico_City",
    patientName: "Ana López",
    patientNumber: "P-0042",
    patientCurp: CURP,
    signerName: null,
    signerRelation: null,
    doctorName: "Dra. Marta Ruiz",
    doctorLicense: "1234567",
    doctorSpecialtyLicense: "7654321",
    doctorSpecialty: "Endodoncia",
    content: "CARTA DE CONSENTIMIENTO INFORMADO\n\n12. FIRMAS\nFirman el paciente y el estomatólogo.",
    signatures: buildSignatureBlocks({
      patientName: "Ana López", signerName: null, signerRelation: null,
      doctorName: "Dra. Marta Ruiz", signedAt: null, doctorSignedAt: null,
      witness1Name: null, witness1SignedAt: null, witness2Name: null, witness2SignedAt: null,
      patientSig: null, doctorSig: null, witness1Sig: null, witness2Sig: null,
    }),
    contentHash: "abc123",
    signedIp: null,
    signedUserAgent: null,
    signedAt: null,
    revokedAt: null,
    revokedReason: null,
    ...over,
  };
}

async function textoDelPdf(p: ConsentDocumentProps): Promise<string> {
  const pdf = await renderToBuffer(<ConsentDocument {...p} />);
  return textoVisiblePorPagina(pdf).join(" ");
}

describe("paciente SIN curp", () => {
  for (const curp of [null, undefined, "", "   "]) {
    it(`texto: la línea sale etiquetada y vacía (curp = ${JSON.stringify(curp)})`, () => {
      const carta = buildConsentContent("resina", { ...FULL, patientCurp: curp });
      const datos = parseConsentText(carta).sections[0]!.body;
      assert.match(datos, new RegExp(`^CURP: ${CONSENT_BLANK}$`, "m"));
      assert.doesNotMatch(carta, NOTHING_INVENTED);
      // Ni un CURP inventado: nada con forma de CURP en toda la carta.
      assert.doesNotMatch(carta, /[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d/);
    });
  }

  it("PDF: «CURP: ______», sin undefined ni null", async () => {
    const texto = await textoDelPdf(pdfProps({ patientCurp: null }));
    assert.match(texto, /CURP: ______/);
    assert.doesNotMatch(texto, NOTHING_INVENTED);
  });

  it("con CURP capturado sale tal cual, en mayúsculas", async () => {
    const carta = buildConsentContent("resina", { ...FULL, patientCurp: CURP.toLowerCase() });
    assert.match(carta, new RegExp(`^CURP: ${CURP}$`, "m"));
    assert.match(await textoDelPdf(pdfProps()), new RegExp(`CURP: ${CURP}`));
  });

  it("el marcador [CURP_PACIENTE] de un texto propio también deja raya", () => {
    assert.equal(
      interpolateConsent("CURP: [CURP_PACIENTE] / [CURP_PACIENTE]", { ...FULL, patientCurp: null }),
      `CURP: ${CONSENT_BLANK} / ${CONSENT_BLANK}`,
    );
  });
});

describe("el ID del paciente es patientNumber, no el id interno", () => {
  it("texto y PDF imprimen el folio", async () => {
    const carta = buildConsentContent("resina", FULL);
    assert.match(carta, /^ID del paciente: P-0042$/m);
    assert.match(await textoDelPdf(pdfProps()), /ID del paciente: P-0042/);
  });

  it("no existe forma de pasarle el id interno: ni el texto ni el PDF lo aceptan", async () => {
    // Se cuela como propiedad extra, igual que llegaría de un `select` con `id`.
    const conId = { ...FULL, id: INTERNAL_ID, patientId: INTERNAL_ID };
    assert.ok(!buildConsentContent("resina", conId).includes(INTERNAL_ID));
    const props = { ...pdfProps(), id: INTERNAL_ID, patientId: INTERNAL_ID } as ConsentDocumentProps;
    assert.ok(!(await textoDelPdf(props)).includes(INTERNAL_ID));
  });

  it("sin folio: raya con etiqueta, y tampoco entonces cae al id interno", () => {
    assert.deepEqual(patientIdentityLines({ patientCurp: CURP, patientNumber: null }), [
      { label: "CURP", value: CURP },
      { label: "ID del paciente", value: CONSENT_BLANK },
    ]);
  });
});

describe("cédulas y especialidad del doctor", () => {
  it("con cédula profesional Y de especialidad salen las dos, etiquetadas", async () => {
    const carta = buildConsentContent("resina", FULL);
    const doctor = parseConsentText(carta).sections[1]!.body;
    assert.match(doctor, /^Cédula profesional: 1234567$/m);
    assert.match(doctor, /^Cédula de especialidad: 7654321$/m);
    assert.match(doctor, /^Especialidad: Endodoncia$/m);

    const texto = await textoDelPdf(pdfProps());
    assert.match(texto, /Cédula profesional: 1234567/);
    assert.match(texto, /Cédula de especialidad: 7654321/);
    assert.match(texto, /Especialidad: Endodoncia/);
  });

  it("sin cédula de especialidad esa línea no sale; las otras dos siguen", () => {
    assert.deepEqual(
      doctorCredentialLines({ doctorLicense: "1234567", doctorSpecialtyLicense: " ", doctorSpecialty: "Endodoncia" }),
      [
        { label: "Cédula profesional", value: "1234567" },
        { label: "Especialidad", value: "Endodoncia" },
      ],
    );
  });

  it("sin cédula ni especialidad: etiqueta con raya, en el texto y en el PDF", async () => {
    const vacio = { doctorLicense: null, doctorSpecialtyLicense: null, doctorSpecialty: null };
    const carta = buildConsentContent("resina", { ...FULL, ...vacio });
    assert.match(carta, /^Cédula profesional: ______$/m);
    assert.match(carta, /^Especialidad: ______$/m);
    assert.doesNotMatch(carta, /Cédula de especialidad/);
    assert.doesNotMatch(carta, NOTHING_INVENTED);

    const texto = await textoDelPdf(pdfProps(vacio));
    assert.match(texto, /Cédula profesional: ______/);
    assert.match(texto, /Especialidad: ______/);
    assert.doesNotMatch(texto, NOTHING_INVENTED);
  });
});

describe("dirección de la clínica", () => {
  it("capturada: sale con su etiqueta y la ciudad", async () => {
    assert.match(buildConsentContent("resina", FULL), /^Dirección: Av\. Reforma 100, Ciudad de México$/m);
    assert.match(await textoDelPdf(pdfProps()), /Dirección: Av\. Reforma 100, Ciudad de México/);
  });

  it("sin capturar (0 de 15 clínicas la tienen hoy): etiqueta con raya", async () => {
    const carta = buildConsentContent("resina", { ...FULL, clinicAddress: null });
    assert.match(carta, /^Establecimiento: Clínica Demo$/m);
    assert.match(carta, /^Dirección: ______$/m);
    assert.match(await textoDelPdf(pdfProps({ clinicAddress: null })), /Dirección: ______/);
  });
});

describe("aviso de datos incompletos: nombra EXACTAMENTE los que faltan", () => {
  const COMPLETE = {
    clinicAddress: "Av. Reforma 100",
    clinicLogoUrl: "https://cdn.example/logo.png",
    doctorLicense: "1234567",
    doctorSpecialty: "Endodoncia",
    patientCurp: CURP,
    patientCurpStatus: "COMPLETE",
  };
  const keys = (input: Parameters<typeof missingConsentData>[0]) =>
    missingConsentData(input).map((m) => m.key);

  it("con todo capturado no avisa de nada", () => {
    assert.deepEqual(missingConsentData(COMPLETE), []);
  });

  it("sin nada capturado avisa de los cinco, con el sitio donde se llena cada uno", () => {
    assert.deepEqual(missingConsentData({}), [
      { key: "clinicAddress", fixIn: "settings" },
      { key: "clinicLogo", fixIn: "settings" },
      { key: "doctorLicense", fixIn: "team" },
      { key: "doctorSpecialty", fixIn: "team" },
      { key: "patientCurp", fixIn: "patient" },
    ]);
  });

  it("cada dato que falta se nombra solo, sin arrastrar a los demás", () => {
    assert.deepEqual(keys({ ...COMPLETE, clinicAddress: "  " }), ["clinicAddress"]);
    assert.deepEqual(keys({ ...COMPLETE, clinicLogoUrl: null }), ["clinicLogo"]);
    assert.deepEqual(keys({ ...COMPLETE, doctorLicense: "" }), ["doctorLicense"]);
    assert.deepEqual(keys({ ...COMPLETE, doctorSpecialty: undefined }), ["doctorSpecialty"]);
    assert.deepEqual(keys({ ...COMPLETE, patientCurp: null, patientCurpStatus: "PENDING" }), ["patientCurp"]);
  });

  it("dos que faltan: esos dos y ninguno más", () => {
    assert.deepEqual(
      keys({ ...COMPLETE, clinicLogoUrl: "", doctorSpecialty: null }),
      ["clinicLogo", "doctorSpecialty"],
    );
  });

  it("un paciente extranjero no tiene CURP que capturar: no se le reclama", () => {
    assert.deepEqual(keys({ ...COMPLETE, patientCurp: null, patientCurpStatus: "FOREIGN" }), []);
  });
});

describe("sin `fullIdentification` la carta sale como antes (la comparte el vertical de instituto)", () => {
  it("ni CURP, ni dirección aparte, ni rayas de cédula o especialidad", () => {
    const { fullIdentification: _omit, ...legacy } = FULL;
    const carta = buildConsentContent("resina", { ...legacy, patientCurp: null, doctorLicense: null });
    assert.match(carta, /^Establecimiento: Clínica Demo, Av\. Reforma 100, Ciudad de México$/m);
    assert.match(carta, /^Número de expediente: P-0042$/m);
    assert.doesNotMatch(carta, /CURP|ID del paciente|Dirección:|Cédula|Especialidad:/);
  });
});
