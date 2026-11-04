// Implants — GET /api/implants/[id]/passport
// Renderiza el carnet del implante (formato licencia horizontal
// landscape 85.6mm × 54mm). Spec §1.15, §9.3.

import { NextResponse, type NextRequest } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import QRCode from "qrcode";
import { getCurrentUser } from "@/lib/auth";
import { denyIfNotClinical } from "@/lib/auth/guardia-clinica";
import { prisma } from "@/lib/prisma";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { createSignedFileUrl, esPathDeLaClinica, extractStoragePath } from "@/lib/storage";
import { canAccessModule } from "@/lib/marketplace/access-control";
import { IMPLANTS_MODULE_KEY } from "@/lib/implants/permissions";
import {
  ImplantPassportDocument,
  type ImplantPassportData,
} from "@/lib/implants/pdf-templates/implant-passport";

export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, ctx: Params) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  // M6: el pasaporte lleva cirugía, prótesis y lote del implante — expediente.
  const sinPermiso = denyIfNotClinical(user, "ver");
  if (sinPermiso) return sinPermiso;
  if (user.clinic.category !== "DENTAL") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const access = await canAccessModule(user.clinicId, IMPLANTS_MODULE_KEY);
  if (!access.hasAccess) {
    return NextResponse.json({ error: "module_inactive" }, { status: 403 });
  }

  const implant = await prisma.implant.findFirst({
    where: { id, clinicId: user.clinicId },
    include: {
      surgicalRecord: true,
      prostheticPhase: true,
      passport: true,
      patient: { select: { firstName: true, lastName: true, dob: true } },
      placedByDoctor: {
        select: { firstName: true, lastName: true, cedulaProfesional: true },
      },
      clinic: { select: { name: true, phone: true, logoUrl: true } },
    },
  });

  if (!implant) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Visibilidad por paciente: no generar el carnet (nombre + dob del paciente)
  // para quien no puede ver a ese paciente.
  if (implant.patientId) {
    const denied = await assertPatientVisible(implant.patientId, { userId: user.id, role: user.role, clinicId: user.clinicId });
    if (denied) return denied;
  }

  // QR opt-in: solo si el carnet existe Y qrPublicEnabled=true
  let qrDataUrl: string | null = null;
  if (implant.passport?.qrPublicEnabled && implant.passport.qrToken) {
    try {
      qrDataUrl = await QRCode.toDataURL(
        `https://www.dalecontrol.com/i/${implant.passport.qrToken}`,
        { margin: 0, width: 240 },
      );
    } catch (e) {
      console.error("[implant passport] QR generation failed", e);
    }
  }

  // Foto del paciente (PatientFile). Auditoría cloudflare: `findUnique` por id, sin clínica, leía el
  // archivo de CUALQUIER clínica. Ahora: de esta clínica y del paciente del implante. Y como @react-pdf
  // BAJA el `src` de la imagen desde el servidor, solo se le da una URL firmada de un objeto de la
  // clínica: nunca la `url` cruda de la fila (un path no se puede bajar y una URL http plantada sería
  // un SSRF).
  let patientPhotoUrl: string | null = null;
  if (implant.passport?.patientPhotoFileId) {
    const photo = await prisma.patientFile.findFirst({
      where: { id: implant.passport.patientPhotoFileId, clinicId: user.clinicId, patientId: implant.patientId },
      select: { url: true },
    });
    const path = extractStoragePath(photo?.url);
    if (path && esPathDeLaClinica(path, user.clinicId)) {
      patientPhotoUrl = await createSignedFileUrl(path).catch(() => null);
    }
  }

  const data: ImplantPassportData = {
    patient: {
      firstName: implant.patient.firstName,
      lastName: implant.patient.lastName,
      dob: implant.patient.dob,
    },
    patientPhotoUrl,
    brand: implant.brand,
    brandCustomName: implant.brandCustomName,
    modelName: implant.modelName,
    diameterMm: String(implant.diameterMm),
    lengthMm: String(implant.lengthMm),
    lotNumber: implant.lotNumber,
    placedAt: implant.placedAt,
    expiryDate: implant.expiryDate,
    prosthesisType: implant.prostheticPhase?.prosthesisType ?? null,
    prosthesisMaterial: implant.prostheticPhase?.prosthesisMaterial ?? null,
    prosthesisLabName: implant.prostheticPhase?.prosthesisLabName ?? null,
    prosthesisLabLot: implant.prostheticPhase?.prosthesisLabLot ?? null,
    prosthesisDeliveredAt:
      implant.prostheticPhase?.prosthesisDeliveredAt ?? null,
    abutmentLot: implant.prostheticPhase?.abutmentLot ?? null,
    doctorName: `${implant.placedByDoctor.firstName} ${implant.placedByDoctor.lastName}`,
    doctorCedula: implant.placedByDoctor.cedulaProfesional,
    clinicName: implant.clinic.name,
    clinicPhone: implant.clinic.phone,
    clinicLogoUrl: implant.clinic.logoUrl,
    qrDataUrl,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const element = createElement(ImplantPassportDocument, { data }) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = await renderToBuffer(element as any);

  const slug = `${implant.patient.firstName}-${implant.patient.lastName}-${implant.toothFdi}`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-");

  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="carnet-${slug}.pdf"`,
      "Cache-Control": "private, no-cache, no-store, must-revalidate",
    },
  });
}
