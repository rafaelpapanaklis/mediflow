"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { AlertTriangle, BellRing } from "lucide-react";
import { Banner, Btn, ErrorText, SwitchRow, apiCall, useSaving } from "@/components/barber/team/admin-ui";
import type { useBarberT } from "@/components/barber/cash/use-barber-t";
import type { OrderNoticeSettings } from "@/lib/barber/pedido-avisos-core";
import type { OrderNoticeSettingsView } from "@/lib/barber/pedido-avisos";
import s from "./configuracion.module.css";

// ═══════════════════════════════════════════════════════════════════════
// Configuración → «Notificaciones» (ws6-t6, 16-nov-2026).
//
// Rafael: «el apartado y pagar en tienda de un producto, ¿dónde le llega al
// dueño?». Aquí el dueño decide cómo se entera de un pedido de su tienda:
//   · por CORREO — encendido de fábrica. La tarjeta dice a qué correos llega
//     (los Dueños de esta sede y de la matriz), para que no haya sorpresas.
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
  const { saving, error, run } = useSaving();
  const k = (key: string, vars?: Record<string, string | number>) => t(`configuracion.notifications.${key}`, vars);

  const dirty = email !== value.email;
  const canSave = value.persisted && dirty && !saving;

  async function save() {
    const done = await run(async () => {
      const r = await apiCall<{ value: OrderNoticeSettings }>("/api/barber/settings", {
        method: "PATCH",
        json: { section: "orderNotices", email },
      });
      onSaved({ ...value, ...r.value });
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
