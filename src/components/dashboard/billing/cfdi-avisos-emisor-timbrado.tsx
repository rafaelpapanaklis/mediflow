"use client";

// En el formulario de timbrado: el CSD vencido o por vencer y la persona moral en «exento»
// (ws1-t8, F-15), para quien timbra, no solo para quien entra a Configuración. Lo trae
// GET /api/cfdi/usage (admin, el mismo que ya consulta el formulario) en `avisosEmisor`.
//
// Auditoría de uso C-44 (ws1-t4): si a la clínica le falta algo para timbrar (RFC, CP,
// régimen, organización o, en Live, el CSD) se dice ARRIBA, al abrir, con el enlace a
// Configuración, y `onBloqueo(true)` apaga el botón de timbrar. Antes se capturaba todo y el
// error llegaba al final.

import Link from "next/link";
import { useEffect, useState } from "react";
import type { AvisoEmisor } from "@/lib/cfdi/emisor";
import { AvisosEmisor } from "@/components/dashboard/settings/cfdi-avisos-emisor";
import { useLocale } from "@/i18n/i18n-provider";
import { tipoDePersona } from "@/lib/invoices/cfdi-reglas";
import { pedirUsoCfdi } from "./uso-cfdi-cliente";

type Retencion = { regimenEmisor: string | null; aplica: "si" | "no" | "duda"; encendida: boolean };

export function AvisosEmisorAlTimbrar({ onBloqueo, rfcReceptor }: {
  onBloqueo?: (bloqueado: boolean) => void;
  /** El RFC que se está tecleando: con el de una empresa se avisa ya del candado de retención. */
  rfcReceptor?: string | null;
} = {}) {
  const locale = useLocale();
  const en = (locale ?? "").startsWith("en");
  const [avisos, setAvisos] = useState<AvisoEmisor[] | null>(null);
  const [falta, setFalta] = useState<string | null>(null);
  const [retencion, setRetencion] = useState<Retencion | null>(null);
  useEffect(() => {
    let vivo = true;
    pedirUsoCfdi()
      .then((d) => {
        if (!vivo || !d) return;
        if (Array.isArray(d.avisosEmisor)) setAvisos(d.avisosEmisor);
        if (d.retencion && typeof d.retencion.aplica === "string") setRetencion(d.retencion);
        const texto = typeof d.textoFaltaEmisor === "string" && d.textoFaltaEmisor ? d.textoFaltaEmisor : null;
        setFalta(texto);
        onBloqueo?.(texto !== null);
      })
      .catch(() => {});
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <>
      {falta && (
        <div role="alert" data-cfdi-falta-emisor className="rounded-lg px-3 py-2 text-[11px]"
          style={{ background: "var(--danger-soft, rgba(225,29,72,0.08))", border: "1px solid var(--danger)", color: "var(--danger)" }}>
          <p style={{ margin: 0 }}>{falta}</p>
          <Link href="/dashboard/settings?tab=facturacion" className="underline font-semibold">
            {en ? "Go to Billing settings" : "Ir a Configuración → Facturación"}
          </Link>
        </div>
      )}
      {retencion && tipoDePersona(rfcReceptor) === "moral" && retencion.aplica !== "no" && (
        <p className="rounded-lg px-3 py-2 text-[11px]" data-cfdi-aviso-retencion
          style={{ margin: 0, background: "var(--warning-soft)", border: "1px solid var(--warning-border-strong)", color: "var(--warning-strong)" }}>
          {retencion.aplica === "si" && retencion.encendida
            ? (en
              ? "This RFC is a company's: it withholds ISR (and 2/3 of the VAT if the service carries it). The CFDI will say so and the invoice is paid with the net amount."
              : "Este RFC es de una empresa: te retiene ISR (y 2/3 del IVA si el servicio lo lleva). El CFDI lo dirá y la factura se paga con el neto.")
            : retencion.aplica === "duda"
              ? (en
                ? "This RFC is a company's. To invoice it from RESICO (626) your RFC must be saved in Settings → Billing."
                : "Este RFC es de una empresa. Para facturarle desde RESICO (626) hay que tener tu RFC guardado en Configuración → Facturación.")
              : (en
                ? "This RFC is a company's: it would have to withhold ISR from you and that invoice can't be issued from DaleControl yet (turn on «Invoice companies with withholding» in Settings → Billing, after checking with your accountant)."
                : "Este RFC es de una empresa: te tendría que retener ISR y esa factura todavía no se puede emitir desde DaleControl (enciende «Facturar a empresas con retención» en Configuración → Facturación, después de confirmarlo con tu contador).")}
        </p>
      )}
      <AvisosEmisor avisos={avisos} />
    </>
  );
}
