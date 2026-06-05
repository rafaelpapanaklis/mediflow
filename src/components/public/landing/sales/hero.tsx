import { MapPin, ShieldCheck, Headphones, ArrowRight, Star } from "lucide-react";
import { ProductWindow } from "./product-window";
import { Tooth3D } from "./tooth-3d";

export function SalesHero() {
  return (
    <section className="mfh-hero" id="producto">
      <div className="mfh-hero__bg" aria-hidden="true">
        <div className="mfh-hero__grid" />
        <div className="mfh-hero__blob mfh-hero__blob--1" />
        <div className="mfh-hero__blob mfh-hero__blob--2" />
      </div>

      <div className="mfh-container mfh-hero__inner">
        <div className="mfh-hero__copy">
          <span className="mfh-eyebrow">
            <MapPin /> Hecho en México · CFDI 4.0 nativo
          </span>

          <h1 className="mfh-h1 mfh-balance">
            Toda tu clínica dental en <span className="mfh-grad">una sola plataforma</span>
          </h1>

          <p className="mfh-lede" style={{ maxWidth: 520 }}>
            Agenda, expedientes con odontograma, radiografías con IA y facturación CFDI 4.0
            en un mismo lugar. Menos software suelto, menos faltas y más tiempo para tus pacientes.
          </p>

          <div className="mfh-hero__cta">
            <a href="#precios" className="mfh-btn mfh-btn--primary mfh-btn--lg">
              Ver Precios <ArrowRight />
            </a>
            <a href="#precios" className="mfh-btn mfh-btn--ghost mfh-btn--lg">
              Ver Planes
            </a>
          </div>

          <div className="mfh-hero__trust">
            <span className="mfh-pill"><Star style={{ color: "#f59e0b" }} /> 800+ clínicas activas</span>
            <span className="mfh-pill"><ShieldCheck /> CFDI 4.0 · NOM-024</span>
            <span className="mfh-pill"><Headphones /> Soporte en español</span>
          </div>
        </div>

        <div className="mfh-hero__stage">
          <Tooth3D />
          <ProductWindow />
        </div>
      </div>
    </section>
  );
}
