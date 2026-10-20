"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { AlertTriangle, Loader2 } from "lucide-react";
import { ButtonNew } from "@/components/ui/design-system/button-new";

/**
 * Aviso del admin cuando, al CONFIRMAR un pago manual, no se pudo marcar la factura de tarjeta del plan como pagada
 * fuera de Stripe (decisión de Rafael, #1(a)). La activación de la clínica NO se deshizo; Stripe podría reintentar el
 * cobro hasta que se marque. «Reintentar» vuelve a pedirlo (idempotente) y, si sale bien, el aviso desaparece.
 */

export const MENSAJE_AVISO_FACTURA_TARJETA =
  "No pudimos marcar la factura de tarjeta como pagada; Stripe podría reintentar el cobro. Reintenta o márcala a mano en Stripe.";

export interface AvisoFacturaTarjetaDatos {
  clinicId: string;
  clinicName?: string | null;
  /** El texto del fallo (marcar la factura, o pausar el cobro de los meses prepagados). Sin él, el de la factura. */
  mensaje?: string | null;
}

type RespuestaMarcado = { facturaTarjeta?: { tipo?: string; mensaje?: string; pausa?: { tipo?: string; hasta?: string } } | null } | null | undefined;

/** Los datos del aviso a partir de la respuesta de una confirmación que falló al marcar / pausar. */
export function datosDelAviso(data: RespuestaMarcado, clinicId: string, clinicName?: string | null): AvisoFacturaTarjetaDatos {
  return { clinicId, clinicName, mensaje: data?.facturaTarjeta?.mensaje ?? null };
}

/** ¿La respuesta de una confirmación trae el fallo de marcado? (si trae `marcadas`, se avisa en un toast aparte). */
export function fallóElMarcadoDeLaFacturaTarjeta(data: RespuestaMarcado): boolean {
  return data?.facturaTarjeta?.tipo === "fallo";
}

/** Toast de éxito cuando sí se marcó alguna factura. */
export function avisarSiSeMarcoLaFacturaTarjeta(data: RespuestaMarcado): void {
  if (data?.facturaTarjeta?.tipo === "marcadas") {
    toast.success("La factura de tarjeta quedó pagada fuera de Stripe: ya no la reintentará.");
  }
  // Q1: un prepago de varios meses pausa el cobro de la tarjeta hasta que termine (sin cancelar nada).
  const pausa = data?.facturaTarjeta?.pausa;
  if (pausa?.tipo === "pausada" && pausa.hasta) {
    toast.success(`El cobro de la tarjeta queda pausado hasta ${new Date(pausa.hasta).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" })}; después Stripe vuelve a cobrar solo.`);
  }
}

export function AvisoFacturaTarjeta({
  aviso,
  onResuelto,
  onCerrar,
}: {
  aviso: AvisoFacturaTarjetaDatos | null;
  onResuelto: () => void;
  onCerrar: () => void;
}) {
  const [reintentando, setReintentando] = useState(false);
  if (!aviso) return null;

  async function reintentar() {
    if (!aviso) return;
    setReintentando(true);
    try {
      const res = await fetch("/api/admin/billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "marcar_factura_fuera_de_stripe", clinicId: aviso.clinicId }),
      });
      const data = (await res.json().catch(() => ({}))) as RespuestaMarcado & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "No se pudo reintentar");
      if (fallóElMarcadoDeLaFacturaTarjeta(data)) {
        toast.error("Stripe sigue sin contestar. Vuelve a intentarlo en un momento o márcala a mano en Stripe.");
        return;
      }
      toast.success(data?.facturaTarjeta?.tipo === "marcadas" ? "Factura de tarjeta marcada como pagada" : "No hay factura de tarjeta abierta que marcar");
      onResuelto();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setReintentando(false);
    }
  }

  return (
    <div
      role="alert"
      data-aviso="factura-tarjeta"
      style={{
        display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 10,
        background: "var(--warning-soft, rgba(217,119,6,0.1))", border: "1px solid var(--warning-border-strong, rgba(217,119,6,0.35))",
        color: "var(--text-1)", fontSize: 13,
      }}
    >
      <AlertTriangle size={16} aria-hidden />
      <div style={{ flex: 1, minWidth: 220 }}>
        {aviso.clinicName ? <strong>{aviso.clinicName}: </strong> : null}
        {aviso.mensaje || MENSAJE_AVISO_FACTURA_TARJETA}
      </div>
      <ButtonNew size="sm" variant="primary" onClick={reintentar} disabled={reintentando}>
        {reintentando ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null}
        Reintentar
      </ButtonNew>
      <ButtonNew size="sm" variant="ghost" onClick={onCerrar} disabled={reintentando}>
        Cerrar
      </ButtonNew>
    </div>
  );
}
