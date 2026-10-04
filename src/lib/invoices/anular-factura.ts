// ¿Qué permiso pide ANULAR una factura desde DELETE /api/invoices/[id]? (ws1-t2,
// auditoría de dinero F6). Borrar un BORRADOR es editar un documento que aún no
// le cobra a nadie: "billing.edit", como siempre. Anular una factura EMITIDA
// (pendiente, con abono…) hace desaparecer una deuda de «Por cobrar»: es lo
// mismo que cancelarla y pide la misma llave que POST /cancel, "billing.refund"
// («Reembolsar / cancelar»), que el doctor y la recepción no tienen de fábrica.

export type PermisoDeAnulacion = "billing.edit" | "billing.refund";

export function permisoParaAnular(status: string | null | undefined): PermisoDeAnulacion {
  return status === "DRAFT" ? "billing.edit" : "billing.refund";
}
