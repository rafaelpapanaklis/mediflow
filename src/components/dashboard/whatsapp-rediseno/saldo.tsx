"use client";

import { ArrowLeft, Wallet, CreditCard, Building2, Upload, X } from "lucide-react";
import type { WalletData } from "@/app/dashboard/whatsapp/bot/saldo/saldo-client";
import { aiBillingFeatureLabel } from "@/lib/ai-billing/types";
import { fmtMXNdec, formatRelativeDate } from "@/lib/format";
import { RaizWhatsApp } from "./raiz";
import { Boton, BotonEnlace, Cabecera, Campo, Cargando, Etiqueta, Interruptor, Nota, Tarjeta } from "./piezas";
import s from "./whatsapp-rediseno.module.css";

/**
 * Todo lo que la vista necesita, tal cual lo tiene `SaldoClient`: el estado,
 * los manejadores (recarga, SPEI, recarga automática) y los TEXTOS que ya
 * vivían allí (por qué un $0.00 es correcto, qué significa «pausado», los
 * montos preestablecidos, el ancla de la tarjeta de recarga). Se pasan por
 * aquí en vez de copiarlos para que las dos pantallas digan lo mismo siempre.
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
    spendScopeNote: string;
    idleConsequenceNote: string;
    idleTitle: (status: WalletData["status"]) => string;
    txTypeLabel: (type: WalletData["transactions"][number]["type"]) => string;
    txSourceLabel: (source: WalletData["transactions"][number]["source"]) => string;
  };
};

const VOLVER = "/dashboard/whatsapp/bot";

export function SaldoRediseno({ vm }: { vm: SaldoVM }) {
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
              {/* La tarjeta «Consumo de IA» explica lo mismo, pero queda más
                  abajo: quien mira el $0.00 lo tiene aquí arriba. */}
              <p className={`${s.notaCuerpo} ${s.textoSuaveMedio}`}>{textos.spendScopeNote}</p>
              {ctaRecarga}
            </Nota>
          ) : showLowWarning ? (
            <p className={`${s.parrafo} ${s.arribaMas}`}>Saldo bajo — recarga para que tu bot siga respondiendo.</p>
          ) : null}
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
                  <p className={s.parrafo} style={{ maxWidth: 520, margin: "12px auto 0" }}>
                    {textos.spendScopeNote}
                  </p>
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

            {/* ── Historial de movimientos ── */}
            <Tarjeta titulo="Recargas y movimientos" sub="Tus recargas, consumos y ajustes de saldo." tabla>
              {data.transactions.length === 0 ? (
                <div className={s.vacioCentrado}>
                  <p className={s.vacio}>Aún no hay movimientos.</p>
                </div>
              ) : (
                <div className={s.tablaEnvoltura}>
                  <table className={s.tabla}>
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>Tipo</th>
                        <th>Origen</th>
                        <th className={s.numero}>Monto</th>
                        <th className={s.numero}>Saldo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.transactions.map((tx) => {
                        const positive = tx.amountCents >= 0;
                        return (
                          <tr key={tx.id}>
                            <td>{formatRelativeDate(tx.createdAt)}</td>
                            <td>{textos.txTypeLabel(tx.type)}</td>
                            <td>{textos.txSourceLabel(tx.source)}</td>
                            <td className={`${s.numero} ${positive ? s.positivo : s.negativo}`}>
                              {positive ? "+" : ""}
                              {fmtMXNdec(tx.amountCents / 100)}
                            </td>
                            <td className={s.numero}>{fmtMXNdec(tx.balanceAfterCents / 100)}</td>
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
