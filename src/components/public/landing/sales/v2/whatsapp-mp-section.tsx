import { WhatsappEscena } from "./whatsapp-escena";

/**
 * «Cobra tratamientos por WhatsApp con Mercado Pago». Sección clara (desde el
 * ajuste 4) después de «El panel, en vivo».
 *
 * Ajuste 5 (Rafael): la historia del teléfono ya no es el anticipo de una
 * cita, es la CLÍNICA cobrando tratamientos y mensualidades. Todo lo que se
 * afirma está comprobado en el código:
 *  · desde una factura se envía por WhatsApp el link de Mercado Pago con el
 *    monto (src/app/api/invoices/[id]/send-whatsapp/route.ts, `linkPago`);
 *  · el pago entra en la cuenta de Mercado Pago DE LA CLÍNICA y el webhook
 *    (kind "factura") lo registra solo en la factura como pago «mercadopago»;
 *  · existen planes de pago en mensualidades (PaymentPlan, 12 por defecto,
 *    con su calendario);
 *  · el anticipo del bot de WhatsApp queda como saldo a favor (ajuste 1).
 */
export const WHATSAPP_MP = {
  eyebrow: "WhatsApp + Mercado Pago",
  title: "Cobra tratamientos y mensualidades por WhatsApp. El dinero cae en tu cuenta.",
  subtitle:
    "Desde la factura mandas el link de pago al WhatsApp del paciente. Paga desde su celular, el dinero entra en la cuenta de Mercado Pago de tu clínica y el pago se registra solo en la factura.",
  facts: [
    { icon: "inv", t: "El link de pago sale de la factura", d: "Un botón en la factura envía por WhatsApp el link de Mercado Pago con el monto exacto." },
    { icon: "mp", t: "El dinero cae en TU Mercado Pago", d: "En la cuenta de la clínica, no en la de DaleControl." },
    { icon: "db", t: "El pago se registra solo", d: "Al aprobarse, queda en la factura como pago «Mercado Pago», sin capturar nada a mano." },
    { icon: "cal", t: "Mensualidades con plan de pago", d: "Ortodoncia y tratamientos largos en 12 mensualidades (o las que definas), con su calendario." },
    { icon: "lock", t: "Anticipos para apartar citas", d: "El bot de WhatsApp aparta la cita con un anticipo que queda como saldo a favor y se descuenta de la factura." },
    { icon: "wa", t: "API oficial de WhatsApp (Meta)", d: "En el número de tu clínica, el que tus pacientes ya tienen guardado." },
  ],
  pie: "Sin terminal ni datáfono: el paciente paga desde su celular.",
};

function Icono({ k }: { k: string }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (k) {
    case "wa":
      return <svg {...common}><path d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3z" /><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-1.8-1-1 1a4 4 0 0 1-2.2-2.2l1-1-1-1.8z" /></svg>;
    case "cal":
      return <svg {...common}><rect x="3" y="5" width="18" height="16" rx="2.5" /><path d="M3 10h18M8 3v4M16 3v4" /><path d="m9 15 2 2 4-4" /></svg>;
    case "lock":
      return <svg {...common}><rect x="4" y="11" width="16" height="10" rx="2.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>;
    case "mp":
      return <svg {...common}><ellipse cx="12" cy="12" rx="10" ry="7.5" /><path d="M6 12c2-2.6 4-2.6 6 0s4 2.6 6 0" /></svg>;
    case "inv":
      return <svg {...common}><path d="M6 3h9l4 4v14H6z" /><path d="M15 3v4h4" /><path d="M9 13h6M9 17h6" /></svg>;
    default:
      return <svg {...common}><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6" /><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></svg>;
  }
}

export function WhatsappMpSection() {
  return (
    <section id="whatsapp" className="dcv4-wasec" style={{ scrollMarginTop: 72 }}>
      <div aria-hidden="true" className="dcv4-dots" />
      <div className="dcv4-wasec__in">
        <div className="dcv4-wasec__copy" data-reveal="">
          <span className="dcv4-eyebrow dcv4-eyebrow--green">{WHATSAPP_MP.eyebrow}</span>
          <h2 className="dcv4-balance dcv4-h2 dcv4-h2--light">{WHATSAPP_MP.title}</h2>
          <p className="dcv4-pretty dcv4-lead dcv4-lead--light">{WHATSAPP_MP.subtitle}</p>
          <ul className="dcv4-wafacts">
            {WHATSAPP_MP.facts.map((f) => (
              <li key={f.t} className="dcv4-wafact">
                <span className={`dcv4-wafact__i dcv4-wafact__i--${f.icon}`}><Icono k={f.icon} /></span>
                <span>
                  <span className="dcv4-wafact__t">{f.t}</span>
                  <span className="dcv4-wafact__d">{f.d}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="dcv4-wasec__pie">{WHATSAPP_MP.pie}</p>
        </div>
        <div className="dcv4-wasec__stage" data-reveal="">
          <WhatsappEscena />
        </div>
      </div>
    </section>
  );
}
