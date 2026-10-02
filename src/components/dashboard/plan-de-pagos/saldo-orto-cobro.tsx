"use client";

// SALDO A FAVOR Y ADELANTO EN EL COBRO DE ORTODONCIA (ws1-t4). Se pinta debajo
// de «Monto a cobrar» (en el detalle de la factura y en la ventana de cobro de
// siempre), SOLO si la factura es de un caso de ortodoncia: fuera de
// ortodoncia `caso` llega null y aquí no sale nada, y el cobro se queda como
// estaba (no deja pagar de más).
//
//   · «Usar saldo a favor ($X)»: el camino de siempre (el servidor aplica el
//     saldo del paciente a esta factura como «Anticipo (saldo a favor)»). No es
//     un cobro: no entra dinero al cajón.
//   · Con un monto MAYOR que el saldo de la factura: a dónde va lo de más (las
//     siguientes facturas del caso por vencimiento) y cuánto queda a favor.
//     Solo informa; el reparto lo vuelve a hacer el servidor con las facturas
//     bloqueadas (src/lib/orthodontics/saldo-a-favor/).

import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { ArrowRight, PiggyBank } from "lucide-react";
import { CLASES_MENU } from "@/components/dashboard/menu-dos-niveles/clases";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { fmtMXNdec } from "@/lib/format";
import { paidAtInstant } from "@/lib/billing/paid-at";
import { repartirCobro, type FacturaDelCaso } from "@/lib/orthodontics/saldo-a-favor/adelanto-core";
import s from "./saldo-orto.module.css";
import { mensajeDeError } from "@/lib/errores/mensaje-de-error";
import { useT } from "@/i18n/i18n-provider";

export interface InfoSaldoOrto {
  caso: { planId: string; modo: string } | null;
  saldoAFavor: number;
  motivoParaNoUsar: string | null;
  otras: FacturaDelCaso[];
}

/** Lo que dice el servidor de esta factura. `null` mientras no se sabe (o si falló): el cobro se queda como siempre. */
export function useSaldoOrto(invoiceId: string | null | undefined, activo: boolean) {
  const [info, setInfo] = useState<InfoSaldoOrto | null>(null);
  const [vuelta, setVuelta] = useState(0);
  useEffect(() => {
    setInfo(null);
    if (!activo || !invoiceId) return;
    let vivo = true;
    fetch(`/api/invoices/${encodeURIComponent(invoiceId)}/saldo-orto`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (vivo) setInfo(d && typeof d === "object" ? (d as InfoSaldoOrto) : null); })
      .catch(() => { if (vivo) setInfo(null); });
    return () => { vivo = false; };
  }, [invoiceId, activo, vuelta]);
  const recargar = useCallback(() => setVuelta((n) => n + 1), []);
  return { info, recargar, esOrto: !!info?.caso };
}

/**
 * El cobro por MÁS que el saldo de una factura de ortodoncia. Mismo cuerpo que
 * el cobro de siempre (monto, método, fecha, referencia, notas) a su propia
 * ruta. Lanza con el mensaje del servidor si no se registró.
 */
export async function registrarCobroConAdelanto(args: {
  invoiceId: string;
  amount: number;
  method: string;
  paidAt: string;
  reference: string;
  notes: string;
}): Promise<{ aFavor: number; warning?: string }> {
  const res = await fetch(`/api/invoices/${encodeURIComponent(args.invoiceId)}/saldo-orto`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      accion: "adelanto",
      amount: args.amount,
      method: args.method,
      paidAt: paidAtInstant(args.paidAt)?.toISOString(),
      reference: args.reference.trim() || undefined,
      notes: args.notes.trim() || undefined,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ?? "No se pudo registrar el pago.");
  return { aFavor: Number(body?.aFavor) || 0, warning: body?.warning };
}

function fechaCorta(dia: string | null): string {
  if (!dia) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dia);
  if (!m) return "";
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
}

/** Cuánto del saldo a favor cubre lo que se está cobrando (nunca más que el saldo de la factura). */
export function saldoQueCubre(saldoAFavor: number, importe: number, balance: number): number {
  const base = importe > 0 ? Math.min(importe, balance) : balance;
  const c = Math.round(Math.min(Math.max(0, saldoAFavor), Math.max(0, base)) * 100) / 100;
  return c > 0 ? c : 0;
}

export function SaldoOrtoEnCobro({
  invoiceId, invoiceNumber, info, importe, balance, pagado, bloqueado = false, alAplicar,
}: {
  invoiceId: string;
  invoiceNumber?: string | null;
  info: InfoSaldoOrto | null;
  /** Lo pagado de la factura tal como se ve: el servidor no aplica si ya cambió (un segundo clic no gasta dos veces). */
  pagado: number;
  /** Lo que hay escrito en «Monto a cobrar». */
  importe: number;
  /** Saldo pendiente de la factura. */
  balance: number;
  bloqueado?: boolean;
  /** Se aplicó saldo a favor: quien monta refresca la factura (y cierra si quedó pagada). */
  alAplicar: (r: { aplicado: number; pagada: boolean }) => void;
}) {
  const t = useT();
  const [aplicando, setAplicando] = useState(false);
  const excedente = Math.round((importe - balance) * 100) / 100;
  const reparto = useMemo(() => {
    if (!info?.caso || !(excedente > 0.004)) return null;
    return repartirCobro(importe, { invoiceId, invoiceNumber: invoiceNumber ?? null, falta: balance, vencimiento: null }, info.otras);
  }, [info, excedente, importe, invoiceId, invoiceNumber, balance]);

  if (!info?.caso) return null;
  const cubre = saldoQueCubre(info.saldoAFavor, importe, balance);
  const mostrarSaldo = info.saldoAFavor > 0;

  async function usar() {
    if (aplicando || bloqueado || !(cubre > 0)) return;
    setAplicando(true);
    try {
      const res = await fetch(`/api/invoices/${encodeURIComponent(invoiceId)}/saldo-orto`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "usar-saldo", tope: cubre, paidVisto: pagado }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 409: la factura ya no está como se ve (quizá el clic anterior SÍ se
        // aplicó). Se refresca para que la pantalla diga la verdad.
        if (res.status === 409) alAplicar({ aplicado: 0, pagada: false });
        throw new Error(body?.error ?? "No se pudo usar el saldo a favor.");
      }
      const aplicado = Number(body?.aplicado) || 0;
      toast.success(`Se usaron ${fmtMXNdec(aplicado)} del saldo a favor`);
      alAplicar({ aplicado, pagada: body?.factura?.status === "PAID" });
    } catch (e: any) {
      toast.error(mensajeDeError(e, t, { porDefecto: "No se pudo usar el saldo a favor." }));
    } finally {
      setAplicando(false);
    }
  }

  return (
    <>
      {mostrarSaldo && (
        <div className={`${CLASES_MENU} ${s.caja}`} role="group" aria-label="Saldo a favor del paciente" data-saldo-a-favor-cobro>
          <div className={s.fila}>
            <span>
              <span className={s.rotulo}>Saldo a favor del paciente</span>{" "}
              <span className={s.cifra}>{fmtMXNdec(info.saldoAFavor)}</span>
            </span>
            {info.motivoParaNoUsar === null && cubre > 0 ? (
              <ButtonNew variant="secondary" size="sm" onClick={usar} disabled={aplicando || bloqueado}>
                <PiggyBank size={14} aria-hidden />
                {aplicando ? "Aplicando…" : `Usar saldo a favor (${fmtMXNdec(cubre)})`}
              </ButtonNew>
            ) : null}
          </div>
          {info.motivoParaNoUsar !== null ? (
            <p className={s.nota}>No se puede usar en esta factura: {info.motivoParaNoUsar}.</p>
          ) : (
            <p className={s.nota}>Se abona a esta factura como «Anticipo (saldo a favor)»: no entra dinero a caja.</p>
          )}
        </div>
      )}
      {reparto && (
        <div className={`${CLASES_MENU} ${s.caja} ${s.adelanto}`} role="status" data-adelanto-orto>
          <span className={s.rotulo}>Pago adelantado · {fmtMXNdec(reparto.excedente)} de más</span>
          <ul className={s.lista}>
            {reparto.partes.filter((p) => !p.esLaCobrada).map((p) => {
              const f = info.otras.find((o) => o.invoiceId === p.invoiceId);
              return (
                <li key={p.invoiceId} className={s.item}>
                  <ArrowRight size={13} strokeWidth={2.4} aria-hidden className={s.flecha} />
                  <span className={s.nombre}>
                    Factura {p.invoiceNumber ?? ""}
                    {f?.vencimiento ? ` · vence ${fechaCorta(f.vencimiento)}` : ""}
                  </span>
                  <span className={s.importe}>{fmtMXNdec(p.monto)}</span>
                </li>
              );
            })}
            {reparto.aFavor > 0 && (
              <li className={s.item}>
                <ArrowRight size={13} strokeWidth={2.4} aria-hidden className={s.flecha} />
                <span className={s.nombre}>Queda a favor del paciente</span>
                <span className={s.importeFavor}>{fmtMXNdec(reparto.aFavor)}</span>
              </li>
            )}
          </ul>
          <p className={s.nota}>
            Lo de más paga las siguientes mensualidades o controles del caso, del que vence antes al que vence después; lo que sobre queda como saldo a favor.
          </p>
        </div>
      )}
    </>
  );
}
