"use client";

// Ortodoncia — Recepción (ws1-t5, Ola 1): R2 (lista de mensualidades por
// cobrar en Caja, agrupada por responsable de pago — R5) + el ancla que usa
// el aviso de Hoy (R3, `aviso-mensualidades-vencidas.tsx`) para llevar aquí.
// Self-fetch a `listarMensualidadesPorCobrar` (mismo patrón que
// `AvisoAnticiposPorRevisar`): se calla sola si no hay nada que cobrar.
//
// R5 (cobrar a hermanos de una vez): cuando ≥2 mensualidades comparten el
// mismo `responsibleGuardianId` (A11, "Alta del caso"), se agrupan bajo un
// solo total y un botón «Cobrar a los dos» (o «a los tres»…, ver rotulo-cobro.ts). No es un cobro atómico nuevo (eso
// tocaría `src/app/api/invoices/**`, fuera del alcance de esta parte): abre
// el `PaymentModal` de la primera factura y, al guardar, encadena el de la
// segunda — dos confirmaciones rápidas en vez de dos búsquedas separadas.

// Diseño (ws1-t5): esta lista vive en CAJA, no en la pestaña de Ortodoncia,
// así que se viste con el sistema de diseño del panel (BadgeNew, ButtonNew y
// los tokens que Caja ya redirige a los aprobados) y no con los átomos del
// módulo de Ortodoncia, que traen su propia paleta (`slate-*`). La ropa está
// en `cobros-inventario-rediseno/avisos.module.css`. Lo único que sigue
// viniendo de los átomos es el FORMATO de importes y fechas, que no se toca.

import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import av from "@/components/dashboard/cobros-inventario-rediseno/avisos.module.css";
import { fmtMoney, fmtDay } from "../redesign/atoms/format";
// ws1-t5 (arreglo): el botón y la lista de hermanos dicen a cuántos, con test.
import { listaDeNombres, rotuloCobrar } from "@/lib/orthodontics/rotulo-cobro";
import {
  listarMensualidadesPorCobrar,
  type MensualidadPorCobrar,
} from "@/app/actions/orthodontics/recepcion/listarMensualidadesPorCobrar";
import { PaymentModal, type PaymentInvoice } from "@/components/dashboard/billing/payment-modal";

const ESTADO_PILL: Record<MensualidadPorCobrar["estado"], { tono: "danger" | "warning" | "neutral"; label: string }> = {
  vencida: { tono: "danger", label: "Vencida" },
  hoy: { tono: "warning", label: "Vence hoy" },
  proxima: { tono: "neutral", label: "Próxima" },
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

/** ws1-t2 (ronda 3, H7): suma `cantidadVencidas` de todos los items del grupo (hermanos incluidos). */
function cantidadVencidasDelGrupo(g: Grupo): number {
  return g.items.reduce((s, it) => s + it.cantidadVencidas, 0);
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

export function ListaMensualidades({
  alCobrar,
}: {
  /**
   * Se llama después de guardar cada cobro (ws1-t3, H16). La usa la pantalla
   * «Cobranza» del módulo de Ortodoncia para volver a pedir sus totales; en
   * Caja no se pasa y todo sigue como siempre.
   */
  alCobrar?: () => void;
} = {}) {
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
  // ws1-t4 #84: cuotas vencidas (no filas): el mismo criterio que el aviso de Hoy.
  const vencidas = items.filter((it) => it.estado === "vencida").reduce((n, it) => n + Math.max(1, it.cantidadVencidas), 0);
  const grupos = agrupar(items);

  function iniciarCobro(grupo: MensualidadPorCobrar[]) {
    setCobrandoCola(grupo);
  }

  function alGuardarUno() {
    if (!cobrandoCola) return;
    const resto = cobrandoCola.slice(1);
    setCobrandoCola(resto.length > 0 ? resto : null);
    recargar();
    alCobrar?.();
  }

  return (
    <section id="mensualidades-ortodoncia" className={av.lista} aria-labelledby="mensualidades-ortodoncia-titulo">
      <header className={av.listaCabeza}>
        <div className={av.textos}>
          <p className={av.ceja}>Ortodoncia</p>
          <h2 id="mensualidades-ortodoncia-titulo" className={av.listaTitulo}>
            {items.length === 1 ? "1 mensualidad" : `${items.length} mensualidades`} por cobrar
            {vencidas > 0 && (
              <>
                {" "}
                <BadgeNew tone="danger" dot>
                  {vencidas === 1 ? "1 vencida" : `${vencidas} vencidas`}
                </BadgeNew>
              </>
            )}
          </h2>
        </div>
        <div className={av.listaTotal}>
          <span className={av.listaTotalRotulo}>Total</span>
          <span className={av.listaTotalCifra}>{fmtMoney(total)}</span>
        </div>
      </header>

      <ul className={av.filas}>
        {grupos.map((g) => {
          const subtotal = g.items.reduce((s, it) => s + it.monto, 0);
          const peorEstado = g.items.some((it) => it.estado === "vencida")
            ? "vencida"
            : g.items.some((it) => it.estado === "hoy")
              ? "hoy"
              : "proxima";
          const pill = ESTADO_PILL[peorEstado];
          return (
            <li key={g.clave} className={av.filaCobro}>
              <div className={av.quien}>
                <span className={av.quienNombre}>{g.guardianName ?? g.items[0].patientName}</span>
                {/* ws1-t2 (ronda 3, H7): cuántas cuotas vencidas trae el total de
                    abajo — reusa la MISMA pastilla (no cabe otra en la columna
                    del importe, de ancho fijo). */}
                <BadgeNew tone={pill.tono} dot>
                  {peorEstado === "vencida" && cantidadVencidasDelGrupo(g) > 1 ? `${cantidadVencidasDelGrupo(g)} vencidas` : pill.label}
                </BadgeNew>
                {g.items.length > 1 && (
                  <span className={av.quienHermanos}>{listaDeNombres(g.items.map((it) => it.patientName))}</span>
                )}
              </div>
              <span className={av.vence}>
                <span className={av.venceRotulo}>Vence</span> {fmtDay(g.items[0].vencimiento)}
              </span>
              <span className={av.montoFila}>{fmtMoney(subtotal)}</span>
              <ButtonNew variant="primary" size="sm" onClick={() => iniciarCobro(g.items)}>
                {/* ws1-t5 (arreglo): decía «Cobrar a los dos» escrito fijo, también
                    con tres hermanos. El cobro encadenado ya era de todos. */}
                {rotuloCobrar(g.items.length)}
              </ButtonNew>
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
          montoSugerido={cobrandoCola[0].monto}
        />
      )}
      {cobrandoCola && cobrandoCola.length > 1 && (
        <p className={av.siguiente}>
          <ArrowRight size={13} strokeWidth={1.75} aria-hidden />
          Al guardar, sigue la factura de {cobrandoCola[1].patientName}.
        </p>
      )}
    </section>
  );
}
