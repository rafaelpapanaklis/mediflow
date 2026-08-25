"use client";

// ═══════════════════════════════════════════════════════════════════════
// Calculadora de GASTOS DE ESCRITURACIÓN.
//
// Recálculo en vivo con useMemo sobre estado en string: sin debounce (el
// cálculo es síncrono y cuesta menos que el propio evento de teclado) y sin
// fetch (la aritmética es pura y los parámetros ya viajaron con la página).
// ═══════════════════════════════════════════════════════════════════════
import { useMemo, useState } from "react";
import type { TFunction } from "@/i18n/t";
import {
  MX_STATES,
  resolveEscrituracionParams,
  type RawCalcParamRow,
} from "@/lib/realty/calc/catalog";
import { calcularEscrituracion } from "@/lib/realty/calc/escrituracion";
import { fmtMXN, fmtPct, parseMoneyInput } from "@/lib/realty/calc/money";
import { AccionesResultado, type AccionesTextos } from "./acciones";
import {
  Campo,
  CifraGrande,
  Faltantes,
  FilaDesglose,
  InputDinero,
  Leyenda,
  Nota,
  Rejilla,
  Selector,
  Tarjeta,
} from "./ui";

export function EscrituracionCalc({
  rows,
  t,
  acciones,
  estadoInicial,
}: {
  rows: RawCalcParamRow[];
  t: TFunction;
  acciones: AccionesTextos;
  estadoInicial: string;
}) {
  const [estado, setEstado] = useState(estadoInicial);
  const [precio, setPrecio] = useState("2000000");
  const [catastral, setCatastral] = useState("");
  const [avaluo, setAvaluo] = useState("");

  const resuelto = useMemo(
    () => resolveEscrituracionParams(rows, estado, new Date()),
    [rows, estado],
  );

  const r = useMemo(() => {
    if (!resuelto.ok || !resuelto.params) return null;
    const p = parseMoneyInput(precio);
    if (p === null || p <= 0) return null;
    return calcularEscrituracion(
      {
        precioCents: p,
        valorCatastralCents: parseMoneyInput(catastral),
        avaluoCents: parseMoneyInput(avaluo),
      },
      resuelto.params,
    );
  }, [resuelto, precio, catastral, avaluo]);

  const textoCompartible = useMemo(() => {
    if (!r || !r.ok) return "";
    const lineas = [
      `Gastos de escrituración — ${r.stateName}`,
      "",
      ...r.conceptos!.map(
        (c) =>
          `• ${c.etiqueta}: ${
            c.minCents === c.maxCents ? fmtMXN(c.minCents) : `${fmtMXN(c.minCents)} a ${fmtMXN(c.maxCents)}`
          }`,
      ),
      "",
      `TOTAL: ${fmtMXN(r.totalMinCents!)} a ${fmtMXN(r.totalMaxCents!)} (${fmtPct(r.totalPctMin!)} a ${fmtPct(r.totalPctMax!)} del precio)`,
      `Precio + gastos: ${fmtMXN(r.costoRealMinCents!)} a ${fmtMXN(r.costoRealMaxCents!)}`,
      "",
      r.leyenda!,
    ];
    return lineas.join("\n");
  }, [r]);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Tarjeta titulo={t("escrituracion.title")} sub={t("escrituracion.intro")}>
        <div style={{ display: "grid", gap: 14 }}>
          <Rejilla>
            <Campo label={t("escrituracion.precio")} htmlFor="esc-precio">
              <InputDinero id="esc-precio" value={precio} onChange={setPrecio} placeholder="2000000" />
            </Campo>
            <Campo label={t("common.estado")} htmlFor="esc-estado">
              <Selector
                id="esc-estado"
                value={estado}
                onChange={setEstado}
                options={MX_STATES.map((s) => ({ value: s.code, label: s.name }))}
              />
            </Campo>
          </Rejilla>
          <Rejilla>
            <Campo
              label={`${t("escrituracion.catastral")} (${t("common.opcional")})`}
              htmlFor="esc-catastral"
            >
              <InputDinero id="esc-catastral" value={catastral} onChange={setCatastral} />
            </Campo>
            <Campo
              label={`${t("escrituracion.avaluo")} (${t("common.opcional")})`}
              htmlFor="esc-avaluo"
              hint={t("escrituracion.baseAyuda")}
            >
              <InputDinero id="esc-avaluo" value={avaluo} onChange={setAvaluo} />
            </Campo>
          </Rejilla>
        </div>
      </Tarjeta>

      {!resuelto.ok && (
        <Faltantes
          faltantes={resuelto.faltantes}
          titulo={t("faltantes.title")}
          cuerpo={t("faltantes.body")}
        />
      )}

      {resuelto.ok && !r && <Nota>{t("common.sinDatos")}</Nota>}

      {r && r.ok && (
        <Tarjeta titulo={t("common.resultado")} padded>
          <div style={{ display: "grid", gap: 16 }}>
            <Rejilla min={240}>
              <CifraGrande
                label={t("escrituracion.totalTitulo")}
                valor={`${fmtMXN(r.totalMinCents!)} a ${fmtMXN(r.totalMaxCents!)}`}
                sub={`${fmtPct(r.totalPctMin!)} a ${fmtPct(r.totalPctMax!)} ${t("escrituracion.delPrecio")}`}
                destacado
              />
              <CifraGrande
                label={t("escrituracion.costoReal")}
                valor={`${fmtMXN(r.costoRealMinCents!)} a ${fmtMXN(r.costoRealMaxCents!)}`}
                sub={`${t("escrituracion.base")}: ${fmtMXN(r.baseGravableCents!)}`}
              />
            </Rejilla>

            {r.baseAdvertencia && <Nota tono="aviso">{r.baseAdvertencia}</Nota>}
            {resuelto.avisos.map((a, i) => (
              <Nota key={i} tono="aviso">
                {a}
              </Nota>
            ))}

            <div>
              <h4
                style={{
                  margin: "0 0 4px",
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: "var(--text-3)",
                  fontWeight: 700,
                }}
              >
                {t("common.desglose")}
              </h4>
              {r.conceptos!.map((c) => (
                <FilaDesglose
                  key={c.clave}
                  etiqueta={c.etiqueta}
                  explicacion={c.explicacion}
                  valor={
                    c.minCents === c.maxCents
                      ? fmtMXN(c.minCents)
                      : `${fmtMXN(c.minCents)} — ${fmtMXN(c.maxCents)}`
                  }
                />
              ))}
              <FilaDesglose
                etiqueta={t("common.total")}
                valor={`${fmtMXN(r.totalMinCents!)} — ${fmtMXN(r.totalMaxCents!)}`}
                fuerte
              />
            </div>

            <AccionesResultado
              texto={textoCompartible}
              titulo={`escrituracion-${r.stateName}`}
              pdf={{ tipo: "escrituracion", estado, precio, catastral, avaluo }}
              textos={acciones}
            />
            <Leyenda texto={r.leyenda!} />
          </div>
        </Tarjeta>
      )}
    </div>
  );
}
