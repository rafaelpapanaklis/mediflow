"use client";

import { useState } from "react";
import { Check, X, Minus, ChevronDown } from "lucide-react";

type Cell =
  | { kind: "yes" }
  | { kind: "no" }
  | { kind: "partial" }
  | { kind: "text"; value: string; highlight?: boolean };

interface CompareRow {
  feature: string;
  mediflow: Cell;
  others: Cell;
  manual: Cell;
}

const yes: Cell = { kind: "yes" };
const no: Cell = { kind: "no" };
const partial: Cell = { kind: "partial" };

// Features REALES del panel (verificadas en src/components/dashboard/sidebar.tsx
// y las rutas de src/app/dashboard/**). "Otros software" = sistemas dentales/
// médicos genéricos; "Excel + facturador" = hojas de cálculo + un timbrador aparte.
const KEY_ROWS: CompareRow[] = [
  { feature: "Agenda con Google Calendar", mediflow: yes, others: partial, manual: no },
  { feature: "Recordatorios por WhatsApp", mediflow: yes, others: no, manual: no },
  { feature: "Expediente clínico + odontograma", mediflow: yes, others: partial, manual: no },
  { feature: "Radiografías con análisis por IA", mediflow: yes, others: no, manual: no },
  { feature: "Facturación CFDI 4.0 nativa", mediflow: yes, others: no, manual: partial },
  { feature: "Cumplimiento NOM-024", mediflow: yes, others: partial, manual: no },
  { feature: "Portal del paciente", mediflow: yes, others: partial, manual: no },
  { feature: "Proveedores y laboratorios integrados", mediflow: yes, others: no, manual: no },
];

const EXTRA_ROWS: CompareRow[] = [
  { feature: "Mi Clínica Visual (editor 2.5D del consultorio)", mediflow: yes, others: no, manual: no },
  { feature: "Especialidades: orto, endo, perio, implantes, odontopediatría", mediflow: yes, others: partial, manual: no },
  { feature: "Inventario de insumos", mediflow: yes, others: partial, manual: partial },
  { feature: "Recetas digitales con firma", mediflow: yes, others: partial, manual: no },
  { feature: "Consentimientos digitales", mediflow: yes, others: partial, manual: no },
  { feature: "Reportes y analytics", mediflow: yes, others: partial, manual: partial },
];

const PRICE_ROW: CompareRow = {
  feature: "Precio",
  mediflow: { kind: "text", value: "Desde $499 MXN/mes", highlight: true },
  others: { kind: "text", value: "Licencia costosa" },
  manual: { kind: "text", value: "Varias suscripciones" },
};

function CompareCell({ cell }: { cell: Cell }) {
  switch (cell.kind) {
    case "yes":
      return (
        <span role="img" aria-label="Sí" className="lp-yes" style={{ display: "inline-flex" }}>
          <Check size={18} strokeWidth={2} aria-hidden="true" />
        </span>
      );
    case "no":
      return (
        <span role="img" aria-label="No" className="lp-no" style={{ display: "inline-flex" }}>
          <X size={18} strokeWidth={2} aria-hidden="true" />
        </span>
      );
    case "partial":
      return (
        <span role="img" aria-label="Parcial" style={{ display: "inline-flex", color: "#b45309" }}>
          <Minus size={18} strokeWidth={2} aria-hidden="true" />
        </span>
      );
    case "text":
      return (
        <span
          className="lp-cmp-price"
          style={cell.highlight ? { color: "var(--ld-brand-strong)", fontWeight: 600 } : undefined}
        >
          {cell.value}
        </span>
      );
  }
}

function Row({ row }: { row: CompareRow }) {
  return (
    <tr>
      <th scope="row" className="lp-compare__feature">{row.feature}</th>
      <td className="lp-compare__col-mediflow"><CompareCell cell={row.mediflow} /></td>
      <td><CompareCell cell={row.others} /></td>
      <td><CompareCell cell={row.manual} /></td>
    </tr>
  );
}

export function Comparison() {
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="lp-section lp-section--tint" id="comparison" aria-labelledby="cmp-h">
      <div className="lp-container">
        <div className="lp-section-head">
          <p className="lp-eyebrow">Comparativa</p>
          <h2 id="cmp-h" className="lp-h2">MediFlow vs. lo que usas hoy.</h2>
          <p className="lp-lead">
            Un solo sistema en vez de un software caro, WhatsApp manual, Excel y un
            facturador aparte.
          </p>
        </div>

        <div className="lp-cmp-scroll">
          <table className="lp-compare">
            <thead>
              <tr>
                <th scope="col">Característica</th>
                <th scope="col" className="lp-compare__col-mediflow">MediFlow</th>
                <th scope="col">Otros software</th>
                <th scope="col">Excel + facturador</th>
              </tr>
            </thead>
            <tbody id="lp-cmp-body">
              {KEY_ROWS.map((row) => <Row key={row.feature} row={row} />)}
              {expanded && EXTRA_ROWS.map((row) => <Row key={row.feature} row={row} />)}
              <Row row={PRICE_ROW} />
            </tbody>
          </table>
        </div>

        <div className="lp-cmp-more">
          <button
            type="button"
            className="lp-btn lp-btn--secondary"
            aria-expanded={expanded}
            aria-controls="lp-cmp-body"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "Ver menos" : "Ver comparación completa"}
            <ChevronDown
              size={16}
              strokeWidth={2}
              aria-hidden="true"
              style={{ transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}
            />
          </button>
        </div>
      </div>

      <style jsx>{`
        .lp-cmp-scroll {
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          margin-top: 8px;
        }
        .lp-cmp-scroll :global(.lp-compare) { min-width: 680px; }
        .lp-cmp-scroll :global(.lp-cmp-price) { font-size: 14px; color: var(--ld-fg-muted); white-space: nowrap; }
        .lp-cmp-more { display: flex; justify-content: center; margin-top: 24px; }
      `}</style>
    </section>
  );
}
