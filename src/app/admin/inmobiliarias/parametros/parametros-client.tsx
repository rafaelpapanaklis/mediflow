"use client";

// ═══════════════════════════════════════════════════════════════════════
// Editor de los parámetros fiscales de las calculadoras de inmuebles.
//
// Dos avisos que NO son decoración:
//   · "revisar cada enero" — la UMA se publica en enero, el ISAI lo fija
//     cada congreso estatal y el SAT actualiza la tarifa del ISR. Un
//     parámetro viejo no falla: contesta mal, que es peor.
//   · "por verificar" — toda fila sembrada nace marcada hasta que una
//     persona la confronta con el documento oficial. La calculadora repite
//     esa marca en su propio aviso, así que la duda viaja hasta el asesor.
//
// El `meta` se edita como JSON crudo a propósito: ahí vive la tarifa del
// artículo 152 (once tramos) y los bloques de crédito. Un formulario campo
// por campo para eso sería una jaula, y quien edita impuestos de plataforma
// es un usuario técnico.
// ═══════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState, useTransition } from "react";
import toast from "react-hot-toast";
import { AlertTriangle, CalendarClock, Pencil, Plus, Sprout, Trash2, X } from "lucide-react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { FEDERAL_STATE_CODE, MX_STATES, stateName } from "@/lib/realty/calc/catalog";
import { borrarAccion, guardarAccion, sembrarAccion } from "./actions";

interface Fila {
  id: string;
  kind: string;
  stateCode: string;
  year: number;
  value: number;
  meta: Record<string, unknown> | null;
  effectiveFrom: string;
  updatedAt: string;
}

const KINDS = ["ISAI", "UMA", "UDI", "INPC", "INFONAVIT", "FOVISSSTE"] as const;

const KIND_LABEL: Record<string, string> = {
  ISAI: "ISAI y costos de escrituración",
  UMA: "UMA",
  UDI: "UDI y parámetros del ISR",
  INPC: "INPC (inflación)",
  INFONAVIT: "Infonavit y crédito bancario",
  FOVISSSTE: "Fovissste",
};

/** En qué unidad se lee el `value` de cada familia. */
const KIND_UNIDAD: Record<string, string> = {
  ISAI: "% sobre la base gravable",
  UMA: "pesos al día",
  UDI: "pesos por UDI",
  INPC: "índice (base 2018 = 100)",
  INFONAVIT: "pesos (monto máximo)",
  FOVISSSTE: "pesos (monto máximo)",
};

const VACIO: Fila = {
  id: "",
  kind: "ISAI",
  stateCode: FEDERAL_STATE_CODE,
  year: new Date().getFullYear(),
  value: 0,
  meta: {},
  effectiveFrom: `${new Date().getFullYear()}-01-01T00:00:00.000Z`,
  updatedAt: "",
};

export function ParametrosClient({
  initial,
  anioActual,
  kindsSinAnio,
  resumenSemilla,
  anioSemilla,
}: {
  initial: Fila[];
  anioActual: number;
  kindsSinAnio: string[];
  resumenSemilla: { total: number; porKind: Record<string, number>; porVerificar: number };
  anioSemilla: number;
}) {
  const askConfirm = useConfirm();
  const [pendiente, startTransition] = useTransition();
  const [editando, setEditando] = useState<Fila | null>(null);
  const [filtroKind, setFiltroKind] = useState<string>("todos");

  const visibles = useMemo(
    () => (filtroKind === "todos" ? initial : initial.filter((f) => f.kind === filtroKind)),
    [initial, filtroKind],
  );

  const porVerificar = useMemo(
    () => initial.filter((f) => f.meta?.porVerificar === true).length,
    [initial],
  );

  function correr(fn: () => Promise<{ ok: boolean; error?: string; mensaje?: string }>) {
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) toast.error(r.error ?? "Algo salió mal.");
      else toast.success(r.mensaje ?? "Listo.");
      if (r.ok) setEditando(null);
    });
  }

  async function borrar(f: Fila) {
    const seguro = await askConfirm({
      title: "Borrar el parámetro",
      description: `${KIND_LABEL[f.kind]} · ${stateName(f.stateCode)} · ${f.year}. Las calculadoras que dependan de él van a decir que falta, en vez de calcular con otro número.`,
      confirmText: "Borrar",
      variant: "danger",
    });
    if (!seguro) return;
    correr(() => borrarAccion(f.id));
  }

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "32px 24px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: 22,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 22,
              letterSpacing: "-0.02em",
              color: "var(--text-1)",
              fontWeight: 600,
              margin: 0,
            }}
          >
            Parámetros de las calculadoras
          </h1>
          <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4, margin: 0 }}>
            De aquí salen TODAS las cifras fiscales de las calculadoras de inmuebles. Ningún número
            está escrito en el código.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <ButtonNew
            variant="secondary"
            icon={<Sprout size={14} />}
            onClick={() => correr(sembrarAccion)}
            disabled={pendiente}
          >
            Sembrar el catálogo {anioSemilla}
          </ButtonNew>
          <ButtonNew
            variant="primary"
            icon={<Plus size={14} />}
            onClick={() => setEditando({ ...VACIO, year: anioActual })}
          >
            Nuevo parámetro
          </ButtonNew>
        </div>
      </div>

      {/* ── Revisar cada enero ─────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "flex-start",
          padding: "14px 16px",
          borderRadius: 10,
          border: "1px solid rgba(191,130,20,0.35)",
          background: "rgba(191,130,20,0.10)",
          marginBottom: 14,
        }}
      >
        <CalendarClock size={16} style={{ color: "#d8a13a", flexShrink: 0, marginTop: 1 }} />
        <div style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.6 }}>
          <strong style={{ color: "var(--text-1)" }}>Revisar cada enero.</strong> La UMA la publica
          el INEGI en enero (entra en vigor el 1 de febrero), el ISAI lo fija cada congreso estatal
          en su ley de ingresos y el SAT actualiza la tarifa del ISR en el Anexo 8 de la RMF. Un
          parámetro viejo no da error: da una respuesta equivocada, que es peor. Captura el valor
          nuevo con su propia fecha de vigencia — <strong>no borres el anterior</strong>, se necesita
          para recalcular operaciones de años pasados.
        </div>
      </div>

      {/* ── Alerta: el año en curso no tiene parámetros ─────────────── */}
      {kindsSinAnio.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "flex-start",
            padding: "14px 16px",
            borderRadius: 10,
            border: "1px solid rgba(190,60,45,0.35)",
            background: "rgba(190,60,45,0.09)",
            marginBottom: 14,
          }}
        >
          <AlertTriangle size={16} style={{ color: "#e06a58", flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.6 }}>
            <strong style={{ color: "var(--text-1)" }}>
              {anioActual} no tiene parámetros de: {kindsSinAnio.map((k) => KIND_LABEL[k] ?? k).join(", ")}.
            </strong>{" "}
            Las calculadoras siguen usando el valor vigente más reciente y lo dicen en pantalla, pero
            el número no es el del año en curso.
          </div>
        </div>
      )}

      {/* ── Resumen ─────────────────────────────────────────────────── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px,1fr))",
          gap: 14,
          marginBottom: 20,
        }}
      >
        <Kpi label="Filas capturadas" valor={String(initial.length)} />
        <Kpi
          label="Por verificar"
          valor={String(porVerificar)}
          tono={porVerificar > 0 ? "warning" : "success"}
        />
        <Kpi label={`Filas del catálogo ${anioSemilla}`} valor={String(resumenSemilla.total)} />
        <Kpi label="Estados con ISAI" valor={String(initial.filter((f) => f.kind === "ISAI" && f.stateCode !== "MX").length)} />
      </div>

      {initial.length === 0 && (
        <div
          style={{
            padding: "22px 18px",
            borderRadius: 10,
            border: "1px dashed var(--border-strong)",
            color: "var(--text-2)",
            fontSize: 13,
            lineHeight: 1.6,
            marginBottom: 20,
          }}
        >
          La tabla está vacía. Las tres calculadoras van a decirle al usuario qué falta en vez de
          inventarse un número. Pulsa <strong>Sembrar el catálogo {anioSemilla}</strong> para escribir
          las {resumenSemilla.total} filas de arranque — {resumenSemilla.porVerificar} nacen marcadas
          como <em>por verificar</em> y hay que confrontarlas con su fuente antes de darlas por buenas.
        </div>
      )}

      {/* ── Filtro ──────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        <ButtonNew
          size="sm"
          variant={filtroKind === "todos" ? "primary" : "ghost"}
          onClick={() => setFiltroKind("todos")}
        >
          Todos <span style={{ marginLeft: 6, opacity: 0.65 }}>{initial.length}</span>
        </ButtonNew>
        {KINDS.map((k) => {
          const n = initial.filter((f) => f.kind === k).length;
          return (
            <ButtonNew
              key={k}
              size="sm"
              variant={filtroKind === k ? "primary" : "ghost"}
              onClick={() => setFiltroKind(k)}
            >
              {KIND_LABEL[k]} <span style={{ marginLeft: 6, opacity: 0.65 }}>{n}</span>
            </ButtonNew>
          );
        })}
      </div>

      {/* ── Tabla ───────────────────────────────────────────────────── */}
      <CardNew noPad title={`Parámetros (${visibles.length})`}>
        {visibles.length === 0 ? (
          <div style={{ padding: "40px 18px", textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
            Sin parámetros en esta familia.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table-new">
              <thead>
                <tr>
                  <th>Familia</th>
                  <th>Estado</th>
                  <th>Año</th>
                  <th>Valor</th>
                  <th>Vigente desde</th>
                  <th>Estado del dato</th>
                  <th style={{ textAlign: "right" }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((f) => {
                  const verificar = f.meta?.porVerificar === true;
                  const viejo = f.year < anioActual;
                  return (
                    <tr key={f.id}>
                      <td style={{ color: "var(--text-1)", fontWeight: 500 }}>
                        {KIND_LABEL[f.kind] ?? f.kind}
                        <span style={{ display: "block", fontSize: 11, color: "var(--text-4)" }}>
                          {KIND_UNIDAD[f.kind]}
                        </span>
                      </td>
                      <td>{stateName(f.stateCode)}</td>
                      <td className="mono">{f.year}</td>
                      <td className="mono" style={{ color: "var(--text-1)", fontWeight: 600 }}>
                        {f.value}
                      </td>
                      <td className="mono">{f.effectiveFrom.slice(0, 10)}</td>
                      <td>
                        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                          <BadgeNew tone={verificar ? "warning" : "success"} dot>
                            {verificar ? "Por verificar" : "Verificado"}
                          </BadgeNew>
                          {viejo && <BadgeNew tone="neutral">De {f.year}</BadgeNew>}
                        </div>
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                          <ButtonNew
                            size="sm"
                            variant="ghost"
                            icon={<Pencil size={13} />}
                            onClick={() => setEditando(f)}
                          >
                            Editar
                          </ButtonNew>
                          <ButtonNew
                            size="sm"
                            icon={<Trash2 size={13} />}
                            onClick={() => borrar(f)}
                            variant="danger"
                          >
                            Borrar
                          </ButtonNew>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardNew>

      {editando && (
        <ModalEditar
          fila={editando}
          pendiente={pendiente}
          onCerrar={() => setEditando(null)}
          onGuardar={(payload) => correr(() => guardarAccion(payload))}
        />
      )}
    </div>
  );
}

function Kpi({ label, valor, tono }: { label: string; valor: string; tono?: "warning" | "success" }) {
  return (
    <div
      style={{
        padding: "14px 16px",
        borderRadius: 10,
        border: "1px solid var(--border-soft)",
        background: "var(--bg-elev)",
      }}
    >
      <div style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </div>
      <div
        style={{
          marginTop: 4,
          fontSize: 20,
          fontWeight: 600,
          color: tono === "warning" ? "#d8a13a" : "var(--text-1)",
        }}
      >
        {valor}
      </div>
    </div>
  );
}

function ModalEditar({
  fila,
  pendiente,
  onCerrar,
  onGuardar,
}: {
  fila: Fila;
  pendiente: boolean;
  onCerrar: () => void;
  onGuardar: (p: {
    id?: string | null;
    kind: string;
    stateCode: string;
    year: number;
    value: number;
    effectiveFrom: string;
    metaJson: string;
  }) => void;
}) {
  const [kind, setKind] = useState(fila.kind);
  const [stateCode, setStateCode] = useState(fila.stateCode);
  const [year, setYear] = useState(String(fila.year));
  const [value, setValue] = useState(String(fila.value));
  const [desde, setDesde] = useState(fila.effectiveFrom.slice(0, 10));
  const [metaJson, setMetaJson] = useState(JSON.stringify(fila.meta ?? {}, null, 2));

  // Escape cierra, igual que en el resto de los modales del repo. Sin esto,
  // la única salida era pulsar el fondo o el aspa.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCerrar();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCerrar]);

  const jsonValido = useMemo(() => {
    try {
      const p = JSON.parse(metaJson || "{}");
      return !!p && typeof p === "object" && !Array.isArray(p);
    } catch {
      return false;
    }
  }, [metaJson]);

  return (
    <div className="modal-overlay" onClick={onCerrar}>
      <div
        className="modal modal--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="param-modal-titulo"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__header">
          <div className="modal__title" id="param-modal-titulo">
            {fila.id ? "Editar parámetro" : "Nuevo parámetro"}
          </div>
          <button
            type="button"
            onClick={onCerrar}
            className="btn-new btn-new--ghost btn-new--sm"
            aria-label="Cerrar"
          >
            <X size={14} />
          </button>
        </div>

        <div className="modal__body">
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="field-new">
                <label className="field-new__label" htmlFor="param-kind">
                  Familia
                </label>
                <select
                  id="param-kind"
                  className="input-new"
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                >
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABEL[k]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-new">
                <label className="field-new__label" htmlFor="param-estado">
                  Estado
                </label>
                <select
                  id="param-estado"
                  className="input-new"
                  value={stateCode}
                  onChange={(e) => setStateCode(e.target.value)}
                >
                  <option value={FEDERAL_STATE_CODE}>Federal (MX)</option>
                  {MX_STATES.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <div className="field-new">
                <label className="field-new__label" htmlFor="param-anio">
                  Año <span className="req">*</span>
                </label>
                <input
                  id="param-anio"
                  type="number"
                  className="input-new"
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                />
              </div>
              <div className="field-new">
                <label className="field-new__label" htmlFor="param-valor">
                  Valor <span className="req">*</span>
                </label>
                <input
                  id="param-valor"
                  type="number"
                  step="0.000001"
                  className="input-new"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
              </div>
              <div className="field-new">
                <label className="field-new__label" htmlFor="param-desde">
                  Vigente desde <span className="req">*</span>
                </label>
                <input
                  id="param-desde"
                  type="date"
                  className="input-new"
                  value={desde}
                  onChange={(e) => setDesde(e.target.value)}
                />
              </div>
            </div>

            <p style={{ margin: 0, fontSize: 11.5, color: "var(--text-3)", lineHeight: 1.55 }}>
              El valor se lee en <strong>{KIND_UNIDAD[kind]}</strong>. La fecha de vigencia forma
              parte de la llave única, así que un valor nuevo del mismo año se captura con una fecha
              distinta y los dos conviven: las operaciones viejas se siguen recalculando con el que
              estaba vigente ese día.
            </p>

            <div className="field-new">
              <label className="field-new__label" htmlFor="param-meta">
                Detalle (JSON)
              </label>
              <textarea
                id="param-meta"
                className="input-new"
                spellCheck={false}
                aria-invalid={!jsonValido}
                value={metaJson}
                onChange={(e) => setMetaJson(e.target.value)}
                style={{
                  height: 240,
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  fontSize: 11.5,
                  lineHeight: 1.6,
                  padding: 10,
                  resize: "vertical",
                }}
              />
              {!jsonValido && (
                <span role="alert" style={{ fontSize: 11.5, color: "var(--danger)" }}>
                  El JSON no es válido: revisa comillas y comas.
                </span>
              )}
              <span style={{ fontSize: 11.5, color: "var(--text-3)", lineHeight: 1.5 }}>
                Aquí van los campos que no caben en una sola columna: honorarios notariales, la
                tarifa del artículo 152, el bloque bancario, el cedular del estado. Pon{" "}
                <code>&quot;porVerificar&quot;: false</code> cuando hayas confrontado el dato con su fuente
                — la calculadora deja de advertirlo y la fila pasa a verde.
              </span>
            </div>
          </div>
        </div>

        <div className="modal__footer">
          <ButtonNew variant="ghost" onClick={onCerrar}>
            Cancelar
          </ButtonNew>
          <ButtonNew
            variant="primary"
            disabled={pendiente || !jsonValido}
            onClick={() =>
              onGuardar({
                id: fila.id || null,
                kind,
                stateCode,
                year: Number(year),
                value: Number(value),
                effectiveFrom: desde,
                metaJson,
              })
            }
          >
            {pendiente ? "Guardando…" : "Guardar"}
          </ButtonNew>
        </div>
      </div>
    </div>
  );
}
