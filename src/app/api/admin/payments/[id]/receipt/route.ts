import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

function isAdminAuthed() {
  const token = cookies().get("admin_token")?.value;
  return !!token && token === process.env.ADMIN_SECRET_TOKEN;
}

// Recibo NO fiscal en HTML. El navegador puede exportarlo a PDF con
// Ctrl/Cmd+P → "Guardar como PDF". Evitamos dependencias pesadas
// (@react-pdf/renderer) porque el documento es informativo.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAdminAuthed()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const payment = await prisma.subscriptionInvoice.findUnique({
    where: { id: params.id },
    include: { clinic: { select: { name: true, email: true, city: true, address: true, taxId: true } } },
  });
  if (!payment) return NextResponse.json({ error: "Pago no encontrado" }, { status: 404 });

  const fmtMoney = (n: number) =>
    new Intl.NumberFormat("es-MX", { style: "currency", currency: payment.currency }).format(n);
  const fmtDate = (d: Date) =>
    new Date(d).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });

  const html = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Recibo — MediFlow ${payment.id.slice(0, 8)}</title>
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
  <button class="print-btn" onclick="window.print()">🖨️ Imprimir / Guardar PDF</button>
  <div class="card">
    <div class="header">
      <div>
        <h1>MediFlow</h1>
        <div class="muted">Recibo no fiscal</div>
        <div class="muted">Folio: ${payment.id}</div>
      </div>
      <div style="text-align:right">
        <div class="muted">Fecha</div>
        <div style="font-weight:700">${fmtDate(payment.createdAt)}</div>
        <div style="margin-top:8px">
          <span class="badge ${payment.status === "paid" ? "badge-paid" : "badge-pending"}">
            ${payment.status === "paid" ? "Pagado" : payment.status}
          </span>
        </div>
      </div>
    </div>

    <div class="grid">
      <div>
        <h3>Cliente</h3>
        <div style="font-weight:700">${payment.clinic.name}</div>
        <div class="muted">${payment.clinic.email ?? ""}</div>
        <div class="muted">${[payment.clinic.city, payment.clinic.address].filter(Boolean).join(", ")}</div>
        ${payment.clinic.taxId ? `<div class="muted">RFC: ${payment.clinic.taxId}</div>` : ""}
      </div>
      <div>
        <h3>Periodo facturado</h3>
        <div style="font-weight:700">${fmtDate(payment.periodStart)} → ${fmtDate(payment.periodEnd)}</div>
        <div class="muted" style="margin-top:8px">Método: ${payment.method ?? "—"}</div>
        ${payment.reference ? `<div class="muted">Ref: ${payment.reference}</div>` : ""}
      </div>
    </div>

    <div class="total">
      <div>
        <div style="font-size:11px;opacity:0.7;text-transform:uppercase">Total pagado</div>
        <div style="font-size:13px;opacity:0.9;margin-top:4px">Suscripción MediFlow</div>
      </div>
      <div class="amount">${fmtMoney(payment.amount)}</div>
    </div>

    <div class="footer">
      Este documento es un comprobante interno de pago, NO sustituye una factura fiscal (CFDI).<br/>
      Para obtener CFDI timbrado ante el SAT, solicítalo al equipo de MediFlow.
    </div>
  </div>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
