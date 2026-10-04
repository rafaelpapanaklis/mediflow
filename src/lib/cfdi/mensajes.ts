// Mensajes del CFDI para quien está en el mostrador (ws1-t4, auditoría de uso C-57): sin
// «Solo administradores», nombres de variables de entorno ni archivos SQL. El detalle técnico
// va al log del servidor. PURO.

function en(locale?: string | null): boolean {
  return typeof locale === "string" && locale.toLowerCase().startsWith("en");
}

/** 403 de timbrar / cancelar / nota de crédito para quien no es dueño ni administrador (decisión 13). */
export function textoSoloDuenoTimbra(locale?: string | null): string {
  return en(locale)
    ? "Only the clinic owner or an administrator can stamp, cancel or issue credit notes. Ask them to do it from this invoice."
    : "Timbrar, cancelar y hacer notas de crédito lo hace solo el dueño o un administrador de la clínica. Pídeselo desde esta misma factura.";
}

/** «Facturar este pago» sin el SQL de CFDI por pago: el detalle (archivo) va al log. */
export function textoCfdiPorPagoNoDisponible(locale?: string | null): string {
  return en(locale)
    ? "Invoicing single payments isn't available yet in your clinic. Write to support and we'll enable it."
    : "Facturar pagos sueltos todavía no está disponible en tu clínica. Escríbenos a soporte y lo activamos.";
}

/** El enlace de descarga no se puede armar (falta la dirección pública del panel). */
export function textoEnlaceNoDisponible(locale?: string | null): string {
  return en(locale)
    ? "The download link can't be created right now. Send it by email or write to support."
    : "No se pudo armar el enlace de descarga en este momento. Mándalo por correo o escríbenos a soporte.";
}

/** Un rechazo de Facturapi al mandar el correo, dicho en humano (el original queda entre paréntesis). */
export function textoCorreoNoEnviado(detalle: string | null | undefined, locale?: string | null): string {
  const d = String(detalle ?? "").trim();
  const base = en(locale)
    ? "The email couldn't be sent. Check that the address is correct and try again."
    : "No se pudo mandar el correo. Revisa que la dirección esté bien escrita y vuelve a intentarlo.";
  return d ? `${base} (${d})` : base;
}
