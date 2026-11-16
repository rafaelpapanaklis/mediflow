"use client";

import { useState } from "react";
import { UserPlus } from "lucide-react";
import type { TFunction } from "@/i18n/t";
import type { ClientLookup } from "@/lib/barber/cash";

/**
 * «Nadie coincide» + alta rápida DENTRO del ticket (lógica L2). Antes, si el
 * cliente sin cita era nuevo, el buscador se quedaba vacío sin decir nada y
 * para registrarlo había que salir de Caja (y perder el ticket a medias).
 * Usa el alta de siempre (POST /api/barber/clients, clients.edit): si el
 * teléfono ya existe, el servidor VINCULA a ese cliente en vez de duplicar.
 */
/** Lo tecleado en el buscador pasa al alta: un teléfono va al teléfono; lo demás, al nombre. */
export function newClientPrefill(query: string): { name: string; phone: string } {
  const q = query.trim();
  return /^[\d\s()+-]{7,}$/.test(q) ? { name: "", phone: q } : { name: q, phone: "" };
}

export function TicketNewClient({
  t,
  query,
  onPicked,
}: {
  t: TFunction;
  /** Lo que se tecleó en el buscador (sin resultados). */
  query: string;
  onPicked: (client: ClientLookup) => void;
}) {
  const q = query.trim();
  const prefill = newClientPrefill(q);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(prefill.name);
  const [phone, setPhone] = useState(prefill.phone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/barber/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), phone: phone.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; client?: { id: string; phone?: string | null } };
      if (!res.ok || !data.client) {
        setError(res.status === 403 ? t("ticket.newClientForbidden") : data.error ?? t("common.error"));
        return;
      }
      // La forma que usa el ticket (estrellas, membresía…) la da el buscador de Caja.
      const digits = (data.client.phone ?? phone).replace(/\D/g, "").slice(-10);
      const look = await fetch(`/api/barber/sales/clients?q=${encodeURIComponent(digits)}`, { cache: "no-store" });
      const found = look.ok ? ((await look.json()) as { clients: ClientLookup[] }).clients.find((c) => c.id === data.client!.id) : null;
      if (!found) {
        setError(t("common.error"));
        return;
      }
      onPicked(found);
    } catch {
      setError(t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="bcaja-hint" role="status" style={{ marginTop: 6, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }} data-ticket-sin-cliente>
        <span>{t("ticket.clientNoMatch", { query: q })}</span>
        <button type="button" className="btn-new btn-new--secondary btn-new--sm" onClick={() => setOpen(true)}>
          <UserPlus size={13} /> {t("ticket.newClient")}
        </button>
      </div>
    );
  }

  return (
    <div className="bcaja-client" style={{ marginTop: 6, display: "grid", gap: 8 }} data-ticket-alta-cliente>
      <div className="field-new" style={{ margin: 0 }}>
        <label className="field-new__label" htmlFor="ticket-new-client-name">{t("ticket.newClientName")}</label>
        <input id="ticket-new-client-name" className="input-new" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" autoFocus={!name} />
      </div>
      <div className="field-new" style={{ margin: 0 }}>
        <label className="field-new__label" htmlFor="ticket-new-client-phone">{t("ticket.newClientPhone")}</label>
        <input id="ticket-new-client-phone" className="input-new" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="off" autoFocus={Boolean(name) && !phone} />
      </div>
      {error ? <div className="bcaja-alert bcaja-alert--danger" role="alert">{error}</div> : null}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" className="btn-new btn-new--ghost btn-new--sm" onClick={() => setOpen(false)} disabled={busy}>{t("common.cancel")}</button>
        <button type="button" className="btn-new barber-btn-primary btn-new--sm" onClick={() => void save()} disabled={busy || !name.trim() || !phone.trim()}>
          {busy ? t("common.saving") : t("ticket.newClientSave")}
        </button>
      </div>
    </div>
  );
}
