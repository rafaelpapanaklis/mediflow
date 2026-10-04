// Aviso en «Hoy» (ws1-t5, F7): la caja lleva más de un día abierta sin corte.
// Componente de SERVIDOR: una sola lectura (la caja abierta de la clínica de
// la sesión). Solo a quien puede operar Caja (canUseCaja); en silencio si la
// caja se abrió hace menos de 24 h, si no hay caja abierta o si algo falla.
// La pantalla de Caja ya avisaba desde las 18 h; faltaba que se viera en Hoy.

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { diasDeCajaAbierta } from "@/lib/caja";
import { canUseCaja } from "@/lib/caja-pin";
import { textosDinero } from "@/lib/dinero/textos";

export async function AvisoCajaAbierta({
  clinicId,
  locale,
  user,
}: {
  clinicId: string;
  locale: string;
  user: { role?: string | null; canAccessCaja?: boolean | null };
}) {
  if (!clinicId || !canUseCaja(user)) return null;
  let dias = 0;
  try {
    dias = await diasDeCajaAbierta(clinicId);
  } catch {
    return null;
  }
  if (dias < 1) return null;
  const tx = textosDinero(locale).caja;
  return (
    <div
      role="alert"
      data-aviso-caja-abierta
      className="flex flex-wrap items-start gap-3 mb-4"
      style={{
        background: "var(--warning-soft)",
        border: "1px solid var(--warning-border-strong)",
        borderRadius: "var(--radius)",
        padding: 14,
      }}
    >
      <AlertTriangle size={18} strokeWidth={2} aria-hidden style={{ color: "var(--warning)", flexShrink: 0, marginTop: 2 }} />
      <div className="min-w-0 flex-1" style={{ minWidth: 180 }}>
        <div className="text-sm font-semibold" style={{ color: "var(--warning-strong)" }}>{tx.abiertaTitulo(dias)}</div>
        <div className="text-xs" style={{ color: "var(--text-2)", marginTop: 2 }}>{tx.abiertaTexto}</div>
      </div>
      <Link href="/dashboard/caja" className="text-sm font-semibold" style={{ color: "var(--warning-strong)", alignSelf: "center" }}>
        {tx.abiertaIr} →
      </Link>
    </div>
  );
}
