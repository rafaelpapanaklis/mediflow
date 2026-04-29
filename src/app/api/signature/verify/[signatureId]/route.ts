import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

interface Params { params: { signatureId: string } }

/**
 * GET /api/signature/verify/[signatureId] — verificación PÚBLICA.
 *
 * Devuelve datos básicos del documento firmado para que un tercero
 * (farmacia, paciente) pueda verificar la firma.
 *
 * NO requiere auth — el signatureId actúa como token de bearer.
 *
 * NO devuelve la firma cruda ni la cer key — solo metadatos verificables:
 * sha256 del documento, fecha de firma, nombre + cédula del firmante.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const signed = await prisma.signedDocument.findUnique({
    where: { id: params.signatureId },
  });
  if (!signed) return NextResponse.json({ valid: false, error: "not_found" }, { status: 404 });

  const signer = await prisma.user.findUnique({
    where: { id: signed.signerUserId },
    select: { firstName: true, lastName: true, cedulaProfesional: true, especialidad: true },
  });

  return NextResponse.json({
    valid: true,
    signatureId: signed.id,
    docType: signed.docType,
    docId: signed.docId,
    sha256: signed.sha256,
    signedAt: signed.signedAt,
    tsaTimestamp: !!signed.tsaTimestamp,
    signer: signer ? {
      name: `${signer.firstName} ${signer.lastName}`,
      cedulaProfesional: signer.cedulaProfesional,
      especialidad: signer.especialidad,
    } : null,
  });
}
