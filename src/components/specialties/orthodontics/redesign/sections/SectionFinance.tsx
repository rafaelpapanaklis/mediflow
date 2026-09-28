"use client";
// Sección F — Plan financiero del tratamiento (ws1-t1, Ola 1 · Cobro).
//
// Reescrita de cero: la versión de Ola 0 pintaba una maqueta (installments
// falsos, "CFDI 4.0 Facturapi" que no existe, "Cobrar siguiente" que no
// pasaba por Caja — bloque S3, QUITAR). Esta versión es la decisión 1 de la
// arquitectura: el dinero vive en la factura a plazos del tratamiento
// (`invoice_payment_terms` + `payments`), nunca en OrthoPaymentPlan/
// OrthoInstallment.
//
// Autofetch: se basta con `treatmentPlanId` — llama a `cargarPanelDeCobro`
// al montar y después de cada acción (mismo espíritu que
// `AvisoAnticiposPorRevisar` en Caja). Así OrthodonticsRedesignClient.tsx
// (compartido con las otras 5 partes de la ola) no necesita hilar props
// financieras nuevas.
//
// F1 (precio único) queda resuelto solo: no hay más precio que el de la
// factura del tratamiento. F3/F4 (cobrar mensualidad o abono extra) y F2
// (abrir el plan) reusan el editor de facturas y el modal de cobro de
// SIEMPRE (`InvoiceEditorModal`, `PaymentModal`) — nunca se toca
// `src/app/api/invoices/**`. F6 (CFDI de mensualidades) y F13 (cobro
// automático con tarjeta) quedan pendientes de Rafael — ver el hueco abajo.

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Banknote, CalendarClock, Percent, Plus, Printer, Settings2 } from "lucide-react";
import { Btn } from "../atoms/Btn";
import { Card } from "../atoms/Card";
import { Pill } from "../atoms/Pill";
import { ProgressBar } from "../atoms/ProgressBar";
import { fmtDateShort, fmtMoney } from "../atoms/format";
import { InvoiceEditorModal } from "@/components/billing/invoice-editor-modal";
import { PaymentModal, type PaymentInvoice } from "@/components/dashboard/billing/payment-modal";
import { DrawerCambiarPlanDePago } from "../drawers/DrawerCambiarPlanDePago";
import { DrawerCobrarExtra } from "../drawers/DrawerCobrarExtra";
import { DrawerConfigCobro } from "../drawers/DrawerConfigCobro";
import { DrawerElegirDescuento } from "../drawers/DrawerElegirDescuento";
import { DrawerPromesaDePago } from "../drawers/DrawerPromesaDePago";
import { cargarPanelDeCobro, type PanelDeCobro } from "@/app/actions/orthodontics/cobro/cargarPanelDeCobro";
import { resolverPromesaDePago } from "@/app/actions/orthodontics/cobro/resolverPromesaDePago";
import { abrirPlanDePago } from "@/app/actions/orthodontics/cobro/abrirPlanDePago";
import { isFailure } from "@/app/actions/orthodontics/result";
import type { CuotaConEstado } from "@/lib/invoices/plan-de-pagos";

export interface SectionFinanceProps {
  treatmentPlanId: string;
  patientId: string;
  patientName?: string;
}

type DrawerKind =
  | { kind: "abrir-plan" }
  | { kind: "cobrar" }
  | { kind: "extra" }
  | { kind: "cambiar-plan" }
  | { kind: "descuento" }
  | { kind: "promesa" }
  | { kind: "config" }
  | null;

function calendarioCompleto(cobranza: NonNullable<PanelDeCobro["cobranza"]>): CuotaConEstado[] {
  return [...cobranza.pagadas, ...cobranza.vencidas, ...cobranza.proximas].sort((a, b) => a.numero - b.numero);
}

const ESTILO_CUOTA: Record<CuotaConEstado["estado"], string> = {
  pagada: "bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-800 dark:text-emerald-300",
  vencida: "bg-rose-50 border-rose-200 text-rose-700 dark:bg-rose-900/20 dark:border-rose-800 dark:text-rose-300",
  porVencer: "bg-slate-50 border-slate-200 text-slate-500 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400",
};

export function SectionFinance(props: SectionFinanceProps) {
  const [panel, setPanel] = useState<PanelDeCobro | null | "cargando" | "error">("cargando");
  const [drawer, setDrawer] = useState<DrawerKind>(null);

  const recargar = useCallback(() => {
    setPanel("cargando");
    cargarPanelDeCobro(props.treatmentPlanId).then((r) => {
      setPanel(r.ok ? r.data : "error");
    }).catch(() => setPanel("error"));
  }, [props.treatmentPlanId]);

  useEffect(() => { recargar(); }, [recargar]);

  function cerrarYRecargar() {
    setDrawer(null);
    recargar();
  }

  if (panel === "cargando") {
    return (
      <Card id="finance" eyebrow="Sección F" title="Plan financiero del tratamiento" accent="emerald">
        <div className="px-6 py-6 text-sm text-slate-400 dark:text-slate-500">Cargando…</div>
      </Card>
    );
  }
  if (panel === "error") {
    return (
      <Card id="finance" eyebrow="Sección F" title="Plan financiero del tratamiento" accent="rose">
        <div className="px-6 py-6 text-sm text-rose-600 dark:text-rose-400">No se pudo cargar la cobranza de este caso.</div>
      </Card>
    );
  }

  const invoiceComoPago: PaymentInvoice | null = panel.invoice
    ? { id: panel.invoice.id, invoiceNumber: panel.invoice.invoiceNumber ?? "", total: panel.invoice.total, paid: panel.invoice.paid, balance: panel.invoice.balance, status: panel.invoice.status, patientName: props.patientName }
    : null;

  return (
    <>
      <Card
        id="finance"
        eyebrow="Sección F"
        title="Plan financiero del tratamiento"
        accent="emerald"
        action={
          panel.puedeConfigurarPolitica ? (
            <Btn variant="ghost" size="sm" icon={<Settings2 className="w-3.5 h-3.5" aria-hidden />} onClick={() => setDrawer({ kind: "config" })}>
              Política de cobro
            </Btn>
          ) : null
        }
      >
        {!panel.invoiceId ? (
          <div className="px-6 py-8 text-center">
            <p className="text-sm text-slate-600 mb-1 dark:text-slate-300">Este caso todavía no tiene un plan de pago.</p>
            <p className="text-xs text-slate-400 mb-4 dark:text-slate-500">
              {panel.redisenoFacturas
                ? "F1/F2 — abre la factura del tratamiento con su precio, enganche y mensualidades."
                : "El diseño nuevo de facturación está apagado en esta clínica: solo se puede abrir un pago único (sin mensualidades)."}
            </p>
            <Btn variant="emerald" icon={<Plus className="w-3.5 h-3.5" aria-hidden />} onClick={() => setDrawer({ kind: "abrir-plan" })}>
              Abrir plan de pago
            </Btn>
          </div>
        ) : (
          <>
            <div className="px-6 py-5 grid grid-cols-1 md:grid-cols-3 gap-4 border-b border-slate-100 dark:border-slate-800">
              <div className="md:border-r md:border-slate-100 md:pr-4 dark:md:border-slate-800">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium dark:text-slate-400">Total tratamiento</div>
                <div className="mt-1 text-2xl font-bold text-slate-900 font-mono dark:text-slate-100">{fmtMoney(panel.invoice!.total)}</div>
              </div>
              <div className="md:border-r md:border-slate-100 md:pr-4 dark:md:border-slate-800">
                <div className="text-[10px] uppercase tracking-wider text-emerald-700 font-medium dark:text-emerald-400">Pagado</div>
                <div className="mt-1 text-2xl font-bold text-emerald-700 font-mono dark:text-emerald-400">{fmtMoney(panel.invoice!.paid)}</div>
                <ProgressBar value={panel.invoice!.paid} max={panel.invoice!.total} color="emerald" className="mt-2" />
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium dark:text-slate-400">Saldo pendiente</div>
                <div className="mt-1 text-2xl font-bold text-slate-900 font-mono dark:text-slate-100">{fmtMoney(panel.invoice!.balance)}</div>
                {panel.cobranza?.saldoAFavor ? (
                  <div className="text-[11px] text-emerald-600 mt-1 dark:text-emerald-400">Saldo a favor: {fmtMoney(panel.cobranza.saldoAFavor)}</div>
                ) : null}
              </div>
            </div>

            {panel.cobranza ? (
              <div className="px-6 py-4 border-b border-slate-100 flex flex-wrap items-center gap-3 dark:border-slate-800">
                <Btn variant="emerald" size="sm" icon={<Banknote className="w-3.5 h-3.5" aria-hidden />} onClick={() => setDrawer({ kind: "cobrar" })}>
                  Cobrar {panel.cobranza.cuotaDeHoy ? `· ${fmtMoney(panel.cobranza.cuotaDeHoy.falta)}` : ""}
                </Btn>
                <Btn variant="secondary" size="sm" icon={<Plus className="w-3.5 h-3.5" aria-hidden />} onClick={() => setDrawer({ kind: "extra" })}>
                  Cobrar extra
                </Btn>
                <Btn variant="ghost" size="sm" icon={<CalendarClock className="w-3.5 h-3.5" aria-hidden />} onClick={() => setDrawer({ kind: "cambiar-plan" })}>
                  Cambiar plan
                </Btn>
                <Btn variant="ghost" size="sm" icon={<Percent className="w-3.5 h-3.5" aria-hidden />} onClick={() => setDrawer({ kind: "descuento" })}>
                  Descuento aplicado
                </Btn>
                {panel.cobranza.vencidas.length > 0 ? (
                  <Btn variant="ghost" size="sm" onClick={() => setDrawer({ kind: "promesa" })}>
                    Registrar promesa de pago
                  </Btn>
                ) : null}
                <Btn variant="ghost" size="sm" icon={<Printer className="w-3.5 h-3.5" aria-hidden />} onClick={() => window.print()}>
                  Imprimir convenio
                </Btn>
              </div>
            ) : null}

            {panel.recargoSugerido > 0 ? (
              <div className="mx-6 mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden />
                <span>
                  Recargo por atraso sugerido: <strong className="font-mono">{fmtMoney(panel.recargoSugerido)}</strong>. No se cobra solo — súmalo al monto en el cobro si la clínica decide aplicarlo.
                </span>
              </div>
            ) : null}

            {panel.billingDelCaso.discountLabel ? (
              <div className="mx-6 mt-4 text-xs text-slate-500 dark:text-slate-400">
                Descuento aplicado a este caso: <strong>{panel.billingDelCaso.discountLabel}</strong> ({panel.billingDelCaso.discountPct}%)
              </div>
            ) : null}

            {panel.cobranza ? (
              <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <h4 className="text-xs uppercase tracking-wider text-slate-500 font-medium dark:text-slate-400">Calendario de mensualidades</h4>
                  <div className="flex items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
                    <Pill color="emerald" size="xs">Pagada</Pill>
                    <Pill color="rose" size="xs">Vencida</Pill>
                    <Pill color="slate" size="xs">Por vencer</Pill>
                  </div>
                </div>
                {calendarioCompleto(panel.cobranza).length === 0 ? (
                  <p className="text-xs text-slate-400 dark:text-slate-500">Pago único, sin calendario de mensualidades.</p>
                ) : (
                  <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(calendarioCompleto(panel.cobranza).length, 8)}, minmax(0, 1fr))` }}>
                    {calendarioCompleto(panel.cobranza).map((q) => (
                      <div key={`${q.esEnganche ? "e" : "p"}-${q.numero}`} className={`border rounded-md p-2 text-center ${ESTILO_CUOTA[q.estado]}`}>
                        <div className="text-[10px] uppercase tracking-wider opacity-70">{q.esEnganche ? "Enganche" : `Mes ${q.numero}`}</div>
                        <div className="text-xs font-mono font-semibold mt-0.5">{fmtMoney(q.importe)}</div>
                        <div className="text-[9px] mt-0.5 opacity-70">{fmtDateShort(q.vencimiento)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}

            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800">
              <h4 className="text-xs uppercase tracking-wider text-slate-500 font-medium mb-2 dark:text-slate-400">Reposiciones incluidas (F11)</h4>
              <p className="text-xs text-slate-600 dark:text-slate-300">
                {panel.billingDelCaso.includedReplacementsUsed} de {panel.billingDelCaso.includedReplacementsTotal} usadas
              </p>
            </div>

            {panel.promesas.filter((p) => !p.fulfilledAt && !p.cancelledAt).length > 0 ? (
              <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800">
                <h4 className="text-xs uppercase tracking-wider text-slate-500 font-medium mb-2 dark:text-slate-400">Promesas de pago abiertas (F12)</h4>
                <ul className="space-y-1.5">
                  {panel.promesas.filter((p) => !p.fulfilledAt && !p.cancelledAt).map((p) => (
                    <li key={p.id} className="flex items-center justify-between text-xs">
                      <span>{fmtMoney(p.amount)} · promete pagar el {fmtDateShort(p.promisedDate)}{p.note ? ` · ${p.note}` : ""}</span>
                      <span className="flex gap-2">
                        <button type="button" className="text-emerald-600 hover:underline" onClick={() => resolverPromesaDePago({ treatmentPlanId: props.treatmentPlanId, promiseId: p.id, resultado: "cumplida" }).then(recargar)}>
                          Cumplida
                        </button>
                        <button type="button" className="text-slate-400 hover:underline" onClick={() => resolverPromesaDePago({ treatmentPlanId: props.treatmentPlanId, promiseId: p.id, resultado: "cancelada" }).then(recargar)}>
                          Cancelar
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {panel.extras.length > 0 ? (
              <div className="px-6 py-4">
                <h4 className="text-xs uppercase tracking-wider text-slate-500 font-medium mb-2 dark:text-slate-400">Extras cobrados aparte (F5)</h4>
                <ul className="space-y-1 text-xs text-slate-600 dark:text-slate-300">
                  {panel.extras.map((e) => (
                    <li key={e.invoiceId} className="flex justify-between">
                      <span>{e.invoiceNumber ?? e.invoiceId} · {fmtDateShort(e.createdAt)}</span>
                      <span className="font-mono">{fmtMoney(e.total)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="px-6 py-3 bg-slate-50/50 text-[11px] text-slate-400 dark:bg-slate-900/40 dark:text-slate-500">
              F6 (CFDI de mensualidades: PPD + complemento) y F13 (cobro automático con tarjeta) — pendientes de que el contador de la clínica decida cómo timbrar. No construidos a propósito.
            </div>
          </>
        )}
      </Card>

      {drawer?.kind === "abrir-plan" ? (
        <InvoiceEditorModal
          open
          patientId={props.patientId}
          patientName={props.patientName}
          rediseno={panel.redisenoFacturas}
          clinicTaxMode={panel.clinicTaxMode}
          onClose={() => setDrawer(null)}
          onCreated={async (invoice: { id: string }) => {
            const r = await abrirPlanDePago({ treatmentPlanId: props.treatmentPlanId, invoiceId: invoice.id });
            if (isFailure(r)) { window.alert(r.error); }
            cerrarYRecargar();
          }}
        />
      ) : null}

      {drawer?.kind === "cobrar" && invoiceComoPago ? (
        <PaymentModal open invoice={invoiceComoPago} onClose={() => setDrawer(null)} onSuccess={cerrarYRecargar} rediseno={panel.redisenoFacturas} />
      ) : null}

      {drawer?.kind === "extra" ? (
        <DrawerCobrarExtra
          treatmentPlanId={props.treatmentPlanId}
          patientId={props.patientId}
          patientName={props.patientName ?? ""}
          reposicionesRestantes={Math.max(0, panel.billingDelCaso.includedReplacementsTotal - panel.billingDelCaso.includedReplacementsUsed)}
          onClose={() => setDrawer(null)}
          onListo={cerrarYRecargar}
        />
      ) : null}

      {drawer?.kind === "cambiar-plan" && panel.invoiceId ? (
        <DrawerCambiarPlanDePago
          treatmentPlanId={props.treatmentPlanId}
          invoiceId={panel.invoiceId}
          total={panel.invoice!.total}
          condicionesActuales={panel.condiciones}
          onClose={() => setDrawer(null)}
          onGuardado={cerrarYRecargar}
        />
      ) : null}

      {drawer?.kind === "descuento" ? (
        <DrawerElegirDescuento
          treatmentPlanId={props.treatmentPlanId}
          reglas={panel.config.discountRules}
          actual={{ ruleId: panel.billingDelCaso.discountRuleId }}
          onClose={() => setDrawer(null)}
          onGuardado={cerrarYRecargar}
        />
      ) : null}

      {drawer?.kind === "promesa" && panel.cobranza ? (
        <DrawerPromesaDePago
          treatmentPlanId={props.treatmentPlanId}
          montoSugerido={panel.cobranza.vencidas.reduce((acc, q) => acc + q.falta, 0) || panel.cobranza.cuotaDeHoy?.falta || 0}
          onClose={() => setDrawer(null)}
          onGuardado={cerrarYRecargar}
        />
      ) : null}

      {drawer?.kind === "config" ? (
        <DrawerConfigCobro config={panel.config} onClose={() => setDrawer(null)} onGuardado={cerrarYRecargar} />
      ) : null}
    </>
  );
}
