"use client";

// ═══════════════════════════════════════════════════════════════════════
// /inmobiliaria/socios — el panel del SOCIO (espejo del de barber).
//
// Quien recomienda DaleControl Inmuebles y la cuenta referida PAGA, gana
// comisión. El "y paga" no es un detalle: la comisión se devenga al PAGAR,
// no al registrarse. Un programa que paga por registros paga por cuentas
// falsas, y el que las hace es el mismo que cobra.
//
// LO QUE ESTA PANTALLA SEPARA A PROPÓSITO — "por liberar" vs. "disponible":
//   · POR LIBERAR = ya se devengó, pero la mensualidad todavía puede
//     reembolsarse. Enseñarla como disponible sería prometer dinero que
//     puede desaparecer.
//   · DISPONIBLE  = pasó el periodo de reembolso. Ese sí se paga.
// Juntarlas en un solo número es la forma más rápida de tener una discusión
// con un socio, y el socio siempre tiene razón cuando el número cambió
// después de que se lo enseñaste.
//
// El monto de la comisión y la ventana de atribución NO se editan aquí: los
// pone el admin (RealtyAffiliateConfig) y aquí se LEEN. Un socio que se
// pueda subir su propio porcentaje no es un programa de socios.
// ═══════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";
import { Handshake, Link2, Wallet } from "lucide-react";
import {
  REALTY_COMMISSION_STATUS_LABELS,
  type RealtyAffiliateSummaryDTO,
} from "./growth-shared";
import { makeRealtyT } from "@/lib/realty/i18n";
import type { Dictionary } from "@/i18n/t";
import {
  Aviso,
  Boton,
  BotonCopiar,
  Campo,
  Cifra,
  Encabezado,
  Rejilla,
  TablaScroll,
  Tarjeta,
  Vacio,
  apiJson,
  areaBase,
  fechaCorta,
  pesos,
  td,
  th,
} from "./growth-ui";

export function RealtySociosScreen({
  dict,
  timeZone,
}: {
  dict: Dictionary;
  timeZone: string;
}) {
  // Convención B: sub-árbol ya recortado → prefijo VACÍO. `t` es nueva por
  // render y NUNCA va en las deps de un efecto.
  const t = makeRealtyT(dict);

  const [resumen, setResumen] = useState<RealtyAffiliateSummaryDTO | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nota, setNota] = useState<string | null>(null);
  const [generando, setGenerando] = useState(false);
  const [pago, setPago] = useState("");
  const [guardandoPago, setGuardandoPago] = useState(false);

  const recargar = useCallback(async () => {
    const r = await apiJson<{ summary: RealtyAffiliateSummaryDTO }>("/api/realty/affiliates");
    if (r.ok && r.data?.summary) {
      setResumen(r.data.summary);
      setPago(r.data.summary.payoutInfo ?? "");
      setError(null);
    } else {
      setError(r.error ?? null);
    }
    setCargando(false);
  }, []);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  useEffect(() => {
    if (!nota) return undefined;
    const id = setTimeout(() => setNota(null), 3000);
    return () => clearTimeout(id);
  }, [nota]);

  if (cargando) {
    return (
      <div className="realty-page">
        <Encabezado titulo={t("socios.title")} sub={t("socios.subtitle")} />
        <Vacio texto={t("comun.cargando")} />
      </div>
    );
  }

  if (!resumen) {
    return (
      <div className="realty-page">
        <Encabezado titulo={t("socios.title")} sub={t("socios.subtitle")} />
        <Aviso tono="malo">{error ?? t("errores.generico")}</Aviso>
      </div>
    );
  }

  const cfg = resumen.config;

  return (
    <div className="realty-page">
      <Encabezado titulo={t("socios.title")} sub={t("socios.subtitle")} />

      {!resumen.storageReady && <Aviso tono="alerta">{t("errores.faltaSql")}</Aviso>}
      {!cfg.enabled && <Aviso tono="alerta">{t("socios.apagado")}</Aviso>}
      {error && <Aviso tono="malo">{error}</Aviso>}
      {nota && <Aviso tono="bueno">{nota}</Aviso>}
      {resumen.status === "SUSPENDIDO" && <Aviso tono="malo">{t("socios.codigo.suspendido")}</Aviso>}

      {/* ── Alta o liga ───────────────────────────────────────────────── */}
      {!resumen.code ? (
        <Tarjeta titulo={t("socios.alta.title")} sub={t("socios.alta.sub")}>
          <Boton
            tono="primario"
            disabled={generando || !cfg.enabled || !resumen.storageReady}
            onClick={async () => {
              setGenerando(true);
              setError(null);
              const r = await apiJson("/api/realty/affiliates", { method: "POST" });
              setGenerando(false);
              if (!r.ok) {
                setError(r.error ?? t("errores.red"));
                return;
              }
              await recargar();
            }}
          >
            <Handshake size={14} aria-hidden="true" />
            {generando ? t("socios.alta.generando") : t("socios.alta.boton")}
          </Boton>
        </Tarjeta>
      ) : (
        <Tarjeta
          titulo={t("socios.codigo.title")}
          sub={t("socios.codigo.sub", { dias: cfg.cookieDays })}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
            <div style={{ display: "flex", gap: 11, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 11.5, fontWeight: 650, color: "var(--text-4)" }}>
                {t("socios.codigo.codigoLabel")}
              </span>
              <code
                style={{
                  padding: "7px 13px",
                  borderRadius: 9,
                  background: "var(--brand-soft)",
                  border: "1px solid var(--border-brand)",
                  color: "var(--brand)",
                  fontSize: 16,
                  fontWeight: 800,
                  letterSpacing: "0.12em",
                }}
              >
                {resumen.code}
              </code>
              <BotonCopiar
                texto={resumen.code}
                label={t("comun.copiar")}
                labelOk={t("comun.copiado")}
              />
            </div>

            {resumen.link && (
              <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
                <Link2 size={14} style={{ color: "var(--text-4)" }} aria-hidden="true" />
                <span
                  style={{
                    fontSize: 12.5,
                    color: "var(--text-2)",
                    wordBreak: "break-all",
                    minWidth: 0,
                  }}
                >
                  {resumen.link}
                </span>
                <BotonCopiar
                  texto={resumen.link}
                  label={t("comun.copiar")}
                  labelOk={t("comun.copiado")}
                />
              </div>
            )}
          </div>
        </Tarjeta>
      )}

      {/* ── Condiciones (las pone el admin; aquí se LEEN) ──────────────── */}
      <Tarjeta titulo={t("socios.condiciones.title")}>
        <Rejilla min={165}>
          <Cifra label={t("socios.condiciones.comision")} valor={`${cfg.commissionPct}%`} />
          <Cifra
            label={t("socios.condiciones.duracion")}
            valor={
              cfg.commissionMonths < 0
                ? t("socios.condiciones.duracionSiempre")
                : t("socios.condiciones.duracionMeses", { n: cfg.commissionMonths })
            }
          />
          <Cifra label={t("socios.condiciones.minimo")} valor={pesos(cfg.payoutMinMxn)} />
          <Cifra
            label={t("socios.condiciones.cookie")}
            valor={t("socios.condiciones.cookieDias", { n: cfg.cookieDays })}
          />
        </Rejilla>
        {cfg.terms && (
          <p
            style={{
              margin: "14px 0 0",
              fontSize: 12,
              color: "var(--text-3)",
              lineHeight: 1.65,
              whiteSpace: "pre-wrap",
            }}
          >
            {cfg.terms}
          </p>
        )}
      </Tarjeta>

      {/* ── Embudo y dinero ───────────────────────────────────────────── */}
      <Rejilla min={280}>
        <Tarjeta titulo={t("socios.embudo.title")}>
          <Rejilla min={110}>
            <Cifra label={t("socios.embudo.clics")} valor={String(resumen.funnel.clicks)} />
            <Cifra
              label={t("socios.embudo.registradas")}
              valor={String(resumen.funnel.referrals)}
            />
            <Cifra
              label={t("socios.embudo.pagando")}
              valor={String(resumen.funnel.paying)}
              tono={resumen.funnel.paying > 0 ? "bueno" : undefined}
            />
          </Rejilla>
        </Tarjeta>

        <Tarjeta titulo={t("socios.ganancias.title")}>
          <Rejilla min={125}>
            <Cifra
              label={t("socios.ganancias.porLiberar")}
              valor={pesos(resumen.earnings.pendingMxn)}
              hint={t("socios.ganancias.porLiberarHint")}
              tono="alerta"
            />
            <Cifra
              label={t("socios.ganancias.disponible")}
              valor={pesos(resumen.earnings.availableMxn)}
              tono="bueno"
            />
            <Cifra label={t("socios.ganancias.pagado")} valor={pesos(resumen.earnings.paidMxn)} />
            <Cifra label={t("socios.ganancias.total")} valor={pesos(resumen.earnings.totalMxn)} />
          </Rejilla>
        </Tarjeta>
      </Rejilla>

      {/* ── A dónde se le paga ────────────────────────────────────────── */}
      {resumen.code && (
        <Tarjeta titulo={t("socios.pago.title")}>
          {!resumen.payoutInfo && <Aviso tono="alerta">{t("socios.pago.sinDatos")}</Aviso>}
          <div style={{ marginTop: resumen.payoutInfo ? 0 : 13 }}>
            <Campo label={t("socios.pago.campo")} hint={t("socios.pago.hint")} htmlFor="rs-pago">
              <textarea
                id="rs-pago"
                value={pago}
                maxLength={600}
                onChange={(e) => setPago(e.target.value)}
                style={areaBase}
              />
            </Campo>
            <div style={{ marginTop: 11 }}>
              <Boton
                tono="primario"
                disabled={guardandoPago || pago === (resumen.payoutInfo ?? "")}
                onClick={async () => {
                  setGuardandoPago(true);
                  setError(null);
                  const r = await apiJson("/api/realty/affiliates", {
                    method: "PATCH",
                    json: { payoutInfo: pago },
                  });
                  setGuardandoPago(false);
                  if (!r.ok) {
                    setError(r.error ?? t("errores.red"));
                    return;
                  }
                  setNota(t("comun.guardado"));
                  await recargar();
                }}
              >
                <Wallet size={13} aria-hidden="true" />
                {guardandoPago ? t("comun.guardando") : t("comun.guardar")}
              </Boton>
            </div>
          </div>
        </Tarjeta>
      )}

      {/* ── Cuentas referidas ─────────────────────────────────────────── */}
      <Tarjeta titulo={t("socios.referidas.title")}>
        {resumen.referrals.length === 0 ? (
          <Vacio texto={t("socios.referidas.vacio")} />
        ) : (
          <TablaScroll>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
              <thead>
                <tr>
                  <th style={th}>{t("socios.referidas.cuenta")}</th>
                  <th style={th}>{t("socios.referidas.plan")}</th>
                  <th style={th}>{t("socios.referidas.estado")}</th>
                  <th style={th}>{t("socios.referidas.desde")}</th>
                  <th style={{ ...th, textAlign: "right" }}>{t("socios.referidas.ganado")}</th>
                </tr>
              </thead>
              <tbody>
                {resumen.referrals.map((r) => (
                  <tr key={r.id}>
                    <td style={{ ...td, color: "var(--text-1)", fontWeight: 600 }}>
                      {r.accountName}
                    </td>
                    <td style={td}>{r.planName ?? t("comun.ninguno")}</td>
                    <td style={td}>{t(`socios.referidas.estado${r.status}`)}</td>
                    <td style={td}>{fechaCorta(r.attributedAt, timeZone)}</td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 700, color: "var(--text-1)" }}>
                      {pesos(r.earnedMxn)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TablaScroll>
        )}
      </Tarjeta>

      {/* ── Comisiones ────────────────────────────────────────────────── */}
      <Tarjeta titulo={t("socios.comisiones.title")}>
        {resumen.commissions.length === 0 ? (
          <Vacio texto={t("socios.comisiones.vacio")} />
        ) : (
          <TablaScroll>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}>
              <thead>
                <tr>
                  <th style={th}>{t("socios.comisiones.periodo")}</th>
                  <th style={th}>{t("socios.referidas.cuenta")}</th>
                  <th style={th}>{t("socios.comisiones.base")}</th>
                  <th style={th}>{t("socios.comisiones.estado")}</th>
                  <th style={{ ...th, textAlign: "right" }}>{t("socios.comisiones.monto")}</th>
                </tr>
              </thead>
              <tbody>
                {resumen.commissions.map((c) => (
                  <tr key={c.id}>
                    <td style={td}>{c.periodMonth}</td>
                    <td style={{ ...td, color: "var(--text-1)" }}>{c.referredAccountName}</td>
                    <td style={td}>
                      {pesos(c.baseMxn)} · {c.commissionPct}%
                    </td>
                    <td style={td}>{REALTY_COMMISSION_STATUS_LABELS[c.status]}</td>
                    <td
                      style={{
                        ...td,
                        textAlign: "right",
                        fontWeight: 700,
                        color: c.status === "CANCELADA" ? "var(--text-4)" : "var(--text-1)",
                        textDecoration: c.status === "CANCELADA" ? "line-through" : "none",
                      }}
                    >
                      {pesos(c.amountMxn)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TablaScroll>
        )}
      </Tarjeta>
    </div>
  );
}
