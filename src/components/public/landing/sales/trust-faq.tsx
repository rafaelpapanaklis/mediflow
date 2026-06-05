"use client";

import { useState } from "react";
import { Receipt, ShieldCheck, Lock, Flag, ChevronDown } from "lucide-react";

const TRUST = [
  { icon: Receipt, t: "CFDI 4.0", d: "Timbrado válido ante el SAT, incluido en todos los planes." },
  { icon: ShieldCheck, t: "NOM-024", d: "Expediente clínico conforme a la norma oficial mexicana." },
  { icon: Lock, t: "Datos cifrados", d: "La información de tus pacientes va cifrada y respaldada." },
  { icon: Flag, t: "Hecho en México 🇲🇽", d: "Soporte y facturación pensados para clínicas mexicanas." },
];

const FAQ = [
  { q: "¿MediFlow sirve para mi clínica dental?", a: "Sí. Hoy MediFlow está enfocado 100% en clínicas y consultorios dentales: agenda, expediente con odontograma, radiografías, laboratorios y facturación, todo pensado para el día a día odontológico." },
  { q: "¿Las facturas son CFDI 4.0 válidas ante el SAT?", a: "Sí. Generas y timbras CFDI 4.0 directamente desde el cobro, con RFC, uso de CFDI y método de pago. Cumple con la normatividad fiscal vigente en México." },
  { q: "¿Pueden migrar mis datos de Excel o de otro sistema?", a: "Sí. Te acompañamos en la migración de pacientes, citas e historial sin costo adicional, para que arranques con tu información ya cargada." },
  { q: "¿Necesito instalar algo?", a: "No. MediFlow funciona en el navegador desde cualquier computadora o tablet. Tus datos se sincronizan en la nube de forma segura." },
  { q: "¿Hay permanencia o contrato forzoso?", a: "No. Trabajamos sin permanencia: puedes cambiar de plan o cancelar cuando quieras desde tu panel." },
  { q: "¿La IA de radiografías reemplaza el diagnóstico del dentista?", a: "No. La IA es una herramienta de apoyo que resalta posibles hallazgos con su nivel de confianza. El diagnóstico y el criterio clínico siempre son del profesional." },
];

export function TrustFaq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section className="mfh-section mfh-band" aria-label="Confianza y preguntas frecuentes">
      <div className="mfh-container">
        <div className="mfh-head mfh-center mfh-reveal">
          <span className="mfh-kicker">Confianza</span>
          <h2 className="mfh-h2 mfh-balance">Cumplimiento y seguridad, de fábrica</h2>
        </div>

        <div className="mfh-trust" style={{ marginTop: 40 }}>
          {TRUST.map((it) => {
            const Icon = it.icon;
            return (
              <div key={it.t} className="mfh-trust__item mfh-reveal">
                <span className="mfh-trust__icon"><Icon /></span>
                <div className="mfh-trust__t">{it.t}</div>
                <div className="mfh-trust__d">{it.d}</div>
              </div>
            );
          })}
        </div>

        <div className="mfh-faq">
          {FAQ.map((item, i) => {
            const isOpen = open === i;
            return (
              <div key={item.q} className="mfh-faq__item" data-open={isOpen}>
                <button
                  type="button"
                  className="mfh-faq__q"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : i)}
                >
                  <span>{item.q}</span>
                  <ChevronDown />
                </button>
                <div className="mfh-faq__a" role="region">
                  <p>{item.a}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
