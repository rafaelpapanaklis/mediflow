// ═══════════════════════════════════════════════════════════════════
// QUÉ LE PASA A LA FACTURA CUANDO SE REEMBOLSA (auditoría de uso, C-02 y
// C-03, 4-oct-2026). Puro: sin Prisma, lo usan la ruta /refund, /cancel y la
// pantalla (para decir antes de confirmar cómo queda la factura).
//
// Antes un reembolso SOLO bajaba lo pagado: una factura de $3,000 cobrada a la
// que se le devolvían $1,000 quedaba «Parcial · Saldo $1,000», el paciente
// pasaba a «Con deuda», a los recordatorios de saldo, y «Marcar pagada»
// inventaba un cobro. Ahora quien reembolsa dice QUÉ fue (decisión de Rafael
// por defecto, 4-oct-2026: todo reembolso pregunta):
//
//   · "baja_total"     — se cobró de más / se hizo menos: el TOTAL baja lo
//                        mismo que se devuelve. Lo que debía antes, lo sigue
//                        debiendo (en una pagada: nada).
//   · "sigue_debiendo" — el dinero se devuelve pero el trato sigue igual: el
//                        total no cambia y el saldo sube (lo de siempre).
//   · "baja_resto"     — el tratamiento no sigue: se devuelve lo que se
//                        indique y el RESTO de la factura se da de baja (el
//                        total queda en lo que el paciente se queda pagado).
//                        Si se devuelve todo, la factura queda CANCELADA.
//
// Una factura que se queda sin nada que cobrar y sin nada pagado se CANCELA
// (no se deja «Pagada» en $0): así deja de contar en ventas, y su cobro y su
// reembolso siguen contando cada uno en su día (facturaConDineroQueCuentaWhere).
// ═══════════════════════════════════════════════════════════════════

export const DESTINOS_DE_REEMBOLSO = ["baja_total", "sigue_debiendo", "baja_resto"] as const;
export type DestinoDeReembolso = (typeof DESTINOS_DE_REEMBOLSO)[number];

export function esDestinoDeReembolso(x: unknown): x is DestinoDeReembolso {
  return typeof x === "string" && (DESTINOS_DE_REEMBOLSO as readonly string[]).includes(x);
}

const c = (n: number) => Math.round((Number(n) || 0) * 100);
const p = (centavos: number) => centavos / 100;

export type EstadoTrasReembolso = "PENDING" | "PARTIAL" | "PAID" | "CANCELLED";

export interface EfectoDelReembolso {
  /** Lo pagado que queda. */
  pagado: number;
  /** El total que queda (igual al de antes salvo con «baja_total» / «baja_resto»). */
  total: number;
  /** Lo que el paciente queda debiendo. */
  saldo: number;
  estado: EstadoTrasReembolso;
  /** Cuánto bajó el total (0 si no bajó). */
  bajaDelTotal: number;
}

/**
 * Cómo queda la factura. `monto` puede ser 0 SOLO con «baja_resto» (dar de
 * baja lo que falta sin devolver nada: el paciente se queda con lo pagado y
 * deja el tratamiento). Lanza si los números no tienen sentido; quien llama
 * valida antes con mensajes para la pantalla.
 */
export function efectoDelReembolso(args: {
  total: number;
  pagado: number;
  monto: number;
  destino: DestinoDeReembolso;
}): EfectoDelReembolso {
  const totalC = c(args.total);
  const pagadoC = Math.max(0, c(args.pagado));
  const montoC = c(args.monto);
  if (montoC < 0 || montoC > pagadoC) throw new Error("monto_fuera_de_rango");
  if (montoC === 0 && args.destino !== "baja_resto") throw new Error("monto_fuera_de_rango");

  const pagadoNuevoC = pagadoC - montoC;
  let totalNuevoC = totalC;
  if (args.destino === "baja_total") totalNuevoC = Math.max(0, totalC - montoC);
  if (args.destino === "baja_resto") totalNuevoC = pagadoNuevoC;
  const saldoC = Math.max(0, totalNuevoC - pagadoNuevoC);

  let estado: EstadoTrasReembolso;
  if (totalNuevoC <= 0 && pagadoNuevoC <= 0) estado = "CANCELLED";
  else if (pagadoNuevoC <= 0) estado = "PENDING";
  else if (saldoC > 0) estado = "PARTIAL";
  else estado = "PAID";

  return {
    pagado: p(pagadoNuevoC),
    total: p(totalNuevoC),
    saldo: p(saldoC),
    estado,
    bajaDelTotal: p(Math.max(0, totalC - totalNuevoC)),
  };
}
