"use client";
// ═══════════════════════════════════════════════════════════════════════
// ESTUDIO IA — la pantalla.
//
// i18n: CONVENCIÓN B — el servidor baja el sub-árbol ya recortado y aquí se
// usa makeRealtyT(dict) SIN prefijo. Cruzar las dos convenciones aplica el
// prefijo dos veces y pinta la llave cruda.
//
// Medidas en px y no en rem: la raíz del panel mide 13px.
// ═══════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Dictionary } from "@/i18n/t";
import { makeRealtyT } from "@/lib/realty/i18n";
import { formatMicrosUsd, type StudioSpendDTO } from "@/lib/realty/studio/pricing";
import {
  REALTY_COPY_TONES,
  REALTY_REEL_TEMPLATES,
  REALTY_STAGING_STYLES,
  type RealtyCopyTone,
  type RealtyReelPlan,
  type RealtyReelTemplate,
  type RealtySocialResult,
  type RealtyStagingStyle,
  type RealtyStudioItem,
} from "@/lib/realty/studio/types";
import { formatReelDuration } from "@/lib/realty/studio/reel-plan";
import { RealtyReelComposer } from "@/components/realty/studio/reel-composer";

interface PropertyOption {
  id: string;
  title: string;
  photos: number;
}

type Tab = "reel" | "staging" | "texto" | "consumo";

export function RealtyStudioScreen({
  dict,
  properties,
}: {
  dict: Dictionary;
  properties: PropertyOption[];
}) {
  // 🔴 useMemo: makeRealtyT devuelve una función NUEVA en cada render, y si
  // entra en las dependencias de un useCallback que alimenta un useEffect,
  // el efecto se vuelve a disparar sin freno.
  const t = useMemo(() => makeRealtyT(dict), [dict]);

  const [tab, setTab] = useState<Tab>("reel");
  const [propertyId, setPropertyId] = useState(properties[0]?.id ?? "");
  const [spend, setSpend] = useState<StudioSpendDTO | null>(null);
  const [items, setItems] = useState<RealtyStudioItem[]>([]);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "err"; texto: string } | null>(null);
  const [cargando, setCargando] = useState<string | null>(null);
  // "¿Qué le he hecho ya a ESTA casa?" — la pregunta que se hace el asesor
  // cuando abre el historial. Apagado por defecto: al llegar a la pantalla
  // lo que interesa es cuánto se lleva gastado en total.
  const [soloEsteInmueble, setSoloEsteInmueble] = useState(false);

  const filtroPropertyId = soloEsteInmueble && propertyId ? propertyId : null;

  // 🔴 `filtroPropertyId` en las dependencias, y NO `t`: makeRealtyT
  // devuelve una función nueva por render y metería este useCallback (y el
  // useEffect que lo consume) en un bucle de fetch sin fondo.
  const cargarConsumo = useCallback(async () => {
    try {
      const qs = filtroPropertyId ? `?propertyId=${encodeURIComponent(filtroPropertyId)}` : "";
      const res = await fetch(`/api/realty/studio/spend${qs}`);
      if (!res.ok) return;
      const data = await res.json();
      setSpend(data?.spend ?? null);
      setItems(Array.isArray(data?.items) ? data.items : []);
    } catch {
      /* el consumo es informativo: si no carga, no se rompe nada */
    }
  }, [filtroPropertyId]);

  useEffect(() => {
    void cargarConsumo();
  }, [cargarConsumo]);

  /** El tope, dicho como se le dice a una persona. */
  const capAviso = spend?.exhausted ? t("cap.alcanzado") : spend?.nearLimit ? t("cap.cerca") : null;

  async function pedir(url: string, init?: RequestInit): Promise<any | null> {
    setAviso(null);
    try {
      const res = await fetch(url, init);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // El texto viene del servidor y ya explica el porqué real (tope,
        // falta la llave, sin fotos). Nunca se sustituye por un genérico.
        setAviso({ tipo: "err", texto: data?.error ?? t("errores.generico") });
        return null;
      }
      return data;
    } catch {
      setAviso({ tipo: "err", texto: t("errores.generico") });
      return null;
    } finally {
      void cargarConsumo();
    }
  }

  return (
    <div className="realty-page">
      <header style={{ display: "grid", gap: 4 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text-1)", margin: 0 }}>
          {t("title")}
        </h1>
        <p style={{ fontSize: 13, color: "var(--text-3)", margin: 0 }}>{t("subtitle")}</p>
      </header>

      {/* El consumo SIEMPRE a la vista: es dinero. */}
      {spend && <SpendBar spend={spend} t={t} />}
      {capAviso && (
        <p
          style={{
            margin: 0,
            padding: "10px 12px",
            borderRadius: 10,
            fontSize: 13,
            border: `1px solid ${spend?.exhausted ? "var(--danger)" : "var(--border-soft)"}`,
            color: spend?.exhausted ? "var(--danger)" : "var(--text-2)",
          }}
        >
          {capAviso}
        </p>
      )}

      <nav style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--border-soft)", flexWrap: "wrap" }}>
        {(["reel", "staging", "texto", "consumo"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            style={{
              padding: "8px 14px",
              fontSize: 13,
              fontWeight: 600,
              color: tab === k ? "var(--brand)" : "var(--text-3)",
              background: "transparent",
              border: "none",
              borderBottom: `2px solid ${tab === k ? "var(--brand)" : "transparent"}`,
              cursor: "pointer",
            }}
          >
            {t(`tabs.${k}`)}
          </button>
        ))}
      </nav>

      {properties.length === 0 ? (
        <Card>
          <p style={{ margin: 0, fontSize: 13, color: "var(--text-2)" }}>{t("sinInmuebles")}</p>
        </Card>
      ) : (
        <>
          {/* El selector va en TODAS las pestañas, la de consumo incluida:
              es el inmueble sobre el que trabaja la pantalla entera, y el
              historial se puede recortar a él. */}
          <Card>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)" }}>
                {t("inmueble")}
              </span>
              <select
                value={propertyId}
                onChange={(e) => setPropertyId(e.target.value)}
                style={{
                  padding: "8px 10px",
                  fontSize: 13,
                  borderRadius: 9,
                  border: "1px solid var(--border-soft)",
                  background: "var(--bg)",
                  color: "var(--text-1)",
                }}
              >
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title} {p.photos ? `· ${p.photos} fotos` : `· ${t("sinFotos")}`}
                  </option>
                ))}
              </select>
            </label>
          </Card>

          {aviso && (
            <p
              role="status"
              style={{
                margin: 0,
                padding: "10px 12px",
                borderRadius: 10,
                fontSize: 13,
                border: `1px solid ${aviso.tipo === "ok" ? "var(--border-brand)" : "var(--danger)"}`,
                color: aviso.tipo === "ok" ? "var(--text-1)" : "var(--danger)",
                background: aviso.tipo === "ok" ? "var(--brand-softer)" : "transparent",
              }}
            >
              {aviso.texto}
            </p>
          )}

          {tab === "reel" && (
            <ReelTab
              t={t}
              propertyId={propertyId}
              pedir={pedir}
              cargando={cargando}
              setCargando={setCargando}
            />
          )}
          {tab === "staging" && (
            <StagingTab
              t={t}
              propertyId={propertyId}
              pedir={pedir}
              cargando={cargando}
              setCargando={setCargando}
              bloqueado={spend?.exhausted === true}
              setAviso={setAviso}
            />
          )}
          {tab === "texto" && (
            <TextoTab
              t={t}
              propertyId={propertyId}
              pedir={pedir}
              cargando={cargando}
              setCargando={setCargando}
              bloqueado={spend?.exhausted === true}
            />
          )}
          {tab === "consumo" && (
            <ConsumoTab
              t={t}
              items={items}
              solo={soloEsteInmueble}
              setSolo={setSoloEsteInmueble}
              titulo={properties.find((p) => p.id === propertyId)?.title ?? ""}
            />
          )}
        </>
      )}
    </div>
  );
}

// ── Piezas ──────────────────────────────────────────────────────────────

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section
      style={{
        background: "var(--bg-elev)",
        border: "1px solid var(--border-soft)",
        borderRadius: 14,
        padding: 16,
        display: "grid",
        gap: 12,
      }}
    >
      {children}
    </section>
  );
}

function SpendBar({ spend, t }: { spend: StudioSpendDTO; t: (k: string, v?: any) => string }) {
  const pct =
    spend.capMicros > 0 ? Math.min(100, Math.round((spend.spentMicros / spend.capMicros) * 100)) : 100;
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 13, color: "var(--text-1)" }}>{t("consumo.hoy")}</strong>
        <span style={{ fontSize: 13, color: "var(--text-2)" }}>
          {formatMicrosUsd(spend.spentMicros)} / {formatMicrosUsd(spend.capMicros)}
        </span>
      </div>
      <div style={{ height: 8, borderRadius: 999, background: "var(--bg-elev-2)", overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            background: spend.exhausted ? "var(--danger)" : "var(--brand)",
          }}
        />
      </div>
      <span style={{ fontSize: 12, color: "var(--text-3)" }}>
        {t("consumo.mes", { monto: formatMicrosUsd(spend.monthMicros) })}
      </span>
    </Card>
  );
}

function ReelTab({ t, propertyId, pedir, cargando, setCargando }: any) {
  const [template, setTemplate] = useState<RealtyReelTemplate>("recorrido");
  const [plan, setPlan] = useState<RealtyReelPlan | null>(null);

  async function armar() {
    setCargando("reel");
    setPlan(null);
    const data = await pedir(
      `/api/realty/studio/reel?propertyId=${encodeURIComponent(propertyId)}&template=${template}`,
    );
    if (data?.plan) setPlan(data.plan);
    setCargando(null);
  }

  return (
    <Card>
      <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-3)" }}>{t("reel.explica")}</p>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {REALTY_REEL_TEMPLATES.map((k) => (
          <Chip key={k} activo={template === k} onClick={() => setTemplate(k)}>
            {t(`reel.plantillas.${k}`)}
          </Chip>
        ))}
      </div>
      <button type="button" onClick={armar} disabled={cargando === "reel" || !propertyId} style={btnPrimario}>
        {cargando === "reel" ? t("cargando") : t("reel.armar")}
      </button>
      {plan && (
        <>
          <p style={{ margin: 0, fontSize: 12, color: "var(--text-3)" }}>
            {t("reel.resumen", {
              escenas: plan.scenes.length,
              dur: formatReelDuration(plan.totalMs),
            })}
          </p>
          <RealtyReelComposer plan={plan} t={t} />
        </>
      )}
    </Card>
  );
}

function StagingTab({ t, propertyId, pedir, cargando, setCargando, bloqueado, setAviso }: any) {
  const [style, setStyle] = useState<RealtyStagingStyle>("moderno");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  async function generar() {
    if (!file) return;
    setCargando("staging");
    setUrl(null);
    const form = new FormData();
    form.append("propertyId", propertyId);
    form.append("style", style);
    form.append("file", file);
    const data = await pedir("/api/realty/studio/staging", { method: "POST", body: form });
    if (data?.url) {
      setUrl(data.url);
      setAviso({ tipo: "ok", texto: t("staging.listo") });
    }
    setCargando(null);
  }

  return (
    <Card>
      <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-3)" }}>{t("staging.explica")}</p>
      {/* 🔴 Se dice ANTES de generar, no después. */}
      <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-2)", fontWeight: 600 }}>
        {t("staging.avisoLegal")}
      </p>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {REALTY_STAGING_STYLES.map((k) => (
          <Chip key={k} activo={style === k} onClick={() => setStyle(k)}>
            {t(`staging.estilos.${k}`)}
          </Chip>
        ))}
      </div>
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        style={{ fontSize: 12.5, color: "var(--text-2)" }}
      />
      <button
        type="button"
        onClick={generar}
        disabled={!file || cargando === "staging" || bloqueado || !propertyId}
        style={{ ...btnPrimario, opacity: !file || bloqueado ? 0.55 : 1 }}
      >
        {cargando === "staging" ? t("staging.generando") : t("staging.generar")}
      </button>
      {url && (
        <div style={{ display: "grid", gap: 6 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={t("staging.resultado")}
            style={{ width: "100%", maxWidth: 420, borderRadius: 12, border: "1px solid var(--border-soft)" }}
          />
          <span style={{ fontSize: 12, color: "var(--text-3)" }}>{t("staging.guardada")}</span>
        </div>
      )}
    </Card>
  );
}

function TextoTab({ t, propertyId, pedir, cargando, setCargando, bloqueado }: any) {
  const [tone, setTone] = useState<RealtyCopyTone>("directo");
  const [desc, setDesc] = useState<string>("");
  const [social, setSocial] = useState<RealtySocialResult | null>(null);

  async function generar(kind: "description" | "social") {
    setCargando(kind);
    const data = await pedir("/api/realty/studio/copy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ propertyId, kind, tone }),
    });
    if (data?.kind === "description") setDesc(data.result?.text ?? "");
    if (data?.kind === "social") setSocial(data.result ?? null);
    setCargando(null);
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Card>
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-3)" }}>{t("texto.explica")}</p>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {REALTY_COPY_TONES.map((k) => (
            <Chip key={k} activo={tone === k} onClick={() => setTone(k)}>
              {t(`texto.tonos.${k}`)}
            </Chip>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => generar("description")}
            disabled={cargando != null || bloqueado || !propertyId}
            style={{ ...btnPrimario, opacity: bloqueado ? 0.55 : 1 }}
          >
            {cargando === "description" ? t("cargando") : t("texto.generarDescripcion")}
          </button>
          <button
            type="button"
            onClick={() => generar("social")}
            disabled={cargando != null || bloqueado || !propertyId}
            style={{ ...btnGhost, opacity: bloqueado ? 0.55 : 1 }}
          >
            {cargando === "social" ? t("cargando") : t("texto.generarRedes")}
          </button>
        </div>
      </Card>

      {desc && <Copiable t={t} titulo={t("texto.descripcion")} texto={desc} />}
      {social && (
        <>
          <Copiable t={t} titulo={t("texto.post")} texto={social.post} />
          {social.hashtags.length > 0 && (
            <Copiable
              t={t}
              titulo={t("texto.hashtags")}
              texto={social.hashtags.map((h) => `#${h}`).join(" ")}
            />
          )}
          {social.firstComment && (
            <Copiable t={t} titulo={t("texto.comentario")} texto={social.firstComment} />
          )}
        </>
      )}
    </div>
  );
}

function ConsumoTab({
  t,
  items,
  solo,
  setSolo,
  titulo,
}: {
  t: (k: string, v?: any) => string;
  items: RealtyStudioItem[];
  solo: boolean;
  setSolo: (v: boolean) => void;
  titulo: string;
}) {
  return (
    <Card>
      {/* El recorte por inmueble: "¿qué le he hecho ya a esta casa?" */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <Chip activo={!solo} onClick={() => setSolo(false)}>
          {t("consumo.todos")}
        </Chip>
        <Chip activo={solo} onClick={() => setSolo(true)}>
          {t("consumo.soloEste")}
        </Chip>
      </div>

      {items.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-2)" }}>
          {/* Vacío filtrado y vacío de verdad NO dicen lo mismo: "todavía no
              has generado nada" delante de un historial lleno es una mentira
              que hace pensar que se perdió algo. */}
          {solo ? t("consumo.vacioInmueble", { inmueble: titulo }) : t("consumo.vacio")}
        </p>
      ) : (
        <ul style={{ display: "grid", gap: 6, listStyle: "none", padding: 0, margin: 0 }}>
          {items.map((it) => (
            <li
              key={it.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 10,
                padding: "8px 10px",
                borderRadius: 9,
                border: "1px solid var(--border-soft)",
                fontSize: 12.5,
              }}
            >
              <span style={{ display: "grid", gap: 2 }}>
                <strong style={{ color: "var(--text-1)" }}>{t(`kinds.${it.kind}`)}</strong>
                <span style={{ color: "var(--text-3)" }}>
                  {it.propertyTitle ?? "—"}
                  {it.detail ? ` · ${it.detail}` : ""}
                </span>
              </span>
              <span style={{ color: "var(--text-2)", whiteSpace: "nowrap" }}>
                {formatMicrosUsd(it.micros)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Copiable({
  t,
  titulo,
  texto,
}: {
  t: (k: string, v?: any) => string;
  titulo: string;
  texto: string;
}) {
  const [copiado, setCopiado] = useState(false);
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
        <strong style={{ fontSize: 13, color: "var(--text-1)" }}>{titulo}</strong>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(texto);
            setCopiado(true);
            setTimeout(() => setCopiado(false), 1600);
          }}
          style={btnGhost}
        >
          {copiado ? t("copiado") : t("copiar")}
        </button>
      </div>
      <p
        style={{
          margin: 0,
          fontSize: 13,
          lineHeight: 1.55,
          color: "var(--text-2)",
          whiteSpace: "pre-wrap",
        }}
      >
        {texto}
      </p>
    </Card>
  );
}

function Chip({
  activo,
  onClick,
  children,
}: {
  activo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "6px 12px",
        fontSize: 12.5,
        fontWeight: 600,
        borderRadius: 999,
        cursor: "pointer",
        color: activo ? "#fff" : "var(--text-2)",
        background: activo ? "var(--brand)" : "transparent",
        border: `1px solid ${activo ? "var(--brand)" : "var(--border-soft)"}`,
      }}
    >
      {children}
    </button>
  );
}

const btnPrimario: React.CSSProperties = {
  padding: "9px 16px",
  fontSize: 13,
  fontWeight: 600,
  color: "#fff",
  background: "var(--brand)",
  border: "1px solid var(--brand)",
  borderRadius: 10,
  cursor: "pointer",
  justifySelf: "start",
};

const btnGhost: React.CSSProperties = {
  padding: "7px 12px",
  fontSize: 12.5,
  fontWeight: 600,
  color: "var(--text-2)",
  background: "transparent",
  border: "1px solid var(--border-soft)",
  borderRadius: 9,
  cursor: "pointer",
};
