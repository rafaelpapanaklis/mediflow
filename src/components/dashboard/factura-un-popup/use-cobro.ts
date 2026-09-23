"use client";

import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { fmtMXNdec } from "@/lib/format";
// Fecha del cobro: "hoy" en LOCAL (no en UTC) y el instante que se guarda.
// Las mismas dos funciones que usa «Registrar pago» (billing/payment-modal).
import { todayLocalISO, paidAtInstant } from "@/lib/billing/paid-at";
import { useT } from "@/i18n/i18n-provider";
import type { MetodoDelCobro } from "@/components/dashboard/billing/payment-modal";

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
}

export function useCobro({ abierta, factura, confirmarAntes, alOcupar, alCobrar }: OpcionesCobro) {
  const t = useT();
  const [amount, setAmount]       = useState("");
  const [method, setMethod]       = useState<MetodoDelCobro>("cash");
  const [paidAt, setPaidAt]       = useState(() => todayLocalISO());
  const [reference, setReference] = useState("");
  const [notes, setNotes]         = useState("");
  const [saving, setSaving]       = useState(false);
  // Id del borrador que ESTA apertura ya confirmó (ver arriba, «BORRADORES»).
  const confirmadaRef = useRef<string | null>(null);

  const id = factura?.id ?? null;
  const balance = factura?.balance ?? 0;

  // Mismos valores iniciales que la ventana de cobro al abrirse.
  useEffect(() => {
    if (!abierta || id === null) return;
    setAmount(String(balance ?? 0));
    setMethod("cash");
    setPaidAt(todayLocalISO());
    setReference("");
    setNotes("");
  }, [abierta, id, balance]);

  const amountNum = Number(amount);
  const isOverpay = amountNum > balance + 0.001;
  const isInvalid = !amountNum || amountNum <= 0 || isOverpay;

  async function submit() {
    const invoice = factura;
    if (isInvalid || saving || !invoice) return;
    setSaving(true);
    alOcupar(true);
    try {
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
      const res = await fetch(`/api/invoices/${invoice.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: amountNum,
          method,
          paidAt: paidAtInstant(paidAt)?.toISOString(),
          reference: reference.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? t("clinical.paymentModal.registerError"));
      }
      toast.success(t("clinical.paymentModal.registerSuccess"));
      alCobrar();
    } catch (err: any) {
      toast.error(err.message ?? t("clinical.paymentModal.registerErrorGeneric"));
    } finally {
      setSaving(false);
      alOcupar(false);
    }
  }

  return {
    amount, setAmount,
    method, setMethod,
    paidAt, setPaidAt,
    reference, setReference,
    notes, setNotes,
    saving, amountNum, isOverpay, isInvalid, balance,
    submit,
  };
}

export type Cobro = ReturnType<typeof useCobro>;
