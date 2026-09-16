import { NextResponse } from "next/server";
import { isFacturapiLive } from "@/lib/facturapi-env";

/**
 * Una factura con CFDI no cambia a espaldas del SAT (hallazgos N2 y N3).
 *
 * Invoice.cfdiUuid tiene tres estados:
 *   · null                          → sin CFDI; se puede timbrar.
 *   · "timbrando:<invoiceId>:<id>"  → POST /api/cfdi la APARTÓ justo antes de
 *     pedirle el timbre a Facturapi. Es el candado contra el doble timbrado: se
 *     escribe con un UPDATE … WHERE "cfdiUuid" IS NULL, que en Postgres es
 *     atómico, así que de dos pestañas solo una lo consigue. Se suelta si
 *     Facturapi no timbró; si timbró y no se pudo guardar, SE QUEDA: no sabemos
 *     si hay un CFDI vigente, y volver a timbrar cuesta un timbre y deja dos CFDI
 *     ante el SAT. `<id>` es único por petición: una petición vieja nunca suelta
 *     el apartado de otra.
 *   · el UUID real                  → CFDI timbrado.
 *
 * Mientras exista cualquiera de los dos últimos, cancelar, anular, reembolsar o
 * cambiar el precio dejaría el CFDI vigente por el importe original: se bloquea.
 * Cancelar el CFDI ante el SAT todavía no existe en dental.
 */
export const CFDI_CLAIM_PREFIX = "timbrando:";

export function cfdiClaimFor(invoiceId: string): string {
  return `${CFDI_CLAIM_PREFIX}${invoiceId}:${crypto.randomUUID()}`;
}

export function isCfdiClaim(cfdiUuid: string | null | undefined): boolean {
  return typeof cfdiUuid === "string" && cfdiUuid.startsWith(CFDI_CLAIM_PREFIX);
}

/** Mensaje para quien intenta timbrar una factura apartada por otro timbrado. */
export const CFDI_EN_CURSO_ERROR =
  "Esta factura ya se está timbrando, o un timbrado anterior no terminó de guardarse. " +
  "No la vuelvas a timbrar: cierra y vuelve a abrir la factura en unos segundos. " +
  "Si sigue sin CFDI, escríbenos a soporte antes de intentarlo otra vez.";

export type CfdiBlockedAction = "cancelar" | "anular" | "reembolsar" | "cambiar el precio de";

/**
 * 409 si la factura tiene CFDI (o un timbrado a medias); null si se puede seguir.
 *
 * Solo con FACTURAPI_ENV=live: en PRUEBAS Facturapi timbra con certificados de
 * prueba y nada llega al SAT, así que no hay CFDI vigente que proteger y
 * bloquear frenaría a la clínica por nada.
 */
export function denyIfCfdiVigente(
  cfdiUuid: string | null | undefined,
  accion: CfdiBlockedAction,
): NextResponse | null {
  return cfdiUuid && isFacturapiLive() ? cfdiVigenteResponse(cfdiUuid, accion) : null;
}

/**
 * El 409 en sí. Con `cfdiUuid` null no se sabe cuál es: lo usa el UPDATE
 * condicionado (`cfdiUuid` igual al leído, en el where) que no alcanzó la fila
 * porque alguien timbró entre la lectura y la escritura.
 */
export function cfdiVigenteResponse(cfdiUuid: string | null, accion: CfdiBlockedAction): NextResponse {
  const cfdi = cfdiUuid && !isCfdiClaim(cfdiUuid)
    ? `ya tiene un CFDI timbrado ante el SAT (UUID ${cfdiUuid})`
    : "tiene un CFDI timbrado ante el SAT, o uno que se estaba timbrando";
  return NextResponse.json({
    error:
      `No se puede ${accion} esta factura: ${cfdi}. Si se hiciera aquí, el CFDI seguiría ` +
      "vigente ante el SAT por el importe original. Primero hay que cancelar ese CFDI ante el SAT, " +
      "y eso todavía no se puede hacer desde DaleControl: escríbenos a soporte con el folio de la factura.",
    code: "CFDI_VIGENTE",
  }, { status: 409 });
}
