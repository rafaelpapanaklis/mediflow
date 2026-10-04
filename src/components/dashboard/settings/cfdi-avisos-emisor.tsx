"use client";

// Avisos del emisor del CFDI (ws1-t8, F-15): CSD vencido o por vencer, RFC del panel distinto al
// del CSD y persona moral en «exento». Los calcula lib/cfdi/emisor.ts; aquí solo se pintan, con
// los tokens del panel (sin colores a mano).

import { AlertTriangle, XCircle } from "lucide-react";
import { useLocale } from "@/i18n/i18n-provider";
import { avisoExentoPersonaMoral, type AvisoEmisor } from "@/lib/cfdi/emisor";

function estilo(nivel: AvisoEmisor["nivel"]): React.CSSProperties {
  return nivel === "peligro"
    ? { background: "var(--danger-soft)", border: "1px solid var(--danger)", color: "var(--danger)", borderRadius: "var(--radius)", padding: 12 }
    : { background: "var(--warning-soft)", border: "1px solid var(--warning-border-strong, var(--warning))", color: "var(--warning-strong, var(--warning))", borderRadius: "var(--radius)", padding: 12 };
}

export function AvisosEmisor({ avisos }: { avisos: AvisoEmisor[] | null | undefined }) {
  if (!avisos || avisos.length === 0) return null;
  return (
    <div className="space-y-2" data-cfdi-avisos-emisor>
      {avisos.map((a) => (
        <div key={a.code} role={a.nivel === "peligro" ? "alert" : "status"} data-aviso={a.code}
          className="flex items-start gap-2 text-xs" style={estilo(a.nivel)}>
          {a.nivel === "peligro"
            ? <XCircle size={16} strokeWidth={1.75} aria-hidden style={{ flexShrink: 0 }} />
            : <AlertTriangle size={16} strokeWidth={1.75} aria-hidden style={{ flexShrink: 0 }} />}
          <span>{a.texto}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Aviso EN VIVO del formulario de datos fiscales: RFC de 12 caracteres + «Exento». No bloquea
 * el guardado (una S.C. de médicos sí puede ir exenta); solo lo dice antes de guardar.
 */
export function AvisoExentoPersonaMoral({ rfc, modo }: { rfc: string; modo: string }) {
  const locale = useLocale();
  const aviso = avisoExentoPersonaMoral(rfc, modo, locale);
  return aviso ? <AvisosEmisor avisos={[aviso]} /> : null;
}
