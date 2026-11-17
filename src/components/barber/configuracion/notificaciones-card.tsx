"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { AlertTriangle, BellRing } from "lucide-react";
import { Banner, Btn, ErrorText, Field, SwitchRow, TextInput, apiCall, useSaving } from "@/components/barber/team/admin-ui";
import type { useBarberT } from "@/components/barber/cash/use-barber-t";
import { soloDigitosTelefono } from "@/lib/barber/phone-format";
import { cleanNoticePhone, type OrderNoticeSettings } from "@/lib/barber/pedido-avisos-core";
import type { OrderNoticeSettingsView } from "@/lib/barber/pedido-avisos";
import s from "./configuracion.module.css";

// ═══════════════════════════════════════════════════════════════════════
// Configuración → «Notificaciones» (ws6-t6, 16-nov-2026).
//
// Rafael: «el apartado y pagar en tienda de un producto, ¿dónde le llega al
// dueño?». Aquí el dueño decide cómo se entera de un pedido de su tienda:
//   · por CORREO — encendido de fábrica. La tarjeta dice a qué correos llega
//     (los Dueños de esta sede y de la matriz), para que no haya sorpresas;
//   · por WHATSAPP — APAGADO de fábrica, con la nota «Meta te cobra cada
//     aviso fuera de las 24 h» siempre a la vista (Rafael: que a ninguna
//     barbería le llegue un cobro de Meta que no esperaba). Pide el número al
//     que se manda: la cuenta del dueño no guarda teléfono. Sin el WhatsApp de
//     la barbería conectado no se puede encender.
//
// Vale por la sede que se está operando. Se guarda sola, con su botón, como
// las demás tarjetas. Sin sql/barber_pedidos_avisos.sql no se manda ningún
// aviso y la tarjeta lo dice (nada se puede guardar).
// ═══════════════════════════════════════════════════════════════════════

type T = ReturnType<typeof useBarberT>;

export const NOTIFICACIONES_SQL = "sql/barber_pedidos_avisos.sql";

export function NotificacionesCard({
  t,
  value,
  onSaved,
}: {
  t: T;
  value: OrderNoticeSettingsView;
  onSaved: (v: OrderNoticeSettingsView) => void;
}) {
  const [email, setEmail] = useState(value.email);
  const [whatsapp, setWhatsapp] = useState(value.whatsapp);
  const [phone, setPhone] = useState(value.phone ?? "");
  const { saving, error, run } = useSaving();
  const k = (key: string, vars?: Record<string, string | number>) => t(`configuracion.notifications.${key}`, vars);

  const phoneClean = cleanNoticePhone(phone);
  const phoneBad = phone.trim() !== "" && phoneClean === null;
  // Encender el WhatsApp sin a dónde mandar no dice la verdad: no se guarda.
  const waNeedsPhone = whatsapp && phoneClean === null;
  const dirty = email !== value.email || whatsapp !== value.whatsapp || (phoneClean ?? "") !== (value.phone ?? "");
  const canSave = value.persisted && dirty && !phoneBad && !waNeedsPhone && !saving;
  // Sin WhatsApp conectado no se puede ENCENDER (sí apagar, si ya estaba).
  const waLocked = !value.persisted || (!value.whatsappConnected && !whatsapp);

  async function save() {
    const done = await run(async () => {
      const r = await apiCall<{ value: OrderNoticeSettings }>("/api/barber/settings", {
        method: "PATCH",
        json: { section: "orderNotices", email, whatsapp, phone: phoneClean ?? "" },
      });
      onSaved({ ...value, ...r.value });
      setPhone(r.value.phone ?? "");
    });
    if (done) toast.success(k("saved"));
  }

  return (
    <section id="notificaciones" className={s.card} aria-label={k("title")} data-notificaciones>
      <div className={s.cardHead}>
        <div className={s.cardIcon}>
          <BellRing size={18} />
        </div>
        <div style={{ minWidth: 0 }}>
          <h2 className={s.cardTitle}>{k("title")}</h2>
          <p className={s.cardSub}>{k("sub")}</p>
        </div>
      </div>
      <div className={s.cardBody}>
        {!value.persisted ? (
          <Banner icon={<AlertTriangle size={16} />}>{k("sqlPending", { file: NOTIFICACIONES_SQL })}</Banner>
        ) : null}

        <SwitchRow
          title={k("email")}
          hint={k("emailHint")}
          checked={email}
          onChange={setEmail}
          disabled={!value.persisted}
        />
        <p className={s.hint} data-avisos-correos>
          {value.recipients.length > 0 ? k("emailTo", { emails: value.recipients.join(", ") }) : k("emailNoOne")}
        </p>

        <SwitchRow
          title={k("whatsapp")}
          hint={k("whatsappHint")}
          checked={whatsapp}
          onChange={setWhatsapp}
          disabled={waLocked}
        />
        {/* El costo va SIEMPRE a la vista, encendido o apagado. */}
        <p className={s.summary} role="note" data-aviso-costo-meta>
          {k("whatsappCost")}
        </p>
        {!value.whatsappConnected ? (
          <p className={s.hint} data-avisos-sin-whatsapp>
            {k("whatsappNotConnected")}{" "}
            <a href="/barber/whatsapp" style={{ fontWeight: 700, color: "var(--brand-ink)" }}>
              {k("whatsappConnect")}
            </a>
          </p>
        ) : null}
        {whatsapp || value.whatsappConnected ? (
          <>
            <Field
              label={k("whatsappPhone")}
              hint={phoneBad || waNeedsPhone ? k("whatsappPhoneBad") : k("whatsappPhoneHint")}
            >
              {(id) => (
                <TextInput
                  id={id}
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  maxLength={16}
                  value={phone}
                  disabled={!value.persisted}
                  aria-invalid={phoneBad || waNeedsPhone ? true : undefined}
                  onChange={(e) => setPhone(soloDigitosTelefono(e.target.value))}
                  placeholder="9991234567"
                  data-avisos-telefono
                />
              )}
            </Field>
            <p className={s.hint}>
              {k("whatsappTemplate")}{" "}
              <a href="/barber/whatsapp" style={{ fontWeight: 700, color: "var(--brand-ink)" }}>
                {k("whatsappTemplateLink")}
              </a>
            </p>
          </>
        ) : null}
      </div>
      <div className={s.cardFoot}>
        <ErrorText>{error}</ErrorText>
        <Btn variant="primary" onClick={save} disabled={!canSave}>
          {saving ? t("common.saving") : t("common.save")}
        </Btn>
      </div>
    </section>
  );
}
