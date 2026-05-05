// Implants — GET /api/implants/[id]/passport
// Renderiza el carnet del implante (formato licencia horizontal
// landscape 85.6mm × 54mm). Spec §1.15, §9.3.

import { NextResponse, type NextRequest } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import QRCode from "qrcode";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
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

  // QR opt-in: solo si el carnet existe Y qrPublicEnabled=true
  let qrDataUrl: string | null = null;
  if (implant.passport?.qrPublicEnabled && implant.passport.qrToken) {
    try {
      qrDataUrl = await QRCode.toDataURL(
        `https://mediflow.app/i/${implant.passport.qrToken}`,
        { margin: 0, width: 240 },
      );
    } catch (e) {
      console.error("[implant passport] QR generation failed", e);
    }
  }

  // Foto del paciente (PatientFile)
  let patientPhotoUrl: string | null = null;
  if (implant.passport?.patientPhotoFileId) {
    const photo = await prisma.patientFile.findUnique({
      where: { id: implant.passport.patientPhotoFileId },
      select: { url: true },
    });
    patientPhotoUrl = photo?.url ?? null;
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
