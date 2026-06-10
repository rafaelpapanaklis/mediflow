"use client";

import { useState } from "react";
import { Check, X, ChevronDown, Stethoscope } from "lucide-react";

type Val = true | false | "part";
type Feat = { f: string; mf: Val; otros: Val; excel: Val };

const BASE: Feat[] = [
  { f: "Agenda con recordatorios por WhatsApp", mf: true, otros: "part", excel: false },
  { f: "Odontograma interactivo por pieza", mf: true, otros: "part", excel: false },
  { f: "Radiografías con análisis por IA", mf: true, otros: false, excel: false },
  { f: "Facturación CFDI 4.0 nativa", mf: true, otros: "part", excel: "part" },
  { f: "Expediente clínico (NOM-024)", mf: true, otros: true, excel: false },
];

const EXTRA: Feat[] = [
  { f: "Proveedores e insumos integrados", mf: true, otros: false, excel: false },
  { f: "Órdenes a laboratorios dentales", mf: true, otros: false, excel: false },
  { f: "Mi Clínica Visual (editor 2.5D)", mf: true, otros: false, excel: false },
  { f: "Portal del paciente", mf: true, otros: "part", excel: false },
  { f: "Soporte en español de México", mf: true, otros: "part", excel: "part" },
  { f: "Precios en pesos, sin permanencia", mf: true, otros: "part", excel: true },
];

function Cell({ v, mf = false }: { v: Val; mf?: boolean }) {
  return (
    <div className={`mfh-cmp__cell${mf ? " mfh-cmp__cell--mf" : ""}`}>
      {v === true && <span className="mfh-cmp__yes"><Check /></span>}
      {v === false && <span className="mfh-cmp__no"><X /></span>}
      {v === "part" && <span className="mfh-cmp__part">Limitado</span>}
    </div>
  );
}

function Row({ row }: { row: Feat }) {
  return (
    <div className="mfh-cmp__row">
      <div className="mfh-cmp__cell mfh-cmp__cell--feat">{row.f}</div>
      <Cell v={row.mf} mf />
      <Cell v={row.otros} />
      <Cell v={row.excel} />
    </div>
  );
}

export function Comparison() {
  const [open, setOpen] = useState(false);

  return (
    <section className="mfh-section mfh-band--soft" aria-label="Comparativa">
      <div className="mfh-container">
        <div className="mfh-head mfh-center mfh-reveal">
          <span className="mfh-kicker">Comparativa</span>
          <h2 className="mfh-h2 mfh-balance">DaleControl vs. lo que usabas antes</h2>
          <p className="mfh-lede">Mira por qué las clínicas dentales dejan los sistemas sueltos y el Excel.</p>
        </div>

        <div className="mfh-cmp mfh-reveal">
          <div className="mfh-cmp__row mfh-cmp__row--head">
            <div className="mfh-cmp__cell mfh-cmp__cell--feat mfh-cmp__h">Función</div>
            <div className="mfh-cmp__cell mfh-cmp__cell--mf">
              <span className="mfh-cmp__h mfh-cmp__h--mf"><Stethoscope /> DaleControl</span>
            </div>
            <div className="mfh-cmp__cell"><span className="mfh-cmp__h">Otros software</span></div>
            <div className="mfh-cmp__cell"><span className="mfh-cmp__h">Excel + facturador</span></div>
          </div>

          {BASE.map((r) => <Row key={r.f} row={r} />)}
          {open && EXTRA.map((r) => <Row key={r.f} row={r} />)}
        </div>

        <div className="mfh-cmp__toggle">
          <button
            type="button"
            className="mfh-btn mfh-btn--ghost"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Ver menos" : "Ver comparación completa"}
            <ChevronDown style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
          </button>
        </div>
      </div>
    </section>
  );
}
