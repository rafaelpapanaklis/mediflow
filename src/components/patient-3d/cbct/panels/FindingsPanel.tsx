"use client";

// Panel de hallazgos y mediciones: lista cada anotación con su valor calculado
// (mm/°/pts/dimensiones del implante), color por tipo, selección, borrado,
// etiqueta editable (anotación/canal) y steppers Ø/largo para el implante (vía
// onEditImplant). Las distancias usan la escala REAL del plano (mmPorPixel),
// reemplazando el FOV_MM fijo del prototipo. Estilo en cbct.css.

import type { Anno, FindingsPanelProps, Plane } from "../types";
import { TOOL_COLORS } from "../constants";
import { mmBetween, angleAt } from "../geometry";
import { IcClose } from "../icons";
import "../cbct.css";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// Límites de ajuste del implante (fracción de la caja de imagen).
const DIAM_MIN = 0.02;
const DIAM_MAX = 0.08;
const DIAM_STEP = 0.005;
const LEN_MIN = 0.1;
const LEN_MAX = 0.95;
const LEN_STEP = 0.02;

// Texto cuando aún no hay escala real del plano (cabeceras DICOM no listas o
// ausentes): evita el engañoso "0.0 mm" en distancias y dimensiones de implante.
const SIN_ESCALA = "sin escala";

function findingMeta(a: Anno, mmPorPixel: Record<Plane, number>): { label: string; val: string } {
  const scale = mmPorPixel[a.plane] || 0;
  const hasScale = scale > 0;
  if (a.type === "distancia")
    return {
      label: "Distancia",
      val: hasScale ? mmBetween(a.points[0], a.points[1], scale).toFixed(1) + " mm" : SIN_ESCALA,
    };
  if (a.type === "angulo")
    return { label: "Ángulo", val: (a.points.length >= 3 ? angleAt(a.points[0], a.points[1], a.points[2]).toFixed(0) : "–") + "°" };
  if (a.type === "anotacion") return { label: a.label || "Nota", val: "Marca" };
  if (a.type === "canal") return { label: a.label || "Conducto", val: a.points.length + " pts" };
  if (a.type === "implante")
    return {
      label: "Implante",
      val: hasScale ? (a.length01 * scale).toFixed(1) + "×Ø" + (a.diam01 * scale).toFixed(1) + " mm" : SIN_ESCALA,
    };
  return { label: "Hallazgo", val: "" };
}

export function FindingsPanel({ annos, selectedId, onSelect, onRemove, onRename, onEditImplant, mmPorPixel }: FindingsPanelProps) {
  return (
    <div className="vc-section">
      <div className="vc-sec-title">
        Hallazgos y mediciones <span className="vc-count">{annos.length}</span>
      </div>
      {annos.length === 0 && (
        <div className="vc-empty">
          Usa las herramientas sobre la imagen para crear mediciones, marcar el conducto dentario o planificar un implante.
        </div>
      )}
      <div className="vc-find-list">
        {annos.map((a) => {
          const m = findingMeta(a, mmPorPixel);
          const scale = mmPorPixel[a.plane] || 0;
          const hasScale = scale > 0;
          const color = TOOL_COLORS[a.type];
          const editable = a.type === "anotacion" || a.type === "canal";
          const sel = a.id === selectedId;
          return (
            <div
              key={a.id}
              className={"vc-find" + (sel ? " sel" : "")}
              role="button"
              tabIndex={0}
              aria-pressed={sel}
              onClick={() => onSelect(a.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(a.id);
                }
              }}
            >
              <span className="vc-find-dot" style={{ background: color }} />
              <div className="vc-find-main">
                {editable ? (
                  <textarea
                    className="vc-find-edit"
                    value={m.label}
                    rows={1}
                    placeholder="Describe el hallazgo…"
                    aria-label="Descripción del hallazgo"
                    onChange={(e) => onRename(a.id, e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onInput={(e) => {
                      const t = e.currentTarget;
                      t.style.height = "auto";
                      t.style.height = t.scrollHeight + "px";
                    }}
                  />
                ) : (
                  <span className="vc-find-lb">{m.label}</span>
                )}
                <span className="vc-find-meta">
                  {a.plane} · {m.val}
                </span>
              </div>
              {a.type === "implante" && (
                <div className="vc-find-imp" onClick={(e) => e.stopPropagation()}>
                  <div className="vc-step">
                    <button
                      type="button"
                      aria-label="Reducir diámetro del implante"
                      onClick={() => onEditImplant(a.id, { diam01: clamp(a.diam01 - DIAM_STEP, DIAM_MIN, DIAM_MAX) })}
                    >
                      −
                    </button>
                    <span className="vc-step-val">Ø {hasScale ? (a.diam01 * scale).toFixed(1) : "—"}</span>
                    <button
                      type="button"
                      aria-label="Aumentar diámetro del implante"
                      onClick={() => onEditImplant(a.id, { diam01: clamp(a.diam01 + DIAM_STEP, DIAM_MIN, DIAM_MAX) })}
                    >
                      +
                    </button>
                  </div>
                  <div className="vc-step">
                    <button
                      type="button"
                      aria-label="Reducir largo del implante"
                      onClick={() => onEditImplant(a.id, { length01: clamp(a.length01 - LEN_STEP, LEN_MIN, LEN_MAX) })}
                    >
                      −
                    </button>
                    <span className="vc-step-val">L {hasScale ? (a.length01 * scale).toFixed(1) : "—"}</span>
                    <button
                      type="button"
                      aria-label="Aumentar largo del implante"
                      onClick={() => onEditImplant(a.id, { length01: clamp(a.length01 + LEN_STEP, LEN_MIN, LEN_MAX) })}
                    >
                      +
                    </button>
                  </div>
                </div>
              )}
              <button
                className="vc-find-rm"
                type="button"
                aria-label="Eliminar hallazgo"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(a.id);
                }}
              >
                <IcClose />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default FindingsPanel;
