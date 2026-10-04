// ═══════════════════════════════════════════════════════════════════════════
// «ABONAR A OTRA FACTURA» (decisión de Rafael, 4-oct-2026). Puro, client-safe.
//
// «Si hay 2 facturas, una de $500 y otra de $700, si el paciente paga $700 [en]
// la primera factura $500, [que] la recepcionista o doctor pueda tener una
// opción de "abonar" los $200 extras que pagó para la segunda factura […].
// Aparecerá $200 pagado y saldo $500, el total es de $700».
//
// Un cobro de dinero real (un método, una fecha) se reparte así:
//   1. la factura que se está cobrando, hasta su saldo;
//   2. lo de más, a la factura que se eligió, hasta SU saldo;
//   3. lo que todavía sobre (o todo lo de más, si no se eligió ninguna) queda
//      a favor del paciente, como ya pasaba con el excedente en ortodoncia.
// El total de ninguna factura cambia: cada una recibe un PAGO por su parte.
//
// En centavos enteros: ni un centavo se crea ni se pierde
// (enCobrada + enDestino + aFavor = monto).
// ═══════════════════════════════════════════════════════════════════════════

const aCentavos = (pesos: unknown) => Math.round((Number(pesos) || 0) * 100);
const aPesos = (centavos: number) => centavos / 100;

/** Estados que todavía reciben pagos (lo mismo que el cobro de siempre). */
export const ESTADOS_ABONABLES = ["PENDING", "PARTIAL", "OVERDUE"] as const;

export interface RepartoConAbono {
  /** Lo que se queda la factura que se cobra. */
  enCobrada: number;
  /** Lo que se abona a la factura elegida (0 si no se eligió). */
  enDestino: number;
  /** Lo que queda a favor del paciente. */
  aFavor: number;
  /** Lo cobrado de más sobre la factura que se cobra (= enDestino + aFavor). */
  excedente: number;
}

export function repartirConAbono(args: {
  monto: number;
  /** Saldo (total − pagado) de la factura que se cobra. */
  faltaCobrada: number;
  /** Saldo de la factura elegida; null = no se eligió (lo de más, a favor). */
  faltaDestino: number | null;
}): RepartoConAbono {
  let resto = Math.max(0, aCentavos(args.monto));
  const enCobrada = Math.min(resto, Math.max(0, aCentavos(args.faltaCobrada)));
  resto -= enCobrada;
  const excedente = resto;
  const enDestino = args.faltaDestino == null ? 0 : Math.min(resto, Math.max(0, aCentavos(args.faltaDestino)));
  resto -= enDestino;
  return { enCobrada: aPesos(enCobrada), enDestino: aPesos(enDestino), aFavor: aPesos(resto), excedente: aPesos(excedente) };
}

export interface FacturaAbonable {
  id: string;
  invoiceNumber: string;
  /** Primer concepto (o «Varios conceptos»), para reconocerla en la lista. */
  concepto: string;
  total: number;
  paid: number;
  /** Lo que le falta: total − pagado. */
  saldo: number;
  createdAt: string | null;
}

/** Primer concepto de la factura, para la lista («Resina · +2»). */
export function conceptoDeFactura(items: unknown): string {
  const lista = Array.isArray(items) ? items : [];
  const nombres = lista
    .map((it) => String((it as { description?: unknown; name?: unknown })?.description ?? (it as { name?: unknown })?.name ?? "").trim())
    .filter(Boolean);
  if (nombres.length === 0) return "";
  return nombres.length === 1 ? nombres[0] : `${nombres[0]} · +${nombres.length - 1}`;
}

/**
 * Las facturas del paciente a las que se puede abonar: con saldo, en un estado
 * que recibe pagos y que no sean la que se está cobrando. La más vieja primero
 * (lo natural es ir saldando en orden).
 */
export function facturasAbonables(
  facturas: Array<{ id: string; invoiceNumber: string; status: string; total: number; paid: number; items?: unknown; createdAt?: Date | string | null }>,
  excluirId: string | null,
): FacturaAbonable[] {
  return facturas
    .filter((f) => f.id !== excluirId && (ESTADOS_ABONABLES as readonly string[]).includes(f.status))
    .map((f) => {
      const saldo = aPesos(Math.max(0, aCentavos(f.total) - aCentavos(f.paid)));
      const fecha = f.createdAt instanceof Date ? f.createdAt.toISOString() : (f.createdAt ?? null);
      return { id: f.id, invoiceNumber: f.invoiceNumber, concepto: conceptoDeFactura(f.items), total: f.total, paid: f.paid, saldo, createdAt: fecha };
    })
    .filter((f) => f.saldo > 0)
    .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? "") || a.id.localeCompare(b.id));
}

/** Las notas de los pagos de un mismo cobro: los liga entre sí (mismo «cobro #…»). */
export function notasDelAbono(args: {
  cobroId: string;
  monto: number;
  folioCobrada: string;
  folioDestino: string | null;
  reparto: RepartoConAbono;
}): { cobrada: string; destino: string; aFavor: string } {
  const m = (n: number) => `$${n.toFixed(2)}`;
  const partes = [`${m(args.reparto.enCobrada)} a esta factura`];
  if (args.reparto.enDestino > 0 && args.folioDestino) partes.push(`${m(args.reparto.enDestino)} abonados a la factura ${args.folioDestino}`);
  if (args.reparto.aFavor > 0) partes.push(`${m(args.reparto.aFavor)} a favor del paciente`);
  return {
    cobrada: `Cobro de ${m(args.monto)} (cobro #${args.cobroId}): ${partes.join(", ")}`,
    destino: args.reparto.enCobrada > 0
      ? `Abono: parte del cobro de ${m(args.monto)} registrado en la factura ${args.folioCobrada} (cobro #${args.cobroId})`
      : `Abono desde la factura ${args.folioCobrada} (cobro #${args.cobroId})`,
    aFavor: `Excedente del cobro de ${m(args.monto)} (cobro #${args.cobroId}): pasa al saldo a favor del paciente`,
  };
}
