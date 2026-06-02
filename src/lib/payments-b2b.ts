// Métodos de pago B2B canónicos compartidos (clínica → laboratorio / proveedor):
// Transferencia (SPEI/CLABE), MercadoPago (directo a la cuenta del vendedor) y Efectivo.
export const B2B_PAYMENT_METHODS = ["TRANSFER", "MERCADOPAGO", "CASH"] as const;
export type B2BPaymentMethod = typeof B2B_PAYMENT_METHODS[number];

export const B2B_PAYMENT_METHOD_LABELS: Record<B2BPaymentMethod, string> = {
  TRANSFER: "Transferencia (SPEI)",
  MERCADOPAGO: "MercadoPago",
  CASH: "Efectivo",
};

export function isB2BPaymentMethod(x: unknown): x is B2BPaymentMethod {
  return typeof x === "string" && (B2B_PAYMENT_METHODS as readonly string[]).includes(x);
}
