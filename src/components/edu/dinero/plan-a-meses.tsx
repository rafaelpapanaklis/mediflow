"use client";

import { useEffect, useMemo, useState } from "react";
import {
  EduFormasPago,
  eduCentavosDeInput,
  eduNuevoPagoDraft,
  eduSerializarPagos,
  eduValidarPagos,
  type EduPagoDraft,
} from "@/components/edu/dinero/formas-pago";
import { eduMoney, eduMoneyInputValue } from "@/lib/edu/dinero-core";
import {
  EDU_PLAN_MAX_MONTHS,
  EDU_PLAN_MIN_MONTHS,
  eduFechaLarga,
  eduPlanCalendario,
  type EduPlanCalendarioFila,
} from "@/lib/edu/pagos-core";

/**
 * PLAN DE PAGOS A MESES (DE LA ESCUELA) — el MISMO bloque en los dos
 * sitios que lo ofrecen: "Cobrar → A meses" y "Recibo → Pagar a meses".
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 LO QUE ARREGLA. La vista previa enseñaba montos y NINGUNA fecha, así
 * que desde el mostrador no se podía contestar "¿y cada cuándo pago?"
 * hasta que el plan ya estaba emitido. Y el "Día de corte (opcional)" con
 * placeholder "El día de hoy" hacía que un plan armado un 31 cayera
 * 31/30/31 sin que nadie lo viera venir. Ahora el calendario completo está
 * a la vista ANTES de emitir, con el recorte dicho con todas sus letras.
 *
 * 🔴 NO ES lo mismo que los "meses sin intereses del banco". Esto lo
 * financia la ESCUELA (sin intereses por construcción) y hay que ir
 * cobrando cada mensualidad; aquello lo financia el BANCO y la escuela
 * recibe el total el mismo día. Los dos nombres van completos en pantalla
 * porque en el mostrador se confunden.
 *
 * 🔴 EL CALENDARIO SALE DE LA MISMA FUNCIÓN PURA QUE EL SERVIDOR
 * (`eduPlanCalendario` = `eduPlanDueDates` + `eduPlanSplitCents`): lo que
 * se ve aquí es lo que se va a guardar, día por día y centavo por centavo.
 * ═══════════════════════════════════════════════════════════════════════
 */

/** Lo que sale de <PlanAMeses/> cuando el plan ya cuadra. */
export interface EduPlanDatos {
  months: number;
  dueDay: number;
  calendario: EduPlanCalendarioFila[];
  /** Lo que se cobra HOY como enganche. 0 = no hay. */
  engancheCents: number;
  /** Las formas del enganche, listas para el cuerpo del POST. null = no hay. */
  enganchePayments: ReturnType<typeof eduSerializarPagos> | null;
}

/** Los plazos que se ofrecen de un toque. "Otro" abre el campo libre. */
const EDU_PLAN_CHIPS = [3, 6, 9, 12];

export interface PlanAMesesProps {
  idPrefix: string;
  /** El hoy del INSTITUTO, "AAAA-MM-DD". Nunca el del navegador. */
  todayISO: string;
  /** Lo que hay para diferir ANTES del enganche: el total, o el saldo. */
  disponibleCents: number;
  /** Cómo se llama eso en pantalla: "el total" o "el saldo". */
  queEs: string;
  disabled?: boolean;
  onChange: (datos: EduPlanDatos | null) => void;
}

export function PlanAMeses({
  idPrefix,
  todayISO,
  disponibleCents,
  queEs,
  disabled,
  onChange,
}: PlanAMesesProps) {
  const [meses, setMeses] = useState("3");
  const [otroPlazo, setOtroPlazo] = useState(false);
  // 🔴 El día de pago arranca en el día de HOY DEL INSTITUTO, no vacío con
  // un placeholder: así lo que se ve es lo que va a pasar, y el mes que no
  // aguante el día lo dice el calendario de abajo antes de emitir.
  const [dia, setDia] = useState(() => String(Number(todayISO.slice(8, 10))));
  const [conEnganche, setConEnganche] = useState(false);
  const [engancheMonto, setEngancheMonto] = useState("");
  const [engPagos, setEngPagos] = useState<EduPagoDraft[]>(() => [eduNuevoPagoDraft(0)]);
  const [engTocado, setEngTocado] = useState(false);

  const engancheTecleado = conEnganche ? eduCentavosDeInput(engancheMonto) : 0;

  // Mientras nadie toque las formas del enganche, la única fila sigue al
  // monto tecleado: en el caso normal la suma cuadra sola.
  useEffect(() => {
    if (engTocado) return;
    setEngPagos((ps) =>
      ps.length === 1 ? [{ ...ps[0], monto: eduMoneyInputValue(engancheTecleado) }] : ps,
    );
  }, [engancheTecleado, engTocado]);

  // 🔴 Lo que de verdad se cobra hoy es la SUMA DE LAS FORMAS, no el
  // número tecleado arriba: es lo que viaja al servidor, y por tanto lo
  // que tiene que mandar en el calendario. Si el calendario usara el
  // número tecleado, el papel del paciente diría un enganche que nadie
  // pagó.
  //
  // El número tecleado sigue siendo el OBJETIVO del bloque de formas: es
  // contra él contra el que se dice "Cubierto" o "Queda a deber", y
  // declarar MÁS de lo que se dijo que era el enganche no pasa.
  const engancheCents = conEnganche
    ? engPagos.reduce((a, x) => a + eduCentavosDeInput(x.monto), 0)
    : 0;
  const errorEnganche =
    conEnganche && engancheTecleado > 0
      ? eduValidarPagos(engPagos, engancheTecleado, false)
      : null;

  const datos = useMemo<EduPlanDatos | null>(() => {
    const m = Number(meses.trim());
    if (!Number.isInteger(m) || m < EDU_PLAN_MIN_MONTHS || m > EDU_PLAN_MAX_MONTHS) return null;
    const d = Number(dia);
    if (!Number.isInteger(d) || d < 1 || d > 31) return null;
    if (conEnganche && (engancheTecleado <= 0 || engancheCents <= 0)) return null;
    if (errorEnganche) return null;
    // Un enganche que se lo come todo es liquidar, no diferir. El servidor
    // lo rebota con esas palabras; aquí simplemente no hay plan que ver.
    if (engancheCents >= disponibleCents) return null;
    const calendario = eduPlanCalendario(todayISO, d, m, disponibleCents - engancheCents);
    if (!calendario) return null;
    return {
      months: m,
      dueDay: d,
      calendario,
      engancheCents,
      enganchePayments: conEnganche && engancheCents > 0 ? eduSerializarPagos(engPagos) : null,
    };
  }, [
    meses,
    dia,
    conEnganche,
    engancheTecleado,
    engancheCents,
    errorEnganche,
    engPagos,
    disponibleCents,
    todayISO,
  ]);

  // El memo devuelve el MISMO objeto mientras no cambie una dependencia,
  // así que este efecto no se retroalimenta con el setState del padre.
  useEffect(() => {
    onChange(datos);
  }, [datos, onChange]);

  const diferidoCents = disponibleCents - (datos?.engancheCents ?? 0);
  const primeraDistinta =
    datos !== null &&
    datos.calendario[0].amountCents !== datos.calendario[datos.calendario.length - 1].amountCents;

  return (
    <>
      <div className="edu-field">
        <span className="edu-field__label">Plan de pagos a meses (de la escuela, sin intereses)</span>
        <div className="edu-msi" role="group" aria-label="Meses del plan">
          {EDU_PLAN_CHIPS.map((n) => (
            <button
              key={n}
              type="button"
              className="edu-fp__metodo"
              aria-pressed={!otroPlazo && Number(meses) === n}
              disabled={disabled}
              onClick={() => {
                setOtroPlazo(false);
                setMeses(String(n));
              }}
            >
              {n} meses
            </button>
          ))}
          <button
            type="button"
            className="edu-fp__metodo"
            aria-pressed={otroPlazo}
            disabled={disabled}
            onClick={() => setOtroPlazo(true)}
          >
            Otro
          </button>
        </div>
        {otroPlazo && (
          <input
            id={`${idPrefix}-meses`}
            className="edu-input"
            type="number"
            min={EDU_PLAN_MIN_MONTHS}
            max={EDU_PLAN_MAX_MONTHS}
            value={meses}
            onChange={(e) => setMeses(e.target.value)}
            disabled={disabled}
            aria-label="Meses del plan"
          />
        )}
        <span className="edu-field__hint">
          De {EDU_PLAN_MIN_MONTHS} a {EDU_PLAN_MAX_MONTHS}. Se difiere {queEs} (
          {eduMoney(disponibleCents)}); las mensualidades y sus fechas las pone el sistema y las
          ves aquí abajo antes de emitir.
        </span>
      </div>

      <div className="edu-field">
        <label className="edu-field__label" htmlFor={`${idPrefix}-dia`}>
          Día de pago de cada mes
        </label>
        <select
          id={`${idPrefix}-dia`}
          className="edu-input"
          value={dia}
          onChange={(e) => setDia(e.target.value)}
          disabled={disabled}
        >
          {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
            <option key={d} value={d}>
              Día {d}
            </option>
          ))}
        </select>
        {datos && (
          <span className="edu-field__hint">
            Cada día {datos.dueDay}, empezando el {eduFechaLarga(datos.calendario[0].dueDateISO)}.
          </span>
        )}
      </div>

      <label className="edu-check">
        <input
          type="checkbox"
          checked={conEnganche}
          onChange={(e) => setConEnganche(e.target.checked)}
          disabled={disabled}
        />
        <span className="edu-check__body">
          <span className="edu-check__label">Cobrar un enganche ahora</span>
          <span className="edu-check__hint">
            Se cobra en este momento y entra en el corte de hoy. A meses se va lo que queda.
          </span>
        </span>
      </label>

      {conEnganche && (
        <>
          <div className="edu-field">
            <label className="edu-field__label" htmlFor={`${idPrefix}-eng`}>
              Enganche
            </label>
            <input
              id={`${idPrefix}-eng`}
              className="edu-input"
              inputMode="decimal"
              value={engancheMonto}
              onChange={(e) => setEngancheMonto(e.target.value)}
              placeholder="0.00"
              disabled={disabled}
              autoComplete="off"
            />
            <span className="edu-field__hint">
              Menor que {queEs} ({eduMoney(disponibleCents)}): algo tiene que quedar para diferir.
            </span>
          </div>

          <EduFormasPago
            objetivoCents={engancheTecleado}
            exacto={false}
            value={engPagos}
            onChange={(next) => {
              setEngTocado(true);
              setEngPagos(next);
            }}
            idPrefix={`${idPrefix}-engfp`}
            disabled={disabled}
          />
          {errorEnganche && <p className="edu-note">{errorEnganche}</p>}
        </>
      )}

      {datos ? (
        <>
          {/* ── EL CALENDARIO, A LA VISTA ─────────────────────────────
              Número, fecha y monto de cada mensualidad. Un mes que no
              aguanta el día de pago lo dice en su renglón: es justo el
              caso que sorprendía al paciente después de firmar. */}
          <ul className="edu-calendario">
            {datos.calendario.map((f) => (
              <li
                className={`edu-calendario__fila ${f.recortado ? "edu-calendario__fila--vencida" : ""}`}
                key={f.number}
              >
                <span className="edu-calendario__n">{f.number}</span>
                <span className="edu-calendario__fecha">
                  {eduFechaLarga(f.dueDateISO)}
                  {f.recortado && (
                    <span className="edu-calendario__nota">
                      (el mes no tiene {datos.dueDay}: se recorta a su último día)
                    </span>
                  )}
                </span>
                <span className="edu-calendario__monto">{eduMoney(f.amountCents)}</span>
              </li>
            ))}
            <li className="edu-calendario__pie">
              <span>
                Total diferido en {datos.months}{" "}
                {datos.months === 1 ? "mensualidad" : "mensualidades"}
              </span>
              <span className="edu-precio">{eduMoney(diferidoCents)}</span>
            </li>
          </ul>

          {datos.engancheCents > 0 && (
            <p className="edu-note">
              Se cobra ahora un enganche de {eduMoney(datos.engancheCents)}; a meses va el
              calendario de arriba.
            </p>
          )}
          {primeraDistinta && (
            <p className="edu-note">
              No divide exacto: la diferencia va completa en la primera mensualidad, no repartida
              en decimales. La suma da {eduMoney(diferidoCents)}, centavo por centavo.
            </p>
          )}
        </>
      ) : (
        <p className="edu-note">
          Revisa los meses ({EDU_PLAN_MIN_MONTHS} a {EDU_PLAN_MAX_MONTHS}) y el enganche: tiene que
          ser menor que {queEs} y dejar al menos un centavo por mensualidad.
        </p>
      )}
    </>
  );
}
