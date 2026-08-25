"use client";

// ═══════════════════════════════════════════════════════════════════════
// Pantalla de CALCULADORAS del panel: las tres juntas más el historial.
//
// i18n — CONVENCIÓN B: el servidor manda el sub-árbol YA RECORTADO
// (calc.json → el idioma que toque) y aquí se llama a makeRealtyT SIN
// segundo argumento. Cruzar esto con la convención A es el bug que pinta
// llaves crudas en pantalla; makeRealtyT lo grita en consola en desarrollo.
// ═══════════════════════════════════════════════════════════════════════
import { useMemo, useState } from "react";
import { Calculator, FileText, History, Landmark, Receipt } from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import { makeRealtyT } from "@/lib/realty/i18n";
import type { RawCalcParamRow } from "@/lib/realty/calc/catalog";
import { Precalificador } from "./precalificador";
import { EscrituracionCalc } from "./escrituracion-calc";
import { IsrCalc } from "./isr-calc";
import type { AccionesTextos } from "./acciones";
import { Nota, Tarjeta } from "./ui";

export interface CalculoGuardado {
  id: string;
  prospecto: string;
  leadId: string;
  nota: string;
  cuando: string;
}

type TabId = "credito" | "escrituracion" | "isr" | "historial";

export function CalculadorasScreen({
  dict,
  rows,
  estadoInicial,
  historial,
}: {
  dict: Dictionary;
  rows: RawCalcParamRow[];
  estadoInicial: string;
  historial: CalculoGuardado[];
}) {
  const t = useMemo(() => makeRealtyT(dict), [dict]);
  const [tab, setTab] = useState<TabId>("credito");

  const acciones: AccionesTextos = useMemo(
    () => ({
      guardar: t("common.guardar"),
      guardando: t("common.guardando"),
      guardado: t("common.guardado"),
      compartir: t("common.compartir"),
      copiar: t("common.copiar"),
      copiado: t("common.copiado"),
      pdf: t("common.pdf"),
      generandoPdf: t("common.generandoPdf"),
      buscarTitulo: t("guardar.title"),
      buscarLabel: t("guardar.buscar"),
      sinResultados: t("guardar.sinResultados"),
      escribeAlgo: t("guardar.escribeAlgo"),
      cancelar: t("guardar.cancelar"),
      errorGenerico: t("errores.generico"),
    }),
    [t],
  );

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: "credito", label: t("tabs.credito"), icon: <Landmark size={14} /> },
    { id: "escrituracion", label: t("tabs.escrituracion"), icon: <Receipt size={14} /> },
    { id: "isr", label: t("tabs.isr"), icon: <FileText size={14} /> },
    { id: "historial", label: t("tabs.historial"), icon: <History size={14} /> },
  ];

  return (
    <div className="realty-page">
      <header>
        <h1
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            margin: 0,
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: "-0.01em",
            color: "var(--text-1)",
          }}
        >
          <Calculator size={20} style={{ color: "var(--brand)" }} />
          {t("title")}
        </h1>
        <p
          style={{
            margin: "6px 0 0",
            fontSize: 13,
            color: "var(--text-3)",
            lineHeight: 1.55,
            maxWidth: 720,
          }}
        >
          {t("subtitle")}
        </p>
      </header>

      <div role="tablist" aria-label={t("title")} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {tabs.map((x) => {
          const activo = tab === x.id;
          return (
            <button
              key={x.id}
              id={`calc-tab-${x.id}`}
              type="button"
              role="tab"
              aria-selected={activo}
              aria-controls={`calc-panel-${x.id}`}
              // Roving tabindex: en un tablist, Tab entra y sale del grupo y
              // las flechas mueven entre pestañas. Dejar las cuatro en el
              // orden de tabulación es medio patrón ARIA, que confunde más
              // que no declarar ninguno.
              tabIndex={activo ? 0 : -1}
              onKeyDown={(e) => {
                if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
                e.preventDefault();
                const i = tabs.findIndex((y) => y.id === tab);
                const siguiente =
                  e.key === "ArrowRight"
                    ? tabs[(i + 1) % tabs.length]
                    : tabs[(i - 1 + tabs.length) % tabs.length];
                setTab(siguiente.id);
                document.getElementById(`calc-tab-${siguiente.id}`)?.focus();
              }}
              onClick={() => setTab(x.id)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                height: 36,
                padding: "0 14px",
                borderRadius: 999,
                fontSize: 12.5,
                fontWeight: activo ? 700 : 600,
                cursor: "pointer",
                fontFamily: "inherit",
                border: `1px solid ${activo ? "transparent" : "var(--border-soft)"}`,
                background: activo ? "var(--pine-700, #27543E)" : "var(--bg-elev)",
                color: activo ? "#fff" : "var(--text-2)",
              }}
            >
              {x.icon}
              {x.label}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={`calc-panel-${tab}`} aria-labelledby={`calc-tab-${tab}`}>
      {tab === "credito" && <Precalificador rows={rows} t={t} acciones={acciones} />}
      {tab === "escrituracion" && (
        <EscrituracionCalc rows={rows} t={t} acciones={acciones} estadoInicial={estadoInicial} />
      )}
      {tab === "isr" && (
        <IsrCalc rows={rows} t={t} acciones={acciones} estadoInicial={estadoInicial} />
      )}
      {tab === "historial" && (
        <Tarjeta titulo={t("historial.title")} sub={t("historial.body")}>
          {historial.length === 0 ? (
            <Nota>{t("historial.vacio")}</Nota>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {historial.map((h) => (
                <article
                  key={h.id}
                  style={{
                    padding: "12px 14px",
                    borderRadius: 12,
                    border: "1px solid var(--border-soft)",
                    background: "var(--bg-elev-2)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      justifyContent: "space-between",
                      gap: 12,
                      flexWrap: "wrap",
                    }}
                  >
                    <strong style={{ fontSize: 13, color: "var(--text-1)" }}>{h.prospecto}</strong>
                    <span style={{ fontSize: 11.5, color: "var(--text-4)" }}>{h.cuando}</span>
                  </div>
                  <pre
                    style={{
                      margin: "8px 0 0",
                      fontSize: 11.5,
                      color: "var(--text-2)",
                      lineHeight: 1.55,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      fontFamily: "inherit",
                    }}
                  >
                    {h.nota}
                  </pre>
                </article>
              ))}
            </div>
          )}
        </Tarjeta>
      )}
      </div>
    </div>
  );
}
