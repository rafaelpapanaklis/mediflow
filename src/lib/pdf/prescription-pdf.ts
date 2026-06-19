import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import QRCode from "qrcode";
import { prisma } from "@/lib/prisma";
import { PrescriptionDocument, type PrescriptionPdfItemProps } from "@/lib/pdf/prescription-document";

/**
 * buildPrescriptionPdf — query + QR + logo + render del PDF de una receta.
 * Compartido entre la ruta autenticada del dashboard y la descarga pública
 * de la página de verificación.
 *
 * Multi-tenant: si se pasa `clinicId`, la receta DEBE pertenecer a esa
 * clínica (rutas del dashboard). Sin `clinicId` es el flujo público, donde
 * la URL con el id (la misma que va en el QR impreso) actúa como bearer —
 * idéntico nivel de exposición que /portal/prescription/[id]/verify.
 */

async function fetchLogoDataUrl(url: string | null): Promise<string | null> {
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
    // Logo caído no debe tumbar la receta: se genera sin logo.
    return null;
  }
}

function fmtAge(dob: Date | null): string | null {
  if (!dob) return null;
  const ms = Date.now() - dob.getTime();
  if (ms <= 0) return null;
  const years = Math.floor(ms / (365.25 * 24 * 3600 * 1000));
  if (years < 1) {
    const months = Math.max(0, Math.floor(ms / (30.44 * 24 * 3600 * 1000)));
    return `${months} meses`;
  }
  return `${years} años`;
}

export async function buildPrescriptionPdf(
  id: string,
  clinicId?: string,
): Promise<{ buffer: Buffer; fileName: string } | null> {
  const rx = await prisma.prescription.findFirst({
    where: clinicId ? { id, clinicId } : { id },
    include: {
      patient: { select: { firstName: true, lastName: true, dob: true } },
      doctor: {
        select: {
          firstName: true,
          lastName: true,
          especialidad: true,
          cedulaProfesional: true,
          cedulaEspecialidad: true,
        },
      },
      clinic: {
        select: {
          name: true,
          address: true,
          city: true,
          phone: true,
          email: true,
          clues: true,
          logoUrl: true,
        },
      },
      items: { include: { cums: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!rx) return null;

  // Firma electrónica FIEL (si el doctor firmó la receta al emitirla).
  const signed = await prisma.signedDocument.findFirst({
    where: { docType: "PRESCRIPTION", docId: rx.id },
    select: { signedAt: true },
    orderBy: { signedAt: "desc" },
  });

  const verifyUrl =
    rx.verifyUrl ||
    `${process.env.NEXT_PUBLIC_APP_URL ?? "https://www.dalecontrol.com"}/portal/prescription/${rx.id}/verify`;

  const [qrDataUrl, logoDataUrl] = await Promise.all([
    QRCode.toDataURL(verifyUrl, { margin: 0, width: 256 }).catch(() => null),
    fetchLogoDataUrl(rx.clinic.logoUrl),
  ]);

  const items: PrescriptionPdfItemProps[] = rx.items.map((it) => ({
    descripcion: it.cums?.descripcion ?? it.cumsKey,
    presentacion: it.cums?.presentacion ?? null,
    dosage: it.dosage,
    duration: it.duration ?? null,
    quantity: it.quantity ?? null,
    notes: it.notes ?? null,
    cofeprisGroup: it.cums?.cofeprisGroup ?? null,
  }));

  const element = createElement(PrescriptionDocument, {
    clinicName: rx.clinic.name,
    clinicAddress: rx.clinic.address ?? null,
    clinicCity: rx.clinic.city ?? null,
    clinicPhone: rx.clinic.phone ?? null,
    clinicEmail: rx.clinic.email ?? null,
    clinicClues: rx.clinic.clues ?? null,
    logoDataUrl,
    doctorName: `Dr/a. ${rx.doctor.firstName} ${rx.doctor.lastName}`,
    doctorEspecialidad: rx.doctor.especialidad ?? null,
    doctorCedula: rx.doctor.cedulaProfesional ?? null,
    doctorCedulaEspecialidad: rx.doctor.cedulaEspecialidad ?? null,
    patientName: `${rx.patient.firstName} ${rx.patient.lastName}`,
    patientAge: fmtAge(rx.patient.dob ?? null),
    diagnosis: rx.diagnosis ?? null,
    indications: rx.indications ?? null,
    items,
    issuedAt: rx.issuedAt.toISOString(),
    expiresAt: rx.expiresAt ? rx.expiresAt.toISOString() : null,
    cofeprisGroup: rx.cofeprisGroup ?? null,
    cofeprisFolio: rx.cofeprisFolio ?? null,
    folio: rx.qrCode,
    verifyUrl,
    qrDataUrl,
    signedElectronically: !!signed,
    signedAt: signed?.signedAt ? signed.signedAt.toISOString() : null,
    // NOM-004 / NOM-024 §7 — anulación lógica: el builder ya trae todos los
    // escalares de Prescription (query con include, sin select), así que
    // status/voidReason/voidedAt están disponibles sin tocar los endpoints.
    voided: rx.status === "VOIDED",
    voidReason: rx.voidReason ?? null,
    voidedAt: rx.voidedAt ? rx.voidedAt.toISOString() : null,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = await renderToBuffer(element as any);
  const fileName = `receta-${rx.issuedAt.toISOString().slice(0, 10)}-${rx.id.slice(0, 8)}.pdf`;
  return { buffer, fileName };
}
