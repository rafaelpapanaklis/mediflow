"use client";

import { Fragment, useMemo, useState, type CSSProperties } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Clock,
  ExternalLink,
  Info,
  Loader2,
  MinusCircle,
  Search,
} from "lucide-react";
import type { TFunction } from "@/i18n/t";
import type {
  RealtyPortalCell,
  RealtyPortalDestinationView,
  RealtyPortalMatrix,
  RealtyPortalMatrixRow,
} from "@/lib/realty/portals";

// ═══════════════════════════════════════════════════════════════════════
// LA MATRIZ: cada inmueble contra cada destino.
//
// 🔴 POR QUÉ NO ES UN "publicado sí/no". Un inmueble puede estar VIVO en
// Trovit, CON ERROR en Meta y PENDIENTE en Mitula, todo al mismo tiempo. Un
// booleano obliga al asesor a abrir el portal uno por uno para descubrir
// cuál falló — que es exactamente el trabajo que este producto le quita.
//
// Cuatro estados por celda: publicada · pendiente · con error · no
// publicada. Y cuando hay error, se enseña el MOTIVO en la propia celda: un
// "con error" sin motivo no sirve de nada.
// ═══════════════════════════════════════════════════════════════════════

const TONES = {
  PUBLICADO: { fg: "var(--pine-700)", bg: "var(--brand-soft)", bd: "var(--border-brand)" },
  BORRADOR: { fg: "var(--text-2)", bg: "var(--bg-elev-2)", bd: "var(--border-soft)" },
  ERROR: { fg: "var(--danger)", bg: "rgba(179,38,30,0.10)", bd: "rgba(179,38,30,0.35)" },
  PAUSADO: { fg: "var(--text-3)", bg: "transparent", bd: "var(--border-soft)" },
  NINGUNO: { fg: "var(--text-4)", bg: "transparent", bd: "var(--border-soft)" },
} as const;

type CellKey = keyof typeof TONES;

function cellKey(cell: RealtyPortalCell | undefined): CellKey {
  if (!cell || !cell.status) return "NINGUNO";
  return cell.status as CellKey;
}

/**
 * Lo que hace el botón, y DESPUÉS el motivo si lo hay. El orden importa: un
 * tooltip que solo enseña el error deja al asesor sin saber qué va a pasar
 * si pulsa, que es justo cuando más falta le hace.
 */
function accionYMotivo(t: TFunction, state: CellKey, error: string | null): string {
  const accion =
    state === "PUBLICADO" || state === "BORRADOR"
      ? t("matriz.quitar")
      : state === "ERROR"
        ? t("matriz.reintentar")
        : t("matriz.publicar");
  return error ? `${accion} — ${error}` : accion;
}

function CellIcon({ state }: { state: CellKey }) {
  const size = 13;
  if (state === "PUBLICADO") return <CheckCircle2 size={size} />;
  if (state === "BORRADOR") return <Clock size={size} />;
  if (state === "ERROR") return <AlertTriangle size={size} />;
  if (state === "PAUSADO") return <MinusCircle size={size} />;
  return <Circle size={size} />;
}

export function RealtyPortalsMatrix({
  t,
  matrix,
  destinations,
  timezone,
  onToggle,
  onSearch,
}: {
  t: TFunction;
  matrix: RealtyPortalMatrix;
  destinations: RealtyPortalDestinationView[];
  timezone: string;
  onToggle: (propertyId: string, portal: string, selected: boolean) => Promise<string | null>;
  onSearch: (q: string) => void;
}) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  // Solo las columnas de los destinos ENCENDIDOS. Trece columnas apagadas
  // no informan de nada y vuelven la tabla ilegible en un portátil.
  const columns = useMemo(
    () => destinations.filter((d) => d.available && (d.active || d.configured)),
    [destinations],
  );

  const fmt = useMemo(() => {
    const opciones: Intl.DateTimeFormatOptions = {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    };
    // La zona se pasa EXPLÍCITA (viene de la cuenta) para que el HTML del
    // servidor y el del navegador digan lo mismo. Sin esto, un asesor en otra
    // zona provoca un desajuste de hidratación.
    //
    // Y en try/catch: una zona IANA inválida guardada en la cuenta hace que
    // `Intl` LANCE, y eso tumbaría la tabla entera por una fecha de cortesía.
    try {
      return new Intl.DateTimeFormat("es-MX", { ...opciones, timeZone: timezone });
    } catch {
      return new Intl.DateTimeFormat("es-MX", { ...opciones, timeZone: "UTC" });
    }
  }, [timezone]);

  async function toggle(row: RealtyPortalMatrixRow, portal: string, current: CellKey) {
    const key = `${row.propertyId}:${portal}`;
    // 🔴 Pulsar RETIRA solo lo que está publicado o pendiente. Una celda CON
    // ERROR se REINTENTA: el reflejo de cualquiera al ver un error es
    // "vuelve a intentarlo", y que en vez de eso se retirara en silencio —
    // perdiendo la elección, sin confirmación y sin deshacer — era
    // destructivo. Para retirar una que falla se pulsa dos veces: primero
    // vuelve a pendiente, luego se retira.
    const selected = current !== "PUBLICADO" && current !== "BORRADOR";
    setBusy(key);
    setError(null);
    const err = await onToggle(row.propertyId, portal, selected);
    if (err) setError(err);
    setBusy(null);
  }

  if (columns.length === 0) {
    return (
      <div style={hint}>
        <Info size={15} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>{t("destinos.subtitle")}</span>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSearch(q);
        }}
        style={{ display: "flex", gap: 8, alignItems: "center" }}
      >
        <div style={{ position: "relative", flex: 1, maxWidth: 420 }}>
          <Search
            size={14}
            style={{
              position: "absolute",
              left: 10,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--text-3)",
            }}
          />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("matriz.buscar")}
            aria-label={t("matriz.buscar")}
            style={{
              width: "100%",
              padding: "8px 12px 8px 30px",
              borderRadius: 10,
              border: "1px solid var(--border-soft)",
              background: "var(--bg-elev)",
              color: "var(--text-1)",
              fontSize: 13,
            }}
          />
        </div>
      </form>

      {error ? (
        <div role="alert" style={{ ...hint, color: "var(--danger)" }}>
          <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{error}</span>
        </div>
      ) : null}

      {matrix.rows.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--text-3)", margin: 0 }}>
          {matrix.total === 0 ? t("matriz.vacio") : t("matriz.sinResultados")}
        </p>
      ) : (
        // 🔴 El scroll horizontal vive AQUÍ, no en el body: con siete
        // destinos la tabla no cabe y la página entera no debe moverse.
        <div style={{ overflowX: "auto", border: "1px solid var(--border-soft)", borderRadius: 12 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr>
                <th style={{ ...th, position: "sticky", left: 0, background: "var(--bg-elev-2)", minWidth: 240 }}>
                  {t("matriz.inmueble")}
                </th>
                {columns.map((c) => (
                  <th key={c.key} style={{ ...th, minWidth: 132 }}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.rows.map((row) => {
                const detailOpen = open === row.propertyId;
                const hasBlockers = row.blockers.length > 0;
                return (
                  <Fragment key={row.propertyId}>
                    <tr style={{ borderTop: "1px solid var(--border-soft)" }}>
                      <td style={{ ...td, position: "sticky", left: 0, background: "var(--bg-elev)" }}>
                        <button
                          type="button"
                          onClick={() => setOpen(detailOpen ? null : row.propertyId)}
                          aria-expanded={detailOpen}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            background: "transparent",
                            border: "none",
                            padding: 0,
                            cursor: "pointer",
                            textAlign: "left",
                            fontFamily: "inherit",
                            fontSize: "inherit",
                            color: "inherit",
                            width: "100%",
                          }}
                        >
                          {row.coverUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={row.coverUrl}
                              alt=""
                              width={40}
                              height={30}
                              style={{ width: 40, height: 30, objectFit: "cover", borderRadius: 6 }}
                            />
                          ) : (
                            <span
                              style={{
                                width: 40,
                                height: 30,
                                borderRadius: 6,
                                background: "var(--bg-elev-2)",
                                display: "inline-block",
                              }}
                            />
                          )}
                          <span style={{ minWidth: 0 }}>
                            <span
                              style={{
                                display: "block",
                                fontWeight: 600,
                                color: "var(--text-1)",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                maxWidth: 200,
                              }}
                            >
                              {row.title}
                            </span>
                            <span style={{ display: "block", color: "var(--text-3)", fontSize: 11.5 }}>
                              {row.folio ? `${row.folio} · ` : ""}
                              {row.city ?? ""}
                            </span>
                          </span>
                          {hasBlockers ? (
                            <AlertTriangle
                              size={14}
                              style={{ color: "var(--danger)", marginLeft: "auto", flexShrink: 0 }}
                              aria-label={t("matriz.bloqueos")}
                            />
                          ) : null}
                        </button>
                      </td>

                      {columns.map((c) => {
                        const cell = row.cells[c.key];
                        const state = cellKey(cell);
                        const tone = TONES[state];
                        const key = `${row.propertyId}:${c.key}`;
                        const isBusy = busy === key;
                        return (
                          <td key={c.key} style={td}>
                            <button
                              type="button"
                              onClick={() => toggle(row, c.key, state)}
                              disabled={busy !== null}
                              title={accionYMotivo(t, state, cell?.error ?? null)}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 5,
                                padding: "4px 9px",
                                borderRadius: 999,
                                border: `1px solid ${tone.bd}`,
                                background: tone.bg,
                                color: tone.fg,
                                fontSize: 11.5,
                                fontWeight: 600,
                                cursor: busy !== null ? "wait" : "pointer",
                                fontFamily: "inherit",
                              }}
                            >
                              {isBusy ? (
                                <Loader2 size={13} className="animate-spin" />
                              ) : (
                                <CellIcon state={state} />
                              )}
                              {t(`matriz.estado.${state}`)}
                            </button>
                            {cell?.lastPushedAt ? (
                              <span
                                style={{
                                  display: "block",
                                  marginTop: 3,
                                  fontSize: 10.5,
                                  color: "var(--text-4)",
                                }}
                              >
                                {fmt.format(new Date(cell.lastPushedAt))}
                              </span>
                            ) : null}
                          </td>
                        );
                      })}
                    </tr>

                    {detailOpen ? (
                      <tr style={{ background: "var(--bg-elev-2)" }}>
                        <td style={{ ...td, verticalAlign: "top" }} colSpan={columns.length + 1}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {row.blockers.length > 0 ? (
                              <div>
                                <strong style={{ color: "var(--danger)", fontSize: 12 }}>
                                  {t("matriz.bloqueos")}
                                </strong>
                                <ul style={{ margin: "4px 0 0", paddingLeft: 18, color: "var(--text-2)" }}>
                                  {row.blockers.map((b) => (
                                    <li key={b}>{b}</li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}
                            {row.warnings.length > 0 ? (
                              <div>
                                <strong style={{ fontSize: 12, color: "var(--text-2)" }}>
                                  {t("matriz.avisos")}
                                </strong>
                                <ul style={{ margin: "4px 0 0", paddingLeft: 18, color: "var(--text-3)" }}>
                                  {row.warnings.map((w) => (
                                    <li key={w}>{w}</li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}
                            {columns
                              .map((c) => ({ c, cell: row.cells[c.key] }))
                              .filter((x) => x.cell?.error)
                              .map(({ c, cell }) => (
                                <div key={c.key} style={{ color: "var(--text-2)" }}>
                                  <strong style={{ fontSize: 12 }}>{c.label}: </strong>
                                  <span>{cell?.error}</span>
                                  {cell && cell.attempts > 0 ? (
                                    <span style={{ color: "var(--text-4)", marginLeft: 6 }}>
                                      {cell.nextAttemptAt
                                        ? t("matriz.reintento", {
                                            n: cell.attempts,
                                            fecha: fmt.format(new Date(cell.nextAttemptAt)),
                                          })
                                        : t("matriz.sinReintento")}
                                    </span>
                                  ) : null}
                                </div>
                              ))}
                            <a
                              href={`/inmobiliaria/inmuebles?inmueble=${encodeURIComponent(row.propertyId)}`}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 5,
                                color: "var(--brand)",
                                fontWeight: 600,
                                width: "fit-content",
                              }}
                            >
                              {t("matriz.verFicha")} <ExternalLink size={12} />
                            </a>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {matrix.truncated ? (
        <p style={{ fontSize: 12, color: "var(--text-3)", margin: 0 }}>
          {t("matriz.mas", { n: matrix.rows.length, total: matrix.total })}
        </p>
      ) : null}
    </div>
  );
}

const th: CSSProperties = {
  textAlign: "left",
  padding: "9px 12px",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "var(--text-3)",
  background: "var(--bg-elev-2)",
  whiteSpace: "nowrap",
};

const td: CSSProperties = {
  padding: "9px 12px",
  verticalAlign: "middle",
  color: "var(--text-2)",
};

const hint: CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "flex-start",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid var(--border-soft)",
  background: "var(--bg-elev-2)",
  fontSize: 12.5,
  color: "var(--text-2)",
  lineHeight: 1.5,
};
