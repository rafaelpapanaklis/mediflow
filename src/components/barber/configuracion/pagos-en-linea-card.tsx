"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { AlertTriangle, CreditCard, ExternalLink, Unplug } from "lucide-react";
import { Banner, Btn, Chip, ErrorText, Modal, apiCall } from "@/components/barber/team/admin-ui";
import type { useBarberT } from "@/components/barber/cash/use-barber-t";
import s from "./configuracion.module.css";

// ═══════════════════════════════════════════════════════════════════════
// Configuración → «Pagos en línea» (ws6-t5). Solo la ve el DUEÑO.
//
// Conecta la cuenta de Mercado Pago de la barbería por OAuth (el mismo
// modelo del dental): el dinero de la tienda va directo a SU cuenta. La
// conexión es un ENLACE a /api/barber/mercadopago/oauth/conectar (sale a
// Mercado Pago y vuelve con ?mp=…); desconectar pide confirmación.
//
// Nunca truena por la conexión: si el token ya no se puede abrir (por
// ejemplo, en un servidor sin la llave de cifrado), dice «vuelve a conectar».
// ═══════════════════════════════════════════════════════════════════════

type T = ReturnType<typeof useBarberT>;

export interface EstadoPagosEnLinea {
  connected: boolean;
  needsReconnect: boolean;
  storageReady: boolean;
  platformReady: boolean;
  account: { nickname: string | null; email: string | null; id: string | null; testMode: boolean } | null;
  connectedAt: string | null;
}

const CONECTAR = "/api/barber/mercadopago/oauth/conectar";
const MOTIVOS = ["permiso", "plataforma", "estado", "sesion", "canje", "guardar"] as const;

function fechaCorta(iso: string | null, locale: string, timeZone: string): string | null {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-MX", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone,
    }).format(new Date(iso));
  } catch {
    return null;
  }
}

export function PagosEnLineaCard({
  t,
  initial,
  locale,
  timeZone,
}: {
  t: T;
  initial: EstadoPagosEnLinea;
  locale: string;
  /** Zona de la barbería: la fecha sale igual en el servidor y en el navegador. */
  timeZone: string;
}) {
  const [estado, setEstado] = useState<EstadoPagosEnLinea>(initial);
  const [aviso, setAviso] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Vuelta del OAuth: ?mp=conectada | cancelado | error&motivo=…
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const mp = q.get("mp");
    if (!mp) return;
    if (mp === "conectada") {
      toast.success(t("configuracion.payments.connectedToast"));
    } else if (mp === "cancelado") {
      setAviso(t("configuracion.payments.cancelled"));
    } else {
      const motivo = q.get("motivo");
      const llave = (MOTIVOS as readonly string[]).includes(motivo ?? "") ? motivo : "generic";
      setAviso(t(`configuracion.payments.errors.${llave}`));
    }
    q.delete("mp");
    q.delete("motivo");
    const resto = q.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${resto ? `?${resto}` : ""}${window.location.hash}`);
    // Solo al montar: la URL de vuelta se lee una vez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function conectar() {
    setTrabajando(true);
    window.location.assign(CONECTAR);
  }

  async function desconectar() {
    setTrabajando(true);
    setError(null);
    try {
      const r = await apiCall<{ status: EstadoPagosEnLinea }>("/api/barber/mercadopago/disconnect", { method: "POST" });
      setEstado(r.status);
      setConfirmar(false);
      toast.success(t("configuracion.payments.disconnectedToast"));
    } catch {
      setError(t("configuracion.payments.disconnectError"));
    } finally {
      setTrabajando(false);
    }
  }

  const cuenta = estado.account;
  const desde = fechaCorta(estado.connectedAt, locale, timeZone);
  const puedeConectar = estado.storageReady && estado.platformReady && !trabajando;
  const nombre = cuenta?.nickname || cuenta?.email || cuenta?.id || t("configuracion.payments.accountFallback");

  let pie: React.ReactNode;
  if (cuenta) {
    pie = (
      <>
        {estado.needsReconnect ? (
          <Btn variant="primary" onClick={conectar} disabled={!puedeConectar}>
            <ExternalLink size={15} aria-hidden="true" /> {t("configuracion.payments.reconnect")}
          </Btn>
        ) : null}
        <Btn variant="danger" onClick={() => setConfirmar(true)} disabled={trabajando}>
          <Unplug size={15} aria-hidden="true" /> {t("configuracion.payments.disconnect")}
        </Btn>
      </>
    );
  } else {
    pie = (
      <Btn variant="primary" onClick={conectar} disabled={!puedeConectar}>
        <ExternalLink size={15} aria-hidden="true" /> {t("configuracion.payments.connect")}
      </Btn>
    );
  }

  return (
    <section id="pagos-en-linea" className={s.card} aria-label={t("configuracion.payments.title")}>
      <div className={s.cardHead}>
        <div className={s.cardIcon}>
          <CreditCard size={18} />
        </div>
        <div style={{ minWidth: 0 }}>
          <h2 className={s.cardTitle}>{t("configuracion.payments.title")}</h2>
          <p className={s.cardSub}>{t("configuracion.payments.sub")}</p>
        </div>
      </div>

      <div className={s.cardBody}>
        {aviso ? (
          <Banner tone="danger" icon={<AlertTriangle size={16} />}>
            {aviso}
          </Banner>
        ) : null}
        {!estado.storageReady ? (
          <Banner icon={<AlertTriangle size={16} />}>
            {t("configuracion.payments.sqlPending", { file: "sql/barber_mercadopago.sql" })}
          </Banner>
        ) : null}

        {cuenta ? (
          <>
            <div className={s.urlBox} data-mp-cuenta="">
              <div style={{ minWidth: 0, flex: "1 1 auto" }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)", overflowWrap: "anywhere" }}>
                  {nombre}
                </div>
                {cuenta.email && cuenta.email !== nombre ? (
                  <div className={s.hint} style={{ overflowWrap: "anywhere" }}>{cuenta.email}</div>
                ) : null}
                {cuenta.id ? (
                  <div className={s.hint}>{t("configuracion.payments.accountId", { id: cuenta.id })}</div>
                ) : null}
              </div>
              {estado.needsReconnect ? (
                <Chip tone="danger">{t("configuracion.payments.chipReconnect")}</Chip>
              ) : (
                <Chip tone="brand">{t("configuracion.payments.chipConnected")}</Chip>
              )}
              {cuenta.testMode ? <Chip tone="warn">{t("configuracion.payments.chipTest")}</Chip> : null}
            </div>
            {estado.needsReconnect ? (
              <Banner tone="danger" icon={<AlertTriangle size={16} />}>
                {t("configuracion.payments.needsReconnect")}
              </Banner>
            ) : !estado.platformReady ? (
              <Banner icon={<AlertTriangle size={16} />}>{t("configuracion.payments.platformPaused")}</Banner>
            ) : (
              <p className={s.hint}>
                {desde
                  ? t("configuracion.payments.connectedSince", { date: desde })
                  : t("configuracion.payments.connectedNote")}
              </p>
            )}
          </>
        ) : (
          <>
            <p className={s.hint} style={{ fontSize: 13, color: "var(--text-2)" }}>
              {t("configuracion.payments.howItWorks")}
            </p>
            {estado.storageReady && !estado.platformReady ? (
              <Banner icon={<AlertTriangle size={16} />}>{t("configuracion.payments.platformMissing")}</Banner>
            ) : null}
          </>
        )}
        <p className={s.hint}>{t("configuracion.payments.moneyNote")}</p>
      </div>

      <div className={s.cardFoot}>{pie}</div>

      {confirmar ? (
        <Modal
          title={t("configuracion.payments.confirmTitle")}
          onClose={() => (trabajando ? undefined : setConfirmar(false))}
          footer={
            <>
              <ErrorText>{error}</ErrorText>
              <Btn onClick={() => setConfirmar(false)} disabled={trabajando}>
                {t("configuracion.payments.confirmCancel")}
              </Btn>
              <Btn variant="danger" onClick={desconectar} disabled={trabajando}>
                {trabajando ? t("configuracion.payments.disconnecting") : t("configuracion.payments.confirmYes")}
              </Btn>
            </>
          }
        >
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: "var(--text-1)" }}>
            {t("configuracion.payments.confirmBody", { account: nombre })}
          </p>
        </Modal>
      ) : null}
    </section>
  );
}
