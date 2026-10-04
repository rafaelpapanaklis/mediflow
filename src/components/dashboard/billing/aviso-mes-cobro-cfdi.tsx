"use client";

// F-21 (ws1-t4, vuelta 2): antes de timbrar, «esto se cobró en septiembre y el
// CFDI sale con fecha de octubre». Solo avisa; el servidor lo repite (con la
// zona horaria de la clínica) y lo deja en la bitácora.

import { useLocale } from "@/i18n/i18n-provider";
import { avisoMesDeCobro, mesesAnterioresDeCobro, textoConfirmarGlobal } from "@/lib/cfdi/avisos-timbrado";

type Pago = { paidAt?: string | Date | null; method?: string | null; amount?: number };

const zonaDelNavegador = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** C-49: ¿hay cobros de un mes anterior? (entonces hay que confirmar lo de la global para timbrar). */
export function pideConfirmarGlobal(pagos: readonly Pago[] | null | undefined, ahora = new Date()): boolean {
  return mesesAnterioresDeCobro({
    pagos: (pagos ?? []).map((p) => ({ paidAt: p.paidAt ?? null, method: p.method ?? null, amount: p.amount })),
    ahora, timeZone: zonaDelNavegador(),
  }).length > 0;
}

export function AvisoMesDeCobroCfdi({ pagos, className, style, confirmado, onConfirmar }: {
  pagos: readonly Pago[] | null | undefined;
  className?: string;
  style?: React.CSSProperties;
  /** C-49: la casilla «no entró en la global» (solo con cobros de meses anteriores). */
  confirmado?: boolean;
  onConfirmar?: (v: boolean) => void;
}) {
  const locale = useLocale();
  const lista = (pagos ?? []).map((p) => ({ paidAt: p.paidAt ?? null, method: p.method ?? null, amount: p.amount }));
  const ahora = new Date();
  const aviso = avisoMesDeCobro({ pagos: lista, ahora, timeZone: zonaDelNavegador(), locale });
  if (!aviso) return null;
  const anteriores = mesesAnterioresDeCobro({ pagos: lista, ahora, timeZone: zonaDelNavegador() });
  return (
    <div className={className} style={style} data-cfdi-aviso-mes>
      <p style={{ margin: 0 }}>{aviso.mensaje}</p>
      {anteriores.length > 0 && onConfirmar && (
        <label style={{ display: "flex", gap: 6, alignItems: "flex-start", marginTop: 6, cursor: "pointer" }} data-cfdi-confirmar-global>
          <input type="checkbox" checked={!!confirmado} onChange={(e) => onConfirmar(e.target.checked)} style={{ marginTop: 2 }} />
          <span>{textoConfirmarGlobal(anteriores, locale)}</span>
        </label>
      )}
    </div>
  );
}
