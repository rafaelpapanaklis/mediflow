"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { AlertTriangle, Loader2 } from "lucide-react";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { fechaHoraAdmin } from "@/lib/admin/zona-horaria";

/**
 * Aviso PERSISTENTE de /admin › Pagos (decisión #1(a) de Rafael): clínicas con la tarjeta viva y una factura del plan
 * todavía ABIERTA después de un pago manual. Se calcula en el servidor contra Stripe en cada carga (no depende de que
 * alguien haya visto el aviso de la pantalla donde se confirmó), así que no se pierde al recargar y también sale el
 * SPEI/OXXO de Stripe. «Reintentar» vuelve a marcar la factura como pagada fuera de Stripe; el cron diario lo intenta solo.
 */

export const TITULO_FACTURAS_TARJETA_PENDIENTES =
  "Clínicas con la tarjeta viva y una factura del plan abierta después de un pago manual";

export interface FacturaTarjetaPendienteDTO {
  clinicId: string;
  clinicName: string;
  pagoManualEn: string;
  /** Facturas del ciclo del pago que siguen abiertas (el marcado falló): se pueden reintentar. */
  facturas: string[];
  /** De ellas, las de meses sin servicio (suspendida) que faltan por anular: no se deben. */
  suspendidas?: string[];
  /** El prepago de varios meses no tiene (o no llega) la pausa del cobro de la tarjeta: fecha en que debería reanudarse. */
  pausaPendiente?: string | null;
}

export function FacturasTarjetaPendientes({ items }: { items: FacturaTarjetaPendienteDTO[] }) {
  const router = useRouter();
  const [filas, setFilas] = useState(items);
  useEffect(() => setFilas(items), [items]);
  const [cargando, setCargando] = useState<string | null>(null);

  async function reintentar(f: FacturaTarjetaPendienteDTO) {
    setCargando(f.clinicId);
    try {
      const res = await fetch("/api/admin/billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "marcar_factura_fuera_de_stripe", clinicId: f.clinicId }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; facturaTarjeta?: { tipo?: string } };
      if (!res.ok) throw new Error(data.error ?? "No se pudo reintentar");
      if (data.facturaTarjeta?.tipo === "fallo") {
        toast.error("Stripe sigue sin contestar. Vuelve a intentarlo en un momento o márcala a mano en Stripe.");
        return;
      }
      toast.success(`${f.clinicName}: factura de tarjeta marcada como pagada`);
      setFilas((prev) => prev.filter((x) => x.clinicId !== f.clinicId));
      router.refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setCargando(null);
    }
  }

  if (filas.length === 0) return null;

  return (
    <div style={{ maxWidth: 1800, margin: "0 auto", padding: "24px 24px 0" }} id="facturas-tarjeta-pendientes">
      <div
        role="alert"
        data-aviso="facturas-tarjeta-pendientes"
        style={{
          borderRadius: 14, padding: "14px 16px",
          border: "1.5px solid var(--warning-border-strong, rgba(217,119,6,0.4))",
          background: "var(--warning-soft, rgba(217,119,6,0.08))", color: "var(--text-1)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 14 }}>
          <AlertTriangle size={16} aria-hidden /> {TITULO_FACTURAS_TARJETA_PENDIENTES} ({filas.length})
        </div>
        <p style={{ margin: "4px 0 10px", fontSize: 12.5, color: "var(--text-2)" }}>
          Stripe podría reintentar (o cobrar) la tarjeta. Reintenta, o hazlo a mano en Stripe; el cron diario también lo intenta. Los meses en que estuvo suspendida no se deben: sus facturas se anulan, no se cobran.
        </p>
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
          {filas.map((f) => (
            <li key={f.clinicId} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, fontSize: 13 }}>
              <strong>{f.clinicName}</strong>
              <span style={{ color: "var(--text-3)" }}>
                pagó a mano {fechaHoraAdmin(f.pagoManualEn) ?? ""}
                {f.facturas.length > 0 ? ` · ${f.facturas.length === 1 ? "factura abierta" : "facturas abiertas"} del ciclo ${f.facturas.join(", ")}` : ""}
                {f.pausaPendiente ? ` · falta pausar el cobro de la tarjeta hasta ${fechaHoraAdmin(f.pausaPendiente) ?? ""}` : ""}
                {(f.suspendidas ?? []).length > 0 ? ` · por anular (meses sin servicio): ${(f.suspendidas ?? []).join(", ")}` : ""}
              </span>
              {(f.facturas.length > 0 || f.pausaPendiente) && (
                <span style={{ marginLeft: "auto" }}>
                  <ButtonNew size="sm" variant="primary" onClick={() => reintentar(f)} disabled={cargando === f.clinicId}>
                    {cargando === f.clinicId ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null}
                    Reintentar
                  </ButtonNew>
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
