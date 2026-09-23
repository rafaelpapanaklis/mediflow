"use client";

import { ArrowLeft, Wallet, CreditCard, Building2, Upload, X } from "lucide-react";
import type { WalletData } from "@/app/dashboard/whatsapp/bot/saldo/saldo-client";
import { useT } from "@/i18n/i18n-provider";
import { aiBillingFeatureLabel } from "@/lib/ai-billing/types";
import { fmtMXNdec, formatRelativeDate } from "@/lib/format";
import { RaizWhatsApp } from "./raiz";
import { Boton, BotonEnlace, Cabecera, Campo, Cargando, Etiqueta, Interruptor, Nota, Tarjeta } from "./piezas";
import s from "./whatsapp-rediseno.module.css";

/**
 * Todo lo que la vista necesita, tal cual lo tiene `SaldoClient`: el estado,
 * los manejadores (recarga, SPEI, recarga automática) y los TEXTOS que ya
 * vivían allí (qué significa «pausado», los montos preestablecidos, el ancla
 * de la tarjeta de recarga). Se pasan por aquí en vez de copiarlos para que
 * las dos pantallas digan lo mismo siempre. Lo traducido —qué se paga con el
 * saldo y el bloque «Recargas de saldo»— sale de i18n (`monederoIa.*`), con
 * las mismas claves en las dos pantallas.
 */
export type SaldoVM = {
  data: WalletData | null;
  loading: boolean;
  loadError: boolean;
  amountCents: number;
  setAmountCents: (v: number) => void;
  customPesos: string;
  setCustomPesos: (v: string) => void;
  payBusy: boolean;
  startCheckout: (path: string) => Promise<void>;
  speiOpen: boolean;
  setSpeiOpen: (v: boolean) => void;
  speiPesos: string;
  setSpeiPesos: (v: string) => void;
  setSpeiFile: (f: File | null) => void;
  speiBusy: boolean;
  openSpei: () => void;
  submitSpei: () => Promise<void>;
  autoOn: boolean;
  setAutoOn: (v: boolean) => void;
  thresholdPesos: string;
  setThresholdPesos: (v: string) => void;
  autoAmountPesos: string;
  setAutoAmountPesos: (v: string) => void;
  savingAuto: boolean;
  saveAuto: () => Promise<void>;
  textos: {
    presetAmountsCents: readonly number[];
    rechargeAnchor: string;
    idleConsequenceNote: string;
    idleTitle: (status: WalletData["status"]) => string;
    /** Clave i18n del tipo de recarga (recarga, abono, devolución, SPEI en revisión). */
    recargaTipoClave: (tipo: WalletData["recargas"][number]["tipo"]) => string;
    /** Clave i18n de por dónde entró el dinero; null si no aplica. */
    recargaViaClave: (via: WalletData["recargas"][number]["via"]) => string | null;
  };
};

const VOLVER = "/dashboard/whatsapp/bot";

export function SaldoRediseno({ vm }: { vm: SaldoVM }) {
  const t = useT();
  const {
    data, loading, loadError, amountCents, setAmountCents, customPesos, setCustomPesos, payBusy,
    startCheckout, speiOpen, setSpeiOpen, speiPesos, setSpeiPesos, setSpeiFile, speiBusy, openSpei,
    submitSpei, autoOn, setAutoOn, thresholdPesos, setThresholdPesos, autoAmountPesos,
    setAutoAmountPesos, savingAuto, saveAuto, textos,
  } = vm;

  if (loading) {
    return (
      <RaizWhatsApp>
        <Cargando>Cargando…</Cargando>
      </RaizWhatsApp>
    );
  }

  if (loadError || !data) {
    return (
      <RaizWhatsApp>
        <div className={s.volver}>
          <BotonEnlace href={VOLVER} variante="suave" icono={<ArrowLeft size={15} />}>
            Volver al bot
          </BotonEnlace>
        </div>
        <Tarjeta titulo="No se pudo cargar tu saldo" sub="Vuelve a intentarlo en unos momentos.">
          <Boton variante="principal" onClick={() => window.location.reload()}>
            Reintentar
          </Boton>
        </Tarjeta>
      </RaizWhatsApp>
    );
  }

  const lowThreshold = data.autoRechargeThresholdCents > 0 ? data.autoRechargeThresholdCents : 5000;
  const showLowWarning = !data.autoRecharge && data.balanceCents < lowThreshold;
  // Monedero parado = pausado o sin saldo. Es exactamente lo que hace que
  // canSpend() devuelva false y el bot no llame a la IA.
  const walletIdle = data.status !== "ACTIVE" || data.balanceCents <= 0;
  const spentCents = data.usage.reduce((acc, u) => acc + u.billedCents, 0);

  // CTA de recarga. No inventa ruta: ancla a la tarjeta «Recargar saldo» de
  // esta misma pantalla. Si quien mira no es administrador esa tarjeta no se
  // pinta, así que se le dice a quién pedirlo.
  const ctaRecarga = data.isAdmin ? (
    <div style={{ marginTop: 10 }}>
      <Boton
        icono={<Wallet size={15} />}
        onClick={() =>
          document
            .getElementById(textos.rechargeAnchor)
            // `center` en vez de un ancla #: así la barra superior fija no tapa
            // la tarjeta a la que acabamos de mandar al usuario.
            ?.scrollIntoView({ behavior: "smooth", block: "center" })
        }
      >
        Recargar saldo
      </Boton>
    </div>
  ) : (
    <div className={`${s.textoSuaveMedio} ${s.arriba}`}>
      Pídele a un administrador de la clínica que recargue el saldo.
    </div>
  );

  return (
    <RaizWhatsApp>
      <div className={s.volver}>
        <BotonEnlace href={VOLVER} variante="suave" icono={<ArrowLeft size={15} />}>
          Volver al bot
        </BotonEnlace>
      </div>
      <Cabecera
        icono={<Wallet size={20} />}
        titulo="Saldo de IA"
        sub="Paga solo lo que tu asistente de IA consume. Sin mensualidades."
      />

      <div className={s.apilado}>
        {/* ── Saldo ── */}
        <Tarjeta>
          <div className={s.saldoCabeza}>
            <div>
              <div className={s.saldoEtiqueta}>Saldo disponible</div>
              <div className={s.saldoCifra}>{fmtMXNdec(data.balanceCents / 100)}</div>
            </div>
            <Etiqueta tono={data.status === "ACTIVE" ? "success" : "warning"} punto>
              {data.status === "ACTIVE" ? "Activo" : "Pausado"}
            </Etiqueta>
          </div>
          {walletIdle ? (
            <Nota titulo={textos.idleTitle(data.status)} className={s.arribaMas}>
              <p className={s.notaCuerpo}>{textos.idleConsequenceNote} Mientras tanto no se te cobra nada.</p>
              {ctaRecarga}
            </Nota>
          ) : showLowWarning ? (
            <p className={`${s.parrafo} ${s.arribaMas}`}>Saldo bajo — recarga para que tu bot siga respondiendo.</p>
          ) : null}

          {/* ── Qué se paga con este saldo: siempre visible, antes de recargar ── */}
          <Nota titulo={t("monederoIa.queGasta.titulo")} className={s.arribaMas}>
            <div className={s.apilado} style={{ gap: 4 }}>
              <p className={s.parrafo}>
                <strong>{t("monederoIa.queGasta.siEtiqueta")}</strong> {t("monederoIa.queGasta.si")}
              </p>
              <p className={s.parrafo}>
                <strong>{t("monederoIa.queGasta.noEtiqueta")}</strong> {t("monederoIa.queGasta.no")}
              </p>
              <p className={s.parrafo}>
                <strong>{t("monederoIa.queGasta.metaEtiqueta")}</strong> {t("monederoIa.queGasta.meta")}
              </p>
            </div>
          </Nota>
        </Tarjeta>

        {/* Dos columnas en iMac: recargas a la izquierda, historiales a la
            derecha. En iPad una debajo de otra. Nada se esconde. */}
        <div className={s.rejillaPar}>
          <div className={s.columna}>
            {data.isAdmin ? (
              <>
                {/* ── Recargar (solo admin) ── */}
                <Tarjeta id={textos.rechargeAnchor} titulo="Recargar saldo" sub="Elige un monto y un método de pago.">
                  <div className={s.apilado} style={{ gap: 16 }}>
                    <div className={s.chips}>
                      {textos.presetAmountsCents.map((cents) => {
                        const selected = !customPesos && amountCents === cents;
                        return (
                          <button
                            key={cents}
                            type="button"
                            aria-pressed={selected}
                            className={[s.chip, selected ? s.chipActivo : ""].filter(Boolean).join(" ")}
                            onClick={() => {
                              setAmountCents(cents);
                              setCustomPesos("");
                            }}
                          >
                            {fmtMXNdec(cents / 100)}
                          </button>
                        );
                      })}
                      <div className={s.otroMonto}>
                        <span className={s.textoSuaveMedio}>Otro monto $</span>
                        <input
                          className={`${s.entrada} ${s.entradaCorta}`}
                          type="number"
                          min={0}
                          step="1"
                          placeholder="0"
                          aria-label="Otro monto"
                          value={customPesos}
                          onChange={(e) => {
                            const v = e.target.value;
                            setCustomPesos(v);
                            const pesos = parseFloat(v);
                            if (!Number.isNaN(pesos) && pesos > 0) {
                              setAmountCents(Math.round(pesos * 100));
                            }
                          }}
                        />
                      </div>
                    </div>

                    <div className={s.accionesFormulario}>
                      <Boton
                        variante="principal"
                        icono={<CreditCard size={15} />}
                        disabled={payBusy}
                        onClick={() => startCheckout("/api/ai-wallet/stripe/checkout")}
                      >
                        Tarjeta
                      </Boton>
                      <Boton
                        icono={<Wallet size={15} />}
                        disabled={payBusy}
                        onClick={() => startCheckout("/api/ai-wallet/mercadopago/checkout")}
                      >
                        MercadoPago
                      </Boton>
                      <Boton icono={<Building2 size={15} />} disabled={payBusy} onClick={openSpei}>
                        Transferencia (SPEI)
                      </Boton>
                    </div>
                  </div>
                </Tarjeta>

                {/* ── Recarga automática ── */}
                <Tarjeta titulo="Recarga automática" sub="Mantén tu bot siempre disponible sin pensar en el saldo.">
                  <div className={s.apilado} style={{ gap: 16 }}>
                    <div className={s.filaInterruptor}>
                      <Interruptor
                        on={autoOn}
                        onClick={() => setAutoOn(!autoOn)}
                        disabled={savingAuto}
                        label="Recargar automáticamente cuando el saldo esté bajo"
                      />
                      <div className={s.filaTitulo}>Recargar automáticamente cuando el saldo esté bajo</div>
                    </div>

                    <div className={s.rejillaCampos}>
                      <Campo etiqueta="Recargar cuando baje de ($)">
                        <input
                          className={s.entrada}
                          type="number"
                          min={0}
                          step="1"
                          value={thresholdPesos}
                          onChange={(e) => setThresholdPesos(e.target.value)}
                        />
                      </Campo>
                      <Campo etiqueta="Recargar este monto ($)">
                        <input
                          className={s.entrada}
                          type="number"
                          min={0}
                          step="1"
                          value={autoAmountPesos}
                          onChange={(e) => setAutoAmountPesos(e.target.value)}
                        />
                      </Campo>
                    </div>

                    {!data.hasPaymentMethod && (
                      <p className={s.pista}>Para la recarga automática necesitas guardar una tarjeta (botón Tarjeta).</p>
                    )}

                    <div className={s.accionesFormulario}>
                      <Boton variante="principal" onClick={saveAuto} disabled={savingAuto}>
                        {savingAuto ? "Guardando…" : "Guardar"}
                      </Boton>
                    </div>
                  </div>
                </Tarjeta>
              </>
            ) : (
              <Tarjeta>
                <p className={s.vacio}>Solo administradores pueden recargar o configurar la recarga automática.</p>
              </Tarjeta>
            )}
          </div>

          <div className={s.columna}>
            {/* ── Historial de consumo ── */}
            <Tarjeta titulo="Consumo de IA" sub="Detalle de lo que ha consumido tu asistente." tabla>
              {data.usage.length === 0 ? (
                <div className={s.vacioCentrado}>
                  <div className={s.saldoCifraMedia}>{fmtMXNdec(spentCents / 100)}</div>
                  <div className={`${s.textoSuaveMedio}`} style={{ marginTop: 4 }}>
                    gastado en IA hasta hoy
                  </div>
                  {walletIdle && (
                    <p className={s.parrafo} style={{ maxWidth: 520, margin: "8px auto 0" }}>
                      {`${textos.idleTitle(data.status)}. ${textos.idleConsequenceNote}`}
                    </p>
                  )}
                </div>
              ) : (
                <div className={s.tablaEnvoltura}>
                  <table className={s.tabla}>
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>Detalle</th>
                        <th className={s.numero}>Tokens</th>
                        <th className={s.numero}>Costo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.usage.map((u) => (
                        <tr key={u.id}>
                          <td>{formatRelativeDate(u.createdAt)}</td>
                          <td>{aiBillingFeatureLabel(u.feature)}</td>
                          <td className={s.numero}>{(u.inputTokens + u.outputTokens).toLocaleString("es-MX")}</td>
                          <td className={s.numero}>{fmtMXNdec(u.billedCents / 100)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Tarjeta>

            {/* ── Recargas de saldo: SOLO el dinero que entra (lo que se gasta ya
                está en «Consumo de IA», justo arriba) ── */}
            <Tarjeta titulo={t("monederoIa.recargas.titulo")} sub={t("monederoIa.recargas.sub")} tabla>
              {data.recargas.length === 0 ? (
                <div className={s.vacioCentrado}>
                  <p className={s.vacio}>{t("monederoIa.recargas.vacio")}</p>
                </div>
              ) : (
                <div className={s.tablaEnvoltura}>
                  <table className={s.tabla}>
                    <thead>
                      <tr>
                        <th>{t("monederoIa.recargas.colFecha")}</th>
                        <th>{t("monederoIa.recargas.colTipo")}</th>
                        <th>{t("monederoIa.recargas.colVia")}</th>
                        <th className={s.numero}>{t("monederoIa.recargas.colMonto")}</th>
                        <th className={s.numero}>{t("monederoIa.recargas.colSaldo")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recargas.map((r) => {
                        const via = textos.recargaViaClave(r.via);
                        // Una devolución es dinero que SALE; una SPEI en revisión
                        // todavía no entró: ni verde ni «+» hasta que se acredite.
                        const sale = r.amountCents < 0;
                        const claseMonto = r.enRevision ? s.textoSuaveMedio : sale ? s.negativo : s.positivo;
                        return (
                          <tr key={r.id}>
                            <td>{formatRelativeDate(r.createdAt)}</td>
                            <td>
                              <div className={s.chips}>
                                {t(textos.recargaTipoClave(r.tipo))}
                                {r.enRevision && (
                                  <Etiqueta tono="warning" punto>
                                    {t("monederoIa.recargas.enRevision")}
                                  </Etiqueta>
                                )}
                              </div>
                              {r.enRevision && (
                                <div className={s.textoSuaveMedio} style={{ marginTop: 2 }}>
                                  {t("monederoIa.recargas.enRevisionNota")}
                                </div>
                              )}
                            </td>
                            <td>{via ? t(via) : ""}</td>
                            <td className={`${s.numero} ${claseMonto}`}>
                              {r.enRevision || sale ? "" : "+"}
                              {fmtMXNdec(r.amountCents / 100)}
                            </td>
                            <td className={s.numero}>
                              {r.balanceAfterCents == null
                                ? t("monederoIa.recargas.sinSaldo")
                                : fmtMXNdec(r.balanceAfterCents / 100)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Tarjeta>
          </div>
        </div>
      </div>

      {/* ── Diálogo SPEI ── */}
      {speiOpen && (
        <div role="dialog" aria-modal="true" className={s.velo} onClick={() => setSpeiOpen(false)}>
          <div className={s.dialogo} onClick={(e) => e.stopPropagation()}>
            <div className={s.dialogoCabeza}>
              <div>
                <div className={s.dialogoTitulo}>Transferencia (SPEI)</div>
                <div className={s.dialogoSub}>Indica el monto que transferiste y adjunta tu comprobante.</div>
              </div>
              <button type="button" aria-label="Cerrar" className={s.cerrar} onClick={() => setSpeiOpen(false)}>
                <X size={18} />
              </button>
            </div>

            <div className={s.campos}>
              <Campo etiqueta="Monto ($)">
                <input
                  className={s.entrada}
                  type="number"
                  min={0}
                  step="1"
                  value={speiPesos}
                  onChange={(e) => setSpeiPesos(e.target.value)}
                />
              </Campo>
              <Campo etiqueta="Comprobante">
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(e) => setSpeiFile(e.target.files?.[0] ?? null)}
                />
              </Campo>
              <div className={`${s.accionesFormulario} ${s.accionesDerecha}`}>
                <Boton variante="suave" onClick={() => setSpeiOpen(false)} disabled={speiBusy}>
                  Cancelar
                </Boton>
                <Boton variante="principal" icono={<Upload size={15} />} onClick={submitSpei} disabled={speiBusy}>
                  {speiBusy ? "Enviando…" : "Enviar comprobante"}
                </Boton>
              </div>
            </div>
          </div>
        </div>
      )}
    </RaizWhatsApp>
  );
}
