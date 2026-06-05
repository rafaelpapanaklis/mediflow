import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";

export function FinalCta() {
  return (
    <section className="mfh-section mfh-band">
      <div className="mfh-container">
        <div className="mfh-cta mfh-reveal">
          <div className="mfh-cta__glow" aria-hidden="true" />
          <div className="mfh-cta__grid" aria-hidden="true" />
          <div className="mfh-cta__inner">
            <h2 className="mfh-cta__h mfh-balance">Lleva tu clínica dental a una sola plataforma</h2>
            <p className="mfh-cta__p">
              Agenda, expedientes, radiografías con IA y facturación CFDI 4.0. Empieza hoy y deja
              atrás los sistemas sueltos.
            </p>
            <div className="mfh-cta__row">
              <a href="#precios" className="mfh-btn mfh-btn--lg mfh-btn--white">Ver Precios <ArrowRight /></a>
              <Link href="/signup" className="mfh-btn mfh-btn--lg mfh-btn--glass">Crear cuenta</Link>
            </div>
            <div className="mfh-cta__note">
              <span><Check /> Sin permanencia</span>
              <span><Check /> CFDI 4.0 · NOM-024</span>
              <span><Check /> Soporte en español</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
