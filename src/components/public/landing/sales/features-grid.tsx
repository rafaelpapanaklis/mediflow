import {
  CalendarDays, MessageCircle, Smile, Scan, Receipt, Truck,
  FlaskConical, Building2, Smartphone,
} from "lucide-react";

const FEATURES = [
  { icon: CalendarDays, t: "Agenda con Google Calendar", d: "Sincroniza citas con Google Calendar y evita choques de horario. Vista por día, semana y mes." },
  { icon: MessageCircle, t: "WhatsApp automático", d: "Recordatorios y confirmaciones por WhatsApp. Menos faltas sin mover un dedo." },
  { icon: Smile, t: "Expediente + odontograma", d: "Historia clínica completa con odontograma interactivo por pieza (FDI, Universal y Palmer)." },
  { icon: Scan, t: "Radiografías con IA", d: "Sube la placa y la IA marca caries, lesiones y pérdida ósea con su nivel de confianza." },
  { icon: Receipt, t: "Facturación CFDI 4.0", d: "Timbra facturas CFDI 4.0 válidas ante el SAT en segundos, directo desde el cobro." },
  { icon: Truck, t: "Proveedores de insumos", d: "Compra insumos dentales a proveedores del marketplace sin salir del panel." },
  { icon: FlaskConical, t: "Laboratorios dentales", d: "Envía órdenes a tu laboratorio y da seguimiento a cada trabajo en tiempo real." },
  { icon: Building2, t: "Mi Clínica Visual", d: "Editor 2.5D de tu consultorio: sillones, salas y ocupación en vivo." },
  { icon: Smartphone, t: "Portal del paciente", d: "Tus pacientes ven citas, consentimientos y tratamientos desde su teléfono." },
];

export function FeaturesGrid() {
  return (
    <section className="mfh-section mfh-band--violet" id="funciones">
      <div className="mfh-container">
        <div className="mfh-head mfh-center mfh-reveal">
          <span className="mfh-kicker">Una sola plataforma</span>
          <h2 className="mfh-h2 mfh-balance">Todo tu consultorio, en un solo lugar</h2>
          <p className="mfh-lede">
            Deja de saltar entre la agenda, el Excel, el facturador y el chat. DaleControl reúne
            todo lo que tu clínica dental necesita para operar cada día.
          </p>
        </div>

        <div className="mfh-fgrid">
          {FEATURES.map((f) => {
            const Icon = f.icon;
            return (
              <article key={f.t} className="mfh-feature mfh-reveal">
                <span className="mfh-feature__glow" />
                <span className="mfh-feature__icon"><Icon /></span>
                <h3 className="mfh-feature__t">{f.t}</h3>
                <p className="mfh-feature__d">{f.d}</p>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
