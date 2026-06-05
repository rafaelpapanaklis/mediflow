import { Star } from "lucide-react";

const U = (id: string) =>
  `https://images.unsplash.com/photo-${id}?w=120&h=120&fit=crop&crop=faces&q=80`;

const ITEMS = [
  {
    metric: "−73%", metricLabel: "faltas a citas",
    quote: "Antes perdíamos un sillón completo cada día por inasistencias. Con los recordatorios por WhatsApp las faltas se desplomaron y la agenda se llena sola.",
    name: "Dra. Mariana Ochoa", role: "Clínica Dental Polanco · CDMX",
    photo: U("1559839734-2b71ea197ec2"),
  },
  {
    metric: "+28%", metricLabel: "aceptación de tratamientos",
    quote: "Mostrarle al paciente la radiografía con los hallazgos de la IA y su plan de tratamiento en pantalla cambió todo. Aceptan más y con más confianza.",
    name: "Dr. Alejandro Kuri", role: "Sonrisas Kuri · Monterrey",
    photo: U("1612349317150-e413f6a5b16d"),
  },
  {
    metric: "+4 h", metricLabel: "ahorradas por semana",
    quote: "Tener agenda, expediente y la factura CFDI en un solo lugar me quitó horas de trabajo administrativo cada semana. Dejé el Excel y el facturador aparte.",
    name: "Dra. Valeria Fuentes", role: "OdontoCentro · Guadalajara",
    photo: U("1582750433449-648ed127bb54"),
  },
];

export function Testimonials() {
  return (
    <section className="mfh-section mfh-band" id="clientes">
      <div className="mfh-container">
        <div className="mfh-head mfh-center mfh-reveal">
          <span className="mfh-kicker">Clientes</span>
          <h2 className="mfh-h2 mfh-balance">Dentistas que ya cambiaron su forma de trabajar</h2>
          <p className="mfh-lede">Resultados reales de clínicas dentales que operan con MediFlow.</p>
        </div>

        <div className="mfh-tgrid">
          {ITEMS.map((t) => (
            <figure key={t.name} className="mfh-tcard mfh-reveal">
              <span className="mfh-tcard__metric"><b>{t.metric}</b> {t.metricLabel}</span>
              <span className="mfh-stars" aria-label="5 de 5 estrellas">
                {Array.from({ length: 5 }).map((_, i) => <Star key={i} fill="currentColor" />)}
              </span>
              <blockquote className="mfh-tcard__quote">“{t.quote}”</blockquote>
              <figcaption className="mfh-tcard__by">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="mfh-tcard__photo" src={t.photo} alt={`Foto de ${t.name}`} width={46} height={46} loading="lazy" />
                <div>
                  <div className="mfh-tcard__name">{t.name}</div>
                  <div className="mfh-tcard__role">{t.role}</div>
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
