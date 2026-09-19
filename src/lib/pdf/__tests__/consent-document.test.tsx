/**
 * LA CARTA DE CONSENTIMIENTO IMPRESA: espacio para firmar a mano.
 *
 * Run: npm run test:consent-pdf
 *
 * El mismo PDF sirve de copia del documento firmado y de hoja para firmar en
 * papel cuando el paciente no firma en tableta. Lo que se prueba aquí es lo
 * segundo, que era lo que estaba a medias:
 *   · sin firmar, la hoja trae las DOS líneas de testigos (NOM-004 10.1.1.7)
 *     con nombre y fecha por llenar, además de paciente y estomatólogo;
 *   · sin firmar, el pie NO dice «firmado electrónicamente» ni imprime IP:
 *     dice que se emitió para firma autógrafa y deja la huella del texto;
 *   · firmada a distancia (sin testigos), NO aparecen líneas de testigo;
 *   · con representante legal, firma él y no el menor.
 *
 * Se lee el PDF DE VERDAD (`renderToBuffer`) y se mira qué texto cae dentro de
 * la hoja, no el árbol de React.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToBuffer } from "@react-pdf/renderer";
import { ConsentDocument, type ConsentDocumentProps } from "../consent-document";
import { buildSignatureBlocks, type SignatureBlocksInput } from "@/lib/consent/signers";
import { textoVisiblePorPagina } from "./_texto-del-pdf";

const CONTENT = [
  "CARTA DE CONSENTIMIENTO INFORMADO",
  "",
  "1. DATOS DEL PACIENTE",
  "Nombre del paciente: Ana López",
  "",
  "3. ACTO QUE SE AUTORIZA",
  "Procedimiento: Extracción dental simple",
  "",
  "12. FIRMAS",
  "Firman el paciente, el estomatólogo responsable y, cuando están presentes, los testigos del acto.",
].join("\n");

const BLOCKS: SignatureBlocksInput = {
  patientName: "Ana López",
  signerName: null,
  signerRelation: null,
  doctorName: "Dra. Marta Ruiz",
  signedAt: null,
  doctorSignedAt: null,
  witness1Name: null,
  witness1SignedAt: null,
  witness2Name: null,
  witness2SignedAt: null,
  patientSig: null,
  doctorSig: null,
  witness1Sig: null,
  witness2Sig: null,
};

function props(over: Partial<ConsentDocumentProps> = {}, blocks: Partial<SignatureBlocksInput> = {}): ConsentDocumentProps {
  const input = { ...BLOCKS, ...blocks };
  return {
    clinicName: "Clínica Demo",
    clinicAddress: "Av. Reforma 100",
    clinicCity: "Ciudad de México",
    clinicPhone: "55 1234 5678",
    clinicEmail: null,
    logoDataUrl: null,
    procedure: "Extracción dental simple",
    place: "Ciudad de México",
    issuedAt: "2026-09-18T15:00:00Z",
    timeZone: "America/Mexico_City",
    patientName: "Ana López",
    patientNumber: "P-0042",
    patientCurp: "LOAA900101MDFPNN09",
    signerName: input.signerName,
    signerRelation: input.signerRelation,
    doctorName: "Dra. Marta Ruiz",
    doctorLicense: "1234567",
    doctorSpecialtyLicense: null,
    doctorSpecialty: "Endodoncia",
    content: CONTENT,
    signatures: buildSignatureBlocks(input),
    contentHash: "abc123",
    signedIp: null,
    signedUserAgent: null,
    signedAt: input.signedAt ? input.signedAt.toISOString() : null,
    revokedAt: null,
    revokedReason: null,
    ...over,
  };
}

async function textoDelPdf(p: ConsentDocumentProps): Promise<string> {
  const pdf = await renderToBuffer(<ConsentDocument {...p} />);
  return textoVisiblePorPagina(pdf).join(" ");
}

describe("carta impresa sin firmar (para firmar en papel)", () => {
  it("trae paciente, estomatólogo y DOS testigos con nombre y fecha por llenar", async () => {
    const texto = await textoDelPdf(props());
    assert.match(texto, /PACIENTE.*Ana López/);
    assert.match(texto, /ESTOMATÓLOGO RESPONSABLE.*Dra\. Marta Ruiz/);
    assert.match(texto, /TESTIGO 1/);
    assert.match(texto, /TESTIGO 2/);
    // Cuatro líneas de firma = cuatro fechas por llenar.
    assert.equal((texto.match(/Fecha: ____/g) ?? []).length, 4);
  });

  it("el pie no la da por firmada electrónicamente: se emitió para firma autógrafa", async () => {
    const texto = await textoDelPdf(props());
    assert.doesNotMatch(texto, /firmado electrónicamente/i);
    assert.doesNotMatch(texto, /IP /);
    assert.doesNotMatch(texto, /Firma del paciente: pendiente/);
    assert.match(texto, /firma autógrafa/);
    assert.match(texto, /SHA-256\): abc123/);
  });

  it("con representante legal firma él, no el menor, y siguen los testigos", async () => {
    const texto = await textoDelPdf(props({}, { signerName: "Luis López", signerRelation: "padre" }));
    assert.match(texto, /REPRESENTANTE LEGAL.*Luis López \(padre\)/);
    assert.match(texto, /TESTIGO 1.*TESTIGO 2/);
  });
});

describe("carta firmada", () => {
  it("firmada a distancia: sin testigos no hay líneas de testigo y el pie lleva la evidencia", async () => {
    const signedAt = new Date("2026-09-18T15:30:00Z");
    const texto = await textoDelPdf(
      props({ signedIp: "187.1.2.3", signedUserAgent: "Safari iPad" }, { signedAt }),
    );
    assert.doesNotMatch(texto, /TESTIGO/);
    assert.match(texto, /firmado electrónicamente/i);
    assert.match(texto, /IP 187\.1\.2\.3/);
    assert.match(texto, /Dispositivo: Safari iPad/);
    assert.match(texto, /Firmado el /);
  });

  it("firmada en tableta con un testigo: solo ese testigo", async () => {
    const signedAt = new Date("2026-09-18T15:30:00Z");
    const texto = await textoDelPdf(
      props({}, { signedAt, witness1Name: "Pedro Gómez", witness1SignedAt: new Date("2026-09-18T15:32:00Z") }),
    );
    assert.match(texto, /TESTIGO 1.*Pedro Gómez/);
    assert.doesNotMatch(texto, /TESTIGO 2/);
  });
});
