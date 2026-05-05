"use client";
// Periodontics — drawer lateral para editar movilidad/furca/ausente/implante
// del diente clickeado en el grid + abrir modal de recesión Cairo. SPEC §6.8.

import { useEffect, useState } from "react";
import type { ToothLevel } from "@/lib/periodontics/schemas";
import { CAIRO_LABELS } from "@/lib/periodontics/cairo-classification";
import { dispatchPerioAction, dispatchPerioPersistTooth } from "./PeriodontogramGrid";

export interface ToothDetailDrawerProps {
  fdi: number | null;
  initialTooth?: ToothLevel;
  onClose: () => void;
  onCreateRecession?: (input: {
    toothFdi: number;
    surface: "vestibular" | "lingual";
    recessionHeightMm: number;
    recessionWidthMm: number;
    keratinizedTissueMm: number;
    cairoClassification: "RT1" | "RT2" | "RT3";
    gingivalPhenotype: "DELGADO" | "GRUESO";
  }) => Promise<void> | void;
}

export function ToothDetailDrawer(props: ToothDetailDrawerProps) {
  const { fdi, initialTooth } = props;
  const [tooth, setTooth] = useState<ToothLevel | null>(null);
  const [showRecession, setShowRecession] = useState(false);

  useEffect(() => {
    if (fdi == null) {
      setTooth(null);
      return;
    }
    setTooth(
      initialTooth ?? {
        fdi,
        mobility: 0,
        furcation: 0,
        absent: false,
        isImplant: false,
      },
    );
  }, [fdi, initialTooth]);

  if (fdi == null || !tooth) return null;

  const update = (patch: Partial<ToothLevel>) => {
    const next: ToothLevel = { ...tooth, ...patch };
    setTooth(next);
    dispatchPerioAction({ type: "UPSERT_TOOTH", tooth: next });
    dispatchPerioPersistTooth(next);
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={props.onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.4)",
          zIndex: 900,
        }}
        aria-hidden
      />
      <aside
        role="dialog"
        aria-label={`Detalles del diente ${fdi}`}
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: 360,
          background: "var(--bg, #0b0d11)",
          borderLeft: "1px solid var(--border, #1f2937)",
          padding: 20,
          zIndex: 901,
          overflowY: "auto",
        }}
      >
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <h2 style={{ fontSize: 18, color: "var(--text-1, #e5e7eb)", margin: 0 }}>
            Diente {fdi}
          </h2>
          <button
            type="button"
            onClick={props.onClose}
            aria-label="Cerrar"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--text-2, #94a3b8)",
              fontSize: 18,
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </header>

        <Field label="Movilidad (Miller)">
          <Segment
            options={[0, 1, 2, 3]}
            value={tooth.mobility}
            onChange={(v) => update({ mobility: v as 0 | 1 | 2 | 3 })}
          />
        </Field>

        <Field label="Furcación (Hamp)">
          <Segment
            options={[0, 1, 2, 3]}
            value={tooth.furcation}
            onChange={(v) => update({ furcation: v as 0 | 1 | 2 | 3 })}
          />
        </Field>

        <Field label="Estado">
          <label style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--text-1)" }}>
            <input
              type="checkbox"
              checked={tooth.absent}
              onChange={(e) => update({ absent: e.target.checked })}
            />
            Ausente
          </label>
          <label
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              color: "var(--text-1)",
              marginTop: 6,
            }}
          >
            <input
              type="checkbox"
              checked={tooth.isImplant}
              onChange={(e) => update({ isImplant: e.target.checked })}
            />
            Implante
          </label>
        </Field>

        {props.onCreateRecession ? (
          <div style={{ marginTop: 24 }}>
            <button
              type="button"
              onClick={() => setShowRecession(true)}
              style={{
                width: "100%",
                padding: "10px 14px",
                borderRadius: 6,
                border: "1px solid var(--brand, #6366f1)",
                background: "transparent",
                color: "var(--brand, #6366f1)",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Registrar recesión Cairo 2018
            </button>
            {showRecession ? (
              <RecessionForm
                fdi={fdi}
                onSubmit={async (data) => {
                  await props.onCreateRecession?.(data);
                  setShowRecession(false);
                }}
                onCancel={() => setShowRecession(false)}
              />
            ) : null}
          </div>
        ) : null}
      </aside>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 16 }}>
      <label
        style={{
          display: "block",
          fontSize: 11,
          textTransform: "uppercase",
          color: "var(--text-2, #94a3b8)",
          marginBottom: 6,
        }}
      >
        {label}
      </label>
      {children}
    </section>
  );
}

function Segment({
  options,
  value,
  onChange,
}: {
  options: number[];
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          style={{
            flex: 1,
            padding: "6px 0",
            borderRadius: 4,
            border:
              value === opt
                ? "1px solid var(--brand, #6366f1)"
                : "1px solid var(--border, #1f2937)",
            background:
              value === opt
                ? "var(--brand-soft, rgba(99,102,241,0.18))"
                : "var(--bg-elev, #11151c)",
            color: "var(--text-1, #e5e7eb)",
            cursor: "pointer",
            fontSize: 12,
          }}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

function RecessionForm({
  fdi,
  onSubmit,
  onCancel,
}: {
  fdi: number;
  onSubmit: (data: {
    toothFdi: number;
    surface: "vestibular" | "lingual";
    recessionHeightMm: number;
    recessionWidthMm: number;
    keratinizedTissueMm: number;
    cairoClassification: "RT1" | "RT2" | "RT3";
    gingivalPhenotype: "DELGADO" | "GRUESO";
  }) => Promise<void> | void;
  onCancel: () => void;
}) {
  const [surface, setSurface] = useState<"vestibular" | "lingual">("vestibular");
  const [height, setHeight] = useState(0);
  const [width, setWidth] = useState(0);
  const [kt, setKt] = useState(0);
  const [cairo, setCairo] = useState<"RT1" | "RT2" | "RT3">("RT1");
  const [phenotype, setPhenotype] = useState<"DELGADO" | "GRUESO">("DELGADO");
  const [pending, setPending] = useState(false);

  const submit = async () => {
    setPending(true);
    try {
      await onSubmit({
        toothFdi: fdi,
        surface,
        recessionHeightMm: height,
        recessionWidthMm: width,
        keratinizedTissueMm: kt,
        cairoClassification: cairo,
        gingivalPhenotype: phenotype,
      });
    } finally {
      setPending(false);
    }
  };

  return (
    <div
      style={{
        marginTop: 12,
        padding: 12,
        borderRadius: 6,
        border: "1px solid var(--border, #1f2937)",
        background: "var(--bg-elev, #11151c)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <Field label="Superficie">
        <Segment
          options={[0, 1] as number[]}
          value={surface === "vestibular" ? 0 : 1}
          onChange={(v) => setSurface(v === 0 ? "vestibular" : "lingual")}
        />
        <span style={{ fontSize: 10, color: "var(--text-3, #64748b)" }}>
          0 = vestibular · 1 = lingual
        </span>
      </Field>
      <NumberField label="Altura (mm)" value={height} onChange={setHeight} />
      <NumberField label="Ancho (mm)" value={width} onChange={setWidth} />
      <NumberField label="Tejido queratinizado (mm)" value={kt} onChange={setKt} />
      <Field label="Cairo 2018">
        <select
          value={cairo}
          onChange={(e) => setCairo(e.target.value as "RT1" | "RT2" | "RT3")}
          style={{
            width: "100%",
            padding: 6,
            background: "var(--bg, #0b0d11)",
            color: "var(--text-1, #e5e7eb)",
            border: "1px solid var(--border, #1f2937)",
            borderRadius: 4,
          }}
        >
          {(["RT1", "RT2", "RT3"] as const).map((c) => (
            <option key={c} value={c}>
              {CAIRO_LABELS[c]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Fenotipo gingival">
        <Segment
          options={[0, 1] as number[]}
          value={phenotype === "DELGADO" ? 0 : 1}
          onChange={(v) => setPhenotype(v === 0 ? "DELGADO" : "GRUESO")}
        />
        <span style={{ fontSize: 10, color: "var(--text-3, #64748b)" }}>
          0 = delgado · 1 = grueso
        </span>
      </Field>
      <div style={{ display: "flex", gap: 6 }}>
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          style={{
            flex: 1,
            padding: "8px 12px",
            borderRadius: 4,
            border: "1px solid var(--brand, #6366f1)",
            background: "var(--brand, #6366f1)",
            color: "white",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          {pending ? "Guardando..." : "Guardar recesión"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          style={{
            padding: "8px 12px",
            borderRadius: 4,
            border: "1px solid var(--border, #1f2937)",
            background: "transparent",
            color: "var(--text-1, #e5e7eb)",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        min={0}
        max={20}
        step={0.5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          width: "100%",
          padding: 6,
          background: "var(--bg, #0b0d11)",
          color: "var(--text-1, #e5e7eb)",
          border: "1px solid var(--border, #1f2937)",
          borderRadius: 4,
        }}
      />
    </Field>
  );
}
