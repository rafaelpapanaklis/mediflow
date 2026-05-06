"use client";
// Orthodontics — IPR map (Interproximal Reduction). Anota el stripping
// interproximal entre cada par adyacente de dientes en la arcada
// superior e inferior. Render basado en una grid simple FDI.

import { useState } from "react";

export interface IPRValue {
  /** Pieza FDI a la izquierda del espacio interproximal. */
  fdiLeft: number;
  /** Pieza FDI a la derecha del espacio interproximal. */
  fdiRight: number;
  /** Stripping en mm (0 = sin reducción, 0.1–0.5 típico). */
  mm: number;
}

export interface OrthoIPRMapProps {
  values: IPRValue[];
  onChange?: (values: IPRValue[]) => void;
  /** Si readonly, oculta inputs y solo muestra valores. */
  readonly?: boolean;
}

// Arcada superior (FDI 17→27) y inferior (47→37) — orden de visualización
// de derecha a izquierda del paciente.
const UPPER_FDI = [17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27];
const LOWER_FDI = [47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37];

export function OrthoIPRMap(props: OrthoIPRMapProps) {
  const [editing, setEditing] = useState<{ left: number; right: number } | null>(null);
  const [draftMm, setDraftMm] = useState("0");

  const totalUpper = sumForArch(props.values, UPPER_FDI);
  const totalLower = sumForArch(props.values, LOWER_FDI);

  const valueFor = (left: number, right: number): number => {
    return (
      props.values.find((v) => v.fdiLeft === left && v.fdiRight === right)?.mm ?? 0
    );
  };

  const setValue = (left: number, right: number, mm: number) => {
    if (!props.onChange) return;
    const filtered = props.values.filter(
      (v) => !(v.fdiLeft === left && v.fdiRight === right),
    );
    const next = mm > 0 ? [...filtered, { fdiLeft: left, fdiRight: right, mm }] : filtered;
    props.onChange(next);
  };

  return (
    <section
      style={{
        background: "var(--surface-1, #ffffff)",
        border: "1px solid var(--border, #e5e5ed)",
        borderRadius: 10,
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
      aria-label="Mapa de IPR"
    >
      <header style={{ display: "flex", justifyContent: "space-between" }}>
        <strong style={{ fontSize: 14 }}>Mapa de IPR · Stripping interproximal</strong>
        <small style={{ fontSize: 11, color: "var(--text-2, #6b6b78)" }}>
          Sup: {totalUpper.toFixed(1)} mm · Inf: {totalLower.toFixed(1)} mm
        </small>
      </header>

      <ArchRow
        label="Superior"
        fdis={UPPER_FDI}
        valueFor={valueFor}
        onClick={(left, right) => {
          if (props.readonly) return;
          setEditing({ left, right });
          setDraftMm(String(valueFor(left, right) || ""));
        }}
        readonly={props.readonly}
      />
      <ArchRow
        label="Inferior"
        fdis={LOWER_FDI}
        valueFor={valueFor}
        onClick={(left, right) => {
          if (props.readonly) return;
          setEditing({ left, right });
          setDraftMm(String(valueFor(left, right) || ""));
        }}
        readonly={props.readonly}
      />

      {editing ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1300,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onClick={() => setEditing(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(360px, 100%)",
              background: "var(--surface-1)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: 16,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <h4 style={{ margin: 0, fontSize: 14 }}>
              IPR entre {editing.left} y {editing.right}
            </h4>
            <label style={{ fontSize: 12, color: "var(--text-2)" }}>
              Stripping (mm)
            </label>
            <input
              type="number"
              step="0.1"
              min="0"
              max="2"
              value={draftMm}
              onChange={(e) => setDraftMm(e.target.value)}
              style={{
                padding: "6px 8px",
                border: "1px solid var(--border)",
                borderRadius: 4,
                fontSize: 13,
                background: "var(--surface-2)",
                color: "var(--text-1)",
              }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
              <button
                type="button"
                onClick={() => setEditing(null)}
                style={btnSecondary}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  const mm = Number.parseFloat(draftMm);
                  if (!Number.isNaN(mm)) setValue(editing.left, editing.right, mm);
                  setEditing(null);
                }}
                style={btnPrimary}
              >
                Guardar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ArchRow(props: {
  label: string;
  fdis: number[];
  valueFor: (left: number, right: number) => number;
  onClick: (left: number, right: number) => void;
  readonly?: boolean;
}) {
  return (
    <div>
      <small style={{ fontSize: 11, color: "var(--text-2, #6b6b78)" }}>{props.label}</small>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${props.fdis.length * 2 - 1}, 1fr)`,
          gap: 2,
          alignItems: "center",
          marginTop: 4,
        }}
      >
        {props.fdis.map((fdi, i) => (
          <ToothCell key={`t-${fdi}`} fdi={fdi} colIndex={i * 2} />
        )).flatMap((cell, i, arr) => {
          if (i === arr.length - 1) return [cell];
          const left = props.fdis[i];
          const right = props.fdis[i + 1];
          const mm = props.valueFor(left, right);
          return [
            cell,
            <button
              key={`ipr-${left}-${right}`}
              type="button"
              onClick={() => props.onClick(left, right)}
              disabled={props.readonly}
              style={{
                fontSize: 9,
                padding: 2,
                borderRadius: 3,
                border: mm > 0 ? "1px solid var(--brand, #6366f1)" : "1px solid var(--border)",
                background: mm > 0
                  ? "var(--brand-soft, rgba(99,102,241,0.10))"
                  : "transparent",
                color: mm > 0 ? "var(--brand, #6366f1)" : "var(--text-3)",
                cursor: props.readonly ? "default" : "pointer",
                fontWeight: 600,
              }}
            >
              {mm > 0 ? mm.toFixed(1) : "·"}
            </button>,
          ];
        })}
      </div>
    </div>
  );
}

function ToothCell(props: { fdi: number; colIndex: number }) {
  return (
    <div
      style={{
        textAlign: "center",
        padding: 4,
        background: "var(--surface-2, #f5f5f7)",
        border: "1px solid var(--border, #e5e5ed)",
        borderRadius: 4,
        fontSize: 11,
        fontFamily: "monospace",
      }}
    >
      {props.fdi}
    </div>
  );
}

function sumForArch(values: IPRValue[], fdis: number[]): number {
  const set = new Set(fdis);
  return values
    .filter((v) => set.has(v.fdiLeft) && set.has(v.fdiRight))
    .reduce((acc, v) => acc + v.mm, 0);
}

const btnPrimary: React.CSSProperties = {
  padding: "5px 10px",
  fontSize: 12,
  borderRadius: 6,
  border: "none",
  background: "var(--brand, #6366f1)",
  color: "white",
  cursor: "pointer",
};

const btnSecondary: React.CSSProperties = {
  padding: "5px 10px",
  fontSize: 12,
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text-1)",
  cursor: "pointer",
};
