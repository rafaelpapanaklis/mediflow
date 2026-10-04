"use client";

// «Cobrado sin CFDI» del mes, para el contador (ws1-t8, auditoría CFDI F-09). Va en
// Configuración → Facturación (solo dueño y administrador). El cálculo y el CSV los hace
// GET /api/cfdi/cobrado-sin-cfdi; aquí solo se elige el mes, se resume y se descarga.

import { useEffect, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { useLocale } from "@/i18n/i18n-provider";
import type { ReporteCobradoSinCfdi } from "@/lib/cfdi/cobrado-sin-cfdi";

function mesDeHoy(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const T = {
  es: {
    titulo: "Cobrado sin CFDI (para tu contador)",
    sub: "Lo que cobraste en el mes y no tiene factura propia: es lo que tu contador incluye en la factura global a público en general. Lo ya timbrado aquí no aparece, para que no se cuente dos veces.",
    mes: "Mes",
    cargando: "Calculando…",
    error: "No se pudo calcular el reporte.",
    total: "Total para la factura global",
    base: "Base",
    iva: "IVA",
    cobros: (n: number, notas: number) => `${n} ${n === 1 ? "cobro" : "cobros"} de ${notas} ${notas === 1 ? "nota" : "notas"}`,
    porForma: "Por forma de pago SAT",
    sinForma: "Por definir (Mercado Pago o tarjeta sin tipo)",
    conSaldo: (n: number) => `${n} ${n === 1 ? "cobro es" : "cobros son"} de notas con saldo: si van en la global, esas notas ya no se timbran solas después.`,
    anticipos: (n: number, m: string) => `Aparte: ${n} ${n === 1 ? "cobro pagado" : "cobros pagados"} con saldo a favor (${m}). No es dinero nuevo: contó el mes en que entró.`,
    enOtroCfdi: (n: number, m: string, folios: string) => `Fuera de la global: ${m} que entraron este mes y ya van en el CFDI de ${folios} (se usaron como saldo a favor). Un mismo ingreso no va en dos CFDI.`,
    reembolsos: (n: number, m: string) => `Aparte: ${n} ${n === 1 ? "reembolso" : "reembolsos"} de notas sin CFDI (${m}).`,
    revision: (n: number) => `${n} ${n === 1 ? "cobro tiene" : "cobros tienen"} un timbre en duda: revisa en Facturapi si el CFDI salió antes de incluirlos.`,
    excluidos: (n: number) => `${n} ${n === 1 ? "cobro ya tiene" : "cobros ya tienen"} CFDI y no se cuentan.`,
    sinNota: (m: string) => `Incluye ${m} que entraron sin nota (anticipos por Mercado Pago o excedentes de cobro automático), en el mes en que entraron, como en Finanzas.`,
    traspasos: (n: number, m: string) => `${n} ${n === 1 ? "cobro pasó" : "cobros pasaron"} a saldo a favor (${m}). No es un reembolso: el dinero no salió y no se resta.`,
    descargar: "Descargar para Excel (CSV)",
    actualizar: "Actualizar",
    vacio: "No hay cobros sin CFDI en este mes.",
  },
  en: {
    titulo: "Collected without CFDI (for your accountant)",
    sub: "What you collected in the month that has no invoice of its own: your accountant includes it in the global invoice to the general public. What was already stamped here is left out so it isn't counted twice.",
    mes: "Month",
    cargando: "Calculating…",
    error: "Could not build the report.",
    total: "Total for the global invoice",
    base: "Base",
    iva: "VAT",
    cobros: (n: number, notas: number) => `${n} ${n === 1 ? "payment" : "payments"} from ${notas} ${notas === 1 ? "receipt" : "receipts"}`,
    porForma: "By SAT payment form",
    sinForma: "To be defined (Mercado Pago or untyped card)",
    conSaldo: (n: number) => `${n} ${n === 1 ? "payment belongs" : "payments belong"} to receipts with a balance: if they go in the global invoice, those receipts must not be stamped on their own later.`,
    anticipos: (n: number, m: string) => `Separate: ${n} ${n === 1 ? "payment" : "payments"} made with credit balance (${m}). It isn't new money: it counted in the month it came in.`,
    enOtroCfdi: (n: number, m: string, folios: string) => `Left out of the global invoice: ${m} that came in this month and are already in the CFDI of ${folios} (used as credit balance). The same income never goes in two CFDI.`,
    reembolsos: (n: number, m: string) => `Separate: ${n} ${n === 1 ? "refund" : "refunds"} of receipts without CFDI (${m}).`,
    revision: (n: number) => `${n} ${n === 1 ? "payment has" : "payments have"} a stamp in doubt: check in Facturapi whether the CFDI was issued before including them.`,
    excluidos: (n: number) => `${n} ${n === 1 ? "payment already has" : "payments already have"} a CFDI and are not counted.`,
    sinNota: (m: string) => `Includes ${m} received without a receipt (Mercado Pago deposits or automatic-charge overpayments), in the month they came in, as in Finances.`,
    traspasos: (n: number, m: string) => `${n} ${n === 1 ? "payment was" : "payments were"} moved to credit balance (${m}). It isn't a refund: the money didn't leave and isn't subtracted.`,
    descargar: "Download for Excel (CSV)",
    actualizar: "Refresh",
    vacio: "No payments without CFDI this month.",
  },
};

const FORMAS: Record<string, string> = { "01": "01 Efectivo", "02": "02 Cheque", "03": "03 Transferencia", "04": "04 Tarjeta de crédito", "28": "28 Tarjeta de débito" };

export function CobradoSinCfdiCard() {
  const locale = useLocale();
  const en = (locale ?? "").startsWith("en");
  const tx = en ? T.en : T.es;
  const pesos = (n: number) => `$${n.toLocaleString(en ? "en-US" : "es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const [mes, setMes] = useState(mesDeHoy());
  const [rep, setRep] = useState<ReporteCobradoSinCfdi | null>(null);
  const [estado, setEstado] = useState<"cargando" | "listo" | "error">("cargando");
  const [vuelta, setVuelta] = useState(0);

  useEffect(() => {
    if (!/^\d{4}-\d{2}$/.test(mes)) return;
    let vivo = true;
    setEstado("cargando");
    fetch(`/api/cfdi/cobrado-sin-cfdi?mes=${mes}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => { if (vivo) { setRep(d); setEstado("listo"); } })
      .catch(() => { if (vivo) setEstado("error"); });
    return () => { vivo = false; };
  }, [mes, vuelta]);

  const suma = (xs: { importe: number }[]) => xs.reduce((s, x) => s + x.importe, 0);
  const excluidos = rep ? rep.excluidos.timbradas + rep.excluidos.timbradoPorPago : 0;

  return (
    <div className="card" data-cobrado-sin-cfdi>
      <div className="card__header">
        <div>
          <div className="card__title">{tx.titulo}</div>
          <div className="card__sub">{tx.sub}</div>
        </div>
      </div>
      <div className="card__body space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="field-new" style={{ minWidth: 0 }}>
            <span className="field-new__label">{tx.mes}</span>
            <input type="month" className="input-new" value={mes} onChange={(e) => setMes(e.target.value)} />
          </label>
          <button type="button" className="btn-new btn-new--ghost btn-new--sm" onClick={() => setVuelta((v) => v + 1)} disabled={estado === "cargando"}>
            <RefreshCw size={14} strokeWidth={1.75} aria-hidden /> {tx.actualizar}
          </button>
          <a className="btn-new btn-new--secondary btn-new--sm" href={`/api/cfdi/cobrado-sin-cfdi?mes=${mes}&formato=csv`} download>
            <Download size={14} strokeWidth={1.75} aria-hidden /> {tx.descargar}
          </a>
        </div>

        {estado === "cargando" && <p className="text-sm" style={{ color: "var(--text-3)" }}>{tx.cargando}</p>}
        {estado === "error" && <p className="text-sm" role="alert" style={{ color: "var(--danger)" }}>{tx.error}</p>}

        {estado === "listo" && rep && (
          <>
            {rep.filas.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--text-2)" }}>{tx.vacio}</p>
            ) : (
              <div style={{ background: "var(--bg-elev-2)", borderRadius: "var(--radius)", padding: 12 }}>
                <div className="text-xs" style={{ color: "var(--text-3)" }}>{tx.total}</div>
                <div className="text-xl font-semibold" style={{ color: "var(--text-1)" }} data-total>{pesos(rep.total)}</div>
                <div className="text-xs" style={{ color: "var(--text-2)" }}>
                  {tx.base} {pesos(rep.base)} · {tx.iva} {pesos(rep.iva)} · {tx.cobros(rep.filas.length, rep.notas)}
                </div>
                <div className="text-xs mt-2" style={{ color: "var(--text-3)" }}>{tx.porForma}</div>
                <ul className="text-xs" style={{ color: "var(--text-2)" }}>
                  {rep.porForma.map((f) => (
                    <li key={String(f.formaSat)}>{f.formaSat ? (FORMAS[f.formaSat] ?? f.formaSat) : tx.sinForma}: {pesos(f.importe)}</li>
                  ))}
                </ul>
              </div>
            )}
            <ul className="text-xs space-y-1" style={{ color: "var(--text-2)" }}>
              {rep.conSaldo > 0 && <li style={{ color: "var(--warning-strong)" }}>{tx.conSaldo(rep.conSaldo)}</li>}
              {rep.apartados.enRevision.length > 0 && <li style={{ color: "var(--warning-strong)" }}>{tx.revision(rep.apartados.enRevision.length)}</li>}
              {rep.apartados.anticipos.length > 0 && <li>{tx.anticipos(rep.apartados.anticipos.length, pesos(suma(rep.apartados.anticipos)))}</li>}
              {rep.apartados.reembolsos.length > 0 && <li>{tx.reembolsos(rep.apartados.reembolsos.length, pesos(suma(rep.apartados.reembolsos)))}</li>}
              {(rep.anticiposSinNota ?? 0) > 0 && <li>{tx.sinNota(pesos(rep.anticiposSinNota))}</li>}
              {(rep.apartados.enOtroCfdi?.length ?? 0) > 0 && <li data-en-otro-cfdi>{tx.enOtroCfdi(rep.apartados.enOtroCfdi.length, pesos(suma(rep.apartados.enOtroCfdi)), Array.from(new Set(rep.apartados.enOtroCfdi.map((f) => f.folioDestino ?? ""))).filter(Boolean).join(", "))}</li>}
              {(rep.apartados.traspasos?.length ?? 0) > 0 && <li>{tx.traspasos(rep.apartados.traspasos.length, pesos(suma(rep.apartados.traspasos)))}</li>}
              {excluidos > 0 && <li>{tx.excluidos(excluidos)}</li>}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
