import { Stethoscope, Sparkles, HeartPulse, Activity, ShieldCheck } from "lucide-react";

const LOGOS = [
  { name: "Clínica Sonrisa", icon: Sparkles },
  { name: "DentalPro", icon: Stethoscope },
  { name: "OdontoCentro", icon: HeartPulse },
  { name: "Sonrisas MX", icon: Activity },
  { name: "Dental Care", icon: ShieldCheck },
];

const METRICS = [
  { v: "−73%", l: "menos faltas a citas", c: "#059669" },
  { v: "+4 h", l: "ahorradas por semana", c: "#7c3aed" },
  { v: "+28%", l: "aceptación de tratamientos", c: "#2563eb" },
  { v: "100%", l: "facturas CFDI 4.0", c: "#d97706" },
];

export function SocialProof() {
  return (
    <section className="mfh-section mfh-section--tight mfh-band--soft" aria-label="Confianza y resultados">
      <div className="mfh-container">
        <p className="mfh-center" style={{ fontSize: 13, fontWeight: 600, color: "#94a3b8", margin: "0 0 26px", letterSpacing: ".02em" }}>
          Clínicas dentales de todo México ya trabajan con DaleControl
        </p>
        <div className="mfh-logos">
          {LOGOS.map((l) => {
            const Icon = l.icon;
            return (
              <span key={l.name} className="mfh-logos__item"><Icon /> {l.name}</span>
            );
          })}
        </div>

        <hr className="mfh-rule" style={{ margin: "40px 0" }} />

        <div className="mfh-metrics">
          {METRICS.map((m) => (
            <div key={m.l} className="mfh-metric">
              <div className="mfh-metric__v" style={{ color: m.c }}>{m.v}</div>
              <div className="mfh-metric__l">{m.l}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
