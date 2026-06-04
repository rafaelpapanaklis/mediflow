import {
  Calendar,
  MessageCircle,
  FileText,
  ReceiptText,
  ScanLine,
  Truck,
  FlaskConical,
  Smartphone,
  BarChart3,
  type LucideIcon,
} from "lucide-react";

type Feature = {
  icon: LucideIcon;
  title: string;
  desc: string;
};

const FEATURES: Feature[] = [
  {
    icon: Calendar,
    title: "Agenda con Google Calendar",
    desc: "Sincroniza tu agenda con Google Calendar y evita dobles reservas. Disponibilidad en tiempo real.",
  },
  {
    icon: MessageCircle,
    title: "WhatsApp automático",
    desc: "Confirmaciones y recordatorios automáticos por WhatsApp. Menos faltas, sin llamar uno por uno.",
  },
  {
    icon: FileText,
    title: "Expediente + odontograma",
    desc: "Expediente clínico digital con odontograma interactivo e historial completo por paciente.",
  },
  {
    icon: ReceiptText,
    title: "Facturación CFDI 4.0",
    desc: "Timbra CFDI 4.0 ante el SAT al momento de cobrar. Sin facturador aparte ni subir archivos.",
  },
  {
    icon: ScanLine,
    title: "Radiografías con IA",
    desc: "Sube la radiografía y la IA marca hallazgos sugeridos en segundos. Una segunda opinión instantánea.",
  },
  {
    icon: Truck,
    title: "Proveedores",
    desc: "Compra insumos a proveedores desde el panel y mantén tu inventario bajo control.",
  },
  {
    icon: FlaskConical,
    title: "Laboratorios",
    desc: "Envía órdenes a laboratorios dentales y da seguimiento a cada trabajo sin perder el hilo.",
  },
  {
    icon: Smartphone,
    title: "Portal del paciente",
    desc: "Tus pacientes agendan, pagan y consultan su historial desde el celular.",
  },
  {
    icon: BarChart3,
    title: "Reportes y analytics",
    desc: "Ingresos, ocupación y retención en tiempo real. Adiós a las hojas de Excel.",
  },
];

export function Features() {
  return (
    <section className="lp-section" id="features" aria-labelledby="features-h">
      <div className="lp-container">
        <div className="lp-section-head">
          <p className="lp-eyebrow">Todo en una plataforma</p>
          <h2 id="features-h" className="lp-h2">
            Nueve módulos. Cero herramientas sueltas.
          </h2>
          <p className="lp-lead">
            Reemplaza Dentrix, WhatsApp, Excel y tu facturador con un solo
            sistema conectado.
          </p>
        </div>
        <div className="lp-grid lp-grid-3">
          {FEATURES.map(({ icon: Icon, title, desc }) => (
            <article key={title} className="lp-card lp-card--hover">
              <div className="lp-card__icon">
                <Icon size={22} strokeWidth={1.75} aria-hidden="true" />
              </div>
              <h3 className="lp-card__title">{title}</h3>
              <p className="lp-card__desc">{desc}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
