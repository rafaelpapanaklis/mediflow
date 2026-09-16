import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

interface Params { params: { signatureId: string } }

/**
 * GET /api/signature/verify/[signatureId] — CONSULTA pública de una firma.
 *
 * Devuelve datos básicos del documento firmado para que un tercero
 * (farmacia, paciente) los consulte.
 *
 * NO requiere auth — el signatureId actúa como token de bearer.
 *
 * NO devuelve la firma cruda ni la cer key — solo metadatos:
 * sha256 del documento, fecha de firma, nombre + cédula del firmante.
 *
 * ── LO QUE ESTA RUTA DEJÓ DE AFIRMAR (15-sep-2026) ────────────────────────
 * Devolvía `valid: true` con que existiera la fila. No comprobaba nada: ni la
 * firma PKCS#7, ni el certificado, ni que el documento siguiera igual. En todo
 * `src/` no existe ninguna función que verifique una firma FIEL.
 *
 * Hoy responde lo que sabe: la firma está REGISTRADA (`registered`) y NO está
 * VERIFICADA (`verified`). `valid` se mantiene por si alguna integración de
 * fuera lo lee —no podemos saberlo—, pero ahora vale `false`: quien lo lea
 * dejará de dar por buena una firma que nadie ha comprobado, que es el lado
 * seguro de equivocarse. Cuando exista verificación real, `valid` pasará a
 * valer lo mismo que `verified` y entonces podrá retirarse.
 *
 * Una verificación criptográfica de verdad son ~30 líneas más, pero sin
 * validar la cadena del SAT solo probaría «lo firmó quien tenga esa llave»,
 * y hoy cualquiera puede registrar un certificado hecho en casa. Primero el
 * SAT; luego esto.
 */

const DETALLE_NO_VERIFICADA =
  "Esta firma está registrada en DaleControl, pero NO ha sido verificada " +
  "criptográficamente ni validada contra el SAT. No la tomes como prueba de " +
  "la identidad del firmante ni de la integridad del documento.";

export async function GET(_req: NextRequest, { params }: Params) {
  const signed = await prisma.signedDocument.findUnique({
    where: { id: params.signatureId },
  });
  if (!signed) {
    return NextResponse.json({
      valid: false,        // campo viejo, se mantiene por compatibilidad
      registered: false,
      verified: false,
      error: "not_found",
    }, { status: 404 });
  }

  const signer = await prisma.user.findUnique({
    where: { id: signed.signerUserId },
    select: { firstName: true, lastName: true, cedulaProfesional: true, especialidad: true },
  });

  return NextResponse.json({
    // `valid` es el campo viejo. Se conserva para no romper integraciones que
    // ya lo lean, pero deja de mentir: sin verificación, no es válida.
    valid: false,
    registered: true,
    verified: false,
    verificationStatus: "not_verified",
    detail: DETALLE_NO_VERIFICADA,
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
