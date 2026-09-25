import { WhatsappEscena } from "./whatsapp-escena";

/**
 * «El bot de WhatsApp con anticipo por Mercado Pago». Bloque OSCURO (#0b1220,
 * como el hero) entre la sección clara de Sabina y la clara del recorrido.
 * Todo lo que afirma sale de material/sabina-y-whatsapp.md.
 */
export const WHATSAPP_MP = {
  eyebrow: "WhatsApp + Mercado Pago",
  title: "Tu clínica cierra a las 8. Tu WhatsApp agenda a las 11 de la noche.",
  subtitle:
    "El bot contesta en el número de siempre de tu clínica, ofrece solo huecos reales y aparta la cita con un anticipo por Mercado Pago que cae directo en tu cuenta. Sin recepcionista de guardia y sin sobreagendar.",
  facts: [
    { icon: "wa", t: "API oficial de WhatsApp (Meta)", d: "En el número de tu clínica, el que tus pacientes ya tienen guardado." },
    { icon: "cal", t: "Solo ofrece huecos reales", d: "Lee el horario de cada doctor, sus días libres y los cierres de la clínica." },
    { icon: "lock", t: "El hueco se aparta al pagar", d: "Hasta que el anticipo no está pagado, el espacio sigue libre para otro paciente." },
    { icon: "mp", t: "El dinero cae en TU Mercado Pago", d: "En la cuenta de la clínica, no en la de DaleControl. El anticipo queda como saldo a favor del paciente y se descuenta solo de su factura." },
    { icon: "inv", t: "El anticipo se descuenta de la factura", d: "Tratamiento de $1,000 menos $200 de anticipo: el paciente debe $800." },
    { icon: "db", t: "Sobreagendar es imposible", d: "La base de datos rechaza dos citas al mismo doctor a la misma hora." },
  ],
  pie: "El bot se paga con Saldo de IA y está en todos los planes.",
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
