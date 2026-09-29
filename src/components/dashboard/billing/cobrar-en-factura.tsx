"use client";

// ws1-t4 — «Cobrar» SIEMPRE abre la ventana completa de la factura.
//
// Los botones de cobro que solo conocen el id de la factura (el recuadro de
// cobranza de ortodoncia en la agenda y en la ficha, la Sección F del caso,
// la lista de mensualidades de Caja/Cobranza) abrían la ventana de cobro
// suelta (`PaymentModal`: resumen, monto, método…). Ahora abren ESTA: trae la
// factura completa (GET /api/invoices/:id — mismo clinicId de sesión, mismo
// permiso billing.view y misma visibilidad por paciente que la Caja) y monta
// `InvoiceDetailModal` con el panel «Registrar pago» ya abierto y el MISMO
// monto sugerido que antes recibía la ventana suelta.
//
// Todo lo del cobro (permiso, caja cerrada, Mercado Pago, anticipos, no
// cobrar dos veces) lo hace la ventana completa: aquí no se decide nada.

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { InvoiceDetailModal } from "./invoice-detail-modal";
import { nombreDelPacienteDeFactura } from "./cobrar-en-factura-core";

export interface CobrarEnFacturaProps {
  invoiceId: string;
  /** Si no llega, sale de la propia factura. */
  patientName?: string;
  /** El monto con que nace «Monto a cobrar» (ver `InvoiceDetailModal.montoSugerido`). */
  montoSugerido?: number;
  /** Interruptor `menu-dos-niveles`, el que ya tenía quien abría la ventana suelta. */
  rediseno: boolean;
  /** Clinic.cfdiTaxMode leído en el servidor. Obligatorio por lo mismo que en `InvoiceDetailModal`. */
  clinicTaxMode: string | null;
  /** Se cerró la ventana (con o sin pago). */
  onClose: () => void;
  /**
   * Refrescar la pantalla de origen. Se llama AL CERRAR (y al registrar un
   * pago), no a mitad: varias pantallas de origen se desmontan mientras
   * recargan y se llevarían la ventana abierta por delante (p. ej. tras
   * «Registrar anticipo recibido», que no cierra). Siempre al cerrar, haya o
   * no cambios: un pago de Mercado Pago puede acreditarse con la ventana abierta.
   */
  onRefrescar: () => void;
  /** Se registró un pago (ya refrescado). Sin él, cierra (`onClose`). */
  onCobrado?: () => void;
  /** La factura llegó y la ventana ya se ve (para apagar un «cargando» de quien la abrió). */
  onLista?: () => void;
}

export function CobrarEnFactura({ invoiceId, patientName, montoSugerido, rediseno, clinicTaxMode, onClose, onRefrescar, onCobrado, onLista }: CobrarEnFacturaProps) {
  const [factura, setFactura] = useState<any | null>(null);

  useEffect(() => {
    let vivo = true;
    setFactura(null);
    fetch(`/api/invoices/${encodeURIComponent(invoiceId)}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d?.error ?? "No se pudo abrir la factura.");
        return d;
      })
      .then((d) => { if (vivo) { setFactura(d); onLista?.(); } })
      .catch((e: any) => {
        if (!vivo) return;
        toast.error(e?.message ?? "No se pudo abrir la factura.");
        onClose();
      });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId]);

  if (!factura) return null;

  return (
    <InvoiceDetailModal
      open
      invoice={factura}
      patientName={patientName || nombreDelPacienteDeFactura(factura)}
      onClose={() => { onClose(); onRefrescar(); }}
      onMutated={() => {}}
      clinicTaxMode={clinicTaxMode}
      rediseno={rediseno}
      abrirCobro
      montoSugerido={montoSugerido}
      onCobrado={onCobrado ? () => { onRefrescar(); onCobrado(); } : undefined}
    />
  );
}
