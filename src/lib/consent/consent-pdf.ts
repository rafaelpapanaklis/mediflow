import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import { prisma } from "@/lib/prisma";
import { signMaybeUrl, BUCKETS } from "@/lib/storage";
import { ConsentDocument } from "@/lib/pdf/consent-document";
import { consentTimeZone } from "@/lib/consent/dates";
import { buildSignatureBlocks } from "@/lib/consent/signers";
import { buildConsentDocumento, type ConsentDocumentoDTO } from "@/lib/consent/documento";
import { fetchClinicLogo } from "@/lib/pdf/clinic-letterhead";

/**
 * buildConsentPdf — query + logo + firmas + render del PDF de un consentimiento.
 *
 * Mismo patrón que buildQuotePdf: el PDF se genera ON-DEMAND y no se guarda en
 * ninguna parte. Las firmas viven como paths privados en el bucket; aquí se
 * firman con TTL corto y se traen a memoria como data URL porque @react-pdf no
 * puede descargar una URL protegida por sí mismo.
 *
 * Multi-tenant: el consentimiento DEBE pertenecer a `clinicId`. Devuelve null
 * si no existe / no pertenece / no se pasa clínica.
 */

async function fetchImageDataUrl(url: string | null): Promise<string | null> {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > 2_000_000) return null;
    return `data:${contentType};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

/** Path privado → signed URL → bytes. Falla suave: sin firma, línea en blanco. */
async function signatureDataUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const signed = await signMaybeUrl(path, 120, BUCKETS.PATIENT_FILES).catch(() => "");
  if (!signed) return null;
  return fetchImageDataUrl(signed);
}

/**
 * La fila de la carta con su paciente, su clínica y su doctor, y las cuatro
 * imágenes de firma ya en memoria. Es la ÚNICA lectura de la carta: la usan el
 * PDF y la hoja del panel (`loadConsentDocumento`), así que no pueden discrepar.
 */
async function loadConsent(id: string, clinicId: string) {
  // `clinicId: undefined` no filtra nada: sin clínica NO se consulta.
  if (!id || !clinicId) return null;
  const form = await prisma.consentForm.findFirst({
    where: { id, clinicId, deletedAt: null },
    include: {
      // patientNumber es el ID que se imprime (el folio del panel), no `id`.
      patient: {
        select: { firstName: true, lastName: true, patientNumber: true, curp: true, curpStatus: true },
      },
      clinic: {
        select: {
          name: true, address: true, city: true, phone: true, email: true, logoUrl: true,
          // Zona horaria de la clínica: TODAS las fechas del PDF se imprimen en
          // ella. Sin esto el render (servidor = UTC) fechaba las firmas seis
          // horas adelante y no coincidían con la pantalla del paciente.
          timezone: true,
        },
      },
    },
  });
  if (!form) return null;

  // El estomatólogo responsable se guarda como id suelto (sin @relation, para
  // que dar de baja al usuario no bloquee ni borre el documento): se resuelve
  // aquí, y si ya no existe la carta se imprime igual sin su nombre.
  const doctor = form.doctorId
    ? await prisma.user.findFirst({
        // Acotado a la clínica de la carta: ahora se leen cédulas y
        // especialidad, y un id suelto no debe poder traerlas de otra clínica.
        where: { id: form.doctorId, clinicId: form.clinicId },
        // `especialidad` es la que se captura en Equipo. `specialty` es el
        // módulo del panel y NO va en la carta.
        select: {
          firstName: true, lastName: true,
          cedulaProfesional: true, cedulaEspecialidad: true, especialidad: true,
        },
      })
    : null;

  // Cuatro descargas como mucho, en paralelo — bajo el tope de 7 del repo.
  const [patientSig, witness1Sig, witness2Sig, doctorSig] = await Promise.all([
    signatureDataUrl(form.signatureUrl),
    signatureDataUrl(form.witness1SignatureUrl),
    signatureDataUrl(form.witness2SignatureUrl),
    signatureDataUrl(form.doctorSignatureUrl),
  ]);

  const patientName = `${form.patient.firstName} ${form.patient.lastName}`.trim();
  const doctorName = doctor
    ? `${doctor.firstName ?? ""} ${doctor.lastName ?? ""}`.trim()
    : "";

  // Orden y presencia de las firmas (testigos solo cuando toca) los decide
  // `buildSignatureBlocks`: una carta sin firmar se imprime con las dos líneas
  // de testigos en blanco para el papel; una firmada solo trae los que hubo.
  const signatures = buildSignatureBlocks({
    patientName,
    signerName: form.signerName ?? null,
    signerRelation: form.signerRelation ?? null,
    doctorName,
    signedAt: form.signedAt ?? null,
    doctorSignedAt: form.doctorSignedAt ?? null,
    witness1Name: form.witness1Name ?? null,
    witness1SignedAt: form.witness1SignedAt ?? null,
    witness2Name: form.witness2Name ?? null,
    witness2SignedAt: form.witness2SignedAt ?? null,
    patientSig,
    doctorSig,
    witness1Sig,
    witness2Sig,
  });

  return { form, doctor, patientName, doctorName, signatures };
}

/**
 * La carta lista para la hoja del panel. `clinicId` es OBLIGATORIO y sale de la
 * sesión: sin él no se consulta (un `undefined` en el where no filtra nada).
 */
export async function loadConsentDocumento(
  id: string,
  clinicId: string,
): Promise<ConsentDocumentoDTO | null> {
  if (!clinicId || !id) return null;
  const loaded = await loadConsent(id, clinicId);
  if (!loaded) return null;
  const { form, doctor, patientName, doctorName, signatures } = loaded;
  return buildConsentDocumento(
    {
      id: form.id,
      procedure: form.procedure,
      content: form.content,
      createdAt: form.createdAt,
      expiresAt: form.expiresAt,
      timeZone: consentTimeZone(form.clinic.timezone),
      clinicName: form.clinic.name,
      clinicAddress: form.clinic.address ?? null,
      clinicCity: form.clinic.city ?? null,
      clinicPhone: form.clinic.phone ?? null,
      clinicLogoUrl: form.clinic.logoUrl ?? null,
      patientName,
      patientNumber: form.patient.patientNumber ?? null,
      patientCurp: form.patient.curp ?? null,
      patientCurpStatus: form.patient.curpStatus ?? null,
      signerName: form.signerName ?? null,
      signerRelation: form.signerRelation ?? null,
      doctorName,
      doctorLicense: doctor?.cedulaProfesional ?? null,
      doctorSpecialtyLicense: doctor?.cedulaEspecialidad ?? null,
      doctorSpecialty: doctor?.especialidad ?? null,
      signedAt: form.signedAt ?? null,
      doctorSignedAt: form.doctorSignedAt ?? null,
      revokedAt: form.revokedAt ?? null,
      revokedReason: form.revokedReason ?? null,
      contentHash: form.contentHash ?? null,
      signedIp: form.signedIp ?? null,
    },
    signatures,
  );
}

export async function buildConsentPdf(
  id: string,
  // Obligatorio: los tres llamadores ya lo pasaban (la ruta pública, el de la
  // propia fila). Opcional, un `buildConsentPdf(id)` compilaba y cruzaba clínicas.
  clinicId: string,
): Promise<{ buffer: Buffer; fileName: string } | null> {
  const loaded = await loadConsent(id, clinicId);
  if (!loaded) return null;
  const { form, doctor, patientName, doctorName, signatures } = loaded;

  // El logo con su proporción real, como en el resto de los documentos: sin
  // ella un logo apaisado se encajaba en un cuadrado y salía diminuto.
  const logo = await fetchClinicLogo(form.clinic.logoUrl);

  const element = createElement(ConsentDocument, {
    clinicName: form.clinic.name,
    clinicAddress: form.clinic.address ?? null,
    clinicCity: form.clinic.city ?? null,
    clinicPhone: form.clinic.phone ?? null,
    clinicEmail: form.clinic.email ?? null,
    logoDataUrl: logo?.dataUrl ?? null,
    logoAspect: logo?.aspect ?? null,

    procedure: form.procedure,
    place: form.clinic.city ?? null,
    issuedAt: form.createdAt.toISOString(),
    timeZone: consentTimeZone(form.clinic.timezone),

    patientName,
    patientNumber: form.patient.patientNumber ?? null,
    patientCurp: form.patient.curp ?? null,
    signerName: form.signerName ?? null,
    signerRelation: form.signerRelation ?? null,
    doctorName: doctorName || null,
    doctorLicense: doctor?.cedulaProfesional ?? null,
    doctorSpecialtyLicense: doctor?.cedulaEspecialidad ?? null,
    doctorSpecialty: doctor?.especialidad ?? null,

    content: form.content,
    signatures,

    contentHash: form.contentHash ?? null,
    signedIp: form.signedIp ?? null,
    signedUserAgent: form.signedUserAgent ?? null,
    signedAt: form.signedAt ? form.signedAt.toISOString() : null,
    revokedAt: form.revokedAt ? form.revokedAt.toISOString() : null,
    revokedReason: form.revokedReason ?? null,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = await renderToBuffer(element as any);
  const fileName = `consentimiento-${slug(form.procedure)}-${form.id.slice(0, 8)}.pdf`;
  return { buffer, fileName };
}

/**
 * Clase de caracteres de las marcas diacríticas combinantes (U+0300–U+036F).
 * Se construye con `String.fromCharCode` en vez de escribir el rango como
 * literal: ese literal se corrompe en cuanto un editor o un script no respeta
 * UTF-8, y entonces el slug deja de quitar los acentos en silencio.
 */
const DIACRITICS = new RegExp(
  "[" + String.fromCharCode(0x0300) + "-" + String.fromCharCode(0x036f) + "]",
  "g",
);

/** Nombre de archivo seguro: sin acentos ni espacios (WhatsApp y Content-Disposition). */
function slug(text: string): string {
  return (text || "consentimiento")
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 40) || "consentimiento";
}
