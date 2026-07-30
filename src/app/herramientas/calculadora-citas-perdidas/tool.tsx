"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CalendarX, Lock, Sparkles } from "lucide-react";
import { mxn, num, parsePositive } from "@/lib/herramientas/format";

// ─────────────────────────────────────────────────────────────────────────────
// Calculadora de citas perdidas — 100% cliente.
//
// No hay fetch, ni server action, ni localStorage: los números que teclea el
// dentista viven en el estado de React y mueren al cerrar la pestaña. Es lo que
// promete la página, así que aquí no se agrega telemetría de ningún tipo.
//
// Los inputs guardan STRING para que se puedan borrar sin que quede un "0"
// pegajoso; el cálculo parsea con parsePositive().
// ─────────────────────────────────────────────────────────────────────────────

export function LostAppointmentsTool() {
  const [apptsPerWeek, setApptsPerWeek] = useState("60");
  const [noShowPct, setNoShowPct] = useState(15);
  const [ticket, setTicket] = useState("900");
  const [weeksPerYear, setWeeksPerYear] = useState("48");

  const r = useMemo(() => {
    const appts = parsePositive(apptsPerWeek);
    const price = parsePositive(ticket);
    const weeks = parsePositive(weeksPerYear);

    const lostPerWeek = (appts * noShowPct) / 100;
    const lostPerMonth = lostPerWeek * (weeks / 12);
    const lostPerYear = lostPerWeek * weeks;

    const moneyMonth = lostPerMonth * price;
    const moneyYear = lostPerYear * price;

    const potentialYear = appts * weeks * price;
    const actualYear = Math.max(0, potentialYear - moneyYear);
    // Ancho de la barra "lo que sí cobras" respecto al 100% potencial.
    const actualPct = potentialYear > 0 ? (actualYear / potentialYear) * 100 : 0;

    return {
      lostPerMonth,
      lostPerYear,
      moneyMonth,
      moneyYear,
      potentialYear,
      actualYear,
      actualPct,
      halfYear: moneyYear / 2,
      hasData: appts > 0 && price > 0 && weeks > 0,
    };
  }, [apptsPerWeek, noShowPct, ticket, weeksPerYear]);

  return (
    <div className="tool-panel">
      <div className="tool-panel__head">
        <CalendarX aria-hidden="true" style={{ width: 18, height: 18, color: "var(--b)" }} />
        <h2 className="tool-panel__title">Calcula tus citas perdidas</h2>
        <span className="tool-panel__badge">
          <Lock aria-hidden="true" /> En tu navegador
        </span>
      </div>

      <div className="tool-panel__body">
        <div className="tool-fields">
          <div className="tool-field">
            <label className="tool-label" htmlFor="cp-citas">
              Citas por semana
            </label>
            <input
              id="cp-citas"
              className="tool-input"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={apptsPerWeek}
              onChange={(e) => setApptsPerWeek(e.target.value)}
            />
            <span className="tool-hint">Todas las citas agendadas, no sólo las que se cumplen.</span>
          </div>

          <div className="tool-field">
            <label className="tool-label" htmlFor="cp-ticket">
              Ticket promedio por cita
            </label>
            <div className="tool-inputwrap">
              <span className="tool-inputwrap__prefix" aria-hidden="true">
                $
              </span>
              <input
                id="cp-ticket"
                className="tool-input tool-input--money"
                type="number"
                inputMode="numeric"
                min={0}
                step={50}
                value={ticket}
                onChange={(e) => setTicket(e.target.value)}
              />
            </div>
            <span className="tool-hint">Lo que deja en caja una cita promedio, en pesos.</span>
          </div>

          <div className="tool-field tool-field--wide">
            <label className="tool-label" htmlFor="cp-pct">
              Porcentaje de inasistencia
            </label>
            <div className="tool-slider">
              <input
                id="cp-pct"
                className="tool-range"
                type="range"
                min={0}
                max={40}
                step={1}
                value={noShowPct}
                onChange={(e) => setNoShowPct(Number(e.target.value))}
                aria-valuetext={`${noShowPct} por ciento`}
              />
              <output className="tool-slider__value" htmlFor="cp-pct">
                {noShowPct}%
              </output>
            </div>
            <span className="tool-hint">
              De cada 100 citas agendadas, cuántas no llegan ni avisan. Si no lo mides, el rango
              típico anda entre 10% y 20%.
            </span>
          </div>

          <div className="tool-field">
            <label className="tool-label" htmlFor="cp-semanas">
              Semanas de trabajo al año
            </label>
            <input
              id="cp-semanas"
              className="tool-input"
              type="number"
              inputMode="numeric"
              min={0}
              max={52}
              step={1}
              value={weeksPerYear}
              onChange={(e) => setWeeksPerYear(e.target.value)}
            />
            <span className="tool-hint">Descontando vacaciones y puentes. Suele ser 46–50.</span>
          </div>
        </div>

        <div className="tool-out">
          <div className="tool-kpis">
            <div className="tool-kpi tool-kpi--hero">
              <p className="tool-kpi__label">Se te va al mes</p>
              <p className="tool-kpi__value">{mxn(r.moneyMonth)}</p>
              <p className="tool-kpi__foot">{num(r.lostPerMonth)} citas perdidas al mes</p>
            </div>
            <div className="tool-kpi tool-kpi--hero">
              <p className="tool-kpi__label">Se te va al año</p>
              <p className="tool-kpi__value">{mxn(r.moneyYear)}</p>
              <p className="tool-kpi__foot">{num(r.lostPerYear)} citas perdidas al año</p>
            </div>
          </div>

          <div className="tool-kpis" style={{ marginTop: 14 }}>
            <div className="tool-kpi">
              <p className="tool-kpi__label">Ingreso potencial al año</p>
              <p className="tool-kpi__value">{mxn(r.potentialYear)}</p>
              <p className="tool-kpi__foot">Si se cumpliera cada cita agendada.</p>
            </div>
            <div className="tool-kpi">
              <p className="tool-kpi__label">Ingreso con tu inasistencia actual</p>
              <p className="tool-kpi__value">{mxn(r.actualYear)}</p>
              <p className="tool-kpi__foot">Lo que realmente entra a caja al año.</p>
            </div>
          </div>

          <div className="tool-bars">
            <p className="tool-bars__title">Ingreso anual: potencial vs. real</p>
            <div className="tool-bar">
              <div className="tool-bar__head">
                <span>Potencial (100% de asistencia)</span>
                <span className="tool-bar__amount">{mxn(r.potentialYear)}</span>
              </div>
              <div
                className="tool-bar__track"
                role="img"
                aria-label={`Ingreso potencial al año: ${mxn(r.potentialYear)}`}
              >
                <div className="tool-bar__fill" style={{ width: "100%" }} />
              </div>
            </div>
            <div className="tool-bar">
              <div className="tool-bar__head">
                <span>Real (con {noShowPct}% de inasistencia)</span>
                <span className="tool-bar__amount">{mxn(r.actualYear)}</span>
              </div>
              <div
                className="tool-bar__track"
                role="img"
                aria-label={`Ingreso real al año: ${mxn(r.actualYear)}`}
              >
                <div
                  className="tool-bar__fill tool-bar__fill--bad"
                  style={{ width: `${Math.min(100, Math.max(0, r.actualPct))}%` }}
                />
              </div>
            </div>
          </div>

          {r.hasData && r.moneyYear > 0 ? (
            <div className="tool-callout">
              <Sparkles aria-hidden="true" />
              <div className="tool-callout__body">
                <p className="tool-callout__title">
                  Si bajaras la inasistencia a la mitad, recuperarías{" "}
                  <span className="tool-callout__amount">~{mxn(r.halfYear)}</span> al año
                </p>
                <p className="tool-callout__text">
                  Es decir, pasar de {noShowPct}% a {Math.round(noShowPct / 2)}% de citas perdidas.
                  La palanca más directa no es llamar más: es que cada paciente reciba el
                  recordatorio por WhatsApp con tiempo para confirmar o mover su cita, y que el
                  hueco que se libera se ofrezca a alguien de la lista de espera. En DaleControl
                  esos recordatorios salen solos desde la agenda.
                </p>
                <p className="tool-callout__cta">
                  <Link
                    href="/blog/confirmacion-citas-whatsapp"
                    className="mfh-btn mfh-btn--soft"
                    style={{ whiteSpace: "nowrap" }}
                  >
                    Cómo confirmar citas por WhatsApp
                  </Link>
                </p>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
