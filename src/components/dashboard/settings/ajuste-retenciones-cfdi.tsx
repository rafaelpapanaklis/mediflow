"use client";

// «Facturar a empresas con retención» (ws1-t4, vuelta 2: F-01). APAGADO por defecto.
// Encendido, un CFDI de una clínica persona FÍSICA 612 o 626 (RESICO) a una persona
// moral lleva la retención de ISR (10% / 1.25%) y, si el servicio está gravado, 2/3 del
// IVA. Apagado, no se timbra a empresas desde DaleControl (candado de la Tanda 0). El
// RESICO de personas morales no tiene retención (auditoría de uso C-41).
// C-50: lo que se dice sale del régimen y el RFC GUARDADOS; sin guardar, se pide guardarlos
// (antes decía «Tu régimen no tiene esta retención» junto a un 612 que nadie guardó).

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { useLocale } from "@/i18n/i18n-provider";

interface Estado { disponible: boolean; encendido: boolean; regimenFiscal: string | null; aplica?: "si" | "no" | "duda" | null }

/** `refreshKey`: súbelo al guardar los datos fiscales para que la tarjeta lea el régimen nuevo. */
export function AjusteRetencionesCfdi({ refreshKey = 0 }: { refreshKey?: number } = {}) {
  const en = useLocale().startsWith("en");
  const [estado, setEstado] = useState<Estado | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    let vivo = true;
    fetch("/api/settings/cfdi/retenciones")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (vivo && d) setEstado(d); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [refreshKey]);

  if (!estado) return null;
  // Respaldo para un servidor que todavía no manda `aplica`.
  const aplica = estado.aplica !== undefined
    ? estado.aplica
    : estado.regimenFiscal ? (estado.regimenFiscal === "612" || estado.regimenFiscal === "626" ? "si" : "no") : null;

  async function cambiar(encendido: boolean) {
    setGuardando(true);
    try {
      const r = await fetch("/api/settings/cfdi/retenciones", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ encendido }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error ?? (en ? "Could not save." : "No se pudo guardar."));
      setEstado((e) => (e ? { ...e, encendido } : e));
      toast.success(encendido
        ? (en ? "Withholding on: invoices to companies carry the ISR withholding." : "Retenciones encendidas: las facturas a empresas llevan la retención de ISR.")
        : (en ? "Withholding off: invoices to companies are issued outside DaleControl." : "Retenciones apagadas: las facturas a empresas se emiten por fuera."));
    } catch (e: any) {
      toast.error(e?.message ?? "Error");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="rounded-lg p-3 mt-3" style={{ border: "1px solid var(--border)" }} data-ajuste-retenciones>
      <label className="flex items-start gap-2.5" style={{ cursor: estado.disponible ? "pointer" : "default" }}>
        <input
          type="checkbox"
          className="mt-1"
          checked={estado.encendido}
          disabled={!estado.disponible || guardando}
          onChange={(e) => cambiar(e.target.checked)}
        />
        <span>
          <span className="block text-sm font-semibold" style={{ color: "var(--text-1)" }}>
            {en ? "Invoice companies with withholding" : "Facturar a empresas con retención"}
          </span>
          <span className="block text-xs mt-0.5" style={{ color: "var(--text-3)" }}>
            {en
              ? "When an individual in regime 612 or 626 (RESICO) invoices a company (12-character RFC), the company withholds ISR (10% or 1.25%) and, if the service carries VAT, 2/3 of the VAT; the CFDI states it. A company in RESICO has no withholding. Off: those invoices are issued outside DaleControl. Check it with your accountant before turning it on."
              : "Cuando una persona física en 612 o 626 (RESICO) le factura a una empresa (RFC de 12 caracteres), la empresa retiene ISR (10% o 1.25%) y, si el servicio lleva IVA, 2/3 del IVA; el CFDI lo dice. Una persona moral en RESICO no tiene retención. Apagado: esas facturas se emiten por fuera. Confírmalo con tu contador antes de encenderlo."}
          </span>
          {aplica === null && (
            <span className="block text-xs mt-1" style={{ color: "var(--text-3)" }} data-retencion-sin-regimen>
              {en ? "Save your tax details above first: whether this applies depends on your regime and your RFC." : "Guarda primero tus datos fiscales arriba: si te aplica depende de tu régimen y tu RFC."}
            </span>
          )}
          {aplica === "no" && (
            <span className="block text-xs mt-1" style={{ color: "var(--text-3)" }}>
              {en ? `Your saved regime (${estado.regimenFiscal}) and RFC don't have this withholding: this setting doesn't change anything for you.` : `Tu régimen guardado (${estado.regimenFiscal}) y tu RFC no tienen esta retención: este ajuste no cambia nada para ti.`}
            </span>
          )}
          {aplica === "duda" && (
            <span className="block text-xs mt-1" style={{ color: "var(--warning-strong)" }}>
              {en ? "Save your RFC: in RESICO (626) the withholding applies only to individuals (13-character RFC)." : "Guarda tu RFC: en RESICO (626) la retención solo aplica a personas físicas (RFC de 13 caracteres)."}
            </span>
          )}
          {!estado.disponible && (
            <span className="block text-xs mt-1" style={{ color: "var(--warning-strong)" }}>
              {en ? "Not available yet: the database update is pending." : "Todavía no disponible: falta aplicar la actualización de la base (sql/ws1-t4-cfdi-retenciones.sql)."}
            </span>
          )}
        </span>
      </label>
    </div>
  );
}
