"use client";

import { useMemo, useState } from "react";
import { BadgeDollarSign, Info, Lock } from "lucide-react";
import { mxn, mxn2, num1, parsePositive } from "@/lib/herramientas/format";

// ─────────────────────────────────────────────────────────────────────────────
// Calculadora de precio por tratamiento — 100% cliente, sin fetch ni storage.
//
// El margen se calcula SOBRE EL PRECIO DE VENTA (precio = costo ÷ (1 − margen)),
// que es como se usa la palabra "margen" en un consultorio. No es lo mismo que
// un markup sobre el costo: con 40% de margen el precio no es costo × 1.4, y
// confundirlos deja el precio corto. Por eso la fórmula se declara en la
// interfaz en lugar de esconderla.
// ─────────────────────────────────────────────────────────────────────────────

/** Escenarios de la tabla comparativa. */
const MARGIN_SCENARIOS = [30, 40, 50];

function priceFor(cost: number, marginPct: number): number {
  const m = Math.min(95, Math.max(0, marginPct)) / 100;
  return m >= 1 ? 0 : cost / (1 - m);
}

export function TreatmentPriceTool() {
  const [supplies, setSupplies] = useState("250");
  const [minutes, setMinutes] = useState("60");
  const [hourCost, setHourCost] = useState("600");
  const [lab, setLab] = useState("0");
  const [margin, setMargin] = useState(40);

  const r = useMemo(() => {
    const s = parsePositive(supplies);
    const mins = parsePositive(minutes);
    const hour = parsePositive(hourCost);
    const l = parsePositive(lab);

    const chair = (mins / 60) * hour;
    const cost = s + chair + l;
    const price = priceFor(cost, margin);
    const profit = price - cost;

    return {
      supplies: s,
      chair,
      lab: l,
      cost,
      price,
      profit,
      // Reparto del costo para las barras: sólo tiene sentido con costo > 0.
      pct: (part: number) => (cost > 0 ? (part / cost) * 100 : 0),
      hasCost: cost > 0,
    };
  }, [supplies, minutes, hourCost, lab, margin]);

  return (
    <div className="tool-panel">
      <div className="tool-panel__head">
        <BadgeDollarSign aria-hidden="true" style={{ width: 18, height: 18, color: "var(--b)" }} />
        <h2 className="tool-panel__title">Calcula tu precio sugerido</h2>
        <span className="tool-panel__badge">
          <Lock aria-hidden="true" /> En tu navegador
        </span>
      </div>

      <div className="tool-panel__body">
        <div className="tool-fields">
          <div className="tool-field">
            <label className="tool-label" htmlFor="pt-insumos">
              Costo de insumos del tratamiento
            </label>
            <div className="tool-inputwrap">
              <span className="tool-inputwrap__prefix" aria-hidden="true">
                $
              </span>
              <input
                id="pt-insumos"
                className="tool-input tool-input--money"
                type="number"
                inputMode="numeric"
                min={0}
                step={25}
                value={supplies}
                onChange={(e) => setSupplies(e.target.value)}
              />
            </div>
            <span className="tool-hint">
              Material, anestesia, guantes, campos, esterilización: lo que se gasta en esa cita.
            </span>
          </div>

          <div className="tool-field">
            <label className="tool-label" htmlFor="pt-minutos">
              Minutos de sillón
            </label>
            <div className="tool-inputwrap">
              <input
                id="pt-minutos"
                className="tool-input tool-input--unit"
                type="number"
                inputMode="numeric"
                min={0}
                step={5}
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
              />
              <span className="tool-inputwrap__suffix" aria-hidden="true">
                minutos
              </span>
            </div>
            <span className="tool-hint">
              Tiempo real ocupado, incluyendo preparar y limpiar el consultorio.
            </span>
          </div>

          <div className="tool-field">
            <label className="tool-label" htmlFor="pt-hora">
              Costo de tu hora de sillón
            </label>
            <div className="tool-inputwrap">
              <span className="tool-inputwrap__prefix" aria-hidden="true">
                $
              </span>
              <input
                id="pt-hora"
                className="tool-input tool-input--money"
                type="number"
                inputMode="numeric"
                min={0}
                step={50}
                value={hourCost}
                onChange={(e) => setHourCost(e.target.value)}
              />
            </div>
            <span className="tool-hint">
              Gastos fijos mensuales ÷ horas productivas al mes. Si pagas 45,000 al mes y trabajas
              75 horas de sillón, son 600 por hora.
            </span>
          </div>

          <div className="tool-field">
            <label className="tool-label" htmlFor="pt-lab">
              Costo de laboratorio, si aplica
            </label>
            <div className="tool-inputwrap">
              <span className="tool-inputwrap__prefix" aria-hidden="true">
                $
              </span>
              <input
                id="pt-lab"
                className="tool-input tool-input--money"
                type="number"
                inputMode="numeric"
                min={0}
                step={100}
                value={lab}
                onChange={(e) => setLab(e.target.value)}
              />
            </div>
            <span className="tool-hint">Coronas, guardas, prótesis, alineadores. Cero si no aplica.</span>
          </div>

          <div className="tool-field tool-field--wide">
            <label className="tool-label" htmlFor="pt-margen">
              Margen deseado
            </label>
            <div className="tool-slider">
              <input
                id="pt-margen"
                className="tool-range"
                type="range"
                min={20}
                max={70}
                step={1}
                value={margin}
                onChange={(e) => setMargin(Number(e.target.value))}
                aria-valuetext={`${margin} por ciento`}
              />
              <output className="tool-slider__value" htmlFor="pt-margen">
                {margin}%
              </output>
            </div>
            <span className="tool-hint">
              Sobre el precio de venta: precio = costo ÷ (1 − margen). Con 40% de margen, de cada
              100 pesos que cobras 40 son ganancia.
            </span>
          </div>
        </div>

        <div className="tool-out">
          <div className="tool-kpis">
            <div className="tool-kpi tool-kpi--hero">
              <p className="tool-kpi__label">Precio sugerido</p>
              <p className="tool-kpi__value">{mxn(r.price)}</p>
              <p className="tool-kpi__foot">Con {margin}% de margen sobre el precio.</p>
            </div>
            <div className="tool-kpi">
              <p className="tool-kpi__label">Costo total del tratamiento</p>
              <p className="tool-kpi__value">{mxn2(r.cost)}</p>
              <p className="tool-kpi__foot">
                Insumos {mxn(r.supplies)} + sillón {mxn(r.chair)} + laboratorio {mxn(r.lab)}.
              </p>
            </div>
            <div className="tool-kpi tool-kpi--ok">
              <p className="tool-kpi__label">Ganancia por tratamiento</p>
              <p className="tool-kpi__value">{mxn2(r.profit)}</p>
              <p className="tool-kpi__foot">Lo que queda después de cubrir el costo.</p>
            </div>
          </div>

          {r.hasCost ? (
            <div className="tool-bars">
              <p className="tool-bars__title">De qué está hecho tu costo</p>
              <div className="tool-bar">
                <div className="tool-bar__head">
                  <span>Insumos</span>
                  <span className="tool-bar__amount">
                    {mxn(r.supplies)} · {num1(r.pct(r.supplies))}%
                  </span>
                </div>
                <div className="tool-bar__track" role="img" aria-label={`Insumos: ${mxn(r.supplies)}`}>
                  <div className="tool-bar__fill" style={{ width: `${r.pct(r.supplies)}%` }} />
                </div>
              </div>
              <div className="tool-bar">
                <div className="tool-bar__head">
                  <span>Tiempo de sillón</span>
                  <span className="tool-bar__amount">
                    {mxn(r.chair)} · {num1(r.pct(r.chair))}%
                  </span>
                </div>
                <div className="tool-bar__track" role="img" aria-label={`Tiempo de sillón: ${mxn(r.chair)}`}>
                  <div className="tool-bar__fill" style={{ width: `${r.pct(r.chair)}%` }} />
                </div>
              </div>
              <div className="tool-bar">
                <div className="tool-bar__head">
                  <span>Laboratorio</span>
                  <span className="tool-bar__amount">
                    {mxn(r.lab)} · {num1(r.pct(r.lab))}%
                  </span>
                </div>
                <div className="tool-bar__track" role="img" aria-label={`Laboratorio: ${mxn(r.lab)}`}>
                  <div
                    className="tool-bar__fill tool-bar__fill--muted"
                    style={{ width: `${r.pct(r.lab)}%` }}
                  />
                </div>
              </div>
            </div>
          ) : null}

          <div className="tool-tablewrap">
            <table className="tool-table">
              <caption className="tool-hint" style={{ padding: "10px 14px", textAlign: "left" }}>
                El mismo tratamiento con tres márgenes distintos.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Margen</th>
                  <th scope="col">Precio</th>
                  <th scope="col">Ganancia</th>
                </tr>
              </thead>
              <tbody>
                {MARGIN_SCENARIOS.map((m) => {
                  const p = priceFor(r.cost, m);
                  return (
                    <tr key={m} data-active={m === margin}>
                      <td>{m}%</td>
                      <td>{mxn(p)}</td>
                      <td>{mxn2(p - r.cost)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="tool-alert tool-alert--info">
            <Info aria-hidden="true" />
            <span>
              Referencia orientativa — el precio final depende de tu mercado y criterio profesional.
              Úsalo como piso informado, no como tarifa automática: la zona, tu experiencia, el
              material que usas y lo que el paciente recibe alrededor del tratamiento también son
              parte del precio.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
