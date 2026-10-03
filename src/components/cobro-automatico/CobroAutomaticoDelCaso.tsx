"use client";
// Cobro automático con tarjeta (ws1-t6) — el bloque dentro de «Cobro del
// tratamiento» de un caso de ortodoncia a plazos.
//
// Se basta con el id de la factura: pide su estado a /api/cobro-automatico/
// factura/[id] y se calla sola (no pinta nada) si la clínica no tiene el
// interruptor encendido, no tiene Mercado Pago conectado, falta el SQL o la ruta
// falla. Con una suscripción viva se pinta aunque el interruptor esté apagado:
// siempre tiene que poder cancelarse.
//
// Ropa: las clases del módulo de ortodoncia (tokens --pr-*), nada de hex.

import { useCallback, useEffect, useState } from "react";
import { Copy, CreditCard, Pause, Play, X } from "lucide-react";
import { Btn } from "@/components/specialties/orthodontics/redesign/atoms/Btn";
import orto from "@/components/specialties/orthodontics/redesign/orto.module.css";
import { WhatsAppLinkButton } from "@/components/ui/whatsapp-link-button";
import type { EstadoDeFactura } from "@/lib/cobro-automatico/servicio.server";
import { fechaLarga, pesos, useTextosCobroAutomatico } from "./textos";

/** «9991234567» / «+52 999 123 4567» → «529991234567» (wa.me pide E.164 sin «+»). */
export function telefonoParaWhatsapp(tel: string | null | undefined): string | null {
  const d = (tel ?? "").replace(/\D/g, "");
  if (d.length === 10) return `52${d}`;
  if (d.length >= 11 && d.length <= 15) return d;
  return null;
}

const ETIQUETA: Record<string, string> = {
  creating: orto.etiquetaNeutra,
  pending: orto.etiquetaAlerta,
  authorized: orto.etiquetaExito,
  paused: orto.etiquetaNeutra,
  cancelled: orto.etiquetaPeligro,
};

export function CobroAutomaticoDelCaso(props: {
  invoiceId: string;
  treatmentPlanId?: string | null;
  /** billing.charge: sin él solo se ve el estado. */
  puedeCobrar: boolean;
}) {
  const t = useTextosCobroAutomatico();
  const [estado, setEstado] = useState<EstadoDeFactura | null>(null);
  const [correo, setCorreo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  const cargar = useCallback(() => {
    let vivo = true;
    fetch(`/api/cobro-automatico/factura/${encodeURIComponent(props.invoiceId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: EstadoDeFactura | null) => {
        if (!vivo) return;
        setEstado(d);
        if (d?.correoSugerido) setCorreo((c) => c || d.correoSugerido || "");
      })
      .catch(() => vivo && setEstado(null));
    return () => {
      vivo = false;
    };
  }, [props.invoiceId]);

  useEffect(() => cargar(), [cargar]);

  async function accion(cuerpo: Record<string, unknown>, confirmar?: string) {
    if (confirmar && !window.confirm(confirmar)) return;
    setOcupado(true);
    setError(null);
    try {
      const r = await fetch(`/api/cobro-automatico/factura/${encodeURIComponent(props.invoiceId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) setError(d?.error ?? t.error);
      else if (d?.estado) setEstado(d.estado);
      else cargar();
    } catch {
      setError(t.error);
    } finally {
      setOcupado(false);
    }
  }

  if (!estado?.visible) return null;
  const cobro = estado.cobro;
  const vivo = cobro && cobro.estado !== "cancelled" ? cobro : null;
  const tel = telefonoParaWhatsapp(estado.telefono);

  return (
    <div className="px-[18px] py-[14px] border-b border-[color:var(--pr-borde-suave)]" data-cobro-automatico>
      <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
        <h4 className={`${orto.bloqueTitulo} flex items-center gap-2`}>
          <CreditCard size={15} strokeWidth={1.75} aria-hidden />
          {t.titulo}
        </h4>
        {cobro ? (
          <span className={`${orto.etiqueta} ${ETIQUETA[cobro.estado] ?? orto.etiquetaNeutra}`}>
            {cobro.pausaMotivo === "ciclo" ? t.estadoPausadoCiclo : t.estado[cobro.estado] ?? cobro.estado}
          </span>
        ) : null}
      </div>

      {vivo ? (
        <div className="space-y-2">
          <div className="text-[13px] flex flex-wrap gap-x-4 gap-y-1">
            <span className="tabular-nums font-medium">{t.montoCada(pesos(vivo.monto, t.locale))}</span>
            {vivo.proximoCobro ? (
              <span className={orto.tonoTexto2}>{t.proximo(fechaLarga(vivo.proximoCobro, t.locale))}</span>
            ) : vivo.inicio ? (
              <span className={orto.tonoTexto2}>{t.desde(fechaLarga(vivo.inicio, t.locale))}</span>
            ) : null}
          </div>

          {vivo.pausaMotivo === "ciclo" && vivo.reanudarEl ? (
            <p className={`text-[12.5px] ${orto.tonoTexto2}`} data-pausado-ciclo>{t.pausadoCiclo(fechaLarga(vivo.reanudarEl, t.locale))}</p>
          ) : null}

          {vivo.link ? (
            <div className={`${orto.aviso} ${orto.avisoAlerta}`} style={{ display: "grid", gap: 8 }}>
              <span className={orto.avisoTexto}>
                <strong>{t.linkTitulo}.</strong> {t.linkPista}
              </span>
              <code className="text-[12px] break-all" style={{ color: "var(--pr-texto-2)" }}>{vivo.link}</code>
              <div className="flex flex-wrap items-center gap-2">
                <Btn
                  variant="secondary"
                  size="sm"
                  icon={<Copy size={14} strokeWidth={1.75} aria-hidden />}
                  onClick={() => {
                    navigator.clipboard?.writeText(vivo.link as string).then(() => {
                      setCopiado(true);
                      setTimeout(() => setCopiado(false), 2000);
                    });
                  }}
                >
                  {copiado ? t.copiado : t.copiar}
                </Btn>
                {tel ? (
                  <WhatsAppLinkButton phoneE164={tel} message={t.mensajeWhatsapp(estado.clinica ?? "", vivo.link)} iconSize={14}>
                    {t.whatsapp}
                  </WhatsAppLinkButton>
                ) : null}
              </div>
            </div>
          ) : null}

          {props.puedeCobrar ? (
            <div className="flex flex-wrap gap-2">
              {vivo.estado === "authorized" ? (
                <Btn variant="ghost" size="sm" disabled={ocupado} icon={<Pause size={14} strokeWidth={1.75} aria-hidden />} onClick={() => accion({ accion: "pausar" }, t.confirmarPausar)}>
                  {t.pausar}
                </Btn>
              ) : null}
              {vivo.estado === "paused" && vivo.pausaMotivo !== "ciclo" ? (
                <Btn variant="ghost" size="sm" disabled={ocupado} icon={<Play size={14} strokeWidth={1.75} aria-hidden />} onClick={() => accion({ accion: "reanudar" })}>
                  {t.reanudar}
                </Btn>
              ) : null}
              {vivo.estado !== "creating" ? (
                <Btn variant="danger" size="sm" disabled={ocupado} icon={<X size={14} strokeWidth={1.75} aria-hidden />} onClick={() => accion({ accion: "cancelar" }, t.confirmarCancelar)}>
                  {t.cancelar}
                </Btn>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="space-y-2">
          {cobro?.estado === "cancelled" && cobro.motivoCancelacion ? (
            <p className={`text-[12px] ${orto.tonoApagado}`}>{t.canceladoPorque(cobro.motivoCancelacion)}</p>
          ) : null}
          {estado.puedeActivar && estado.plan && props.puedeCobrar ? (
            <>
              <p className={`text-[13px] ${orto.tonoTexto2}`}>
                {t.resumenPlan(pesos(estado.plan.monto, t.locale), fechaLarga(estado.plan.inicio, t.locale), estado.plan.cuotaInicial, estado.plan.totalCuotas)}
              </p>
              <label className={orto.campo}>
                <span className={orto.campoEtiqueta}>{t.correo}</span>
                <input
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  className={orto.entrada}
                  value={correo}
                  onChange={(e) => setCorreo(e.target.value)}
                  style={{ maxWidth: 360 }}
                />
                <span className={orto.campoPista}>{t.correoPista}</span>
              </label>
              <Btn
                variant="primary"
                size="sm"
                disabled={ocupado || !correo.trim()}
                icon={<CreditCard size={14} strokeWidth={1.75} aria-hidden />}
                onClick={() => accion({ accion: "activar", correo, treatmentPlanId: props.treatmentPlanId ?? null }, t.confirmar)}
              >
                {ocupado ? t.activando : t.activar}
              </Btn>
            </>
          ) : estado.motivo ? (
            <p className={`text-[12px] ${orto.tonoApagado}`}>{estado.motivo}</p>
          ) : null}
        </div>
      )}

      {error ? (
        <div className={`${orto.aviso} ${orto.avisoPeligro} mt-2`} role="alert">
          <span className={orto.avisoTexto}>{error}</span>
        </div>
      ) : null}
    </div>
  );
}
