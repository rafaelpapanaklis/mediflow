"use client";

// Antes de timbrar: con qué clave SAT e IVA sale cada concepto, y el aviso de los que no se
// ligaron a su procedimiento (ws1-t4, auditoría de uso C-40: «un blanqueamiento marcado con 16%
// salía exento sin avisar»). Lo calcula GET /api/cfdi/conceptos con la MISMA regla del timbrado.

import { useEffect, useState } from "react";
import { useLocale } from "@/i18n/i18n-provider";

interface Fila { descripcion: string; claveSat: string; ivaModo: "exento" | "iva16"; origenIva: string; ambiguo: boolean }

export function ConceptosAlTimbrar({ invoiceId, taxMode, className, style, titulo }: {
  /** Encabezado de la lista (p. ej. en «Facturar este pago»). */
  titulo?: string;
  invoiceId: string | null | undefined;
  /** El «Impuestos» elegido en el formulario: es el IVA de los conceptos sin procedimiento. */
  taxMode: string | null | undefined;
  className?: string;
  style?: React.CSSProperties;
}) {
  const locale = useLocale();
  const en = (locale ?? "").startsWith("en");
  const [datos, setDatos] = useState<{ conceptos: Fila[]; aviso: string | null } | null>(null);

  useEffect(() => {
    if (!invoiceId) { setDatos(null); return; }
    let vivo = true;
    const q = new URLSearchParams({ invoiceId });
    if (taxMode === "exento" || taxMode === "iva16") q.set("taxMode", taxMode);
    fetch(`/api/cfdi/conceptos?${q}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (vivo && d && Array.isArray(d.conceptos)) setDatos(d); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [invoiceId, taxMode]);

  if (!datos || datos.conceptos.length === 0) return null;
  const iva = (m: string) => (m === "iva16" ? (en ? "16% VAT" : "IVA 16%") : (en ? "VAT exempt" : "Exento"));
  return (
    <div data-cfdi-conceptos>
      <p className="text-[11px]" style={{ color: "var(--text-3)", margin: 0 }}>
        {titulo ?? (en ? "How each item goes on the CFDI:" : "Así sale cada concepto en el CFDI:")}
      </p>
      <ul className="text-[11px]" style={{ color: "var(--text-2)", margin: "2px 0 0", paddingLeft: 16 }}>
        {datos.conceptos.slice(0, 8).map((c, i) => (
          <li key={i} style={{ overflowWrap: "anywhere" }}>
            {c.descripcion} · {c.claveSat} · {iva(c.ivaModo)}
          </li>
        ))}
        {datos.conceptos.length > 8 && <li>{en ? `…and ${datos.conceptos.length - 8} more` : `…y ${datos.conceptos.length - 8} más`}</li>}
      </ul>
      {datos.aviso && <p className={className} style={{ ...style, marginTop: 6 }} role="status" data-cfdi-conceptos-aviso>{datos.aviso}</p>}
    </div>
  );
}
