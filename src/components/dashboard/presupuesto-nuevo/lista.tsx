"use client";

// ═══════════════════════════════════════════════════════════════════════════
// Lista de presupuestos rediseñada (WS1-T8).
//
// El marco del editor. Mismas acciones, mismos endpoints y mismos permisos que
// la lista de siempre (`quotes-tab.tsx`): esto es presentación, no
// funcionalidad. Lo único que se AÑADE es la línea del plan de pagos —
// «6 pagos mensuales de $5,000.00» — debajo del título, porque es lo que hay
// que recordar de un presupuesto que se está negociando.
//
// Solo se monta con el interruptor `menu-dos-niveles` encendido.
// ═══════════════════════════════════════════════════════════════════════════

import { useCallback, useState } from "react";
import {
  Check, CheckCircle2, ClipboardList, Copy, Download, FileText, Files,
  MessageCircle, Pencil, ReceiptText, Send, Trash2, XCircle,
} from "lucide-react";
import { dinero, fechaCorta, frasePlan, hayCondiciones } from "@/lib/quotes/condiciones-pago";
import type { QuoteDTO, QuoteStatus } from "@/lib/quotes/types";
import { useT } from "@/i18n/i18n-provider";
import type { TFunction } from "@/i18n/t";
import { useConfirm } from "@/components/ui/confirm-dialog";
import r from "@/components/dashboard/pacientes-rediseno/rediseno.module.css";
import s from "./presupuesto.module.css";

/** Mismas cinco palabras y mismos colores que la lista de siempre. */
const ESTADO: Record<QuoteStatus, { clave: string; tono: string }> = {
  DRAFT:     { clave: "quotes.status.draft",     tono: "etiquetaNeutra" },
  PRESENTED: { clave: "quotes.status.presented", tono: "etiquetaVioleta" },
  ACCEPTED:  { clave: "quotes.status.accepted",  tono: "etiquetaExito" },
  REJECTED:  { clave: "quotes.status.rejected",  tono: "etiquetaPeligro" },
  EXPIRED:   { clave: "quotes.status.expired",   tono: "etiquetaAlerta" },
};

export function PresupuestoLista({
  presupuestos, patientId, cargando, onNuevo, onEditar, onRecargar, onVerFactura, onVerPlan,
}: {
  presupuestos: QuoteDTO[];
  patientId: string;
  cargando: boolean;
  onNuevo: () => void;
  onEditar: (q: QuoteDTO) => void;
  onRecargar: () => Promise<void> | void;
  onVerFactura?: (invoiceId: string) => void;
  onVerPlan?: (planId: string) => void;
}) {
  const t = useT();

  return (
    <div className={s.pantalla}>
      <div className={s.cabecera}>
        <div className={s.cabeceraTexto}>
          <h2 className={s.titulo}>{t("presupuestoNuevo.listaTitulo")}</h2>
          <p className={s.subtitulo}>{t("presupuestoNuevo.listaSubtitulo")}</p>
        </div>
        <div className={s.cabeceraAcciones}>
          <button type="button" className={`${r.boton} ${r.botonPrincipal}`} onClick={onNuevo}>
            <FileText size={15} /> {t("presupuestoNuevo.tituloNuevo")}
          </button>
        </div>
      </div>

      {cargando ? (
        /* «Cargando…», nunca un 0 que parece un dato real (regla del patrón). */
        <div className={r.cargando}>{t("presupuestoNuevo.cargando")}</div>
      ) : presupuestos.length === 0 ? (
        <div className={r.vacio}>
          <span className={r.vacioIcono}><FileText size={17} /></span>
          <p className={r.vacioTitulo}>{t("presupuestoNuevo.listaVaciaTitulo")}</p>
          <p className={r.vacioPista}>{t("presupuestoNuevo.listaVaciaPista")}</p>
        </div>
      ) : (
        <div className={s.fichas}>
          {presupuestos.map((q) => (
            <Ficha
              key={q.id}
              quote={q}
              patientId={patientId}
              t={t}
              onEditar={() => onEditar(q)}
              onRecargar={onRecargar}
              onVerFactura={onVerFactura}
              onVerPlan={onVerPlan}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Ficha({
  quote, patientId, t, onEditar, onRecargar, onVerFactura, onVerPlan,
}: {
  quote: QuoteDTO;
  patientId: string;
  t: TFunction;
  onEditar: () => void;
  onRecargar: () => Promise<void> | void;
  onVerFactura?: (invoiceId: string) => void;
  onVerPlan?: (planId: string) => void;
}) {
  const confirmar = useConfirm();
  const [ocupado, setOcupado] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [waEnviado, setWaEnviado] = useState(false);
  const estado = ESTADO[quote.status] ?? ESTADO.DRAFT;

  const post = useCallback(async (url: string) => {
    setOcupado(true);
    setMensaje(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const salida = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(salida.error ?? t("presupuestoNuevo.errorAccion"));
      await onRecargar();
      return salida;
    } catch (e) {
      setMensaje((e as Error).message);
      return null;
    } finally {
      setOcupado(false);
    }
  }, [onRecargar, t]);

  const postConCuerpo = useCallback(async (url: string, cuerpo: unknown) => {
    setOcupado(true);
    setMensaje(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
      });
      const salida = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(salida.error ?? t("presupuestoNuevo.errorAccion"));
      await onRecargar();
      return salida;
    } catch (e) {
      setMensaje((e as Error).message);
      return null;
    } finally {
      setOcupado(false);
    }
  }, [onRecargar, t]);

  async function borrar() {
    const ok = await confirmar({
      title: t("quotes.deleteConfirmTitle"),
      description: t("quotes.deleteConfirm", { folio: quote.folio }),
      variant: "danger",
      confirmText: t("quotes.deleteConfirmBtn"),
      cancelText: t("quotes.deleteCancelBtn"),
    });
    if (!ok) return;
    setOcupado(true);
    setMensaje(null);
    try {
      const res = await fetch(`/api/quotes/${quote.id}`, { method: "DELETE" });
      const salida = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(salida.error ?? t("presupuestoNuevo.errorAccion"));
      await onRecargar();
    } catch (e) {
      setMensaje((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function copiarLiga() {
    if (!quote.acceptToken) return;
    const url = `${window.location.origin}/presupuesto/${quote.acceptToken}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      setMensaje(t("quotes.card.copyFailed", { url }));
    }
  }

  const Accion = ({ onClick, tono, children }: {
    onClick: () => void;
    tono?: "principal" | "exito" | "peligro";
    children: React.ReactNode;
  }) => (
    <button
      type="button"
      disabled={ocupado}
      onClick={onClick}
      className={[
        s.accion,
        tono === "principal" ? s.accionPrincipal : "",
        tono === "exito" ? s.accionExito : "",
        tono === "peligro" ? s.accionPeligro : "",
      ].filter(Boolean).join(" ")}
    >
      {children}
    </button>
  );

  const editable = quote.status === "DRAFT" || quote.status === "PRESENTED";
  const plan = hayCondiciones(quote.condicionesPago) && quote.condicionesPago?.modo === "plazos"
    ? frasePlan(quote.total, quote.condicionesPago)
    : null;

  return (
    <article className={s.ficha}>
      <div className={s.fichaCuerpo}>
        <div className={s.fichaLinea1}>
          <span className={s.fichaFolio}>{quote.folio}</span>
          <span className={`${r.etiqueta} ${(r as Record<string, string>)[estado.tono]}`}>
            {t(estado.clave)}
          </span>
          {quote.invoiceId && (
            <span className={`${r.etiqueta} ${r.etiquetaExito}`}>
              <ReceiptText size={11} /> {t("quotes.card.invoiced")}
            </span>
          )}
          {quote.treatmentPlanId && (
            <span className={`${r.etiqueta} ${r.etiquetaVioleta}`}>
              <ClipboardList size={11} /> {t("quotes.card.planCreated")}
            </span>
          )}
        </div>
        <p className={s.fichaTitulo}>{quote.title}</p>
        <p className={s.fichaSub}>
          {t("quotes.card.itemCount", { count: quote.items.length })}
          {quote.validUntil ? ` · ${t("quotes.card.validUntil", { date: fechaCorta(quote.validUntil) })}` : ""}
        </p>
        {plan && <p className={s.fichaPlan}>{plan}</p>}
      </div>

      <div className={s.fichaDinero}>
        <p className={s.fichaTotal}>{dinero(quote.total)}</p>
        {quote.discountAmount > 0 && (
          <p className={s.fichaDescuento}>
            −{dinero(quote.discountAmount)} {t("presupuestoNuevo.deDescuento")}
          </p>
        )}
      </div>

      <div className={s.fichaAcciones}>
        <a
          href={`/api/quotes/${quote.id}/pdf`}
          target="_blank"
          rel="noreferrer"
          className={s.accion}
        >
          <Download size={13} /> {t("quotes.card.pdf")}
        </a>

        {editable && (
          <Accion onClick={onEditar}><Pencil size={13} /> {t("quotes.card.edit")}</Accion>
        )}

        {quote.status === "DRAFT" && (
          <Accion tono="principal" onClick={() => postConCuerpo(`/api/quotes/${quote.id}/status`, { action: "present" })}>
            <Send size={13} /> {t("quotes.card.present")}
          </Accion>
        )}

        {quote.status === "PRESENTED" && (
          <>
            <Accion tono="principal" onClick={copiarLiga}>
              {copiado ? <Check size={13} /> : <Copy size={13} />}
              {copiado ? t("quotes.card.copied") : t("quotes.card.copyLink")}
            </Accion>
            <Accion tono="exito" onClick={() => postConCuerpo(`/api/quotes/${quote.id}/status`, { action: "accept" })}>
              <CheckCircle2 size={13} /> {t("quotes.card.markAccepted")}
            </Accion>
            <Accion tono="peligro" onClick={() => postConCuerpo(`/api/quotes/${quote.id}/status`, { action: "reject" })}>
              <XCircle size={13} /> {t("quotes.card.markRejected")}
            </Accion>
          </>
        )}

        {quote.status === "EXPIRED" && (
          <Accion tono="principal" onClick={() => postConCuerpo(`/api/quotes/${quote.id}/status`, { action: "present" })}>
            <Send size={13} /> {t("quotes.card.presentAgain")}
          </Accion>
        )}

        {(quote.status === "DRAFT" || quote.status === "PRESENTED" || quote.status === "EXPIRED") && (
          <Accion
            tono="principal"
            onClick={async () => {
              setWaEnviado(false);
              const salida = await post(`/api/quotes/${quote.id}/send-whatsapp`);
              if (salida) setWaEnviado(true);
            }}
          >
            <MessageCircle size={13} /> {t("quotes.card.sendWhatsApp")}
          </Accion>
        )}

        {quote.status === "ACCEPTED" && (
          <>
            <Accion
              tono="exito"
              onClick={async () => {
                if (quote.invoiceId) { onVerFactura?.(quote.invoiceId); return; }
                const salida = await post(`/api/quotes/${quote.id}/invoice`);
                if (salida?.invoiceId) onVerFactura?.(salida.invoiceId);
              }}
            >
              <ReceiptText size={13} />
              {quote.invoiceId ? t("quotes.card.viewInvoice") : t("quotes.card.generateInvoice")}
            </Accion>
            <Accion
              tono="principal"
              onClick={async () => {
                if (quote.treatmentPlanId) { onVerPlan?.(quote.treatmentPlanId); return; }
                const salida = await post(`/api/quotes/${quote.id}/treatment-plan`);
                if (salida?.treatmentPlanId) onVerPlan?.(salida.treatmentPlanId);
              }}
            >
              <ClipboardList size={13} />
              {quote.treatmentPlanId ? t("quotes.card.viewPlan") : t("quotes.card.createPlan")}
            </Accion>
          </>
        )}

        <Accion onClick={() => post(`/api/quotes/${quote.id}/duplicate`)}>
          <Files size={13} /> {t("quotes.card.duplicate")}
        </Accion>

        {quote.status === "DRAFT" && (
          <Accion tono="peligro" onClick={borrar}>
            <Trash2 size={13} /> {t("quotes.card.delete")}
          </Accion>
        )}
      </div>

      {mensaje && <p className={s.fichaMensaje}>{mensaje}</p>}
      {waEnviado && (
        <p className={s.fichaAviso}>
          {t("quotes.card.waSentToast")}{" "}
          <a href={`/dashboard/inbox${patientId ? `?patientId=${patientId}` : ""}`}>
            {t("quotes.card.waViewInbox")}
          </a>
        </p>
      )}
    </article>
  );
}
