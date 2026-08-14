import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import { prisma } from "@/lib/prisma";
import { signMaybeUrl, BUCKETS } from "@/lib/storage";
import {
  ConsentDocument,
  type ConsentSignatureBlock,
} from "@/lib/pdf/consent-document";
import { consentTimeZone } from "@/lib/consent/dates";

/**
 * buildConsentPdf — query + logo + firmas + render del PDF de un consentimiento.
 *
 * Mismo patrón que buildQuotePdf: el PDF se genera ON-DEMAND y no se guarda en
 * ninguna parte. Las firmas viven como paths privados en el bucket; aquí se
 * firman con TTL corto y se traen a memoria como data URL porque @react-pdf no
 * puede descargar una URL protegida por sí mismo.
 *
 * Multi-tenant: si se pasa `clinicId`, el consentimiento DEBE pertenecer a esa
 * clínica. Devuelve null si no existe / no pertenece.
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

export async function buildConsentPdf(
  id: string,
  clinicId?: string,
): Promise<{ buffer: Buffer; fileName: string } | null> {
  const form = await prisma.consentForm.findFirst({
    where: clinicId ? { id, clinicId, deletedAt: null } : { id, deletedAt: null },
    include: {
      patient: { select: { firstName: true, lastName: true, patientNumber: true } },
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
    ? await prisma.user.findUnique({
        where: { id: form.doctorId },
        select: { firstName: true, lastName: true, cedulaProfesional: true },
      })
    : null;

  // Cinco descargas como mucho (logo + cuatro firmas) en paralelo — bajo el
  // tope de 7 del repo para Promise.all.
  const [logoDataUrl, patientSig, witness1Sig, witness2Sig, doctorSig] = await Promise.all([
    fetchImageDataUrl(form.clinic.logoUrl),
    signatureDataUrl(form.signatureUrl),
    signatureDataUrl(form.witness1SignatureUrl),
    signatureDataUrl(form.witness2SignatureUrl),
    signatureDataUrl(form.doctorSignatureUrl),
  ]);

  const patientName = `${form.patient.firstName} ${form.patient.lastName}`.trim();
  const doctorName = doctor
    ? `${doctor.firstName ?? ""} ${doctor.lastName ?? ""}`.trim()
    : "";

  // Orden de las firmas: primero quien consiente, luego el profesional, al
  // final los testigos. Los testigos solo aparecen si hay algo que imprimir
  // (nombre o firma): una carta firmada a distancia no lleva testigos y dejar
  // dos líneas vacías haría pensar que faltan.
  const signatures: ConsentSignatureBlock[] = [
    {
      role: form.signerName ? "Representante legal" : "Paciente",
      name: form.signerName
        ? `${form.signerName}${form.signerRelation ? ` (${form.signerRelation})` : ""}`
        : patientName,
      dataUrl: patientSig,
      signedAt: form.signedAt ? form.signedAt.toISOString() : null,
    },
    {
      role: "Estomatólogo responsable",
      name: doctorName,
      dataUrl: doctorSig,
      signedAt: form.doctorSignedAt ? form.doctorSignedAt.toISOString() : null,
    },
  ];
  if (form.witness1Name || witness1Sig) {
    signatures.push({
      role: "Testigo 1",
      name: form.witness1Name ?? "",
      dataUrl: witness1Sig,
      signedAt: form.witness1SignedAt ? form.witness1SignedAt.toISOString() : null,
    });
  }
  if (form.witness2Name || witness2Sig) {
    signatures.push({
      role: "Testigo 2",
      name: form.witness2Name ?? "",
      dataUrl: witness2Sig,
      signedAt: form.witness2SignedAt ? form.witness2SignedAt.toISOString() : null,
    });
  }

  const element = createElement(ConsentDocument, {
    clinicName: form.clinic.name,
    clinicAddress: form.clinic.address ?? null,
    clinicCity: form.clinic.city ?? null,
    clinicPhone: form.clinic.phone ?? null,
    clinicEmail: form.clinic.email ?? null,
    logoDataUrl,

    procedure: form.procedure,
    place: form.clinic.city ?? null,
    issuedAt: form.createdAt.toISOString(),
    timeZone: consentTimeZone(form.clinic.timezone),

    patientName,
    patientNumber: form.patient.patientNumber ?? null,
    signerName: form.signerName ?? null,
    signerRelation: form.signerRelation ?? null,
    doctorName: doctorName || null,
    doctorLicense: doctor?.cedulaProfesional ?? null,

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
