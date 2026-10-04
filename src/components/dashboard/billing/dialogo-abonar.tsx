"use client";

// «Abonar a otra factura» (pedido de Rafael, 4-oct-2026): el botón de la fila
// de acciones de la factura abre esto. Dos maneras de abonar a OTRA factura
// del mismo paciente:
//   · «Pago que recibe ahora»: dinero real (método, fecha, referencia). Primero
//     salda ESTA factura y lo de más va a la elegida; lo que sobre, a favor.
//     El mismo flujo que «Registrar pago» con un monto mayor al saldo.
//   · «De su saldo a favor»: aplica el saldo a favor del paciente a la elegida
//     (no es dinero nuevo).
// Todo pasa por POST /api/invoices/:id/abonar (billing.charge, clínica de la
// sesión, visibilidad por paciente). Sin otra factura con saldo no se abre.

import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DateField } from "@/components/ui/date-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { fmtMXNdec } from "@/lib/format";
import { paidAtInstant } from "@/lib/billing/paid-at";
import { useHoyDeLaClinica } from "@/lib/billing/zona-clinica";
import { useLocale, useT } from "@/i18n/i18n-provider";
import { textosDinero } from "@/lib/dinero/textos";
import { mensajeDeError } from "@/lib/errores/mensaje-de-error";
import { repartirConAbono, type FacturaAbonable } from "@/lib/dinero/abono-core";
import { METHODS, type MetodoDelCobro } from "./payment-modal";
import { CLASES_CALENDARIO_REDISENO, CLASES_FACTURA_REDISENO, clasesFactura as c } from "@/components/dashboard/factura-rediseno/raiz";
import u from "@/components/dashboard/factura-un-popup/un-popup.module.css";

export interface DatosAbono {
  abonables: FacturaAbonable[];
  saldoAFavor: number;
}

/** Las facturas abonables y el saldo a favor del paciente de esta factura (null = no se sabe aún). */
export function useDatosAbono(invoiceId: string | null | undefined, activo: boolean, vuelta = 0): DatosAbono | null {
  const [datos, setDatos] = useState<DatosAbono | null>(null);
  useEffect(() => {
    setDatos(null);
    if (!activo || !invoiceId) return;
    let vivo = true;
    fetch(`/api/invoices/${encodeURIComponent(invoiceId)}/abonar`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (vivo && d && Array.isArray(d.abonables)) setDatos({ abonables: d.abonables, saldoAFavor: Number(d.saldoAFavor) || 0 }); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [invoiceId, activo, vuelta]);
  return datos;
}

export function DialogoAbonar({ open, onClose, invoice, datos, onHecho }: {
  open: boolean;
  onClose: () => void;
  invoice: { id: string; invoiceNumber: string; balance: number };
  datos: DatosAbono | null;
  /** Se registró algo: refrescar la factura y la ficha. */
  onHecho: () => void | Promise<void>;
}) {
  const t = useT();
  const tx = textosDinero(useLocale());
  const hoy = useHoyDeLaClinica();
  const abonables = datos?.abonables ?? [];
  const saldoAFavor = datos?.saldoAFavor ?? 0;
  const [destino, setDestino] = useState("");
  const [origen, setOrigen] = useState<"pago" | "saldo">("pago");
  const [monto, setMonto] = useState("");
  const [metodo, setMetodo] = useState<MetodoDelCobro>("cash");
  const [fecha, setFecha] = useState(hoy);
  const [referencia, setReferencia] = useState("");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDestino(abonables[0]?.id ?? "");
    setOrigen("pago");
    setMonto("");
    setMetodo("cash");
    setFecha(hoy);
    setReferencia("");
  }, [open, abonables, hoy]);

  const elegida = abonables.find((f) => f.id === destino) ?? null;
  const montoNum = Number(String(monto).replace(/,/g, "")) || 0;
  const reparto = useMemo(
    () => repartirConAbono({ monto: montoNum, faltaCobrada: origen === "pago" ? invoice.balance : 0, faltaDestino: elegida ? elegida.saldo : null }),
    [montoNum, origen, invoice.balance, elegida],
  );
  const maximoSaldo = elegida ? Math.min(saldoAFavor, elegida.saldo) : 0;
  const invalido =
    !elegida || !(montoNum > 0) || guardando ||
    (origen === "saldo" && montoNum > maximoSaldo + 0.001) ||
    (origen === "pago" && metodo === "transfer" && !referencia.trim());

  async function registrar() {
    if (invalido || !elegida) return;
    setGuardando(true);
    try {
      const cuerpo = origen === "saldo"
        ? { origen: "saldo", destino: elegida.id, amount: montoNum, paidVisto: elegida.paid }
        : {
            destino: elegida.id,
            amount: montoNum,
            method: metodo,
            paidAt: paidAtInstant(fecha, undefined, hoy)?.toISOString(),
            reference: referencia.trim() || undefined,
          };
      const res = await fetch(`/api/invoices/${encodeURIComponent(invoice.id)}/abonar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(out?.error ?? "No se pudo abonar."), { body: out });
      toast.success(origen === "saldo"
        ? tx.abono.exitoSaldo(fmtMXNdec(out.aplicado ?? montoNum), elegida.invoiceNumber)
        : tx.abono.exito(fmtMXNdec(out.reparto?.enDestino ?? 0), out.folioDestino ?? elegida.invoiceNumber, fmtMXNdec(out.reparto?.aFavor ?? 0)), { duration: 8000 });
      if (out?.warning) toast(out.warning, { duration: 8000 });
      onClose();
      // Después de cerrar (el refresco en el mismo tick dejaba el diálogo abierto).
      setTimeout(() => { void onHecho(); }, 0);
    } catch (e) {
      toast.error(mensajeDeError(e, t, { porDefecto: "No se pudo abonar." }));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !guardando) onClose(); }}>
      <DialogContent className={`${CLASES_FACTURA_REDISENO} ${c.modal} ${c.modalEstrecho} ${u.unPopup}`} data-dialogo-abonar>
        <DialogHeader className={c.cabecera}>
          <DialogTitle className={c.titulo}>{`${tx.abono.titulo} · ${invoice.invoiceNumber}`}</DialogTitle>
        </DialogHeader>
        <div className={c.cuerpo} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {abonables.length === 0 ? (
            <p className={c.texto}>{tx.abono.sinOtras}</p>
          ) : (
            <>
              <p className={c.ayuda}>{invoice.balance > 0 ? tx.abono.explicacion(fmtMXNdec(invoice.balance)) : tx.abono.explicacionPagada}</p>

              <div className={c.campo}>
                <Label htmlFor="abonar-destino">{tx.abono.facturaDestino}</Label>
                <select id="abonar-destino" value={destino} onChange={(e) => setDestino(e.target.value)} disabled={guardando}>
                  {abonables.map((f) => (
                    <option key={f.id} value={f.id}>{tx.abono.opcion(f.invoiceNumber, f.concepto, fmtMXNdec(f.saldo))}</option>
                  ))}
                </select>
              </div>

              {saldoAFavor > 0 && (
                <div className={c.campo} role="radiogroup" aria-label={tx.abono.origen}>
                  <Label>{tx.abono.origen}</Label>
                  <div className={c.metodos} style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                    {(["pago", "saldo"] as const).map((o) => (
                      <button
                        key={o}
                        type="button"
                        role="radio"
                        aria-checked={origen === o}
                        className={`${c.metodo} ${origen === o ? c.metodoActivo : ""}`}
                        onClick={() => setOrigen(o)}
                        disabled={guardando}
                      >
                        {o === "pago" ? tx.abono.origenPago : tx.abono.origenSaldo(fmtMXNdec(saldoAFavor))}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className={c.campo}>
                <Label htmlFor="abonar-monto">{origen === "pago" ? tx.abono.montoRecibido : tx.abono.montoAAbonar}</Label>
                <div className={u.montoCaja}>
                  <span className={u.montoPrefijo} aria-hidden>$</span>
                  <input
                    id="abonar-monto"
                    className={u.montoInput}
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={monto}
                    onChange={(e) => setMonto(e.target.value.replace(/[^\d.,]/g, ""))}
                    disabled={guardando}
                    autoFocus
                  />
                </div>
                {origen === "saldo" && elegida && <p className={c.ayuda}>{tx.abono.maximoSaldo(fmtMXNdec(maximoSaldo))}</p>}
              </div>

              {origen === "pago" && (
                <>
                  <div className={c.campo}>
                    <Label>{t("clinical.paymentModal.paymentMethod")}</Label>
                    <div className={c.metodos}>
                      {METHODS.map((m) => {
                        const Icon = m.icon;
                        const activo = m.value === metodo;
                        return (
                          <button key={m.value} type="button" onClick={() => setMetodo(m.value)} disabled={guardando} aria-pressed={activo} className={`${c.metodo} ${activo ? c.metodoActivo : ""}`}>
                            <Icon size={14} aria-hidden />
                            {t(m.labelKey)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className={c.rejilla2}>
                    <div className={c.campo}>
                      <Label>{t("common.date")}</Label>
                      <DateField max={hoy} className={c.campoFecha} popoverClassName={CLASES_CALENDARIO_REDISENO} value={fecha} onChange={(e) => setFecha(e.target.value)} />
                    </div>
                    <div className={c.campo}>
                      <Label>{metodo === "transfer" ? tx.cobro.referenciaObligatoria : t("clinical.paymentModal.reference")}</Label>
                      <Input value={referencia} onChange={(e) => setReferencia(e.target.value)} disabled={guardando} aria-required={metodo === "transfer"} />
                    </div>
                  </div>
                </>
              )}

              {montoNum > 0 && elegida && (
                <div className={u.resumen} role="status" data-resumen-abono>
                  {origen === "pago" && reparto.enCobrada > 0 && (
                    <div className={u.resumenFila}><span>{tx.abono.estaFactura}</span><strong>{fmtMXNdec(reparto.enCobrada)}</strong></div>
                  )}
                  <div className={u.resumenFila}>
                    <span>{tx.abono.abonoA(elegida.invoiceNumber)}</span>
                    <strong>{fmtMXNdec(origen === "saldo" ? Math.min(montoNum, maximoSaldo) : reparto.enDestino)}</strong>
                  </div>
                  {origen === "pago" && reparto.aFavor > 0 && (
                    <div className={u.resumenFila}><span>{tx.abono.aFavor}</span><strong>{fmtMXNdec(reparto.aFavor)}</strong></div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
        <DialogFooter className={c.pie}>
          <ButtonNew variant="ghost" onClick={onClose} disabled={guardando}>{t("common.cancel")}</ButtonNew>
          {abonables.length > 0 && (
            <ButtonNew variant="primary" onClick={() => void registrar()} disabled={invalido}>
              {tx.abono.confirmar(fmtMXNdec(montoNum))}
            </ButtonNew>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
