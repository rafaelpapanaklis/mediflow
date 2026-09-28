// Gate de producción para CUALQUIER ruta que timbre CFDI (factura completa o
// por pago). Extraído de api/cfdi/route.ts (ws1-t1, sep-2026) para que el
// nuevo endpoint de CFDI por pago no duplique este criterio — la MISMA
// función, no una copia que se pueda desalinear.
import { getOrganizationStatus } from "@/lib/facturapi";
import { NextResponse } from "next/server";

/**
 * Con FACTURAPI_ENV=live el CFDI se timbra ante el SAT y ya no se puede
 * "deshacer": si la organización de la clínica todavía no puede emitir,
 * JAMÁS se intenta timbrar — se devuelve 409 con el paso que falta.
 *
 * La fuente de verdad es la organización en Facturapi (`is_production_ready` /
 * `pending_steps`). El boolean local `csdUploaded` solo se usa como respaldo
 * cuando Facturapi no responde — así un CSD subido fuera de MediFlow no bloquea,
 * y un `csdUploaded` viejo tampoco.
 */
export async function liveReadinessBlock(orgId: string, csdUploaded: boolean): Promise<NextResponse | null> {
  let status;
  try {
    status = await getOrganizationStatus(orgId);
  } catch {
    // Facturapi no respondió: se cae al único dato local que hay. Sin CSD no hay
    // timbrado posible en Live; con CSD se deja pasar (no se bloquea una
    // operación válida por una falla ajena y el timbrado es el juez final).
    if (!csdUploaded) {
      return NextResponse.json({
        error: "Falta subir tus certificados CSD (.cer y .key del SAT) en Configuración → Facturación antes de timbrar con validez fiscal.",
        code:  "CFDI_LIVE_NOT_READY",
      }, { status: 409 });
    }
    return null;
  }

  // A partir de aquí manda Facturapi, NO el boolean local: si la org está lista
  // para producción se timbra aunque `csdUploaded` esté desactualizado (p. ej. el
  // CSD se subió desde el panel de Facturapi).
  if (!status.exists) {
    return NextResponse.json({
      error: "Tu organización fiscal ya no existe en Facturapi. Vuelve a guardar tu configuración fiscal en Configuración → Facturación.",
      code:  "CFDI_LIVE_NOT_READY",
    }, { status: 409 });
  }
  if (status.isProductionReady) return null;

  const faltan: string[] = [];
  if (status.hasLegal       === false) faltan.push("Completa tus datos fiscales (razón social, régimen y código postal).");
  if (status.hasCertificate === false) faltan.push("Falta subir tus certificados CSD.");
  if (status.manifestSigned === false) faltan.push("Falta firmar la Carta Manifiesto con tu e.firma.");
  if (status.hasLogo        === false) faltan.push("Falta subir el logo de tu organización en Facturapi.");
  // pending_steps puede traer un paso que no mapeamos: se muestra su propia
  // descripción antes que un mensaje vacío.
  if (faltan.length === 0) {
    faltan.push(...status.pendingSteps.map((s) => s.description || s.type).filter(Boolean));
  }
  // Facturapi dice que no está lista pero no dijo por qué: se manda al panel en vez
  // de devolver un mensaje sin contenido.
  if (faltan.length === 0) {
    faltan.push("Facturapi reporta tu organización como no lista para producción pero no detalló el motivo. Revisa Configuración → Facturación → «Listo para facturar ante el SAT».");
  }

  return NextResponse.json({
    error: `Todavía no puedes timbrar con validez fiscal. ${faltan.join(" ")}`,
    code:  "CFDI_LIVE_NOT_READY",
    pendingSteps: status.pendingSteps,
  }, { status: 409 });
}
