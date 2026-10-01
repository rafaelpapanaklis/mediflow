// ─────────────────────────────────────────────────────────────────────────────
// HTML del recibo NO fiscal de un pago de suscripción.
//
// Se sirve como text/html desde el MISMO origen que /admin y lo abre el admin
// de plataforma con su cookie, así que NINGÚN dato de la base (nombre, correo,
// ciudad, dirección, RFC, método, referencia, folio, estado) puede ir crudo:
// todo pasa por `esc` (A2, auditoría 30-sep-2026). Función pura para poder
// probarla con datos hostiles sin base ni servidor.
// ─────────────────────────────────────────────────────────────────────────────
import { escapeHtml } from "@/lib/document-templates/sanitize";

export interface ReciboPago {
  id: string;
  status: string;
  currency: string;
  amount: number;
  createdAt: Date;
  periodStart: Date;
  periodEnd: Date;
  method: string | null;
  reference: string | null;
  clinic: {
    name: string;
    email: string | null;
    city: string | null;
    address: string | null;
    taxId: string | null;
  };
}

export function renderReciboHtml(payment: ReciboPago, nonce: string): string {
  const esc = (v: string | null | undefined) => escapeHtml(v ?? "");
  const c = payment.clinic;
  const folio = esc(payment.id);
  const estado = payment.status === "paid" ? "Pagado" : esc(payment.status);
  // El `currency` va a Intl: un valor inválido lanza RangeError; se cae a MXN.
  const fmtMoney = (n: number) => {
    try {
      return new Intl.NumberFormat("es-MX", { style: "currency", currency: payment.currency }).format(n);
    } catch {
      return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n);
    }
  };
  const fmtDate = (d: Date) =>
    new Date(d).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Recibo — DaleControl ${esc(payment.id.slice(0, 8))}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: #f1f5f9; margin: 0; padding: 32px; color: #0f172a; }
    .card { max-width: 720px; margin: 0 auto; background: #fff; border-radius: 16px; padding: 48px; box-shadow: 0 10px 30px rgba(0,0,0,0.06); }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; padding-bottom: 24px; border-bottom: 2px solid #e2e8f0; }
    h1 { margin: 0; font-size: 22px; }
    .muted { color: #64748b; font-size: 13px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin: 24px 0; }
    .grid h3 { margin: 0 0 8px; font-size: 12px; text-transform: uppercase; color: #64748b; letter-spacing: 0.05em; }
    .total { display: flex; justify-content: space-between; align-items: center; background: #0f172a; color: white; padding: 20px 24px; border-radius: 12px; margin-top: 16px; }
    .total .amount { font-size: 28px; font-weight: 800; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; text-align: center; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; text-transform: uppercase; }
    .badge-paid { background: #dcfce7; color: #166534; }
    .badge-pending { background: #fef3c7; color: #92400e; }
    .print-btn { position: fixed; top: 16px; right: 16px; background: #4f46e5; color: white; border: 0; padding: 10px 18px; border-radius: 8px; font-weight: 700; cursor: pointer; font-size: 13px; }
    @media print { body { background: white; padding: 0; } .card { box-shadow: none; } .print-btn { display: none; } }
  </style>
</head>
<body>
  <button class="print-btn" id="print-btn" type="button">🖨️ Imprimir / Guardar PDF</button>
  <script nonce="${esc(nonce)}">document.getElementById("print-btn").addEventListener("click", function () { window.print(); });</script>
  <div class="card">
    <div class="header">
      <div>
        <h1>DaleControl</h1>
        <div class="muted">Recibo no fiscal</div>
        <div class="muted">Folio: ${folio}</div>
      </div>
      <div style="text-align:right">
        <div class="muted">Fecha</div>
        <div style="font-weight:700">${fmtDate(payment.createdAt)}</div>
        <div style="margin-top:8px">
          <span class="badge ${payment.status === "paid" ? "badge-paid" : "badge-pending"}">
            ${estado}
          </span>
        </div>
      </div>
    </div>

    <div class="grid">
      <div>
        <h3>Cliente</h3>
        <div style="font-weight:700">${esc(c.name)}</div>
        <div class="muted">${esc(c.email)}</div>
        <div class="muted">${esc([c.city, c.address].filter(Boolean).join(", "))}</div>
        ${c.taxId ? `<div class="muted">RFC: ${esc(c.taxId)}</div>` : ""}
      </div>
      <div>
        <h3>Periodo facturado</h3>
        <div style="font-weight:700">${fmtDate(payment.periodStart)} → ${fmtDate(payment.periodEnd)}</div>
        <div class="muted" style="margin-top:8px">Método: ${esc(payment.method ?? "—")}</div>
        ${payment.reference ? `<div class="muted">Ref: ${esc(payment.reference)}</div>` : ""}
      </div>
    </div>

    <div class="total">
      <div>
        <div style="font-size:11px;opacity:0.7;text-transform:uppercase">Total pagado</div>
        <div style="font-size:13px;opacity:0.9;margin-top:4px">Suscripción DaleControl</div>
      </div>
      <div class="amount">${fmtMoney(payment.amount)}</div>
    </div>

    <div class="footer">
      Este documento es un comprobante interno de pago, NO sustituye una factura fiscal (CFDI).<br/>
      Para obtener CFDI timbrado ante el SAT, solicítalo al equipo de DaleControl.
    </div>
  </div>
</body>
</html>`;

}
