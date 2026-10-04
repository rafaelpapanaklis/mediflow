"use client";

// F-21 (ws1-t4, vuelta 2): antes de timbrar, «esto se cobró en septiembre y el
// CFDI sale con fecha de octubre». Solo avisa; el servidor lo repite (con la
// zona horaria de la clínica) y lo deja en la bitácora.

import { useLocale } from "@/i18n/i18n-provider";
import { avisoMesDeCobro } from "@/lib/cfdi/avisos-timbrado";

export function AvisoMesDeCobroCfdi({ pagos, className, style }: {
  pagos: readonly { paidAt?: string | Date | null; method?: string | null; amount?: number }[] | null | undefined;
  className?: string;
  style?: React.CSSProperties;
}) {
  const locale = useLocale();
  const aviso = avisoMesDeCobro({
    pagos: (pagos ?? []).map((p) => ({ paidAt: p.paidAt ?? null, method: p.method ?? null, amount: p.amount })),
    ahora: new Date(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    locale,
  });
  if (!aviso) return null;
  return <p className={className} style={style} data-cfdi-aviso-mes>{aviso.mensaje}</p>;
}
