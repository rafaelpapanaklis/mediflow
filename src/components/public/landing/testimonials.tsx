type Testimonial = {
  metric: string;
  quote: string;
  name: string;
  role: string;
  city: string;
};

const TESTIMONIALS: Testimonial[] = [
  {
    metric: "−73% faltas",
    quote:
      "Dejamos Excel y WhatsApp manual. En 3 meses bajamos las faltas a citas de 22% a 6%. El recordatorio automático se paga solo.",
    name: "Dra. Mariana Ochoa",
    role: "Directora · Clínica Dental Polanco",
    city: "CDMX",
  },
  {
    metric: "4 h/semana",
    quote:
      "Lo que me convenció fue el CFDI nativo. Antes facturábamos aparte; ahora todo en un clic y ahorro 4 horas a la semana.",
    name: "Dr. Ernesto Villalobos",
    role: "Médico general · Consultorio Villalobos",
    city: "Monterrey",
  },
  {
    metric: "+28% aceptación",
    quote:
      "La IA para radiografías no reemplaza mi ojo clínico, pero es una segunda opinión que mis pacientes valoran. Subió la aceptación de tratamientos.",
    name: "Dr. Alejandro Kuri",
    role: "Endodoncista · Smile Studio",
    city: "Guadalajara",
  },
];

function getInitials(name: string): string {
  const parts = name
    .replace(/^(Dra?\.)\s+/i, "")
    .trim()
    .split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

export function Testimonials() {
  return (
    <section className="lp-section lp-section--tint" id="testimonials" aria-labelledby="tst-h">
      <div className="lp-container">
        <div className="lp-section-head">
          <p className="lp-eyebrow">Clientes</p>
          <h2 id="tst-h" className="lp-h2">
            Clínicas que crecen con MediFlow.
          </h2>
        </div>
        <div className="lp-grid lp-grid-3">
          {TESTIMONIALS.map((t) => (
            <figure key={t.name} className="lp-card lp-tst-card">
              <span className="lp-tst-metric">{t.metric}</span>
              <blockquote className="lp-tst-quote">{t.quote}</blockquote>
              <figcaption className="lp-tst-caption">
                <span className="lp-tst-avatar" aria-hidden="true">
                  {getInitials(t.name)}
                </span>
                <span className="lp-tst-who">
                  <span className="lp-tst-name">{t.name}</span>
                  <span className="lp-tst-role">
                    {t.role} · {t.city}
                  </span>
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
      <style>{`
        .lp-tst-card {
          display: flex;
          flex-direction: column;
          gap: 18px;
        }
        .lp-tst-metric {
          align-self: flex-start;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 12px;
          line-height: 1;
          padding: 7px 12px;
          border-radius: 100px;
          background: rgba(16, 157, 107, 0.1);
          color: #0d8f60;
          border: 1px solid rgba(16, 157, 107, 0.22);
        }
        .lp-tst-quote {
          margin: 0;
          color: var(--ld-fg);
          font-size: 16px;
          line-height: 1.55;
        }
        .lp-tst-caption {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-top: auto;
          padding-top: 4px;
        }
        .lp-tst-avatar {
          flex: none;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 38px;
          height: 38px;
          border-radius: 50%;
          background: var(--ld-grad-brand);
          color: #fff;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 0.02em;
        }
        .lp-tst-who {
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
        }
        .lp-tst-name {
          color: var(--ld-fg);
          font-size: 14px;
          font-weight: 600;
        }
        .lp-tst-role {
          color: var(--ld-fg-subtle);
          font-size: 12px;
        }
      `}</style>
    </section>
  );
}
