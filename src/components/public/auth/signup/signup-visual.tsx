import { Logo } from "../../landing/primitives/logo";
import { DashboardMockup } from "../../landing/mockups/dashboard-mockup";

/** Los tres pasos, tal como pasan de verdad (cuenta → clínica → plan y pago). */
const PASOS = [
  { t: "Crea tu cuenta", s: "Tu nombre, tu correo y una contraseña. Un minuto." },
  { t: "Cuéntanos de tu clínica", s: "Especialidad y tamaño: con eso dejamos tu panel listo." },
  { t: "Elige tu plan y paga", s: "Tarjeta, SPEI u OXXO, en la página segura de Stripe." },
];

const VENTAJAS = ["Sin permanencia", "Sin instalar nada", "Datos cifrados", "Soporte 1 a 1"];

/**
 * Panel de marca del alta: mismo navy, trama de puntos y acento azul→violeta
 * que el hero de la portada. Cuenta qué va a pasar en los tres pasos en vez
 * de una lista de beneficios genérica. Estilos en ../auth-v4.css.
 */
export function SignupVisual() {
  return (
    <div className="dca-visual__in">
      <div>
        <Logo size={26} color="#c4b5fd" />
      </div>

      <div className="dca-eyebrow">
        <span className="dca-eyebrow__dot" aria-hidden="true" />
        Alta en 3 pasos · Cancela cuando quieras
      </div>

      <div>
        <h1 className="dca-h1">
          Tu clínica, en control <span className="dca-h1__accent">desde hoy</span>
        </h1>
        <p className="dca-lead">
          Agenda, expedientes, cobros, WhatsApp y facturación CFDI en un solo panel. Crea tu cuenta
          y elige el plan que te acomode.
        </p>
      </div>

      <ol className="dca-pasos">
        {PASOS.map((p, i) => (
          <li key={p.t} className="dca-paso">
            <span className="dca-paso__n" aria-hidden="true">{i + 1}</span>
            <span>
              <span className="dca-paso__t">{p.t}</span>
              <span className="dca-paso__s">{p.s}</span>
            </span>
          </li>
        ))}
      </ol>

      <ul className="dca-chips">
        {VENTAJAS.map((v) => (
          <li key={v}>{v}</li>
        ))}
      </ul>

      <div className="dca-mock" aria-hidden="true">
        <div className="dca-mock__frame">
          <DashboardMockup scale={0.395} animate={false} />
        </div>
      </div>

      <figure className="dca-testi" style={{ margin: 0 }}>
        <div className="dca-testi__avatar" aria-hidden="true">AP</div>
        <div style={{ minWidth: 0 }}>
          <blockquote className="dca-testi__q" style={{ margin: 0 }}>
            “Lo más fácil que he configurado. Lista en 8 minutos.”
          </blockquote>
          <figcaption className="dca-testi__by">Dra. Ana Paredes · Clínica Luna</figcaption>
        </div>
      </figure>
    </div>
  );
}
