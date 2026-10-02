"use client";

// ═══════════════════════════════════════════════════════════════════════════
// Aceptación por concepto y «Se cobrará hoy» de un presupuesto (ws1-t6, ticket
// 3 de BEVADENT, 7c y 7d). Lo montan las dos tarjetas de Presupuestos: la de
// siempre (`components/quotes/quotes-tab.tsx`) y la rediseñada (`lista.tsx`).
//
//  · <AceptarConceptos>: «¿Qué acepta el paciente?». Casillas por concepto,
//    todas marcadas de entrada; lo que se desmarca queda guardado como «no
//    aceptado» y nunca se carga ni genera avisos.
//  · <CobrarPresupuesto>: «Se cobrará hoy». Elige qué conceptos aceptados se
//    cargan hoy (lo que se hizo hoy) y/o un abono (el inicial pactado, una
//    cuota) y enseña, antes de crear nada, cuánto se carga hoy y cuánto queda.
//    La vista previa corre la MISMA `planearCargo` que el servidor.
//  · <LineaDeCobro>: en la tarjeta, «Aceptado $1,500 de $10,000 · cargado …»
//    y las facturas que ya salieron del presupuesto.
//
// Solo aparecen con `quote.porConcepto` (el SQL aplicado). Sin él la tarjeta
// hace lo de siempre. Los cuadros van en un portal con las clases de la raíz
// del rediseño: así se ven igual dentro de la ficha rediseñada o la de siempre.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, ReceiptText, X } from "lucide-react";
import { CLASES_REDISENO } from "@/components/dashboard/pacientes-rediseno/raiz";
import r from "@/components/dashboard/pacientes-rediseno/rediseno.module.css";
import { dinero } from "@/lib/quotes/condiciones-pago";
import {
  armarAceptacion,
  claveDeConcepto,
  estadoDeCobro,
  netoDe,
  planearCargo,
  resumirAceptacion,
  type CargadoEnOtro,
  type CargoVivo,
  type CobroDePresupuesto,
  type RenglonAceptado,
} from "@/lib/quotes/aceptacion";
import type { BillingInvoiceLite, QuoteDTO } from "@/lib/quotes/types";
import { useT } from "@/i18n/i18n-provider";
import s from "./aceptacion-y-cobro.module.css";

/* ── Cuadro base (portal + Escape + foco) ──────────────────────────────── */

function Cuadro({ titulo, sub, onCerrar, children, pie }: {
  titulo: string;
  sub?: string;
  onCerrar: () => void;
  children: ReactNode;
  pie: ReactNode;
}) {
  const t = useT();
  const idTitulo = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [montado, setMontado] = useState(false);
  // En un ref: la tarjeta pasa una flecha nueva en cada render y el efecto de
  // abajo no debe re-armarse (devolvería el foco a medio uso).
  const cerrarRef = useRef(onCerrar);
  cerrarRef.current = onCerrar;

  useEffect(() => {
    setMontado(true);
    const previo = document.activeElement as HTMLElement | null;
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); cerrarRef.current(); }
    };
    document.addEventListener("keydown", alTeclear, true);
    return () => {
      document.removeEventListener("keydown", alTeclear, true);
      previo?.focus?.();
    };
  }, []);

  useEffect(() => {
    if (montado) ref.current?.querySelector<HTMLElement>("input, button:not([data-cerrar])")?.focus();
  }, [montado]);

  if (!montado) return null;
  return createPortal(
    <div className={CLASES_REDISENO}>
      <div className={s.velo} onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
        <div ref={ref} className={s.dialogo} role="dialog" aria-modal="true" aria-labelledby={idTitulo}>
          <header className={s.cabeza}>
            <div className={s.cabezaTextos}>
              <h2 id={idTitulo} className={s.titulo}>{titulo}</h2>
              {sub && <p className={s.sub}>{sub}</p>}
            </div>
            <button type="button" data-cerrar className={s.cerrar} aria-label={t("presupuestoAceptacion.cerrar")} onClick={onCerrar}>
              <X size={17} aria-hidden />
            </button>
          </header>
          <div className={s.cuerpo}>{children}</div>
          <footer className={s.pie}>{pie}</footer>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function detalleDe(it: { toothFdi: string | null; quantity: number; unitPrice: number }, t: ReturnType<typeof useT>) {
  return [
    it.toothFdi ? t("presupuestoAceptacion.dientes", { dientes: it.toothFdi }) : "",
    `${it.quantity} × ${dinero(it.unitPrice)}`,
  ].filter(Boolean).join(" · ");
}

/* ── «¿Qué acepta el paciente?» ────────────────────────────────────────── */

export function AceptarConceptos({ quote, onCerrar, onAceptado }: {
  quote: QuoteDTO;
  onCerrar: () => void;
  onAceptado: () => Promise<void> | void;
}) {
  const t = useT();
  const [marcados, setMarcados] = useState<string[]>(() => quote.items.map((i) => i.id));
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const renglones = useMemo(
    () => armarAceptacion({ discountAmount: quote.discountAmount, items: quote.items }, marcados),
    [quote, marcados],
  );
  const resumen = resumirAceptacion(renglones, quote.total);

  function alternar(id: string) {
    setMarcados((p) => (p.indexOf(id) === -1 ? [...p, id] : p.filter((x) => x !== id)));
  }

  async function aceptar() {
    setOcupado(true);
    setError(null);
    try {
      const res = await fetch(`/api/quotes/${quote.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept", itemIds: marcados }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error ?? t("presupuestoAceptacion.errorGenerico"));
      await onAceptado();
      onCerrar();
    } catch (e) {
      setError((e as Error).message);
      setOcupado(false);
    }
  }

  const ninguno = marcados.length === 0;
  return (
    <Cuadro
      titulo={t("presupuestoAceptacion.aceptarTitulo")}
      sub={t("presupuestoAceptacion.aceptarSub", { folio: quote.folio })}
      onCerrar={onCerrar}
      pie={
        <>
          <button type="button" className={r.boton} onClick={onCerrar} disabled={ocupado}>
            {t("presupuestoAceptacion.cancelar")}
          </button>
          <button type="button" className={`${r.boton} ${r.botonExito}`} onClick={aceptar} disabled={ocupado || ninguno}>
            <CheckCircle2 size={15} aria-hidden />
            {resumen.alcance === "total"
              ? t("presupuestoAceptacion.aceptarTodo", { total: dinero(resumen.total) })
              : t("presupuestoAceptacion.aceptarParte", { n: resumen.aceptados, de: resumen.conceptos, total: dinero(resumen.total) })}
          </button>
        </>
      }
    >
      <div>
        <p className={s.seccionTitulo}>
          {t("presupuestoAceptacion.conceptos")}
          <span className={s.atajos}>
            <button type="button" className={s.atajo} onClick={() => setMarcados(quote.items.map((i) => i.id))}>
              {t("presupuestoAceptacion.todos")}
            </button>
            <button type="button" className={s.atajo} onClick={() => setMarcados([])}>
              {t("presupuestoAceptacion.ninguno")}
            </button>
          </span>
        </p>
        <ul className={s.lista}>
          {quote.items.map((it, i) => {
            const rg = renglones[i];
            const si = rg.aceptado;
            return (
              <li key={it.id}>
                <label className={`${s.renglon} ${si ? "" : s.renglonApagado}`}>
                  <input type="checkbox" className={s.casilla} checked={si} onChange={() => alternar(it.id)} />
                  <span className={s.renglonTexto}>
                    <span className={s.renglonNombre}>{it.name}</span>
                    <span className={s.renglonDetalle}>{detalleDe(it, t)}</span>
                    {!si && (
                      <span className={`${s.etiqueta} ${s.etiquetaNeutra}`}>{t("presupuestoAceptacion.noAceptadoNoSeCobra")}</span>
                    )}
                  </span>
                  <span className={s.renglonMonto}>
                    {dinero(si ? netoDe(rg) : rg.importe)}
                    {si && rg.descuentoGlobal > 0 && <span className={s.renglonTachado}>{dinero(rg.importe)}</span>}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>

      <div className={s.cifras}>
        <div className={s.cifra}>
          <span className={s.cifraEtiqueta}>{t("presupuestoAceptacion.totalPresupuesto")}</span>
          <span className={s.cifraValor}>{dinero(quote.total)}</span>
        </div>
        <div className={s.cifra}>
          <span className={s.cifraEtiqueta}>{t("presupuestoAceptacion.aceptado")}</span>
          <span className={s.cifraValor}>{dinero(resumen.total)}</span>
        </div>
        <div className={s.cifra}>
          <span className={s.cifraEtiqueta}>{t("presupuestoAceptacion.noAceptado")}</span>
          <span className={s.cifraValor}>{dinero(resumen.noAceptado)}</span>
        </div>
      </div>

      {ninguno ? (
        <p className={s.aviso}>{t("presupuestoAceptacion.ningunoAviso")}</p>
      ) : (
        <p className={s.pista}>
          {resumen.alcance === "parcial"
            ? t("presupuestoAceptacion.parcialPista")
            : t("presupuestoAceptacion.totalPista")}
          {resumen.descuento > 0 && resumen.alcance === "parcial" ? ` ${t("presupuestoAceptacion.descuentoProporcional")}` : ""}
        </p>
      )}
      {resumen.alcance === "parcial" && quote.condicionesPago?.modo === "plazos" && (
        <p className={s.aviso}>{t("presupuestoAceptacion.planNoCuadra")}</p>
      )}
      {error && <p className={s.error} role="alert">{error}</p>}
    </Cuadro>
  );
}

/* ── «Se cobrará hoy» ──────────────────────────────────────────────────── */

interface DatosDeCobro {
  renglones: RenglonAceptado[];
  vivos: CargoVivo[];
  cobro: CobroDePresupuesto;
  sugerencias: Array<{ clave: "enganche" | "cuota"; monto: number }>;
  conceptos: Array<{ id: string; name: string; toothFdi: string | null; quantity: number; unitPrice: number }>;
}

export function CobrarPresupuesto({ quote, onCerrar, onCargado, onVerFactura, cargadosEnOtros }: {
  quote: QuoteDTO;
  onCerrar: () => void;
  onCargado: (invoice: BillingInvoiceLite) => Promise<void> | void;
  onVerFactura?: (invoiceId: string) => void;
  /** Conceptos ya cargados desde OTRO presupuesto del paciente (el duplicado): aviso, no bloqueo. */
  cargadosEnOtros?: Map<string, CargadoEnOtro[]>;
}) {
  const t = useT();
  const [datos, setDatos] = useState<DatosDeCobro | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [elegidos, setElegidos] = useState<string[]>([]);
  const [abono, setAbono] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tRef = useRef(t);
  tRef.current = t;
  useEffect(() => {
    let vivo = true;
    fetch(`/api/quotes/${quote.id}/cargos`)
      .then(async (res) => {
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(out.error ?? tRef.current("presupuestoAceptacion.errorGenerico"));
        return out as DatosDeCobro;
      })
      .then((d) => {
        if (!vivo) return;
        setDatos(d);
        // Con UN solo concepto pendiente, viene marcado (lo normal: «lo que se
        // hizo hoy» es eso). Con varios, se elige: nada se carga por inercia.
        const pend = estadoDeCobro(d.renglones, d.vivos).pendientes;
        if (pend.length === 1) setElegidos([pend[0].quoteItemId]);
      })
      .catch((e) => vivo && setErrorCarga((e as Error).message));
    return () => { vivo = false; };
  }, [quote.id]);

  const estado = datos ? estadoDeCobro(datos.renglones, datos.vivos) : null;
  const abonoNum = abono.trim() === "" ? 0 : Number(abono.replace(",", "."));
  const plan = datos
    ? planearCargo(datos.renglones, datos.vivos, {
        itemIds: elegidos,
        abono: isFinite(abonoNum) ? abonoNum : -1,
        etiquetaAbono: t("presupuestoAceptacion.abonoConcepto", { folio: quote.folio }),
      })
    : null;
  const nadaElegido = elegidos.length === 0 && (abono.trim() === "" || abonoNum === 0);

  function alternar(id: string) {
    setElegidos((p) => (p.indexOf(id) === -1 ? [...p, id] : p.filter((x) => x !== id)));
  }

  async function cargar() {
    if (!plan?.ok) return;
    setOcupado(true);
    setError(null);
    try {
      const res = await fetch(`/api/quotes/${quote.id}/cargos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIds: elegidos, abono: abonoNum || 0 }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error ?? t("presupuestoAceptacion.errorGenerico"));
      await onCargado(out.invoice);
      onCerrar();
    } catch (e) {
      setError((e as Error).message);
      setOcupado(false);
    }
  }

  const facturaDe = (id: string) => datos?.cobro.cargos.find((c) => c.quoteItemId === id);

  return (
    <Cuadro
      titulo={t("presupuestoAceptacion.cobrarTitulo")}
      sub={t("presupuestoAceptacion.cobrarSub", { folio: quote.folio, titulo: quote.title })}
      onCerrar={onCerrar}
      pie={
        <>
          <p className={s.pieNota}>{t("presupuestoAceptacion.cobrarNota")}</p>
          <button type="button" className={r.boton} onClick={onCerrar} disabled={ocupado}>
            {t("presupuestoAceptacion.cancelar")}
          </button>
          <button
            type="button"
            className={`${r.boton} ${r.botonPrincipal}`}
            onClick={cargar}
            disabled={ocupado || !plan?.ok}
          >
            <ReceiptText size={15} aria-hidden />
            {plan?.ok
              ? t("presupuestoAceptacion.generarCargo", { total: dinero(plan.plan.total) })
              : t("presupuestoAceptacion.generarCargoVacio")}
          </button>
        </>
      }
    >
      {errorCarga ? (
        <p className={s.error} role="alert">{errorCarga}</p>
      ) : !datos || !estado ? (
        <p className={s.estado} role="status">{t("presupuestoAceptacion.cargando")}</p>
      ) : (
        <>
          <div className={s.cifras}>
            <div className={s.cifra}>
              <span className={s.cifraEtiqueta}>{t("presupuestoAceptacion.aceptado")}</span>
              <span className={s.cifraValor}>{dinero(estado.totalAceptado)}</span>
            </div>
            <div className={s.cifra}>
              <span className={s.cifraEtiqueta}>{t("presupuestoAceptacion.yaCargado")}</span>
              <span className={s.cifraValor}>{dinero(estado.cargado)}</span>
            </div>
            <div className={s.cifra}>
              <span className={s.cifraEtiqueta}>{t("presupuestoAceptacion.porCargar")}</span>
              <span className={s.cifraValor}>{dinero(estado.porCargar)}</span>
            </div>
          </div>

          <div>
            <p className={s.seccionTitulo}>{t("presupuestoAceptacion.queSeCargaHoy")}</p>
            <ul className={s.lista}>
              {datos.renglones.map((rg) => {
                const concepto = datos.conceptos.find((c) => c.id === rg.quoteItemId);
                const detalle = detalleDe(
                  { toothFdi: rg.toothFdi, quantity: rg.cantidad, unitPrice: rg.precio },
                  t,
                );
                if (!rg.aceptado) {
                  return (
                    <li key={rg.quoteItemId} className={`${s.renglon} ${s.renglonApagado}`}>
                      <span className={s.renglonTexto}>
                        <span className={s.renglonNombre}>{concepto?.name ?? rg.nombre}</span>
                        <span className={s.renglonDetalle}>{detalle}</span>
                        <span className={`${s.etiqueta} ${s.etiquetaNeutra}`}>{t("presupuestoAceptacion.noAceptadoNoSeCobra")}</span>
                      </span>
                      <span className={s.renglonMonto}>{dinero(rg.importe)}</span>
                    </li>
                  );
                }
                const yaCargado = estado.cargados.indexOf(rg.quoteItemId) !== -1;
                if (yaCargado) {
                  const f = facturaDe(rg.quoteItemId);
                  return (
                    <li key={rg.quoteItemId} className={`${s.renglon} ${s.renglonApagado}`}>
                      <span className={s.renglonTexto}>
                        <span className={s.renglonNombre}>{rg.nombre}</span>
                        <span className={s.renglonDetalle}>{detalle}</span>
                        {f && onVerFactura ? (
                          <button type="button" className={`${s.etiqueta} ${s.etiquetaExito}`} onClick={() => onVerFactura(f.invoiceId)}>
                            {t("presupuestoAceptacion.cargadoEn", { folio: f.invoiceNumber })}
                          </button>
                        ) : (
                          <span className={`${s.etiqueta} ${s.etiquetaExito}`}>
                            {f ? t("presupuestoAceptacion.cargadoEn", { folio: f.invoiceNumber }) : t("presupuestoAceptacion.cargado")}
                          </span>
                        )}
                      </span>
                      <span className={s.renglonMonto}>{dinero(netoDe(rg))}</span>
                    </li>
                  );
                }
                const si = elegidos.indexOf(rg.quoteItemId) !== -1;
                const enOtro = cargadosEnOtros?.get(claveDeConcepto(rg.nombre, rg.toothFdi))?.[0];
                return (
                  <li key={rg.quoteItemId}>
                    <label className={s.renglon}>
                      <input type="checkbox" className={s.casilla} checked={si} onChange={() => alternar(rg.quoteItemId)} />
                      <span className={s.renglonTexto}>
                        <span className={s.renglonNombre}>{rg.nombre}</span>
                        <span className={s.renglonDetalle}>{detalle}</span>
                        {enOtro && (
                          <span className={`${s.etiqueta} ${s.etiquetaAlerta}`}>
                            {enOtro.factura
                              ? t("presupuestoAceptacion.yaCargadoEnOtro", { folio: enOtro.folio, factura: enOtro.factura })
                              : t("presupuestoAceptacion.yaCargadoEnOtroSinNota", { folio: enOtro.folio })}
                          </span>
                        )}
                      </span>
                      <span className={s.renglonMonto}>{dinero(netoDe(rg))}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>

          {estado.porCargar > 0 && (
            <div>
              <p className={s.seccionTitulo}>{t("presupuestoAceptacion.abonoTitulo")}</p>
              <div className={s.abono}>
                <label className={s.campoDinero}>
                  <span aria-hidden>$</span>
                  <input
                    inputMode="decimal"
                    value={abono}
                    onChange={(e) => setAbono(e.target.value.replace(/[^\d.,]/g, ""))}
                    placeholder="0.00"
                    aria-label={t("presupuestoAceptacion.abonoTitulo")}
                  />
                </label>
                {datos.sugerencias.map((sg) => (
                  <button key={sg.clave} type="button" className={s.sugerencia} onClick={() => setAbono(String(sg.monto))}>
                    {t(sg.clave === "enganche" ? "presupuestoAceptacion.sugerenciaEnganche" : "presupuestoAceptacion.sugerenciaCuota", { monto: dinero(sg.monto) })}
                  </button>
                ))}
              </div>
              <p className={s.pista}>{t("presupuestoAceptacion.abonoPista")}</p>
            </div>
          )}

          {estado.porCargar <= 0 ? (
            <p className={s.aviso}>{t("presupuestoAceptacion.todoCargado")}</p>
          ) : plan?.ok ? (
            <div className={s.resumen} aria-live="polite">
              <p className={s.resumenTitulo}>{t("presupuestoAceptacion.seCobraraHoy")}</p>
              {plan.plan.lineas.map((l, i) => (
                <div key={i} className={s.resumenLinea}>
                  <span>{l.toothFdi ? `${l.name} (${l.toothFdi})` : l.name}</span>
                  <span>{dinero(l.monto)}</span>
                </div>
              ))}
              {plan.plan.descontadoDeAbonos > 0 && (
                <p className={s.pista}>
                  {t("presupuestoAceptacion.descontadoDeAbonos", { monto: dinero(plan.plan.descontadoDeAbonos) })}
                </p>
              )}
              <div className={s.resumenTotal}>
                <span>{t("presupuestoAceptacion.hoy")}</span>
                <span>{dinero(plan.plan.total)}</span>
              </div>
              <p className={s.pista}>
                {plan.plan.quedaPorCargar > 0
                  ? t("presupuestoAceptacion.quedaraPorCargar", { monto: dinero(plan.plan.quedaPorCargar) })
                  : t("presupuestoAceptacion.quedaraTodo")}
              </p>
            </div>
          ) : (
            !nadaElegido && plan && <p className={s.error} role="alert">{plan.error}</p>
          )}
          {nadaElegido && estado.porCargar > 0 && (
            <p className={s.pista}>{t("presupuestoAceptacion.eligeAlgo")}</p>
          )}
          {error && <p className={s.error} role="alert">{error}</p>}
        </>
      )}
    </Cuadro>
  );
}

/* ── Línea de la tarjeta ───────────────────────────────────────────────── */

export function LineaDeCobro({ cobro, total, onVerFactura }: {
  cobro: CobroDePresupuesto;
  total: number;
  onVerFactura?: (invoiceId: string) => void;
}) {
  const t = useT();
  const facturas = Array.from(new Map(cobro.cargos.map((c) => [c.invoiceId, c])).values());
  // Con las clases de la raíz: la tarjeta de siempre no tiene los tokens.
  return (
    <div className={CLASES_REDISENO}>
      <p className={s.lineaCobro}>
        {cobro.alcance === "parcial"
          ? t("presupuestoAceptacion.lineaParcial", {
              n: cobro.aceptados.length,
              de: cobro.renglones.length,
              aceptado: dinero(cobro.totalAceptado),
              total: dinero(total),
            })
          : t("presupuestoAceptacion.lineaTotal", { aceptado: dinero(cobro.totalAceptado) })}
        {" · "}
        {cobro.porCargar > 0
          ? t("presupuestoAceptacion.lineaCargado", { cargado: dinero(cobro.cargado), porCargar: dinero(cobro.porCargar) })
          : t("presupuestoAceptacion.lineaTodoCargado")}
      </p>
      {facturas.length > 0 && (
        <div className={s.facturas}>
          {facturas.map((f) => {
            const monto = cobro.cargos.filter((c) => c.invoiceId === f.invoiceId).reduce((a, c) => a + c.monto, 0);
            const texto = `${f.invoiceNumber} · ${dinero(Math.round(monto * 100) / 100)}`;
            return onVerFactura ? (
              <button key={f.invoiceId} type="button" className={`${s.etiqueta} ${s.etiquetaVioleta}`} onClick={() => onVerFactura(f.invoiceId)}>
                <ReceiptText size={11} aria-hidden /> {texto}
              </button>
            ) : (
              <span key={f.invoiceId} className={`${s.etiqueta} ${s.etiquetaVioleta}`}>
                <ReceiptText size={11} aria-hidden /> {texto}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
