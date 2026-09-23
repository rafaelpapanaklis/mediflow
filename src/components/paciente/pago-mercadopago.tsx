"use client";

// Pagar una factura con Mercado Pago desde el portal del paciente (ws1-t2).
//
// Un botón pide el link a POST /api/paciente/payments/mercadopago (solo manda
// el id de la factura: el monto lo decide el servidor) y, con lo que devuelve,
// enseña el botón «Abrir Mercado Pago» y un QR del MISMO link para escanearlo
// con el celular si el paciente está en una pantalla grande.
//
// 🔴 El QR y el botón salen SOLO de la `url` que devolvió el servidor, y solo
// si es de Mercado Pago (`esUrlDeMercadoPago`). Nada que teclee el paciente.
//
// Cuando Mercado Pago acredita, el webhook de siempre registra el pago; la
// lista se refresca sola (usePacienteData revalida al volver a la pestaña y
// cada 20 s) y la factura sale pagada, sin este panel.
import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useTOptional } from "@/i18n/i18n-provider";
import { makeT } from "@/i18n/t";
import { IconoMercadoPago } from "@/components/dashboard/billing/icono-mercado-pago";
import { formatMxn, formatFecha } from "@/components/paciente/ui";
import type { PacienteFactura } from "@/lib/patient-portal/types";
import {
  TEXTOS_PAGO_MP_ES,
  esUrlDeMercadoPago,
  varsErrorPortal,
  type ErrorPagoPortal,
  type LinkDePagoPortal,
} from "@/lib/patient-portal/pago-mercadopago";

const TEXT = "rgba(255,255,255,0.92)";
const MUTED = "rgba(255,255,255,0.55)";

const CODIGOS: ErrorPagoPortal[] = ["peticion", "no_encontrada", "sin_saldo", "bajo_minimo", "sin_mp", "mp_fallo"];

/** `t` del panel si hay I18nProvider; el portal todavía no lo monta → español. */
function useTextos() {
  const t = useTOptional();
  const respaldo = useMemo(() => makeT({ portalPagoMp: TEXTOS_PAGO_MP_ES }), []);
  return t ?? respaldo;
}

export interface PagoMercadoPago {
  /** El link listo para enseñarse (null = todavía no se pidió, o ya no vale). */
  link: LinkDePagoPortal | null;
  pidiendo: boolean;
  error: string | null;
  pedir: () => void;
  ocultar: () => void;
}

/**
 * Estado del pago de UNA factura. El link se descarta solo si la factura cambia
 * (la cobraron en caja, se pagó una parte…): el saldo viejo ya no es lo que se
 * debe, y el servidor ya cerró ese link en Mercado Pago.
 */
export function usePagoMercadoPago(f: PacienteFactura): PagoMercadoPago {
  const t = useTextos();
  const [guardado, setGuardado] = useState<{ link: LinkDePagoPortal; paid: number; total: number } | null>(null);
  const [pidiendo, setPidiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const link = guardado && guardado.paid === f.paid && guardado.total === f.total ? guardado.link : null;

  async function pedir() {
    setPidiendo(true);
    setError(null);
    const generico = t("portalPagoMp.errores.peticion");
    try {
      const res = await fetch("/api/paciente/payments/mercadopago", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ invoiceId: f.id }),
      });
      if (res.status === 401) {
        window.location.assign(`/paciente/login?next=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      const data = await res.json().catch(() => null);
      if (res.ok && data && esUrlDeMercadoPago(data.url) && typeof data.monto === "number") {
        setGuardado({
          link: { url: data.url, monto: data.monto, venceA: String(data.venceA ?? "") },
          paid: f.paid,
          total: f.total,
        });
      } else if (res.ok) {
        setError(t("portalPagoMp.errores.mp_fallo"));
      } else if (data && CODIGOS.includes(data.code)) {
        setError(t(`portalPagoMp.errores.${data.code}`, varsErrorPortal()));
      } else {
        setError((data && typeof data.error === "string" && data.error) || generico);
      }
    } catch {
      setError(generico);
    } finally {
      setPidiendo(false);
    }
  }

  return {
    link,
    pidiendo,
    error,
    pedir: () => void pedir(),
    ocultar: () => {
      setGuardado(null);
      setError(null);
    },
  };
}

/** El botón de la columna de acciones (y el error, si lo hubo). */
export function BotonMercadoPago({ pago }: { pago: PagoMercadoPago }) {
  const t = useTextos();
  return (
    <div style={{ minWidth: 0, maxWidth: "100%" }}>
      <button
        type="button"
        onClick={pago.pedir}
        disabled={pago.pidiendo}
        data-pago-mp="pedir"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          background: "#7c3aed",
          color: "#fff",
          border: "none",
          borderRadius: 10,
          padding: "9px 14px",
          fontSize: 13,
          fontWeight: 600,
          lineHeight: 1.25,
          textAlign: "left",
          cursor: pago.pidiendo ? "default" : "pointer",
          minHeight: 38,
          maxWidth: "100%",
          opacity: pago.pidiendo ? 0.7 : 1,
        }}
      >
        <span
          style={{
            display: "inline-flex",
            background: "#fff",
            borderRadius: 999,
            padding: "2px 4px",
            flex: "0 0 auto",
          }}
        >
          <IconoMercadoPago size={14} />
        </span>
        <span style={{ minWidth: 0 }}>
          {pago.pidiendo ? t("portalPagoMp.preparando") : t("portalPagoMp.pagar")}
        </span>
      </button>
      {pago.error && (
        <div role="alert" style={{ color: "#f87171", fontSize: 12, marginTop: 4 }}>
          {pago.error}
        </div>
      )}
    </div>
  );
}

// El QR va a la izquierda en pantalla ancha; en el celular, DEBAJO del botón
// (ahí lo normal es tocar «Abrir Mercado Pago», el QR es para otra pantalla).
const panelCss = `
.pmpPanel{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:16px;align-items:center;margin-top:4px;padding:14px;border-radius:12px;background:rgba(124,58,237,0.08);border:1px solid rgba(124,58,237,0.28)}
.pmpQr{flex:0 0 auto;background:#fff;border-radius:12px;padding:10px;line-height:0}
.pmpTexto{flex:1 1 220px;min-width:0;display:flex;flex-direction:column;gap:8px}
@media (max-width:559px){.pmpQr{order:2;margin:0 auto}.pmpTexto{order:1}}
`;

const abrirBtn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  alignSelf: "flex-start",
  maxWidth: "100%",
  minHeight: 42,
  padding: "10px 16px",
  borderRadius: 10,
  background: "#009ee3",
  color: "#fff",
  fontSize: 14,
  fontWeight: 700,
  textDecoration: "none",
};

/** El panel con el botón que lleva al link y el QR del mismo link. Ocupa la fila entera. */
export function PanelMercadoPago({ pago, invoiceNumber }: { pago: PagoMercadoPago; invoiceNumber: string }) {
  const t = useTextos();
  const link = pago.link;
  if (!link || !esUrlDeMercadoPago(link.url)) return null;
  const vence = link.venceA && !isNaN(new Date(link.venceA).getTime()) ? formatFecha(link.venceA) : null;
  return (
    <div className="pmpPanel" data-pago-mp="panel" data-factura={invoiceNumber}>
      <style>{panelCss}</style>
      <div className="pmpQr">
        <QRCodeSVG
          value={link.url}
          size={168}
          level="M"
          marginSize={0}
          role="img"
          aria-label={t("portalPagoMp.qrAlt")}
          data-pago-mp="qr"
        />
      </div>
      <div className="pmpTexto">
        <div style={{ color: TEXT, fontSize: 15, fontWeight: 700 }}>
          {t("portalPagoMp.titulo", { monto: formatMxn(link.monto) })}
        </div>
        <a href={link.url} target="_blank" rel="noopener noreferrer" style={abrirBtn} data-pago-mp="abrir">
          {t("portalPagoMp.abrir")}
        </a>
        <div style={{ color: MUTED, fontSize: 13, lineHeight: 1.45 }}>{t("portalPagoMp.qrAyuda")}</div>
        <div style={{ color: MUTED, fontSize: 13, lineHeight: 1.45 }}>
          {t("portalPagoMp.seRegistraSolo")}
          {vence ? ` ${t("portalPagoMp.vence", { fecha: vence })}` : ""}
        </div>
        <button
          type="button"
          onClick={pago.ocultar}
          style={{
            alignSelf: "flex-start",
            background: "transparent",
            border: "none",
            color: "#a78bfa",
            fontSize: 13,
            fontWeight: 600,
            padding: "6px 0",
            cursor: "pointer",
          }}
        >
          {t("portalPagoMp.ocultar")}
        </button>
      </div>
    </div>
  );
}
