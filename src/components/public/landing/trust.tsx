import { ReceiptText, ShieldCheck, Lock, MapPin } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface TrustItem {
  icon: LucideIcon;
  title: string;
  sub: string;
  flag?: boolean;
}

const ITEMS: TrustItem[] = [
  {
    icon: ReceiptText,
    title: "CFDI 4.0",
    sub: "Timbrado directo ante el SAT",
  },
  {
    icon: ShieldCheck,
    title: "NOM-024",
    sub: "Expediente clínico conforme a norma",
  },
  {
    icon: Lock,
    title: "Datos cifrados",
    sub: "En tránsito y en reposo · servidores en México",
  },
  {
    icon: MapPin,
    title: "Hecho en México",
    sub: "Soporte en español de México",
    flag: true,
  },
];

export function Trust() {
  return (
    <section
      className="lp-section lp-section--tight"
      id="confianza"
      aria-labelledby="trust-h"
    >
      <div className="lp-container">
        <div className="lp-section-head">
          <p className="lp-eyebrow">Confianza</p>
          <h2
            id="trust-h"
            className="lp-h2"
            style={{ fontSize: "clamp(24px, 3vw, 34px)" }}
          >
            Cumplimiento y seguridad, de fábrica.
          </h2>
        </div>

        <div className="lp-trust">
          {ITEMS.map((it) => {
            const Icon = it.icon;
            return (
              <div key={it.title} className="lp-trust__item">
                <div className="lp-trust__icon">
                  <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
                </div>
                <div>
                  <div className="lp-trust__title">
                    {it.title}
                    {it.flag ? (
                      <span className="lp-trust-flag" aria-hidden="true">
                        🇲🇽
                      </span>
                    ) : null}
                  </div>
                  <div className="lp-trust__sub">{it.sub}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <style>{`
        .lp-trust-flag {
          margin-left: 7px;
          font-size: 0.95em;
          line-height: 1;
        }
      `}</style>
    </section>
  );
}
