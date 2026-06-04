import { ClipboardCheck, Users, ReceiptText, type LucideIcon } from "lucide-react";

type Step = {
  num: string;
  Icon: LucideIcon;
  title: string;
  desc: string;
};

const STEPS: Step[] = [
  {
    num: "01",
    Icon: ClipboardCheck,
    title: "Configura tu clínica en 15 minutos",
    desc: "Importamos tus pacientes desde Excel, Dentrix o el sistema que uses hoy. Sin perder datos.",
  },
  {
    num: "02",
    Icon: Users,
    title: "Tu equipo la usa el primer día",
    desc: "Interfaz intuitiva, sin manual. Recepción, doctores y administración se adaptan en horas.",
  },
  {
    num: "03",
    Icon: ReceiptText,
    title: "Atiende, factura y fideliza",
    desc: "Cobras y se timbra el CFDI, se envía por WhatsApp y queda en el expediente. Sin capturar nada dos veces.",
  },
];

export function Steps() {
  return (
    <section className="lp-section lp-section--tint" aria-labelledby="steps-h">
      <div className="lp-container">
        <div className="lp-section-head">
          <p className="lp-eyebrow">Cómo funciona</p>
          <h2 id="steps-h" className="lp-h2">
            De tu primera cita a tu quinta sucursal.
          </h2>
        </div>

        <ol className="lp-steps-grid lp-grid lp-grid-3">
          {STEPS.map(({ num, Icon, title, desc }) => (
            <li key={num} className="lp-steps-item">
              <article className="lp-card lp-steps-card">
                <span aria-hidden="true" className="lp-steps-connector" />
                <span className="lp-mono lp-steps-num">{num}</span>
                <div className="lp-card__icon lp-steps-icon">
                  <Icon size={22} strokeWidth={1.75} aria-hidden="true" />
                </div>
                <h3 className="lp-card__title">{title}</h3>
                <p className="lp-card__desc">{desc}</p>
              </article>
            </li>
          ))}
        </ol>
      </div>

      <style>{`
        .lp-steps-grid {
          list-style: none;
          padding: 0;
          margin: 0;
        }
        .lp-steps-item {
          position: relative;
        }
        .lp-steps-card {
          height: 100%;
          position: relative;
        }
        .lp-steps-num {
          display: block;
          color: var(--ld-brand-strong);
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 0.18em;
          margin-bottom: 18px;
        }
        .lp-steps-icon {
          margin-bottom: 18px;
        }
        /* Conector hairline entre tarjetas en escritorio */
        .lp-steps-connector {
          position: absolute;
          top: 44px;
          right: -1px;
          width: 24px;
          height: 1px;
          background: var(--ld-border-strong);
          transform: translateX(100%);
          z-index: 1;
        }
        .lp-steps-item:last-child .lp-steps-connector {
          display: none;
        }
        @media (max-width: 880px) {
          .lp-steps-connector {
            display: none;
          }
        }
      `}</style>
    </section>
  );
}
