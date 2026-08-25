"use client";

// ═══════════════════════════════════════════════════════════════════════
// LO QUE SE MONTA EN LA FICHA PÚBLICA DE UN INMUEBLE.
//
// Dos piezas, las dos autónomas: no importan nada de servidor, no navegan a
// ninguna parte y no dependen del tema del panel. La ficha pública (/i/[slug]
// /[propertyId], territorio de T5) solo tiene que renderizarlas con los
// parámetros ya cargados.
//
//   <BotonConCuantoTeAlcanza slug={cuenta.slug} rows={rows} dict={dict} />
//   <TiraEscrituracion precioCents={...} stateCode={...} rows={rows} dict={dict} />
//
// Los `rows` salen de getCalcParamRows() en el componente de servidor, o de
// GET /api/realty/calc/params si hace falta pedirlos desde el navegador.
//
// NINGUNA de las dos enlaza a una ruta que todavía no existe: el botón abre
// un modal en la misma página y la tira despliega el desglose ahí mismo. Un
// enlace a una página sin construir es peor que no tener botón.
// ═══════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from "react";
import { Calculator, ChevronDown, X } from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import { makeRealtyT } from "@/lib/realty/i18n";
import {
  REALTY_PUBLIC_BASE,
} from "@/lib/realty/types";
import { resolveEscrituracionParams, type RawCalcParamRow } from "@/lib/realty/calc/catalog";
import { calcularEscrituracion } from "@/lib/realty/calc/escrituracion";
import { fmtMXN, fmtPct } from "@/lib/realty/calc/money";
import { PrecalificadorPublico } from "./publico";

const TINTA = "#14201A";
const GRIS = "#4c5a52";
const VERDE = "#2F6B4D";

/**
 * La ruta donde vivirá el precalificador como página propia, para poder
 * mandarlo por WhatsApp suelto. La define el contrato (REALTY_PUBLIC_BASE),
 * pero la PÁGINA la monta la terminal dueña de /i/[slug]: por eso este
 * helper existe y no se usa en ningún enlace visible todavía.
 */
export function rutaCalculadoraPublica(slug: string): string {
  return `${REALTY_PUBLIC_BASE}/${slug}/calculadora`;
}

/** El texto listo para pegar en un WhatsApp, una vez que la página exista. */
export function textoWhatsAppCalculadora(baseUrl: string, slug: string, nombre: string): string {
  return `Hola, te comparto la calculadora de ${nombre} para que veas con cuánto te alcanza: ${baseUrl}${rutaCalculadoraPublica(slug)}`;
}

// ── 1. "¿Con cuánto te alcanza?" ───────────────────────────────────────

export function BotonConCuantoTeAlcanza({
  slug,
  rows,
  dict,
  ancho,
}: {
  slug: string;
  rows: RawCalcParamRow[];
  dict: Dictionary;
  ancho?: boolean;
}) {
  const t = useMemo(() => makeRealtyT(dict), [dict]);
  const [abierto, setAbierto] = useState(false);

  // Escape cierra y el fondo deja de moverse mientras está abierto. Es la
  // pieza que ve el PÚBLICO: no puede ser la menos cuidada de las dos.
  useEffect(() => {
    if (!abierto) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setAbierto(false);
    }
    const previo = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previo;
    };
  }, [abierto]);

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          width: ancho ? "100%" : undefined,
          height: 46,
          padding: "0 20px",
          borderRadius: 12,
          border: "none",
          background: VERDE,
          color: "#fff",
          fontSize: 15,
          fontWeight: 700,
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        <Calculator size={17} />
        {t("publico.cta")}
      </button>

      {abierto && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t("publico.titulo")}
          onClick={() => setAbierto(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(9, 18, 14, 0.55)",
            display: "grid",
            placeItems: "start center",
            zIndex: 1000,
            padding: "24px 16px",
            overflowY: "auto",
          }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ position: "relative", width: "100%", maxWidth: 560 }}>
            <button
              type="button"
              onClick={() => setAbierto(false)}
              aria-label="Cerrar"
              style={{
                position: "absolute",
                top: 12,
                right: 12,
                zIndex: 1,
                border: "none",
                background: "transparent",
                color: GRIS,
                cursor: "pointer",
                padding: 4,
                lineHeight: 0,
              }}
            >
              <X size={18} />
            </button>
            <PrecalificadorPublico
              slug={slug}
              dict={dict}
              rows={rows}
              onCerrar={() => setAbierto(false)}
            />
          </div>
        </div>
      )}
    </>
  );
}

// ── 2. "Además del precio, calcula unos $X de escrituración" ───────────

export function TiraEscrituracion({
  precioCents,
  stateCode,
  rows,
  dict,
}: {
  precioCents: number;
  stateCode: string;
  rows: RawCalcParamRow[];
  dict: Dictionary;
}) {
  const t = useMemo(() => makeRealtyT(dict), [dict]);
  const [abierto, setAbierto] = useState(false);

  const r = useMemo(() => {
    const p = resolveEscrituracionParams(rows, stateCode, new Date());
    if (!p.ok || !p.params) return null;
    const calc = calcularEscrituracion({ precioCents }, p.params);
    return calc.ok ? calc : null;
  }, [rows, stateCode, precioCents]);

  // Sin parámetros del estado no se pinta NADA. Un rango inventado en la
  // ficha de una casa es peor que no decir nada: el comprador lo toma por
  // bueno y la operación se cae en la notaría.
  if (!r) return null;

  return (
    <div
      style={{
        border: "1px solid #E2DCCE",
        background: "#FFFDF8",
        borderRadius: 14,
        padding: 16,
        color: TINTA,
        fontFamily: "inherit",
      }}
    >
      <div style={{ fontSize: 12.5, color: GRIS, lineHeight: 1.5 }}>
        {t("publico.escrituracionFicha")}
      </div>
      <div
        style={{
          marginTop: 4,
          fontSize: 20,
          fontWeight: 700,
          letterSpacing: "-0.02em",
          lineHeight: 1.25,
        }}
      >
        {fmtMXN(r.totalMinCents!)} — {fmtMXN(r.totalMaxCents!)}
      </div>
      <div style={{ marginTop: 3, fontSize: 12.5, color: GRIS }}>
        {fmtPct(r.totalPctMin!)} a {fmtPct(r.totalPctMax!)} {t("escrituracion.delPrecio")} ·{" "}
        {r.stateName}
      </div>

      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          marginTop: 10,
          border: "none",
          background: "transparent",
          padding: 0,
          color: VERDE,
          fontSize: 13,
          fontWeight: 700,
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        {t("publico.escrituracionVer")}
        <ChevronDown
          size={14}
          style={{ transform: abierto ? "rotate(180deg)" : "none", transition: "transform .15s" }}
        />
      </button>

      {abierto && (
        <div style={{ marginTop: 10 }}>
          {r.conceptos!.map((c) => (
            <div
              key={c.clave}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                padding: "7px 0",
                borderTop: "1px solid #EDE7DA",
                fontSize: 12.5,
              }}
            >
              <span style={{ color: GRIS, minWidth: 0 }}>{c.etiqueta}</span>
              <span style={{ fontWeight: 600, whiteSpace: "nowrap" }}>
                {c.minCents === c.maxCents
                  ? fmtMXN(c.minCents)
                  : `${fmtMXN(c.minCents)} — ${fmtMXN(c.maxCents)}`}
              </span>
            </div>
          ))}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              padding: "8px 0 0",
              borderTop: "1px solid #D9D2C2",
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            <span>{t("escrituracion.costoReal")}</span>
            <span style={{ whiteSpace: "nowrap" }}>
              {fmtMXN(r.costoRealMinCents!)} — {fmtMXN(r.costoRealMaxCents!)}
            </span>
          </div>
        </div>
      )}

      <p style={{ margin: "10px 0 0", fontSize: 11, color: "#7a857e", fontStyle: "italic", lineHeight: 1.5 }}>
        {r.leyenda}
      </p>
    </div>
  );
}
