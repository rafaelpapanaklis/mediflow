"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Info, Lock, Scale } from "lucide-react";
import { mxn, mxn2, num, num1, parsePositive } from "@/lib/herramientas/format";

// ─────────────────────────────────────────────────────────────────────────────
// Calculadora de punto de equilibrio — 100% cliente, sin fetch ni storage.
//
// Los equivalentes por semana y por día hábil necesitan un supuesto de
// calendario. Se dejan como constantes visibles (4.33 semanas y 22 días hábiles
// al mes) y se declaran en la interfaz: un número redondo sin supuesto explícito
// es justo lo que hace desconfiar de una calculadora.
// ─────────────────────────────────────────────────────────────────────────────

const WEEKS_PER_MONTH = 4.33;
const WORKDAYS_PER_MONTH = 22;

export function BreakEvenTool() {
  const [fixed, setFixed] = useState("45000");
  const [price, setPrice] = useState("1200");
  const [variable, setVariable] = useState("350");

  const r = useMemo(() => {
    const f = parsePositive(fixed);
    const p = parsePositive(price);
    const v = parsePositive(variable);

    const margin = p - v;
    const marginPct = p > 0 ? (margin / p) * 100 : 0;
    // Sin margen positivo no existe punto de equilibrio: cada tratamiento suma
    // pérdida. Se avisa en lugar de dividir entre cero o entre un negativo.
    const valid = p > 0 && margin > 0;

    const perMonth = valid ? Math.ceil(f / margin) : 0;
    const perWeek = valid ? Math.ceil(perMonth / WEEKS_PER_MONTH) : 0;
    const perDay = valid ? Math.ceil(perMonth / WORKDAYS_PER_MONTH) : 0;
    const revenue = perMonth * p;

    return { f, p, v, margin, marginPct, valid, perMonth, perWeek, perDay, revenue };
  }, [fixed, price, variable]);

  return (
    <div className="tool-panel">
      <div className="tool-panel__head">
        <Scale aria-hidden="true" style={{ width: 18, height: 18, color: "var(--b)" }} />
        <h2 className="tool-panel__title">Calcula tu punto de equilibrio</h2>
        <span className="tool-panel__badge">
          <Lock aria-hidden="true" /> En tu navegador
        </span>
      </div>

      <div className="tool-panel__body">
        <div className="tool-fields">
          <div className="tool-field">
            <label className="tool-label" htmlFor="pe-fijos">
              Gastos fijos mensuales
            </label>
            <div className="tool-inputwrap">
              <span className="tool-inputwrap__prefix" aria-hidden="true">
                $
              </span>
              <input
                id="pe-fijos"
                className="tool-input tool-input--money"
                type="number"
                inputMode="numeric"
                min={0}
                step={1000}
                value={fixed}
                onChange={(e) => setFixed(e.target.value)}
              />
            </div>
            <span className="tool-hint">
              Renta, sueldos base, luz, internet, software, contador, créditos. Lo que pagas aunque
              no entre un solo paciente.
            </span>
          </div>

          <div className="tool-field">
            <label className="tool-label" htmlFor="pe-precio">
              Precio promedio por tratamiento
            </label>
            <div className="tool-inputwrap">
              <span className="tool-inputwrap__prefix" aria-hidden="true">
                $
              </span>
              <input
                id="pe-precio"
                className="tool-input tool-input--money"
                type="number"
                inputMode="numeric"
                min={0}
                step={50}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
            <span className="tool-hint">Lo que cobras en promedio por tratamiento terminado.</span>
          </div>

          <div className="tool-field">
            <label className="tool-label" htmlFor="pe-variable">
              Costo variable promedio por tratamiento
            </label>
            <div className="tool-inputwrap">
              <span className="tool-inputwrap__prefix" aria-hidden="true">
                $
              </span>
              <input
                id="pe-variable"
                className="tool-input tool-input--money"
                type="number"
                inputMode="numeric"
                min={0}
                step={25}
                value={variable}
                onChange={(e) => setVariable(e.target.value)}
              />
            </div>
            <span className="tool-hint">
              Insumos, laboratorio, esterilización, comisión bancaria y honorarios por porcentaje.
              Sólo lo que existe porque hiciste ese tratamiento.
            </span>
          </div>
        </div>

        {!r.valid ? (
          <div className="tool-alert tool-alert--warn">
            <AlertTriangle aria-hidden="true" />
            <span>
              {r.p <= 0 ? (
                <>Pon un precio promedio mayor a cero para calcular tu punto de equilibrio.</>
              ) : (
                <>
                  Tu costo variable ({mxn(r.v)}) es igual o mayor que tu precio ({mxn(r.p)}): cada
                  tratamiento te deja pérdida, así que no existe un punto de equilibrio por volumen.
                  No hay número de pacientes que arregle eso — primero hay que subir el precio o
                  bajar el costo del tratamiento.
                </>
              )}
            </span>
          </div>
        ) : null}

        <div className="tool-out">
          <div className="tool-kpis">
            <div className="tool-kpi tool-kpi--hero">
              <p className="tool-kpi__label">Tratamientos al mes para no perder</p>
              <p className="tool-kpi__value">{r.valid ? num(r.perMonth) : "—"}</p>
              <p className="tool-kpi__foot">
                Redondeado hacia arriba: con uno menos, el mes cierra en rojo.
              </p>
            </div>
            <div className="tool-kpi">
              <p className="tool-kpi__label">Margen por tratamiento</p>
              <p className="tool-kpi__value">{mxn2(r.margin)}</p>
              <p className="tool-kpi__foot">
                {r.p > 0 ? `${num1(r.marginPct)}% del precio` : "Falta el precio"}
              </p>
            </div>
          </div>

          <div className="tool-kpis" style={{ marginTop: 14 }}>
            <div className="tool-kpi">
              <p className="tool-kpi__label">Por semana</p>
              <p className="tool-kpi__value">{r.valid ? num(r.perWeek) : "—"}</p>
              <p className="tool-kpi__foot">Asumiendo {WEEKS_PER_MONTH} semanas al mes.</p>
            </div>
            <div className="tool-kpi">
              <p className="tool-kpi__label">Por día hábil</p>
              <p className="tool-kpi__value">{r.valid ? num(r.perDay) : "—"}</p>
              <p className="tool-kpi__foot">Asumiendo {WORKDAYS_PER_MONTH} días hábiles al mes.</p>
            </div>
            <div className="tool-kpi">
              <p className="tool-kpi__label">Ingreso mensual de equilibrio</p>
              <p className="tool-kpi__value">{r.valid ? mxn(r.revenue) : "—"}</p>
              <p className="tool-kpi__foot">Lo que tienes que facturar para quedar en ceros.</p>
            </div>
          </div>

          {r.valid ? (
            <div className="tool-bars">
              <p className="tool-bars__title">A dónde va cada peso que cobras</p>
              <div className="tool-bar">
                <div className="tool-bar__head">
                  <span>Costo variable del tratamiento</span>
                  <span className="tool-bar__amount">{mxn2(r.v)}</span>
                </div>
                <div
                  className="tool-bar__track"
                  role="img"
                  aria-label={`Costo variable por tratamiento: ${mxn2(r.v)}`}
                >
                  <div
                    className="tool-bar__fill tool-bar__fill--muted"
                    style={{ width: `${Math.min(100, (r.v / r.p) * 100)}%` }}
                  />
                </div>
              </div>
              <div className="tool-bar">
                <div className="tool-bar__head">
                  <span>Margen que queda para gastos fijos y utilidad</span>
                  <span className="tool-bar__amount">{mxn2(r.margin)}</span>
                </div>
                <div
                  className="tool-bar__track"
                  role="img"
                  aria-label={`Margen por tratamiento: ${mxn2(r.margin)}`}
                >
                  <div
                    className="tool-bar__fill"
                    style={{ width: `${Math.min(100, Math.max(0, r.marginPct))}%` }}
                  />
                </div>
              </div>
            </div>
          ) : null}

          <div className="tool-alert tool-alert--info">
            <Info aria-hidden="true" />
            <span>
              El punto de equilibrio es el piso, no la meta: en ese número no ganas nada, sólo
              dejas de perder. Para fijar tu objetivo real, súmale la utilidad que quieres sacar al
              mes y vuelve a dividir entre el margen por tratamiento.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
