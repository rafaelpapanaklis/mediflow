// ═══════════════════════════════════════════════════════════════════════
// DaleControl BARBER — AVISOS AL DUEÑO de los pedidos de la tienda: la parte
// PURA (sin red, sin base, client-safe). ws6-t6, 16-nov-2026.
//
// Rafael: «el apartado y pagar en tienda de un producto, ¿dónde le llega al
// dueño?». Además del numerito del menú y la tarjeta de Inicio, se le avisa:
//   · por CORREO (encendido por defecto): cuando entra el pedido (NEW) y
//     cuando se paga en línea (PAID). Una vez por pedido y motivo;
//   · por WHATSAPP (apagado por defecto: Meta cobra cada aviso fuera de las
//     24 h): solo cuando entra el pedido, desde el número de la barbería al
//     WhatsApp que el dueño escribió en Notificaciones.
//
// Aquí vive lo que se puede probar sin nada: el correo (asunto, HTML y texto
// plano), cómo se dice la forma de pago, los parámetros de la plantilla de
// WhatsApp y la decisión de si un WhatsApp sale, cómo, o por qué no.
// Quien habla con la base, con el correo y con Meta es pedido-avisos.ts.
// ═══════════════════════════════════════════════════════════════════════
import { mxTenDigits } from "@/lib/phone-mx";

/** Por qué se avisa. */
export type OrderNoticeKind = "NEW" | "PAID";
/** Por dónde. */
export type OrderNoticeChannelId = "EMAIL" | "WHATSAPP";
/** En qué quedó (columna "status" de barber_order_notices). */
export type OrderNoticeStatus = "SENDING" | "SENT" | "FAILED" | "SKIPPED";

/** A cuántos correos, como mucho, se manda un aviso (dueños de la sede + de la matriz). */
export const ORDER_NOTICE_MAX_RECIPIENTS = 5;

/** El WhatsApp solo avisa de un pedido NUEVO: un segundo mensaje al pagarse sería otro cobro de Meta. */
export const ORDER_NOTICE_WHATSAPP_KINDS: readonly OrderNoticeKind[] = ["NEW"];

/** A dónde lleva «Ver pedido»: Productos, ya en la pestaña Pedidos. */
export const ORDER_NOTICE_PANEL_PATH = "/barber/productos?tab=pedidos";

type Locale = "es" | "en";
const loc = (l: string | null | undefined): Locale => (String(l ?? "").toLowerCase().startsWith("en") ? "en" : "es");

/** Lo que el aviso necesita saber del pedido. */
export interface OrderNoticeOrder {
  id: string;
  folio: string;
  clientName: string;
  clientPhone: string;
  items: Array<{ name: string; qty: number; unitPrice: number }>;
  total: number;
  /** El cliente eligió pagar en línea (pay_method MERCADOPAGO). */
  payOnline: boolean;
  /** Ya está pagado (paid_at). */
  paid: boolean;
}

/** Dinero como en el panel: «$1,349.50». */
export function noticeMoney(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  try {
    return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
  } catch {
    return `$${v.toFixed(2)}`;
  }
}

/**
 * Cómo se le dice al dueño la forma de pago. Tres casos, nunca ambiguo:
 *   · ya pagó en línea        → «Pagado en línea»
 *   · eligió pagar en línea y → «Eligió pagar en línea (todavía no paga)»
 *     aún no lo hace
 *   · lo paga al recoger      → «Paga en la barbería»
 */
export function orderPayLabel(o: Pick<OrderNoticeOrder, "payOnline" | "paid">, locale?: string | null): string {
  const en = loc(locale) === "en";
  if (o.paid) return en ? "Paid online" : "Pagado en línea";
  if (o.payOnline) return en ? "Chose to pay online (not paid yet)" : "Eligió pagar en línea (todavía no paga)";
  return en ? "Pays at the shop" : "Paga en la barbería";
}

export function escapeHtml(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** «Barbería El Corte · Norte» (con la sede, si la hay y no repite el nombre). */
export function noticeShopLabel(shopName: string, branchName?: string | null): string {
  const name = String(shopName ?? "").trim();
  const branch = String(branchName ?? "").trim();
  return branch && branch.toLowerCase() !== name.toLowerCase() ? `${name} · ${branch}` : name;
}

/** El asunto no admite saltos de línea ni es infinito. */
function subjectSafe(v: string): string {
  return v.replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim().slice(0, 180);
}

export interface OwnerOrderEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * El correo al dueño. `panelUrl` es la liga completa a Productos → Pedidos.
 * Todo lo que escribió el cliente (nombre, productos) va escapado.
 */
export function buildOwnerOrderEmail(args: {
  kind: OrderNoticeKind;
  order: OrderNoticeOrder;
  shopName: string;
  branchName?: string | null;
  panelUrl: string;
  locale?: string | null;
}): OwnerOrderEmail {
  const { kind, order } = args;
  const en = loc(args.locale) === "en";
  const shop = noticeShopLabel(args.shopName, args.branchName);
  const pay = orderPayLabel(order, args.locale);
  const total = noticeMoney(order.total);

  const T = en
    ? {
        subject: kind === "PAID" ? `Order paid online #${order.folio} — ${shop}` : `New order #${order.folio} — ${shop}`,
        heading: kind === "PAID" ? "An order was paid online" : "You have a new shop order",
        lead:
          kind === "PAID"
            ? "The money is already in your Mercado Pago account. Get it ready and hand it over when the customer comes by."
            : "Someone set products aside from your online shop. Get them ready and mark the order “Ready” in your panel.",
        folio: "Order",
        customer: "Customer",
        phone: "WhatsApp",
        payment: "Payment",
        products: "Products",
        total: "Total",
        cta: "View order",
        why: "You get this email because order notices are on in Settings → Notifications. You can turn them off there.",
      }
    : {
        subject: kind === "PAID" ? `Pedido pagado en línea #${order.folio} — ${shop}` : `Pedido nuevo #${order.folio} — ${shop}`,
        heading: kind === "PAID" ? "Te pagaron un pedido en línea" : "Tienes un pedido nuevo en tu tienda",
        lead:
          kind === "PAID"
            ? "El dinero ya está en tu cuenta de Mercado Pago. Prepáralo y entrégalo cuando el cliente pase."
            : "Alguien apartó productos desde tu tienda en línea. Prepáralos y marca el pedido «Listo» en tu panel.",
        folio: "Pedido",
        customer: "Cliente",
        phone: "WhatsApp",
        payment: "Pago",
        products: "Productos",
        total: "Total",
        cta: "Ver pedido",
        why: "Recibes este correo porque los avisos de pedidos están encendidos en Configuración → Notificaciones. Ahí mismo los puedes apagar.",
      };

  const rows = order.items
    .map(
      (it) =>
        `<tr><td style="padding:6px 0;color:#1F1611;font-size:14px;">${it.qty} × ${escapeHtml(it.name)}</td>` +
        `<td style="padding:6px 0;color:#4A3D33;font-size:14px;text-align:right;white-space:nowrap;">${escapeHtml(noticeMoney(it.unitPrice * it.qty))}</td></tr>`,
    )
    .join("");
  const dato = (label: string, value: string) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#6F6153;font-size:13px;white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td>` +
    `<td style="padding:4px 0;color:#1F1611;font-size:14px;font-weight:600;">${escapeHtml(value)}</td></tr>`;

  const html = `<!doctype html>
<html lang="${en ? "en" : "es"}">
<body style="margin:0;padding:32px 16px;background:#F4ECE1;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#1F1611;">
  <div style="max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid #E6DACB;border-radius:14px;padding:32px 28px;">
    <div style="font-size:13px;font-weight:700;letter-spacing:0.04em;color:#7A4323;margin-bottom:18px;">${escapeHtml(shop)}</div>
    <h1 style="font-size:22px;line-height:1.3;margin:0 0 10px 0;color:#1F1611;">${escapeHtml(T.heading)}</h1>
    <p style="font-size:15px;line-height:1.55;margin:0 0 20px 0;color:#4A3D33;">${escapeHtml(T.lead)}</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 18px 0;">
      ${dato(T.folio, `#${order.folio}`)}
      ${dato(T.customer, order.clientName)}
      ${dato(T.phone, order.clientPhone)}
      ${dato(T.payment, pay)}
    </table>
    <div style="font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#6F6153;margin:0 0 6px 0;">${escapeHtml(T.products)}</div>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;border-top:1px solid #E6DACB;">
      ${rows}
      <tr><td style="padding:10px 0 0 0;border-top:1px solid #E6DACB;color:#1F1611;font-size:15px;font-weight:700;">${escapeHtml(T.total)}</td>
      <td style="padding:10px 0 0 0;border-top:1px solid #E6DACB;color:#1F1611;font-size:17px;font-weight:700;text-align:right;white-space:nowrap;">${escapeHtml(total)}</td></tr>
    </table>
    <div style="margin:26px 0 22px 0;">
      <a href="${escapeHtml(args.panelUrl)}" style="display:inline-block;padding:13px 26px;background:#8B4E26;color:#FFFFFF;font-size:15px;font-weight:700;text-decoration:none;border-radius:10px;">${escapeHtml(T.cta)}</a>
    </div>
    <p style="font-size:12px;line-height:1.5;margin:0;color:#6F6153;">${escapeHtml(T.why)}</p>
  </div>
</body>
</html>`;

  const text =
    `${T.heading}\n\n${T.lead}\n\n` +
    `${T.folio}: #${order.folio}\n${T.customer}: ${order.clientName}\n${T.phone}: ${order.clientPhone}\n${T.payment}: ${pay}\n\n` +
    `${T.products}:\n` +
    order.items.map((it) => `  ${it.qty} × ${it.name} — ${noticeMoney(it.unitPrice * it.qty)}`).join("\n") +
    `\n${T.total}: ${total}\n\n${T.cta}: ${args.panelUrl}\n\n${T.why}`;

  return { subject: subjectSafe(T.subject), html, text };
}

/**
 * Los correos a los que se avisa, sin repetir y con tope: primero los dueños
 * de la sede del pedido, luego los de la matriz. Si no hay ningún usuario
 * Dueño activo con correo, el correo de la barbería (el del registro).
 */
export function noticeRecipients(owners: Array<string | null | undefined>, fallback: Array<string | null | undefined> = []): string[] {
  const clean = (list: Array<string | null | undefined>) =>
    list.map((e) => String(e ?? "").trim().toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  const out: string[] = [];
  for (const e of clean(owners).length > 0 ? clean(owners) : clean(fallback)) {
    if (!out.includes(e)) out.push(e);
    if (out.length >= ORDER_NOTICE_MAX_RECIPIENTS) break;
  }
  return out;
}

// ── WhatsApp ────────────────────────────────────────────────────────────

/** El WhatsApp del dueño tal como se guarda: 10 dígitos de México, o null. */
export function cleanNoticePhone(raw: unknown): string | null {
  return typeof raw === "string" || typeof raw === "number" ? mxTenDigits(String(raw)) : null;
}

/** Lo que Configuración → Notificaciones lee y guarda. */
export interface OrderNoticeSettings {
  email: boolean;
  whatsapp: boolean;
  /** WhatsApp del dueño (10 dígitos) o null. */
  phone: string | null;
}

/** Con lo que nace una barbería: correo sí, WhatsApp no. */
export const ORDER_NOTICE_DEFAULTS: OrderNoticeSettings = { email: true, whatsapp: false, phone: null };
