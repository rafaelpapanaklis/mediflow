"use client";

import { useCallback, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  AlertTriangle,
  Info,
  Check,
  Copy,
  ExternalLink,
  Link2,
  Loader2,
  Lock,
  RefreshCw,
  Wallet,
} from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import { makeRealtyT } from "@/lib/realty/i18n";
import { REALTY_PORTAL_GROUP_LABELS } from "@/lib/realty/portal-adapters";
import type {
  RealtyPortalDestinationView,
  RealtyPortalMatrix,
  RealtyPortalsOverview,
} from "@/lib/realty/portals";
import { RealtyPortalsMatrix } from "@/components/realty/portals/portals-matrix";

// ═══════════════════════════════════════════════════════════════════════
// Pantalla PORTALES.
//
// Lo que tiene que dejar claro, en este orden:
//   1. Qué es el feed y cómo se le da de alta al portal.
//   2. QUIÉN PAGA QUÉ. El cliente paga su propia suscripción al portal;
//      nosotros publicamos, no regalamos anuncios. Escrito así de directo:
//      prometer lo contrario es un reclamo garantizado.
//   3. Que los tres grandes de México todavía no se pueden, y por qué.
//   4. Cuántos anuncios tiene contratados en cada portal y cuáles eligió.
//   5. Inmueble por inmueble, dónde está vivo y dónde se atoró.
//
// El diccionario llega como sub-árbol YA RECORTADO, así que makeRealtyT va
// SIN prefijo (ver src/lib/realty/i18n.ts: cruzar las dos convenciones es
// lo que pinta la llave cruda en pantalla).
// ═══════════════════════════════════════════════════════════════════════

export function RealtyPortalsScreen({
  dict,
  initialOverview,
  initialMatrix,
  timezone,
}: {
  dict: Dictionary;
  initialOverview: RealtyPortalsOverview;
  initialMatrix: RealtyPortalMatrix;
  timezone: string;
}) {
  // 🔴 useMemo, no una llamada suelta: makeT (y por tanto makeRealtyT)
  // devuelve una función NUEVA cada vez, así que un `t` sin memoizar cambia
  // de identidad en cada render. Metido en las deps de un useCallback que a
  // su vez alimenta un useEffect, eso es un bucle infinito de fetch — le pasó
  // al panel de WhatsApp del vertical contra la Graph API de Meta.
  const t = useMemo(() => makeRealtyT(dict), [dict]);
  const [overview, setOverview] = useState(initialOverview);
  const [matrix, setMatrix] = useState(initialMatrix);
  const [checking, setChecking] = useState(false);
  const [flash, setFlash] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const refreshMatrix = useCallback(async (q?: string) => {
    const url = `/api/realty/portals?vista=matriz${q ? `&q=${encodeURIComponent(q)}` : ""}`;
    const res = await fetch(url, { cache: "no-store" });
    if (res.ok) setMatrix(await res.json());
  }, []);

  const refreshOverview = useCallback(async () => {
    const res = await fetch("/api/realty/portals", { cache: "no-store" });
    if (res.ok) setOverview(await res.json());
  }, []);

  const onToggle = useCallback(
    async (propertyId: string, portal: string, selected: boolean): Promise<string | null> => {
      const res = await fetch("/api/realty/portals/listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId, portal, selected }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return typeof data.error === "string" ? data.error : t("acciones.error");
      await Promise.all([refreshMatrix(), refreshOverview()]);
      return null;
    },
    [refreshMatrix, refreshOverview, t],
  );

  async function checkNow() {
    setChecking(true);
    setFlash(null);
    try {
      const res = await fetch("/api/realty/portals/cola", { method: "POST" });
      if (!res.ok) throw new Error("cola");
      const s = await res.json();
      setFlash({
        tone: "ok",
        text: t("acciones.revisado", {
          publicados: s.published ?? 0,
          retirados: s.unpublished ?? 0,
          fallidos: (s.failed ?? 0) + (s.overQuota ?? 0),
          pendientes: s.waiting ?? 0,
        }),
      });
      await Promise.all([refreshMatrix(), refreshOverview()]);
    } catch {
      setFlash({ tone: "bad", text: t("acciones.error") });
    } finally {
      setChecking(false);
    }
  }

  const groups = ["lifull", "meta", "propia", "otros", "convenio"] as const;

  return (
    <div className="realty-page">
      <header style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text-1)", margin: 0 }}>
            {t("title")}
          </h1>
          <p style={{ fontSize: 13.5, color: "var(--text-2)", margin: "6px 0 0", lineHeight: 1.6 }}>
            {t("subtitle")}
          </p>
        </div>
        <button
          type="button"
          onClick={checkNow}
          disabled={checking}
          className="realty-btn-primary"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            padding: "9px 16px",
            fontSize: 13,
            cursor: checking ? "wait" : "pointer",
            fontFamily: "inherit",
          }}
        >
          {checking ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <RefreshCw size={14} />
          )}
          {checking ? t("acciones.revisando") : t("acciones.revisar")}
        </button>
      </header>

      {flash ? (
        <div
          role="status"
          style={{
            ...noteBox,
            borderColor: flash.tone === "ok" ? "var(--border-brand)" : "rgba(179,38,30,0.35)",
            color: flash.tone === "ok" ? "var(--text-2)" : "var(--danger)",
          }}
        >
          {flash.tone === "ok" ? <Check size={15} /> : <AlertTriangle size={15} />}
          <span>{flash.text}</span>
        </div>
      ) : null}

      {/* ── Cómo funciona ─────────────────────────────────────────────── */}
      <section style={card}>
        <h2 style={h2}>{t("comoFunciona.title")}</h2>
        <div style={steps}>
          {(["paso1", "paso2", "paso3"] as const).map((k) => (
            <div key={k}>
              <strong style={{ display: "block", fontSize: 13, color: "var(--text-1)" }}>
                {t(`comoFunciona.${k}Title`)}
              </strong>
              <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.6 }}>
                {t(`comoFunciona.${k}Body`)}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Quién paga qué. Va ARRIBA de los destinos a propósito. ────── */}
      <section style={{ ...card, borderColor: "var(--border-brand)", background: "var(--brand-softer)" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <Wallet size={18} style={{ color: "var(--brand)", flexShrink: 0, marginTop: 2 }} />
          <div>
            <h2 style={{ ...h2, marginBottom: 4 }}>{t("cobro.title")}</h2>
            <p style={{ margin: 0, fontSize: 13, color: "var(--text-2)", lineHeight: 1.65 }}>
              {t("cobro.body")}
            </p>
          </div>
        </div>
      </section>

      {/* ── La liga del feed ──────────────────────────────────────────── */}
      <section style={card}>
        <h2 style={h2}>{t("feed.title")}</h2>
        <p style={{ margin: "0 0 12px", fontSize: 12.5, color: "var(--text-3)" }}>
          {overview.publishedCount === 0
            ? t("feed.vacio")
            : overview.publishedCount === 1
              ? t("feed.publicadosUno")
              : t("feed.publicados", { n: overview.publishedCount })}
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <CopyField t={t} label={t("feed.general")} url={overview.generalFeedUrl} primary />
          {/* 🔴 Este aviso no es adorno: la liga de arriba lleva TODA la
              cartera y NO respeta el cupo. Quien le pase esta al portal que
              le vende 10 anuncios le manda 40. La liga que sí recorta está
              en la tarjeta de cada destino. */}
          <p style={{ margin: "-4px 0 0", fontSize: 11.5, color: "var(--text-3)", lineHeight: 1.5 }}>
            {t("feed.generalAyuda")}
          </p>
          <CopyField t={t} label={t("feed.meta")} url={overview.metaFeedUrl} />
          <CopyField t={t} label={t("feed.json")} url={overview.jsonFeedUrl} muted />
        </div>
        <div style={{ ...noteBox, marginTop: 12 }}>
          <Lock size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{t("feed.aviso")}</span>
        </div>
      </section>

      {/* ── Destinos ──────────────────────────────────────────────────── */}
      <section style={card}>
        <h2 style={h2}>{t("destinos.title")}</h2>
        <p style={{ margin: "0 0 14px", fontSize: 12.5, color: "var(--text-3)" }}>
          {t("destinos.subtitle")}
        </p>

        {groups.map((g) => {
          const items = overview.destinations.filter((d) => d.group === g);
          if (items.length === 0) return null;
          return (
            <div key={g} style={{ marginBottom: 18 }}>
              <div style={groupTitle}>{REALTY_PORTAL_GROUP_LABELS[g]}</div>
              {g === "convenio" ? (
                <div style={{ ...noteBox, marginBottom: 10 }}>
                  <Info size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>
                    <strong>{t("convenio.title")}. </strong>
                    {t("convenio.body")}
                  </span>
                </div>
              ) : null}
              <div style={grid}>
                {items.map((d) => (
                  <DestinationCard
                    key={d.key}
                    t={t}
                    dest={d}
                    timezone={timezone}
                    onSaved={async () => {
                      await Promise.all([refreshOverview(), refreshMatrix()]);
                    }}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </section>

      {/* ── La matriz ─────────────────────────────────────────────────── */}
      <section style={card}>
        <h2 style={h2}>{t("matriz.title")}</h2>
        <p style={{ margin: "0 0 12px", fontSize: 12.5, color: "var(--text-3)" }}>
          {t("matriz.subtitle")}
        </p>
        <RealtyPortalsMatrix
          t={t}
          matrix={matrix}
          destinations={overview.destinations}
          timezone={timezone}
          onToggle={onToggle}
          onSearch={(q) => void refreshMatrix(q)}
        />
      </section>
    </div>
  );
}

// ── Una liga con su botón de copiar ───────────────────────────────────

function CopyField({
  t,
  label,
  url,
  primary,
  muted,
  compact,
}: {
  t: ReturnType<typeof makeRealtyT>;
  label: string;
  url: string;
  primary?: boolean;
  muted?: boolean;
  /** Dentro de la tarjeta de un destino: sin el botón de abrir, más chico. */
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Sin permiso de portapapeles (o sin https en local): al menos se
      // deja seleccionada para que el asesor haga Ctrl+C. Callar el fallo y
      // no hacer nada sería lo peor: parecería que el botón está roto.
      ref.current?.select();
    }
  }

  return (
    <div>
      <label
        style={{
          display: "block",
          fontSize: 11.5,
          fontWeight: 600,
          color: muted ? "var(--text-3)" : "var(--text-2)",
          marginBottom: 4,
        }}
      >
        {label}
      </label>
      <div style={{ display: "flex", gap: 6, alignItems: "stretch" }}>
        <input
          ref={ref}
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          aria-label={label}
          style={{
            flex: 1,
            minWidth: 0,
            padding: "8px 10px",
            borderRadius: 9,
            border: `1px solid ${primary ? "var(--border-brand)" : "var(--border-soft)"}`,
            background: primary ? "var(--brand-softer)" : "var(--bg-elev-2)",
            color: muted ? "var(--text-3)" : "var(--text-1)",
            fontSize: 12,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          }}
        />
        <button type="button" onClick={copy} style={ghostBtn} aria-live="polite">
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? t("feed.copiado") : t("feed.copiar")}
        </button>
        {compact ? null : (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ ...ghostBtn, textDecoration: "none" }}
          >
            <ExternalLink size={13} />
            {t("feed.abrir")}
          </a>
        )}
      </div>
    </div>
  );
}

// ── Tarjeta de un destino ─────────────────────────────────────────────

function DestinationCard({
  t,
  dest,
  timezone,
  onSaved,
}: {
  t: ReturnType<typeof makeRealtyT>;
  dest: RealtyPortalDestinationView;
  timezone: string;
  onSaved: () => Promise<void>;
}) {
  const maxId = useId();
  const [max, setMax] = useState(String(dest.slots.max || 0));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(patch: { active?: boolean; maxListings?: number }) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/realty/portals/destinos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ portal: dest.key, ...patch }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : t("acciones.error"));
        return;
      }
      await onSaved();
    } catch {
      setError(t("acciones.error"));
    } finally {
      setSaving(false);
    }
  }

  // Una zona IANA inválida guardada en la cuenta hace que Intl LANCE, y eso
  // tumbaría el render entero de la pantalla por una fecha de cortesía.
  const lastCheck = dest.lastPushedAt ? formatoSeguro(dest.lastPushedAt, timezone) : null;

  return (
    <div
      style={{
        border: `1px solid ${dest.active ? "var(--border-brand)" : "var(--border-soft)"}`,
        borderRadius: 12,
        padding: 14,
        background: dest.available ? "var(--bg-elev)" : "var(--bg-elev-2)",
        opacity: dest.available ? 1 : 0.75,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong style={{ fontSize: 13.5, color: "var(--text-1)" }}>{dest.label}</strong>
          <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--text-3)", lineHeight: 1.55 }}>
            {dest.help}
          </p>
        </div>
        {dest.available ? (
          <span
            style={{
              ...chip,
              color: dest.active ? "var(--pine-700)" : "var(--text-3)",
              background: dest.active ? "var(--brand-soft)" : "transparent",
              borderColor: dest.active ? "var(--border-brand)" : "var(--border-soft)",
            }}
          >
            {dest.active ? t("destinos.encendido") : t("destinos.apagado")}
          </span>
        ) : (
          <span style={{ ...chip, color: "var(--text-3)" }}>{t("destinos.noDisponible")}</span>
        )}
      </div>

      {!dest.available ? (
        <p style={{ margin: 0, fontSize: 12, color: "var(--text-2)", lineHeight: 1.55 }}>
          {dest.unavailableReason}
        </p>
      ) : (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            <span style={{ ...chip, color: "var(--text-2)" }}>
              {dest.slots.unlimited
                ? t("destinos.sinLimite")
                : dest.slots.used > dest.slots.max
                  ? // "10 de 5 usados" no significa nada. Cuando bajaron el
                    // cupo después de elegir, se dice qué pasó de verdad.
                    t("destinos.cupoExcedido", {
                      usados: dest.slots.used,
                      max: dest.slots.max,
                      sobrantes: dest.slots.used - dest.slots.max,
                    })
                  : t("destinos.cupo", { usados: dest.slots.used, max: dest.slots.max })}
            </span>
            {dest.slots.full ? (
              <span style={{ ...chip, color: "var(--danger)", borderColor: "rgba(179,38,30,0.35)" }}>
                {t("destinos.cupoLleno")}
              </span>
            ) : dest.slots.remaining !== null ? (
              <span style={{ ...chip, color: "var(--text-3)" }}>
                {dest.slots.remaining === 1
                  ? t("destinos.quedaUno")
                  : t("destinos.quedan", { n: dest.slots.remaining })}
              </span>
            ) : null}
            {dest.counts.ERROR > 0 ? (
              <span style={{ ...chip, color: "var(--danger)", borderColor: "rgba(179,38,30,0.35)" }}>
                {dest.counts.ERROR} · {t("matriz.estado.ERROR")}
              </span>
            ) : null}
            <span style={{ ...chip, color: "var(--text-4)" }}>
              {dest.paidBySubscriber ? t("destinos.dePaga") : t("destinos.sinPagar")}
            </span>
          </div>

          <div style={{ fontSize: 11.5, color: "var(--text-3)" }}>
            <label htmlFor={maxId}>{t("destinos.anuncios")}</label>
            <span style={{ display: "flex", gap: 6, marginTop: 4 }}>
              <input
                id={maxId}
                type="number"
                min={0}
                inputMode="numeric"
                value={max}
                onChange={(e) => setMax(e.target.value)}
                style={{
                  width: 84,
                  padding: "6px 8px",
                  borderRadius: 8,
                  border: "1px solid var(--border-soft)",
                  background: "var(--bg-elev)",
                  color: "var(--text-1)",
                  fontSize: 12.5,
                }}
              />
              <button
                type="button"
                disabled={saving}
                onClick={() => save({ maxListings: Number(max) || 0 })}
                style={ghostBtn}
              >
                {saving ? <Loader2 size={13} className="animate-spin" /> : null}
                {saving ? t("destinos.guardando") : t("destinos.guardar")}
              </button>
            </span>
            <span style={{ display: "block", marginTop: 4, color: "var(--text-4)", fontSize: 11 }}>
              {t("destinos.anunciosAyuda")}
            </span>
          </div>

          {/* 🔴 LA LIGA DE ESTE DESTINO, con su propio botón de copiar.
              Antes solo estaba la liga GENERAL (que lleva TODA la cartera) y
              esta era un ancla chiquita sin copiar: el asesor copiaba la
              general, se la daba al portal y el portal recibía los 40
              inmuebles aunque solo tuviera 10 contratados. Todo el trabajo
              del cupo no mordía por la ruta que el producto enseñaba. */}
          {dest.feedUrl ? (
            <CopyField t={t} label={t("destinos.ligaPortal")} url={dest.feedUrl} compact />
          ) : null}

          <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 2 }}>
            <button
              type="button"
              disabled={saving}
              onClick={() => save({ active: !dest.active })}
              style={ghostBtn}
            >
              {dest.active ? t("destinos.apagar") : t("destinos.encender")}
            </button>
            <span style={{ fontSize: 11, color: "var(--text-4)" }}>
              {lastCheck ? t("destinos.ultimaRevision", { fecha: lastCheck }) : t("destinos.nunca")}
            </span>
          </div>
        </>
      )}

      {error ? (
        <p role="alert" style={{ margin: 0, fontSize: 12, color: "var(--danger)" }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Fecha corta en la zona de la cuenta; si la zona es basura, cae a UTC. */
export function formatoSeguro(iso: string, timezone: string): string {
  const opciones: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  };
  try {
    return new Intl.DateTimeFormat("es-MX", { ...opciones, timeZone: timezone }).format(
      new Date(iso),
    );
  } catch {
    try {
      return new Intl.DateTimeFormat("es-MX", { ...opciones, timeZone: "UTC" }).format(
        new Date(iso),
      );
    } catch {
      return "";
    }
  }
}

// ── Estilos ───────────────────────────────────────────────────────────
// Medidas en px, no rem: la raíz del panel mide 13px y un rem no vale 16.

const card: CSSProperties = {
  background: "var(--bg-elev)",
  border: "1px solid var(--border-soft)",
  borderRadius: 14,
  padding: "clamp(14px, 2vw, 20px)",
  boxShadow: "var(--shadow-1)",
};

const h2: CSSProperties = {
  fontSize: 15,
  fontWeight: 700,
  color: "var(--text-1)",
  margin: "0 0 8px",
};

const steps: CSSProperties = {
  display: "grid",
  gap: 14,
  gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
};

const grid: CSSProperties = {
  display: "grid",
  gap: 10,
  gridTemplateColumns: "repeat(auto-fill, minmax(268px, 1fr))",
};

const groupTitle: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--text-3)",
  marginBottom: 8,
};

const chip: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "3px 9px",
  borderRadius: 999,
  border: "1px solid var(--border-soft)",
  fontSize: 11,
  fontWeight: 600,
  whiteSpace: "nowrap",
};

const ghostBtn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  padding: "7px 11px",
  borderRadius: 9,
  border: "1px solid var(--border-soft)",
  background: "var(--bg-elev)",
  color: "var(--text-2)",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
  whiteSpace: "nowrap",
};

const noteBox: CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "flex-start",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid var(--border-soft)",
  background: "var(--bg-elev-2)",
  fontSize: 12.5,
  color: "var(--text-2)",
  lineHeight: 1.55,
};
