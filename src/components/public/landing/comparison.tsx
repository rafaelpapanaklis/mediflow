import { Check, X, Minus } from "lucide-react";

type Cell =
  | { kind: "yes" }
  | { kind: "no" }
  | { kind: "partial" }
  | { kind: "text"; value: string; highlight?: boolean };

interface CompareRow {
  feature: string;
  mediflow: Cell;
  dentrix: Cell;
  manual: Cell;
}

const ROWS: CompareRow[] = [
  {
    feature: "CFDI 4.0 timbrado nativo",
    mediflow: { kind: "yes" },
    dentrix: { kind: "no" },
    manual: { kind: "no" },
  },
  {
    feature: "Recordatorios por WhatsApp",
    mediflow: { kind: "yes" },
    dentrix: { kind: "no" },
    manual: { kind: "no" },
  },
  {
    feature: "Análisis de radiografías con IA",
    mediflow: { kind: "yes" },
    dentrix: { kind: "no" },
    manual: { kind: "no" },
  },
  {
    feature: "Proveedores y laboratorios integrados",
    mediflow: { kind: "yes" },
    dentrix: { kind: "no" },
    manual: { kind: "no" },
  },
  {
    feature: "Expediente + agenda + cobro en un lugar",
    mediflow: { kind: "yes" },
    dentrix: { kind: "partial" },
    manual: { kind: "no" },
  },
  {
    feature: "Soporte en español de México",
    mediflow: { kind: "yes" },
    dentrix: { kind: "partial" },
    manual: { kind: "no" },
  },
  {
    feature: "Precio",
    mediflow: { kind: "text", value: "Desde $49 USD/mes", highlight: true },
    dentrix: { kind: "text", value: "Licencia costosa" },
    manual: { kind: "text", value: "Varias suscripciones" },
  },
];

function CompareCell({ cell }: { cell: Cell }) {
  switch (cell.kind) {
    case "yes":
      return <Check className="lp-yes" size={18} strokeWidth={1.75} aria-label="Sí" />;
    case "no":
      return <X className="lp-no" size={18} strokeWidth={1.75} aria-label="No" />;
    case "partial":
      // Ámbar (AA sobre blanco): el color refuerza la semántica "Parcial" y la
      // distingue del gris de "No".
      return <Minus size={18} strokeWidth={1.75} aria-label="Parcial" style={{ color: "#b45309" }} />;
    case "text":
      return (
        <span
          className="lp-cmp-price"
          style={
            cell.highlight
              ? { color: "var(--ld-brand-strong)", fontWeight: 600 }
              : undefined
          }
        >
          {cell.value}
        </span>
      );
  }
}

export function Comparison() {
  return (
    <section className="lp-section lp-section--tint" id="comparison" aria-labelledby="cmp-h">
      <div className="lp-container">
        <div className="lp-section-head">
          <p className="lp-eyebrow">Comparativa</p>
          <h2 id="cmp-h" className="lp-h2">
            MediFlow vs. lo que usas hoy.
          </h2>
          <p className="lp-lead">
            Un solo sistema en vez de un software caro + WhatsApp manual + Excel + un
            facturador aparte.
          </p>
        </div>

        <div className="lp-cmp-scroll">
          <table className="lp-compare">
            <thead>
              <tr>
                <th scope="col">Característica</th>
                <th scope="col" className="lp-compare__col-mediflow">
                  MediFlow
                </th>
                <th scope="col">Dentrix</th>
                <th scope="col">Excel + facturador</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.feature}>
                  <th scope="row" className="lp-compare__feature">
                    {row.feature}
                  </th>
                  <td className="lp-compare__col-mediflow">
                    <CompareCell cell={row.mediflow} />
                  </td>
                  <td>
                    <CompareCell cell={row.dentrix} />
                  </td>
                  <td>
                    <CompareCell cell={row.manual} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <style>{`
        .lp-cmp-scroll {
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          margin-top: 8px;
        }
        .lp-cmp-scroll .lp-compare {
          min-width: 640px;
        }
        .lp-cmp-price {
          font-size: 14px;
          color: var(--ld-fg-muted);
          white-space: nowrap;
        }
      `}</style>
    </section>
  );
}
