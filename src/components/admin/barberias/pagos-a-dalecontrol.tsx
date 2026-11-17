// /admin/barberias/[id] — «Lo que esta barbería te ha pagado» (ws6-t1, 16-nov).
//
// El mismo bloque que la pestaña «Facturación» de la ficha de clínica del
// dental («Total cobrado», «Pagos registrados», «Último pago»), más la lista
// de cobros con su recibo de Stripe y los rechazados. Solo pinta: los datos
// llegan calculados de src/lib/barber/admin-pagos.ts.
//
// Sin estado ni handlers: sirve igual dentro del componente cliente de la ficha.
import Link from "next/link";
import { ExternalLink, Receipt } from "lucide-react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import type { PagosBarberiaDTO } from "@/lib/barber/admin-pagos-core";
import { formatInt, formatMoney, fullDate, shortDate } from "./shared";

const CICLO: Record<string, string> = { month: "mensual", year: "anual" };

function Cifra({ label, children, sub }: { label: string; children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div className="dcba-label">{label}</div>
      <div className="dcba-cifra">{children}</div>
      {sub ? <div className="dcba-note">{sub}</div> : null}
    </div>
  );
}

export function PagosADaleControl({
  barbershopId,
  pagos,
  matrizNombre,
}: {
  /** La ficha que se está viendo (el recibo se pide con ESTA barbería). */
  barbershopId: string;
  /** null = no se pudo leer (la ficha sigue). */
  pagos: PagosBarberiaDTO | null;
  matrizNombre: string | null;
}) {
  return (
    <CardNew noPad>
      <div style={{ padding: "14px 16px 0" }}>
        <div className="dcba-cardtitle">
          <Receipt size={14} />
          {pagos?.esSucursal ? "Lo que su matriz te ha pagado" : "Lo que esta barbería te ha pagado"}
        </div>
        {pagos?.esSucursal && (
          <p className="dcba-note" style={{ marginTop: -4 }}>
            Una sucursal no paga aparte: son los cobros de{" "}
            <Link href={`/admin/barberias/${pagos.pagaId}`}>{matrizNombre ?? "su matriz"}</Link>.
          </p>
        )}
      </div>

      {pagos === null ? (
        <p className="dcba-note" style={{ padding: "0 16px 16px" }}>
          No se pudieron leer los cobros. El resto de la ficha está bien; recarga en un momento.
        </p>
      ) : !pagos.disponible ? (
        <div className="dcba-warn" style={{ margin: "0 16px 16px" }}>
          <span>
            Sin registro de cobros: falta pegar <span className="mono">sql/barber_cobros.sql</span>. El estado de
            la suscripción de arriba sigue siendo el de Stripe.
          </span>
        </div>
      ) : (
        <>
          <div className="dcba-fields" style={{ padding: "4px 16px 14px" }}>
            <Cifra label="Total cobrado" sub="pagos de la suscripción">
              <span style={{ color: "var(--success)" }}>{formatMoney(pagos.totalCobrado)}</span>
            </Cifra>
            <Cifra
              label="Pagos registrados"
              sub={pagos.fallidos > 0 ? <span style={{ color: "var(--danger)" }}>{formatInt(pagos.fallidos)} rechazados</span> : "sin rechazos"}
            >
              {formatInt(pagos.pagados)}
            </Cifra>
            <Cifra label="Último pago" sub={pagos.ultimoPago ? formatMoney(pagos.ultimoPago.monto) : undefined}>
              <span title={fullDate(pagos.ultimoPago?.fecha)}>
                {pagos.ultimoPago ? shortDate(pagos.ultimoPago.fecha) : "Sin pagos"}
              </span>
            </Cifra>
            <Cifra
              label="Próxima renovación"
              sub={
                pagos.terminos?.cancelaAlFinal
                  ? <span style={{ color: "var(--warning)" }}>se cancela al terminar el periodo</span>
                  : pagos.terminos?.importe
                    ? `${formatMoney(pagos.terminos.importe)} ${CICLO[pagos.terminos.ciclo ?? ""] ?? ""}`.trim()
                    : undefined
              }
            >
              <span title={fullDate(pagos.proximaRenovacion)}>{shortDate(pagos.proximaRenovacion)}</span>
            </Cifra>
          </div>

          {pagos.terminos?.cortesiaDesde && (
            <div className="dcba-note" style={{ padding: "0 16px 10px" }}>
              Reactivada a mano el {shortDate(pagos.terminos.cortesiaDesde)}: es cortesía hasta el siguiente cobro.
            </div>
          )}

          <div className="dcba-tablewrap">
            <table className="table-new">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th style={{ textAlign: "right" }}>Monto</th>
                  <th>Estado</th>
                  <th className="dcba-col-wide">Periodo</th>
                  <th>Recibo</th>
                </tr>
              </thead>
              <tbody>
                {pagos.pagos.map((p) => (
                  <tr key={p.invoiceId}>
                    <td>
                      <span className="dcba-nowrap" style={{ fontSize: 12, color: "var(--text-2)" }} title={fullDate(p.fecha)}>
                        {shortDate(p.fecha)}
                      </span>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <span className="mono" style={{ fontSize: 12.5, color: "var(--text-1)" }}>
                        {formatMoney(p.monto, p.moneda)}
                      </span>
                    </td>
                    <td>
                      {p.estado === "paid" ? (
                        <BadgeNew tone="success" dot>Pagado</BadgeNew>
                      ) : (
                        <BadgeNew tone="danger" dot>Rechazado</BadgeNew>
                      )}
                      {p.motivo && <div className="mono dcba-note">{p.motivo}</div>}
                    </td>
                    <td className="dcba-col-wide">
                      <span style={{ fontSize: 12, color: "var(--text-2)" }}>
                        {p.periodoDesde || p.periodoHasta
                          ? `${shortDate(p.periodoDesde)} – ${shortDate(p.periodoHasta)}`
                          : "—"}
                        {p.ciclo ? ` · ${CICLO[p.ciclo]}` : ""}
                      </span>
                    </td>
                    <td>
                      <a
                        href={`/api/admin/barberias/${barbershopId}/recibo?factura=${encodeURIComponent(p.invoiceId)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="dcba-link"
                        title={p.invoiceId}
                      >
                        Stripe <ExternalLink size={11} style={{ verticalAlign: -1 }} />
                      </a>
                    </td>
                  </tr>
                ))}
                {pagos.pagos.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ padding: 24, textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
                      Sin cobros registrados: cortesía, sin pagar, o pagó antes de que existiera el registro.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="dcba-note" style={{ padding: "10px 16px 14px", margin: 0 }}>
            Cobros de la suscripción por Stripe (tabla <span className="mono">barber_subscription_payments</span>).
            Es lo que la barbería te paga a ti; lo que ella cobra a sus clientes está en «Números del negocio».
            {pagos.hayMas ? ` Se listan los ${formatInt(pagos.pagos.length)} más recientes; los totales son de todos.` : ""}
          </p>
        </>
      )}
    </CardNew>
  );
}
