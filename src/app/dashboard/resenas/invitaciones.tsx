"use client";

import { Mail, Send } from "lucide-react";
import { useLocale } from "@/i18n/i18n-provider";
import { formatInvitationDate, type EstadoInvitacion, type InvitacionResenaDTO } from "@/lib/reviews/types";
import { Etiqueta, estilos as s } from "@/components/dashboard/pequenas-rediseno/piezas";

// ─────────────────────────────────────────────────────────────────────────────
// «Invitaciones» de Reseñas (ws1-t4, 11.4): lo que se pidió al cerrar cada cita
// y cómo va DE VERDAD. «Enviada» solo significa que Meta aceptó el mensaje; si
// después lo rechaza (131026: el número no tiene WhatsApp) aquí dice «Falló» y
// por qué, en vez de seguir figurando como invitada.
//
// Los textos viven aquí (no en los diccionarios) por la misma razón que
// textos-equipo.ts: esos archivos los tocan varias pantallas a la vez.
// ─────────────────────────────────────────────────────────────────────────────

const es = {
  titulo: "Invitaciones enviadas",
  intro: "Los últimos 30 días, las que aún no han respondido.",
  estado: {
    enviada: "Enviada",
    entregada: "Entregada",
    vista: "Vista",
    fallo: "No se entregó",
    sin_enviar: "No se envió",
  } satisfies Record<EstadoInvitacion, string>,
  porCorreo: "También por correo",
  motivos: {
    undeliverable: "Ese número no tiene WhatsApp o no puede recibir el mensaje.",
    outside24h: "Fuera de la ventana de 24 h y sin plantilla aprobada.",
    tokenExpired: "La conexión de WhatsApp de la clínica caducó.",
    billingRequired: "La cuenta de WhatsApp de la clínica no tiene método de pago.",
    templateRejected: "Meta rechazó la plantilla de reseñas.",
    rateLimited: "Meta limitó el envío; vuelve a intentarlo más tarde.",
    generic: "WhatsApp rechazó el mensaje.",
  } as Record<string, string>,
  sinEnviar: "Ningún canal aceptó el mensaje (sin WhatsApp conectado, sin plantilla de reseñas o sin correo).",
};

const en: typeof es = {
  titulo: "Invitations sent",
  intro: "Last 30 days, the ones not answered yet.",
  estado: {
    enviada: "Sent",
    entregada: "Delivered",
    vista: "Seen",
    fallo: "Not delivered",
    sin_enviar: "Not sent",
  },
  porCorreo: "Also by email",
  motivos: {
    undeliverable: "That number has no WhatsApp or can't receive the message.",
    outside24h: "Outside the 24 h window and no approved template.",
    tokenExpired: "The clinic's WhatsApp connection expired.",
    billingRequired: "The clinic's WhatsApp account has no payment method.",
    templateRejected: "Meta rejected the review template.",
    rateLimited: "Meta rate-limited the send; try again later.",
    generic: "WhatsApp rejected the message.",
  },
  sinEnviar: "No channel accepted the message (no WhatsApp connected, no review template, or no email).",
};

const TONO: Record<EstadoInvitacion, "info" | "ambar" | "neutra" | "violeta"> = {
  enviada: "neutra",
  entregada: "info",
  vista: "violeta",
  fallo: "ambar",
  sin_enviar: "ambar",
};

const CLASICA: Record<"info" | "ambar" | "neutra" | "violeta", string> = {
  neutra: "badge-new--neutral",
  info: "badge-new--info",
  violeta: "badge-new--brand",
  ambar: "badge-new--warning",
};

// `rediseno` elige el vestido: las piezas del menú de dos niveles (variables
// --pr-*, que solo existen dentro de RaizPequenas) o las clases de siempre.
export function Invitaciones({ items, rediseno = false }: { items: InvitacionResenaDTO[] | undefined; rediseno?: boolean }) {
  const t = useLocale().startsWith("en") ? en : es;
  if (!items || items.length === 0) return null;

  const Chip = ({ tono, children }: { tono: keyof typeof CLASICA; children: React.ReactNode }) =>
    rediseno ? (
      <Etiqueta tono={tono}>{children}</Etiqueta>
    ) : (
      <span className={`badge-new ${CLASICA[tono]}`}>{children}</span>
    );

  return (
    <section
      aria-label={t.titulo}
      data-testid="invitaciones-resenas"
      className={rediseno ? s.lista : undefined}
      style={{ marginBottom: 16, ...(rediseno ? {} : { display: "grid", gap: 10 }) }}
    >
      <div>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--text-1)" }}>{t.titulo}</h2>
        <p style={{ fontSize: 13, color: "var(--text-3)", marginTop: 2 }}>{t.intro}</p>
      </div>
      {items.map((i) => {
        const motivo =
          i.estado === "fallo" ? t.motivos[i.motivo ?? "generic"] ?? t.motivos.generic
          : i.estado === "sin_enviar" ? t.sinEnviar
          : null;
        const chips = (
          <>
            {i.porCorreo && (
              <Chip tono="neutra"><Mail size={11} strokeWidth={1.75} aria-hidden /> {t.porCorreo}</Chip>
            )}
            <Chip tono={TONO[i.estado]}><Send size={11} strokeWidth={1.75} aria-hidden /> {t.estado[i.estado]}</Chip>
          </>
        );
        return rediseno ? (
          <article key={i.id} className={s.tarjeta}>
            <div className={s.tarjetaCuerpo}>
              <div className={s.tarjetaCabeza}>
                <div className={s.tarjetaTextos}>
                  <h3 className={s.tarjetaTitulo}>{i.authorName}</h3>
                  <p className={s.tarjetaSub}>{formatInvitationDate(i.createdAt)}</p>
                </div>
                <div className={s.tarjetaAcciones}>{chips}</div>
              </div>
              {motivo && <p className={s.parrafo}>{motivo}</p>}
            </div>
          </article>
        ) : (
          <article key={i.id} className="card">
            <div className="card__body">
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                <div>
                  <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)" }}>{i.authorName}</h3>
                  <p style={{ fontSize: 12, color: "var(--text-3)" }}>{formatInvitationDate(i.createdAt)}</p>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{chips}</div>
              </div>
              {motivo && <p style={{ fontSize: 13, color: "var(--text-2)", marginTop: 8 }}>{motivo}</p>}
            </div>
          </article>
        );
      })}
    </section>
  );
}
