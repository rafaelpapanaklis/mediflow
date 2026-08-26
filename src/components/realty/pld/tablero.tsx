"use client";

// ═══════════════════════════════════════════════════════════════════════
// EL TABLERO. Lo que hay que atender hoy, y los umbrales con los que se
// está comparando.
//
// 🔴 LOS CONTADORES SON BOTONES. Un tablero que solo cuenta obliga a
// buscar a mano lo que acaba de señalar: cada tarjeta salta a su pestaña
// ya filtrada.
//
// 🔴 NINGÚN NÚMERO DE LA LEY SE PINTA SIN SU LEYENDA. Los umbrales salen
// del parámetro y llevan pegado LEYENDA_UMBRALES: son una alerta, no un
// dictamen. Y si el parámetro está marcado como no verificado, lo dice en
// ámbar, no en letra chiquita.
// ═══════════════════════════════════════════════════════════════════════
import { Tarjeta, Rejilla } from "@/components/realty/calc/ui";
import { fmtMXN, toCents } from "@/lib/realty/calc/money";
import {
  LEYENDA_ALCANCE,
  LEYENDA_EN_CEROS,
  LEYENDA_UMBRALES,
  type PantallaCumplimiento,
} from "@/lib/realty/pld/contrato";
import type { TFunction } from "@/i18n/t";
import { AvisoAmbar, Contador, LeyendaLegal, Pastilla } from "./ui";

export function Tablero({
  datos,
  t,
  onIr,
}: {
  datos: PantallaCumplimiento;
  t: TFunction;
  onIr: (pestana: string, filtro?: string) => void;
}) {
  const b = datos.tablero;
  const u = datos.umbrales;
  const corte = b.proximoCorte;

  const nada =
    b.expedientesIncompletos === 0 &&
    b.expedientesVencidos === 0 &&
    b.operacionesSinExpediente === 0 &&
    b.efectivoEnBandera === 0 &&
    b.alertas24h === 0 &&
    b.documentosPorVencer === 0;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <LeyendaLegal texto={LEYENDA_ALCANCE} fuerte />

      {/* ── Lo que hay que atender ── */}
      <Tarjeta padded>
        <Rejilla min={190}>
          <Contador
            etiqueta={t("tablero.expedientesIncompletos")}
            valor={b.expedientesIncompletos}
            tono={b.expedientesIncompletos > 0 ? "aviso" : "neutral"}
            onClick={() => onIr("expedientes", "INCOMPLETO")}
          />
          <Contador
            etiqueta={t("tablero.expedientesVencidos")}
            valor={b.expedientesVencidos}
            tono={b.expedientesVencidos > 0 ? "peligro" : "neutral"}
            onClick={() => onIr("expedientes", "VENCIDO")}
          />
          <Contador
            etiqueta={t("tablero.operacionesSinExpediente")}
            valor={b.operacionesSinExpediente}
            tono={b.operacionesSinExpediente > 0 ? "peligro" : "neutral"}
            onClick={() => onIr("operaciones", "sinExpediente")}
          />
          <Contador
            etiqueta={t("tablero.efectivoEnBandera")}
            valor={b.efectivoEnBandera}
            tono={b.efectivoEnBandera > 0 ? "peligro" : "neutral"}
            onClick={() => onIr("operaciones", "bandera")}
          />
          <Contador
            etiqueta={t("tablero.pepDetectados")}
            valor={b.pepDetectados}
            tono={b.pepDetectados > 0 ? "info" : "neutral"}
            onClick={() => onIr("expedientes", "PEP")}
          />
          <Contador
            etiqueta={t("tablero.alertas24h")}
            valor={b.alertas24h}
            tono={b.alertas24h > 0 ? "peligro" : "neutral"}
            onClick={() => onIr("operaciones", "alerta")}
          />
          <Contador
            etiqueta={t("tablero.documentosPorVencer")}
            valor={b.documentosPorVencer}
            tono={b.documentosPorVencer > 0 ? "aviso" : "neutral"}
            onClick={() => onIr("expedientes")}
          />
          <Contador
            etiqueta={t("tablero.proximoCorte")}
            valor={corte ? corte.etiqueta : t("tablero.sinCorte")}
            tono={corte?.vencido ? "peligro" : corte && corte.diasRestantes <= 7 ? "aviso" : "neutral"}
            pie={
              corte
                ? corte.diasRestantes === 0
                  ? t("calendario.hoyVence")
                  : corte.diasRestantes > 0
                    ? t("calendario.diasRestantes", { dias: corte.diasRestantes })
                    : t("calendario.diasVencido", { dias: Math.abs(corte.diasRestantes) })
                : undefined
            }
            onClick={() => onIr("calendario")}
          />
        </Rejilla>
        {nada && (
          <p style={{ margin: "12px 0 0", fontSize: 12, color: "var(--text-4)" }}>
            {t("tablero.todoEnOrden")}
          </p>
        )}
      </Tarjeta>

      {/* ── El informe en ceros: se dice SIEMPRE, no solo cuando aplica ── */}
      <AvisoAmbar>{LEYENDA_EN_CEROS}</AvisoAmbar>

      {/* ── Los umbrales con los que se compara ── */}
      {u && (
        <Tarjeta titulo={t("tablero.umbralesVigentes")} sub={`${u.year} · UMA ${fmtMXN(toCents(u.umaDiaria))}`} padded>
          <Rejilla min={200}>
            <Umbral
              etiqueta={t("tablero.umbralIdentificacion")}
              pesos={u.identificacion}
              uma={u.identificacionUma}
              vecesTexto={t("tablero.veces")}
            />
            <Umbral
              etiqueta={t("tablero.umbralAviso")}
              pesos={u.aviso}
              uma={u.avisoUma}
              vecesTexto={t("tablero.veces")}
            />
            <Umbral
              etiqueta={t("tablero.umbralEfectivo")}
              pesos={u.efectivo}
              uma={u.efectivoUma}
              vecesTexto={t("tablero.veces")}
              peligro
            />
          </Rejilla>

          <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
            {u.porVerificar && (
              <AvisoAmbar>
                <strong style={{ fontWeight: 700 }}>{t("tablero.porVerificar")}.</strong> {u.fuente}
              </AvisoAmbar>
            )}
            {datos.avisos.map((a, i) => (
              <AvisoAmbar key={i}>{a}</AvisoAmbar>
            ))}
            <LeyendaLegal texto={LEYENDA_UMBRALES} />
            {u.nota && <LeyendaLegal texto={u.nota} />}
          </div>
        </Tarjeta>
      )}
    </div>
  );
}

function Umbral({
  etiqueta,
  pesos,
  uma,
  vecesTexto,
  peligro,
}: {
  etiqueta: string;
  pesos: number;
  uma: number;
  vecesTexto: string;
  peligro?: boolean;
}) {
  return (
    <div
      style={{
        padding: "14px 16px",
        borderRadius: 12,
        background: "var(--bg-elev-2)",
        border: "1px solid var(--border-soft)",
      }}
    >
      <div style={{ fontSize: 11.5, color: "var(--text-3)", marginBottom: 5 }}>{etiqueta}</div>
      <div
        style={{
          fontSize: 19,
          fontWeight: 700,
          color: peligro ? "#b03030" : "var(--text-1)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {fmtMXN(toCents(pesos))}
      </div>
      <div style={{ marginTop: 6 }}>
        <Pastilla tono="neutral">
          {uma.toLocaleString("es-MX")} {vecesTexto}
        </Pastilla>
      </div>
    </div>
  );
}
