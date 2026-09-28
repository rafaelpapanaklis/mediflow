"use client";

// Ortodoncia — Recepción (ws1-t5, Ola 1): R2 (lista de mensualidades por
// cobrar en Caja, agrupada por responsable de pago — R5) + el ancla que usa
// el aviso de Hoy (R3, `aviso-mensualidades-vencidas.tsx`) para llevar aquí.
// Self-fetch a `listarMensualidadesPorCobrar` (mismo patrón que
// `AvisoAnticiposPorRevisar`): se calla sola si no hay nada que cobrar.
//
// R5 (cobrar a hermanos de una vez): cuando ≥2 mensualidades comparten el
// mismo `responsibleGuardianId` (A11, "Alta del caso"), se agrupan bajo un
// solo total y un botón "Cobrar a los dos". No es un cobro atómico nuevo (eso
// tocaría `src/app/api/invoices/**`, fuera del alcance de esta parte): abre
// el `PaymentModal` de la primera factura y, al guardar, encadena el de la
// segunda — dos confirmaciones rápidas en vez de dos búsquedas separadas.

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Card } from "../redesign/atoms/Card";
import { Pill, type PillColor } from "../redesign/atoms/Pill";
import { Btn } from "../redesign/atoms/Btn";
import { fmtMoney, fmtDate } from "../redesign/atoms/format";
import {
  listarMensualidadesPorCobrar,
  type MensualidadPorCobrar,
} from "@/app/actions/orthodontics/recepcion/listarMensualidadesPorCobrar";
import { PaymentModal, type PaymentInvoice } from "@/components/dashboard/billing/payment-modal";

const ESTADO_PILL: Record<MensualidadPorCobrar["estado"], { color: PillColor; label: string }> = {
  vencida: { color: "rose", label: "Vencida" },
  hoy: { color: "amber", label: "Vence hoy" },
  proxima: { color: "slate", label: "Próxima" },
};

interface Grupo {
  clave: string;
  guardianName: string | null;
  items: MensualidadPorCobrar[];
}

function agrupar(items: MensualidadPorCobrar[]): Grupo[] {
  const porGuardian = new Map<string, MensualidadPorCobrar[]>();
  for (const it of items) {
    if (!it.responsibleGuardianId) continue;
    const lista = porGuardian.get(it.responsibleGuardianId) ?? [];
    lista.push(it);
    porGuardian.set(it.responsibleGuardianId, lista);
  }

  const agrupadoIds = new Set<string>();
  const grupos: Grupo[] = [];
  for (const [guardianId, lista] of porGuardian) {
    if (lista.length < 2) continue; // un solo caso con responsable: fila normal
    lista.forEach((it) => agrupadoIds.add(it.treatmentPlanId));
    grupos.push({ clave: guardianId, guardianName: lista[0].responsibleGuardianName, items: lista });
  }
  for (const it of items) {
    if (agrupadoIds.has(it.treatmentPlanId)) continue;
    grupos.push({ clave: it.treatmentPlanId, guardianName: null, items: [it] });
  }
  return grupos;
}

function comoFactura(it: MensualidadPorCobrar): PaymentInvoice {
  return {
    id: it.invoiceId,
    invoiceNumber: it.invoiceNumber ?? "",
    total: it.invoiceTotal,
    paid: it.invoicePaid,
    balance: it.invoiceBalance,
    status: it.invoiceStatus,
    patientName: it.patientName,
  };
}

export function ListaMensualidades() {
  const [items, setItems] = useState<MensualidadPorCobrar[] | null>(null);
  const [rediseno, setRediseno] = useState(false);
  const [cobrandoCola, setCobrandoCola] = useState<MensualidadPorCobrar[] | null>(null);

  function recargar() {
    listarMensualidadesPorCobrar()
      .then((r) => {
        setItems(r.ok ? r.data.items : []);
        setRediseno(r.ok ? r.data.redisenoFacturas : false);
      })
      .catch(() => setItems([]));
  }

  useEffect(() => {
    recargar();
  }, []);

  if (!items || items.length === 0) return null;

  const total = items.reduce((s, it) => s + it.monto, 0);
  const vencidas = items.filter((it) => it.estado === "vencida").length;
  const grupos = agrupar(items);

  function iniciarCobro(grupo: MensualidadPorCobrar[]) {
    setCobrandoCola(grupo);
  }

  function alGuardarUno() {
    if (!cobrandoCola) return;
    const resto = cobrandoCola.slice(1);
    setCobrandoCola(resto.length > 0 ? resto : null);
    recargar();
  }

  return (
    <Card
      id="mensualidades-ortodoncia"
      eyebrow="Ortodoncia"
      title={`${items.length === 1 ? "1 mensualidad" : `${items.length} mensualidades`} por cobrar`}
      action={<span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{fmtMoney(total)}</span>}
      accent={vencidas > 0 ? "rose" : "amber"}
    >
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {grupos.map((g) => {
          const subtotal = g.items.reduce((s, it) => s + it.monto, 0);
          const peorEstado = g.items.some((it) => it.estado === "vencida")
            ? "vencida"
            : g.items.some((it) => it.estado === "hoy")
              ? "hoy"
              : "proxima";
          const pill = ESTADO_PILL[peorEstado];
          return (
            <li key={g.clave} className="px-6 py-3 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <span className="font-medium text-slate-800 dark:text-slate-100">
                  {g.guardianName ?? g.items[0].patientName}
                  {g.items.length > 1 && (
                    <span className="text-slate-400 dark:text-slate-500 font-normal">
                      {" "}
                      ({g.items.map((it) => it.patientName).join(" y ")})
                    </span>
                  )}
                </span>
                <Pill color={pill.color}>{pill.label}</Pill>
                <span className="text-slate-500 dark:text-slate-400">
                  {fmtMoney(subtotal)} · vence {fmtDate(g.items[0].vencimiento)}
                </span>
              </div>
              <Btn variant={peorEstado === "vencida" ? "rose" : "primary"} size="sm" onClick={() => iniciarCobro(g.items)}>
                {g.items.length > 1 ? "Cobrar a los dos" : "Cobrar"}
              </Btn>
            </li>
          );
        })}
      </ul>

      {cobrandoCola && cobrandoCola.length > 0 && (
        <PaymentModal
          open
          invoice={comoFactura(cobrandoCola[0])}
          onClose={() => setCobrandoCola(null)}
          onSuccess={alGuardarUno}
          rediseno={rediseno}
        />
      )}
      {cobrandoCola && cobrandoCola.length > 1 && (
        <div className="px-6 py-2 flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-slate-500">
          <AlertTriangle size={12} aria-hidden />
          Al guardar, sigue la factura de {cobrandoCola[1].patientName}.
        </div>
      )}
    </Card>
  );
}
