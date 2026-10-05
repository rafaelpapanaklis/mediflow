"use client";

import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { fmtMXNdec } from "@/lib/format";
// Fecha del cobro: "hoy" en LOCAL (no en UTC) y el instante que se guarda.
// Las mismas dos funciones que usa «Registrar pago» (billing/payment-modal).
import { paidAtInstant } from "@/lib/billing/paid-at";
import { useHoyDeLaClinica } from "@/lib/billing/zona-clinica";
import { useLocale, useT } from "@/i18n/i18n-provider";
import { textosDinero } from "@/lib/dinero/textos";
import type { MetodoDelCobro } from "@/components/dashboard/billing/payment-modal";
import { montoInicialDeCobro } from "@/components/dashboard/billing/monto-inicial-cobro";
// El freno de «caja cerrada»: la MISMA pieza que usa «Registrar pago» (ws1-t6, H25).
import { useFrenoCajaCerrada } from "@/components/dashboard/billing/aviso-caja-cerrada";
// ws1-t4: en un caso de ortodoncia, pagar de más es un adelanto (la MISMA pieza que la ventana de cobro).
import { useSaldoOrto, registrarCobroConAdelanto } from "@/components/dashboard/plan-de-pagos/saldo-orto-cobro";
import { mensajeDeError } from "@/lib/errores/mensaje-de-error";
// ws1-t6 (F1): el aviso del cobro automático con tarjeta (la MISMA pieza que «Registrar pago»).
import { useAvisoCobroAutomatico } from "@/components/cobro-automatico/aviso-en-cobro";
// Decisión de Rafael (4-oct-2026): lo cobrado de más se abona a otra factura del paciente.
import { repartirConAbono, type FacturaAbonable } from "@/lib/dinero/abono-core";

/**
 * EL COBRO DENTRO DEL DETALLE DE LA FACTURA (ws1-t2, solo con `menu-dos-niveles`).
 *
 * Esto es una MUDANZA del formulario de `billing/payment-modal.tsx`, no un
 * cobro nuevo: mismos campos, mismos valores iniciales, misma validación y el
 * MISMO POST a `/api/invoices/:id` con el mismo cuerpo. Lo vigila
 * `__tests__/factura-un-popup.test.ts`, que compara el cuerpo de los dos
 * archivos letra por letra: si uno cambia y el otro no, el test cae.
 *
 * El estado vive en un hook (y no dentro de la sección) porque el botón
 * «Registrar pago» va en el PIE del detalle —siempre a la vista, donde hoy
 * está «Cobrar ahora»— y los campos van en el cuerpo.
 *
 * BORRADORES. Hoy «Cobrar ahora» confirma el borrador (POST …/confirm,
 * DRAFT → PENDING) y abre la segunda ventana. Aquí ya no hay segunda ventana:
 * con `confirmarAntes`, «Registrar pago» hace esa misma llamada justo antes
 * del pago, en el mismo orden que hoy. Si el pago falla después de confirmar,
 * el reintento NO vuelve a confirmar (el servidor contestaría 400 «Solo se
 * pueden confirmar borradores»).
 */

export interface FacturaACobrar {
  id: string;
  balance: number;
}

export interface OpcionesCobro {
  /** El detalle está abierto. Al abrirse se reinician los campos, como hacía la ventana de cobro. */
  abierta: boolean;
  /** `null` mientras no hay factura o no se puede cobrar (pagada, cancelada, interruptor apagado). */
  factura: FacturaACobrar | null;
  /** La factura es un borrador: se confirma antes de registrar el pago. */
  confirmarAntes: boolean;
  /** Avisa al detalle para que bloquee el resto de sus botones mientras se cobra. */
  alOcupar: (ocupado: boolean) => void;
  /** Lo mismo que corría al cobrar en la segunda ventana (refrescar y cerrar). */
  alCobrar: () => void;
  /**
   * ws1-t10 (H68) — la mensualidad o lo vencido de una factura a plazos, si
   * la hay: MISMO parámetro y misma regla que `PaymentModal.montoSugerido`
   * (`monto-inicial-cobro.ts`). Sin esto el campo nacía en el saldo COMPLETO
   * del tratamiento, letra por letra el mismo bug que ya se corrigió en la
   * ventana de cobro de siempre.
   */
  montoSugerido?: number;
  /** QA de Rafael #1: la factura a la que se abonó lo de más también se refresca en la ficha. */
  alAbonarA?: (invoiceId: string) => void;
}

export function useCobro({ abierta, factura, confirmarAntes, alOcupar, alCobrar, montoSugerido, alAbonarA }: OpcionesCobro) {
  const t = useT();
  const txDinero = textosDinero(useLocale());
  const txCobro = txDinero.cobro;
  const txAbono = txDinero.abono;
  const [amount, setAmount]       = useState("");
  const [method, setMethod]       = useState<MetodoDelCobro>("cash");
  // C-33: la fecha por defecto es el «hoy» de la clínica, no el de la computadora.
  const hoy = useHoyDeLaClinica();
  const [paidAt, setPaidAt]       = useState(hoy);
  const [reference, setReference] = useState("");
  const [notes, setNotes]         = useState("");
  const [saving, setSaving]       = useState(false);
  // Id del borrador que ESTA apertura ya confirmó (ver arriba, «BORRADORES»).
  const confirmadaRef = useRef<string | null>(null);
  const freno = useFrenoCajaCerrada(abierta, method === "cash");

  const id = factura?.id ?? null;
  const orto = useSaldoOrto(id, abierta);
  const cobroAuto = useAvisoCobroAutomatico(id, Number(amount) || 0, abierta && method !== "mercadopago");
  const balance = factura?.balance ?? 0;

  // «Abonar a otra factura»: las demás facturas del paciente con saldo y su saldo
  // a favor (GET /api/invoices/:id/abonar). `destino` "" = lo de más queda a favor.
  const [abono, setAbono] = useState<{ abonables: FacturaAbonable[]; saldoAFavor: number } | null>(null);
  const [destino, setDestino] = useState("");
  const [vueltaAbono, setVueltaAbono] = useState(0);
  useEffect(() => {
    setAbono(null);
    setDestino("");
    if (!abierta || id === null) return;
    let vivo = true;
    fetch(`/api/invoices/${encodeURIComponent(id)}/abonar`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (vivo && d && Array.isArray(d.abonables)) setAbono({ abonables: d.abonables, saldoAFavor: Number(d.saldoAFavor) || 0 }); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [abierta, id, vueltaAbono]);

  // Mismos valores iniciales que la ventana de cobro al abrirse.
  useEffect(() => {
    if (!abierta || id === null) return;
    setAmount(String(montoInicialDeCobro(montoSugerido, balance ?? 0)));
    setMethod("cash");
    setPaidAt(hoy);
    setReference("");
    setNotes("");
  }, [abierta, id, balance, montoSugerido, hoy]);

  const amountNum = Number(amount);
  const isOverpay = amountNum > balance + 0.001;
  // ws1-t4: sobre una factura de un caso de ortodoncia, lo de más es un
  // adelanto (siguientes mensualidades, y lo que sobre a favor), no un error.
  // Fuera de ortodoncia (o mientras no se sabe) sigue bloqueado como siempre.
  const adelanto = isOverpay && orto.esOrto;
  // Fuera de ortodoncia (ya SABIDO: `info` cargó sin caso), lo de más ya no se
  // bloquea: se abona a la factura elegida y lo que sobre queda a favor.
  const conExcedente = isOverpay && !!orto.info && !orto.info.caso;
  const isInvalid = !amountNum || amountNum <= 0 || (isOverpay && !adelanto);
  const invalido = isInvalid && !(conExcedente && amountNum > 0);
  const elegida = abono?.abonables.find((f) => f.id === destino) ?? null;
  const reparto = repartirConAbono({ monto: amountNum || 0, faltaCobrada: balance, faltaDestino: elegida ? elegida.saldo : null });

  // `sinAviso === true` solo lo manda «Cobrar de todos modos»; el clic del botón
  // pasa el evento, que no cuenta.
  async function submit(sinAviso?: unknown) {
    const invoice = factura;
    if (invalido || saving || !invoice) return;
    // Auditoría de uso C-15: transferencia sin referencia no (la regla de «Registrar
    // anticipo recibido»: el mismo dinero, la misma regla).
    if (method === "transfer" && !reference.trim()) { toast.error(txCobro.faltaReferencia); return; }
    // MP ya cobró este ciclo: sin confirmar que es un adelanto, no se cobra.
    if (cobroAuto.bloquea) return;
    setSaving(true);
    alOcupar(true);
    try {
      // Efectivo con la caja cerrada: se avisa ANTES de confirmar el borrador o cobrar.
      if (sinAviso !== true && (await freno.frenar())) return;
      freno.ocultar();
      if (confirmarAntes && confirmadaRef.current !== invoice.id) {
        const confirmacion = await fetch(`/api/invoices/${invoice.id}/confirm`, { method: "POST" });
        if (!confirmacion.ok) {
          const err = await confirmacion.json().catch(() => ({}));
          throw new Error(err.error ?? t("clinical.invoiceDetail.confirmError"));
        }
        confirmadaRef.current = invoice.id;
        // Al confirmarse recibió el saldo a favor del paciente: el monto que se
        // tecleó era sobre el total del borrador. No se cobra a ciegas; se
        // avisa y se refresca para cobrar sobre lo que de verdad queda.
        const confirmada = await confirmacion.json().catch(() => ({}));
        if (confirmada?.anticipoAplicado > 0) {
          toast(t("clinical.invoiceDetail.anticipoAplicadoAlConfirmar", {
            monto: fmtMXNdec(confirmada.anticipoAplicado),
            resta: fmtMXNdec(confirmada.balance ?? 0),
          }), { duration: 10000 });
          alCobrar();
          return;
        }
      }
      if (conExcedente) {
        const res = await fetch(`/api/invoices/${invoice.id}/abonar`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: amountNum,
            method,
            paidAt: paidAtInstant(paidAt, undefined, hoy)?.toISOString(),
            reference: reference.trim() || undefined,
            notes: notes.trim() || undefined,
            destino: destino || null,
            confirmarCobroAutomatico: cobroAuto.confirmado || undefined,
          }),
        });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(out.error ?? t("clinical.paymentModal.registerError"));
        toast.success(txAbono.exito(fmtMXNdec(out.reparto?.enDestino ?? 0), out.folioDestino ?? null, fmtMXNdec(out.reparto?.aFavor ?? 0)), { duration: 8000 });
        if (destino && (out.reparto?.enDestino ?? 0) > 0) alAbonarA?.(destino);
        alCobrar();
        return;
      }
      if (adelanto) {
        const r = await registrarCobroConAdelanto({ invoiceId: invoice.id, amount: amountNum, method, paidAt, reference, notes });
        toast.success(r.aFavor > 0
          ? `Pago registrado · ${fmtMXNdec(r.aFavor)} quedan a favor del paciente`
          : t("clinical.paymentModal.registerSuccess"));
        alCobrar();
        return;
      }
      const res = await fetch(`/api/invoices/${invoice.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: amountNum,
          method,
          paidAt: paidAtInstant(paidAt, undefined, hoy)?.toISOString(),
          reference: reference.trim() || undefined,
          notes: notes.trim() || undefined,
          confirmarCobroAutomatico: cobroAuto.confirmado || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? t("clinical.paymentModal.registerError"));
      }
      toast.success(t("clinical.paymentModal.registerSuccess"));
      alCobrar();
    } catch (err: any) {
      toast.error(mensajeDeError(err, t, { porDefecto: t("clinical.paymentModal.registerErrorGeneric") }));
    } finally {
      setSaving(false);
      alOcupar(false);
    }
  }

  return {
    // El campo enseña el monto con formato («4,000.00»): las comas no son decimales.
    amount, setAmount: (v: string) => setAmount(String(v ?? "").replace(/,/g, "")),
    method, setMethod,
    paidAt, setPaidAt,
    reference, setReference,
    notes, setNotes,
    // `isInvalid` también se apaga mientras falte confirmar el adelanto del cobro automático.
    saving, amountNum, isOverpay, isInvalid: invalido || cobroAuto.bloquea, balance, adelanto, orto, cobroAuto,
    // «Abonar a otra factura»
    conExcedente, abono, destino, setDestino, reparto, recargarAbono: () => setVueltaAbono((n) => n + 1),
    hoy,
    submit,
    avisoCaja: freno.visible,
    // Decisión 16 (auditoría de uso): quién abrió la caja, si no es quien cobra.
    cajaDe: freno.cajaDe,
  };
}

export type Cobro = ReturnType<typeof useCobro>;
