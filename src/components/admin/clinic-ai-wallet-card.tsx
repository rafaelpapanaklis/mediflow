"use client";

import Link from "next/link";
import { ArrowUpRight, Wallet } from "lucide-react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { fmtMXNdec } from "@/lib/format";
import { fechaHoraAdmin } from "@/lib/admin/zona-horaria";
import { esSaldoBajo } from "@/lib/ai-billing/saldo-estado";
import { ETIQUETA_VIA_RECARGA } from "@/lib/ai-billing/recargas";
import { AiWalletStatusBadge } from "@/components/admin/ai-wallet-status-badge";
import type { SaldoIaClinicaDTO, MovimientoSaldoIaDTO } from "@/lib/admin/saldo-ia-clinica";

/**
 * El saldo de IA de la clínica, en su ficha. De LECTURA: el saldo es el de
 * `ai_wallets` tal cual (el mismo que pinta /admin/ai-billing), el estado
 * sale de la misma regla que Tesorería, y «Ajustar saldo» sigue donde estaba.
 */

const TIPO_MOVIMIENTO: Record<string, string> = {
  TOPUP: "Recarga",
  CHARGE: "Consumo",
  REFUND: "Reembolso",
};

const ORIGEN: Record<string, string> = {
  STRIPE: "Stripe",
  MERCADOPAGO: "Mercado Pago",
  SPEI: "SPEI",
  USAGE: "bot de WhatsApp",
  ADMIN: "DaleControl",
};

function tipoDe(m: MovimientoSaldoIaDTO): string {
  if (m.type === "ADJUSTMENT") return m.amountCents >= 0 ? "Abono a mano" : "Cargo a mano";
  return TIPO_MOVIMIENTO[m.type] ?? m.type;
}

const ETIQUETA_STYLE: React.CSSProperties = {
  fontSize: 11, color: "var(--text-3)", marginBottom: 4,
};

/** Cifra con signo: los abonos en verde, los cargos en el color del texto. */
function Importe({ cents }: { cents: number }) {
  const positivo = cents > 0;
  return (
    <span className="mono" style={{ fontWeight: 600, color: positivo ? "var(--success)" : "var(--text-1)" }}>
      {positivo ? "+" : ""}{fmtMXNdec(cents / 100)}
    </span>
  );
}

export function ClinicAiWalletCard({ saldo }: { saldo: SaldoIaClinicaDTO | null }) {
  if (!saldo) {
    return (
      <CardNew>
        <div className="form-section__title">
          Saldo de IA <span className="form-section__rule" />
        </div>
        <div style={{ fontSize: 13, color: "var(--text-3)" }}>
          No se pudo leer el monedero de IA de esta clínica. Vuelve a cargar o míralo en{" "}
          <Link href="/admin/ai-billing" style={{ color: "var(--brand)" }}>Tesorería IA</Link>.
        </div>
      </CardNew>
    );
  }

  const w = saldo.wallet;
  const monedero = { hasWallet: !!w, status: w?.status ?? null, balanceCents: w ? w.balanceCents : null };
  const saldoColor = !w
    ? "var(--text-3)"
    : w.balanceCents < 0
      ? "var(--danger)"
      : esSaldoBajo(monedero)
        ? "var(--warning)"
        : "var(--text-1)";

  return (
    <CardNew>
      {/* flexWrap: a 390 px el enlace baja de línea en vez de recortarse. */}
      <div className="form-section__title" style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <Wallet size={14} style={{ color: "var(--text-3)", flexShrink: 0 }} />
        <span style={{ whiteSpace: "nowrap" }}>Saldo de IA</span>
        <AiWalletStatusBadge monedero={monedero} />
        <span className="form-section__rule" style={{ minWidth: 16 }} />
        <Link
          href="/admin/ai-billing"
          style={{ fontSize: 11, fontWeight: 600, color: "var(--brand)", textDecoration: "none", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 3 }}
          title="El ajuste de saldo se hace desde Tesorería IA"
        >
          Ajustar en Tesorería IA <ArrowUpRight size={12} />
        </Link>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 16 }}>
        <div>
          <div style={ETIQUETA_STYLE}>Saldo actual</div>
          <div className="mono" style={{ fontSize: 22, fontWeight: 700, color: saldoColor }} title={w ? undefined : "La clínica no tiene monedero prepago"}>
            {w ? fmtMXNdec(w.balanceCents / 100) : "—"}
          </div>
          {w && (
            <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
              {w.autoRecharge ? "Auto-recarga activa" : "Sin auto-recarga"} · movido {fechaHoraAdmin(w.updatedAt) ?? "—"}
            </div>
          )}
        </div>
        <div>
          <div style={ETIQUETA_STYLE}>Pagado en recargas</div>
          <div className="mono" style={{ fontSize: 22, fontWeight: 700, color: "var(--success)" }}>
            {fmtMXNdec(saldo.pagos.totalCents / 100)}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
            {saldo.pagos.count} {saldo.pagos.count === 1 ? "recarga acreditada" : "recargas acreditadas"} · detalle en Facturación
          </div>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <div style={{ ...ETIQUETA_STYLE, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
          Últimos movimientos
        </div>
        {!w ? (
          <div style={{ fontSize: 13, color: "var(--text-3)" }}>
            Esta clínica no tiene monedero de IA: no es saldo 0, es «no aplica». Se crea con su primera recarga o abono.
          </div>
        ) : saldo.movimientos.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--text-3)" }}>Sin movimientos todavía.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table-new" style={{ minWidth: 520 }}>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Movimiento</th>
                  <th style={{ textAlign: "right" }}>Importe</th>
                  <th style={{ textAlign: "right" }}>Saldo después</th>
                  <th>Nota</th>
                </tr>
              </thead>
              <tbody>
                {saldo.movimientos.map((m) => (
                  <tr key={m.id}>
                    <td className="mono" style={{ color: "var(--text-3)", whiteSpace: "nowrap" }}>
                      {fechaHoraAdmin(m.createdAt) ?? "—"}
                    </td>
                    <td>
                      <div style={{ color: "var(--text-1)", fontWeight: 500 }}>{tipoDe(m)}</div>
                      <div style={{ fontSize: 11, color: "var(--text-3)" }}>{ORIGEN[m.source] ?? m.source}</div>
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}><Importe cents={m.amountCents} /></td>
                    <td className="mono" style={{ textAlign: "right", color: m.balanceAfterCents < 0 ? "var(--danger)" : "var(--text-2)", whiteSpace: "nowrap" }}>
                      {fmtMXNdec(m.balanceAfterCents / 100)}
                    </td>
                    <td style={{ fontSize: 12, color: "var(--text-2)", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={m.note ?? m.reference ?? undefined}>
                      {m.note ?? (m.reference ? <span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{m.reference}</span> : "—")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </CardNew>
  );
}

/**
 * Lo que la clínica ha PAGADO de saldo IA, en Facturación. Es dinero distinto
 * de la suscripción: una recarga es un CARGO de Stripe (checkout
 * `mode: "payment"`), no una factura, y por eso no salía en ningún lado. El
 * criterio de qué es un pago es el mismo que el historial de facturas del
 * cliente (@/lib/ai-billing/recargas).
 */
export function ClinicAiPaymentsCard({ saldo }: { saldo: SaldoIaClinicaDTO | null }) {
  const filas = saldo?.pagos.filas ?? [];
  return (
    <CardNew>
      <div className="form-section__title" style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <span style={{ whiteSpace: "nowrap" }}>Pagos de saldo IA</span>
        <BadgeNew tone="brand">Saldo IA</BadgeNew>
        <span className="form-section__rule" />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 16, marginBottom: 12 }}>
        <div>
          <div style={ETIQUETA_STYLE}>Total acreditado</div>
          <div className="mono" style={{ fontSize: 22, fontWeight: 700, color: "var(--success)" }}>
            {saldo ? fmtMXNdec(saldo.pagos.totalCents / 100) : "—"}
          </div>
        </div>
        <div>
          <div style={ETIQUETA_STYLE}>Recargas acreditadas</div>
          <div className="mono" style={{ fontSize: 22, fontWeight: 700, color: "var(--text-1)" }}>
            {saldo ? saldo.pagos.count : "—"}
          </div>
        </div>
      </div>

      {!saldo ? (
        <div style={{ fontSize: 13, color: "var(--text-3)" }}>No se pudo leer el monedero de IA de esta clínica.</div>
      ) : filas.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--text-3)" }}>Sin recargas de saldo IA.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="table-new" style={{ minWidth: 560 }}>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Vía</th>
                <th style={{ textAlign: "right" }}>Importe</th>
                <th>Estado</th>
                <th>Referencia</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((p) => (
                <tr key={p.id}>
                  <td className="mono" style={{ color: "var(--text-3)", whiteSpace: "nowrap" }}>
                    {fechaHoraAdmin(p.createdAt) ?? "—"}
                  </td>
                  <td style={{ color: "var(--text-1)" }}>{ETIQUETA_VIA_RECARGA[p.via]}</td>
                  <td className="mono" style={{ textAlign: "right", fontWeight: 600, color: "var(--success)", whiteSpace: "nowrap" }}>
                    {fmtMXNdec(p.amountCents / 100)}
                  </td>
                  <td>
                    {p.status === "paid" ? (
                      <BadgeNew tone="success" dot>Pagada</BadgeNew>
                    ) : (
                      <BadgeNew tone="warning" dot>Pendiente</BadgeNew>
                    )}
                  </td>
                  <td style={{ fontSize: 11, color: "var(--text-3)", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.note ?? p.reference ?? undefined}>
                    {p.proofUrl ? (
                      <a href={p.proofUrl} target="_blank" rel="noreferrer" style={{ color: "var(--brand)" }}>Ver comprobante</a>
                    ) : p.note ?? (p.reference ? <span className="mono">{p.reference}</span> : "—")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ marginTop: 12, fontSize: 11, color: "var(--text-3)" }}>
        Recargas del monedero de IA (libro mayor ai_wallet_transactions: recargas por pasarela y abonos a
        mano) más las SPEI con comprobante en revisión. No son pagos de suscripción: esos van arriba.
        Mismo criterio que el historial de facturas que ve la clínica.
      </div>
    </CardNew>
  );
}
