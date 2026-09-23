"use client";

// ═══════════════════════════════════════════════════════════════════════════
// Mercado Pago como método de pago de una factura (ws1-t1) — la pantalla.
//
//   · `useCobroMercadoPago` — ¿la clínica puede cobrar con Mercado Pago? Sin
//     cuenta conectada el método NI SE PINTA (nada de un botón que da error).
//   · `BotonMercadoPago` — el método, al lado de efectivo, débito, crédito…
//   · `LinkMercadoPago` — ver / generar / copiar / abrir el link de la factura.
//
// El monto NO sale de aquí: el POST de /api/invoices/[id]/link-pago no lleva
// body y el servidor cobra el saldo de la factura. Lo que se enseña es lo que el
// servidor contestó.
// ═══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Copy, ExternalLink, Link2, Loader2 } from "lucide-react";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { fmtMXNdec } from "@/lib/format";
import { formatDate } from "@/lib/utils";
import { useT } from "@/i18n/i18n-provider";
import s from "./link-mercado-pago.module.css";

export interface LinkDePago {
  url: string;
  monto: number;
  venceA: string;
}

// Se pregunta en CADA apertura, sin guardarlo en el módulo: cambiar de clínica
// no recarga la página (router.push), y un «sí» de la clínica A no puede
// enseñar el método en la clínica B. Tampoco si desconectan la cuenta.
function preguntarDisponible(): Promise<boolean> {
  return fetch("/api/invoices/cobro-mercadopago")
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => d?.disponible === true)
    .catch(() => false);
}

/** `true` solo si el servidor dijo que sí. Mientras tanto (y ante cualquier fallo), `false`. */
export function useCobroMercadoPago(activo: boolean): boolean {
  const [disponible, setDisponible] = useState(false);
  useEffect(() => {
    setDisponible(false);
    if (!activo) return;
    let vivo = true;
    preguntarDisponible().then((v) => { if (vivo) setDisponible(v); });
    return () => { vivo = false; };
  }, [activo]);
  return disponible;
}

/** Pide (o reutiliza) el link. Nunca lanza: `error` trae el motivo del servidor. */
export async function pedirLinkDePago(invoiceId: string): Promise<{ link: LinkDePago | null; error: string | null }> {
  try {
    const res = await fetch(`/api/invoices/${invoiceId}/link-pago`, { method: "POST" });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || !out?.link) return { link: null, error: typeof out?.error === "string" ? out.error : null };
    return { link: out.link as LinkDePago, error: null };
  } catch {
    return { link: null, error: null };
  }
}

export async function copiarAlPortapapeles(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    return false;
  }
}

/** El método en la rejilla del cobro. Quien lo monta le pasa sus clases, para ser hermano de los otros. */
export function BotonMercadoPago({ activo, alElegir, disabled, className, style }: {
  activo: boolean;
  alElegir: () => void;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const t = useT();
  return (
    <button type="button" onClick={alElegir} disabled={disabled} aria-pressed={activo} className={className} style={style} data-metodo="mercadopago">
      <Link2 size={14} aria-hidden />
      {t("facturaMp.metodo")}
    </button>
  );
}

/** Clases del botón en la rejilla del cobro de siempre (sin el interruptor). */
export function clasesMetodoClasico(activo: boolean): string {
  return `${s.metodoClasico} ${activo ? s.metodoClasicoActivo : ""}`;
}

/**
 * El bloque del link.
 *   · `modo="cobro"`: se eligió Mercado Pago al cobrar. Siempre se pinta (quien
 *     lo monta ya comprobó que la clínica puede): enseña el link o el botón
 *     para generarlo.
 *   · `modo="detalle"`: el detalle de la factura. Solo se pinta si YA hay un
 *     link vigente (o `sugerido`: el trato dice Mercado Pago). Así una factura
 *     que se cobra en caja no enseña nada nuevo.
 */
export function LinkMercadoPago({ invoiceId, modo, sugerido = false, bloqueado = false, alCambiar }: {
  invoiceId: string;
  modo: "cobro" | "detalle";
  sugerido?: boolean;
  bloqueado?: boolean;
  /** Avisa al que lo monta que hay (o dejó de haber) link. */
  alCambiar?: (link: LinkDePago | null) => void;
}) {
  const t = useT();
  const [cargando, setCargando] = useState(true);
  const [disponible, setDisponible] = useState(false);
  const [link, setLink] = useState<LinkDePago | null>(null);
  const [saldo, setSaldo] = useState(0);
  const [puedeGenerar, setPuedeGenerar] = useState(false);
  // Tuvo un link que ya no sirve (el saldo cambió): se sigue cobrando por MP.
  const [habiaLink, setHabiaLink] = useState(false);
  const [generando, setGenerando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    setLink(null);
    setError(null);
    fetch(`/api/invoices/${invoiceId}/link-pago`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!vivo) return;
        setDisponible(d?.disponible === true);
        setLink(d?.link ?? null);
        setHabiaLink(d?.habiaLink === true);
        setSaldo(Number(d?.saldo) || 0);
        setPuedeGenerar(d?.disponible === true && !d?.motivo);
        // Por qué no se puede (sin saldo, bajo el mínimo…), dicho por el servidor.
        setError(d?.disponible === true && d?.motivo && typeof d?.motivoTexto === "string" ? d.motivoTexto : null);
        alCambiar?.(d?.link ?? null);
      })
      .catch(() => { if (vivo) setDisponible(false); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId]);

  const generar = useCallback(async () => {
    setGenerando(true);
    setError(null);
    const r = await pedirLinkDePago(invoiceId);
    setGenerando(false);
    if (r.link) {
      setLink(r.link);
      alCambiar?.(r.link);
    } else {
      setError(r.error ?? t("facturaMp.errorGenerar"));
    }
  }, [invoiceId, alCambiar, t]);

  const copiar = useCallback(async () => {
    if (!link) return;
    if (await copiarAlPortapapeles(link.url)) toast.success(t("facturaMp.copiado"));
    else toast.error(t("facturaMp.copiarFallo"));
  }, [link, t]);

  if (modo === "detalle" && (cargando || !disponible || (!link && !((sugerido || habiaLink) && puedeGenerar)))) return null;

  return (
    <section className={s.bloque} aria-label={t("facturaMp.titulo")} data-link-mercadopago={modo}>
      <h3 className={s.titulo}><Link2 size={14} aria-hidden /> {t("facturaMp.titulo")}</h3>

      {cargando ? (
        <p className={s.ayuda}>{t("facturaMp.cargando")}</p>
      ) : link ? (
        <>
          <p className={s.texto}>
            {t("facturaMp.texto", { monto: fmtMXNdec(link.monto) })}
          </p>
          <span className={s.url}>{link.url}</span>
          <div className={s.acciones}>
            <ButtonNew variant="primary" icon={<Copy size={14} aria-hidden />} onClick={copiar} disabled={bloqueado}>
              {t("facturaMp.copiar")}
            </ButtonNew>
            <ButtonNew
              variant="secondary"
              icon={<ExternalLink size={14} aria-hidden />}
              onClick={() => window.open(link.url, "_blank", "noopener,noreferrer")}
              disabled={bloqueado}
            >
              {t("facturaMp.abrir")}
            </ButtonNew>
          </div>
          <p className={s.ayuda}>{t("facturaMp.vigente", { fecha: formatDate(link.venceA) })}</p>
        </>
      ) : (
        <>
          <p className={s.texto}>{t("facturaMp.textoSinLink", { monto: fmtMXNdec(saldo) })}</p>
          <div className={s.acciones}>
            <ButtonNew
              variant="primary"
              icon={generando ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Link2 size={14} aria-hidden />}
              onClick={generar}
              disabled={bloqueado || generando || !puedeGenerar}
            >
              {generando ? t("facturaMp.generando") : t("facturaMp.generar")}
            </ButtonNew>
          </div>
        </>
      )}

      {error && <p className={s.error} role="alert">{error}</p>}
      {modo === "cobro" && <p className={s.ayuda}>{t("facturaMp.noRegistraAqui")}</p>}
    </section>
  );
}
