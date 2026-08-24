"use client";

// ═══════════════════════════════════════════════════════════════════════
// PUENTE agenda → caja.
//
// El cobro NO se reimplementa aquí. El modal de ticket de /barber/caja ya
// resuelve todo (precio congelado, agregar servicios y productos,
// descuento, propinas, membresía, lealtad, tres métodos de pago, ticket
// imprimible) y su matemática ya está verificada en producción. Este
// archivo solo lo MONTA desde la agenda:
//
//   1. pide el estado del turno y el contexto de cobro (los mismos dos
//      endpoints que alimenta la pantalla de caja),
//   2. si no hay turno abierto, lo dice y ofrece abrirlo con el MISMO
//      modal de apertura de caja (nada de fallar en silencio),
//   3. busca esta visita en `pendingAppointments` —la lista canónica de
//      "citas por cobrar" que arma getCheckoutContext()— y se la pasa al
//      TicketModal tal cual.
//
// Cero reglas de negocio propias: si algo cambia en src/lib/barber/cash.ts,
// cambia aquí solo. Lo único que este puente sabe es en qué orden preguntar.
// ═══════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Lock, Wallet } from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import type { CashState, CheckoutContext, PendingAppointment, SaleRow } from "@/lib/barber/cash";
import { TicketModal } from "@/components/barber/cash/ticket-modal";
import { OpenSessionModal } from "@/components/barber/cash/session-modals";
import { Modal, agendaCss as css } from "./agenda-ui";

export interface ChargeBridgeProps {
  /** Sub-diccionario `barber.caja`: es el que hablan los modales de dinero. */
  cajaDict: Dictionary;
  appointmentId: string;
  /** Nombre del cliente, solo para el título mientras carga. */
  clientLabel: string;
  timezone: string;
  /** t() de la AGENDA, para los textos de este puente. */
  t: (key: string, vars?: Record<string, string | number>) => string;
  onClose: () => void;
  onCharged: (sale: SaleRow) => void;
}

type Phase = "loading" | "blocked" | "noSession" | "notPending" | "ticket";

export function ChargeBridge(props: ChargeBridgeProps) {
  const { t, appointmentId } = props;
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [checkout, setCheckout] = useState<CheckoutContext | null>(null);
  const [pending, setPending] = useState<PendingAppointment | null>(null);
  const [openingSession, setOpeningSession] = useState(false);

  const load = useCallback(async () => {
    setPhase("loading");
    setError(null);
    try {
      const [cashRes, ctxRes] = await Promise.all([
        fetch("/api/barber/cash-sessions/current"),
        fetch("/api/barber/sales/checkout-context"),
      ]);

      if (!cashRes.ok || !ctxRes.ok) {
        const bad = cashRes.ok ? ctxRes : cashRes;
        const body = (await bad.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? t("barber.agenda.charge.errorLoad"));
        setPhase("blocked");
        return;
      }

      const cash = (await cashRes.json()) as CashState;
      const ctx = (await ctxRes.json()) as CheckoutContext;
      setCheckout(ctx);

      if (!cash.open) {
        setPhase("noSession");
        return;
      }
      // La lista de "por cobrar" la arma getCheckoutContext(): solo visitas
      // TERMINADAS, de la ventana de la caja y sin ticket vivo. Si esta no
      // está ahí, el puente lo dice en vez de inventar un ticket a medias.
      const found = ctx.pendingAppointments.find((a) => a.id === appointmentId) ?? null;
      setPending(found);
      setPhase(found ? "ticket" : "notPending");
    } catch {
      setError(t("barber.agenda.charge.errorLoad"));
      setPhase("blocked");
    }
  }, [appointmentId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // ── El modal de verdad: el MISMO de /barber/caja ──────────────────────
  if (phase === "ticket" && checkout && pending) {
    return (
      <TicketModal
        dict={props.cajaDict}
        checkout={checkout}
        appointment={pending}
        tz={props.timezone}
        onClose={props.onClose}
        onCharged={props.onCharged}
      />
    );
  }

  if (openingSession) {
    return (
      <OpenSessionModal
        dict={props.cajaDict}
        onClose={() => setOpeningSession(false)}
        onDone={() => {
          setOpeningSession(false);
          void load();
        }}
      />
    );
  }

  const title = t("barber.agenda.charge.title", { client: props.clientLabel });

  if (phase === "loading") {
    return (
      <Modal title={title} onClose={props.onClose} closeLabel={t("barber.agenda.actions.close")}>
        <p className={css.hint}>{t("barber.agenda.charge.loading")}</p>
      </Modal>
    );
  }

  if (phase === "noSession") {
    return (
      <Modal
        title={title}
        onClose={props.onClose}
        closeLabel={t("barber.agenda.actions.close")}
        footer={
          <>
            <button type="button" className={css.btn} onClick={props.onClose}>
              {t("barber.agenda.charge.later")}
            </button>
            <button
              type="button"
              className={`${css.btn} ${css.btnPrimary}`}
              onClick={() => setOpeningSession(true)}
            >
              <Wallet size={14} /> {t("barber.agenda.charge.openSession")}
            </button>
          </>
        }
      >
        <div className={css.noticeBox}>
          <strong style={{ display: "block", marginBottom: 4, color: "var(--text-1)" }}>
            {t("barber.agenda.charge.noSessionTitle")}
          </strong>
          {t("barber.agenda.charge.noSessionBody")}
        </div>
      </Modal>
    );
  }

  if (phase === "notPending") {
    return (
      <Modal
        title={title}
        onClose={props.onClose}
        closeLabel={t("barber.agenda.actions.close")}
        footer={
          <>
            <button type="button" className={css.btn} onClick={props.onClose}>
              {t("barber.agenda.actions.close")}
            </button>
            <Link href="/barber/caja" className={`${css.btn} ${css.btnPrimary}`}>
              {t("barber.agenda.charge.goToCash")}
            </Link>
          </>
        }
      >
        <div className={css.noticeBox}>
          <strong style={{ display: "block", marginBottom: 4, color: "var(--text-1)" }}>
            {t("barber.agenda.charge.notPendingTitle")}
          </strong>
          {t("barber.agenda.charge.notPendingBody")}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title={title}
      onClose={props.onClose}
      closeLabel={t("barber.agenda.actions.close")}
      footer={
        <>
          <button type="button" className={css.btn} onClick={props.onClose}>
            {t("barber.agenda.actions.close")}
          </button>
          <Link href="/barber/caja" className={`${css.btn} ${css.btnPrimary}`}>
            <Lock size={14} /> {t("barber.agenda.charge.goToCash")}
          </Link>
        </>
      }
    >
      <div className={css.errorBox}>{error ?? t("barber.agenda.charge.errorLoad")}</div>
    </Modal>
  );
}
