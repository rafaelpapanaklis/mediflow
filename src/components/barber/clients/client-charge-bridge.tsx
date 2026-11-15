"use client";

// ═══════════════════════════════════════════════════════════════════════
// PUENTE ficha del cliente → caja («Nuevo cobro»).
//
// Igual que el de la agenda (agenda/charge-bridge.tsx): el cobro NO se
// reimplementa. Se monta el MISMO TicketModal de /barber/caja con el cliente
// ya puesto, así que el ticket sale por createSale y entra al corte, Inicio,
// Reportes, comisiones y estrellas exactamente como uno hecho en Caja.
//
//   1. pide el turno y el contexto de cobro (con ?clientId=, que trae a este
//      cliente con sus estrellas y bonos frescos);
//   2. sin turno abierto, lo dice y ofrece abrirlo con el MISMO modal de Caja
//      (si la persona puede; si no, la manda a Caja);
//   3. abre el TicketModal con `initialClient`.
// ═══════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Wallet } from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import { makeBarberT } from "@/lib/barber/i18n";
import type { CashState, CheckoutContext, ClientLookup, SaleRow } from "@/lib/barber/cash";
import { TicketModal } from "@/components/barber/cash/ticket-modal";
import { OpenSessionModal } from "@/components/barber/cash/session-modals";
import { Modal, clientStyles as s } from "./ui";

type Phase = "loading" | "error" | "noSession" | "ticket";

export function ClientChargeBridge({
  clientId,
  clientName,
  cajaDict,
  starsDict,
  cobrosDict,
  locale,
  timezone,
  canOpenSession,
  onClose,
  onCharged,
}: {
  clientId: string;
  clientName: string;
  /** Sub-árbol barber.caja (lo hablan los modales de dinero). */
  cajaDict: Dictionary;
  /** Sub-árbol barber.estrellas (bonos y «+1 estrella» al cobrar). */
  starsDict?: Dictionary;
  /** Sub-árbol barber.cobros (los textos de este puente). */
  cobrosDict: Dictionary;
  locale: string;
  timezone: string;
  /** cash.manage: puede abrir el turno desde aquí. */
  canOpenSession: boolean;
  onClose: () => void;
  onCharged: (sale: SaleRow) => void;
}) {
  const t = useMemo(() => makeBarberT(cobrosDict), [cobrosDict]);
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [checkout, setCheckout] = useState<CheckoutContext | null>(null);
  const [client, setClient] = useState<ClientLookup | null>(null);
  const [openingSession, setOpeningSession] = useState(false);

  const load = useCallback(async () => {
    setPhase("loading");
    setError(null);
    try {
      const [cashRes, ctxRes] = await Promise.all([
        fetch("/api/barber/cash-sessions/current", { cache: "no-store" }),
        fetch(`/api/barber/sales/checkout-context?clientId=${encodeURIComponent(clientId)}`, { cache: "no-store" }),
      ]);
      if (!cashRes.ok || !ctxRes.ok) {
        const bad = cashRes.ok ? ctxRes : cashRes;
        const body = (await bad.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? null);
        setPhase("error");
        return;
      }
      const cash = (await cashRes.json()) as CashState;
      const ctx = (await ctxRes.json()) as CheckoutContext & { client?: ClientLookup | null };
      setCheckout(ctx);
      setClient(ctx.client ?? null);
      setPhase(cash.open ? "ticket" : "noSession");
    } catch {
      setPhase("error");
    }
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (phase === "ticket" && checkout) {
    return (
      <TicketModal
        dict={cajaDict}
        starsDict={starsDict}
        locale={locale}
        checkout={checkout}
        appointment={null}
        initialClient={client}
        tz={timezone}
        onClose={onClose}
        onCharged={onCharged}
      />
    );
  }

  if (openingSession) {
    return (
      <OpenSessionModal
        dict={cajaDict}
        onClose={() => setOpeningSession(false)}
        onDone={() => {
          setOpeningSession(false);
          void load();
        }}
      />
    );
  }

  const title = `${t("newCharge")} · ${clientName}`;

  if (phase === "loading") {
    return (
      <Modal title={title} onClose={onClose} closeLabel="×">
        <p className={s.hint}>{t("loadingCharge")}</p>
      </Modal>
    );
  }

  if (phase === "noSession") {
    return (
      <Modal
        title={title}
        onClose={onClose}
        closeLabel="×"
        footer={
          canOpenSession ? (
            <button type="button" className={`${s.btn} barber-btn-primary`} onClick={() => setOpeningSession(true)} data-accion="abrir-turno">
              <Wallet size={14} /> {t("noSession.open")}
            </button>
          ) : (
            <Link href="/barber/caja" className={`${s.btn} barber-btn-primary`}>
              {t("noSession.goCaja")}
            </Link>
          )
        }
      >
        <p className={s.sectionTitle} style={{ margin: 0 }}>{t("noSession.title")}</p>
        <p className={s.sectionSub} style={{ marginTop: 4 }}>
          {t("noSession.body")}
          {canOpenSession ? "" : ` ${t("noSession.noPermission")}`}
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      closeLabel="×"
      footer={
        <Link href="/barber/caja" className={`${s.btn} barber-btn-primary`}>
          {t("noSession.goCaja")}
        </Link>
      }
    >
      <p className={s.errorText} role="alert">{error ?? t("error")}</p>
    </Modal>
  );
}
