"use client";

// ═══════════════════════════════════════════════════════════════════════
// Las piezas que comparten el tablero, la lista y la ficha del prospecto.
//
// Aquí vive lo VISUAL; lo que decide (catálogo de etapas, semáforo,
// enlaces) está en src/lib/admin/crm/crm-core.ts. La razón de tenerlo
// junto es que las tres pantallas pinten la misma etapa con el mismo color
// y el mismo texto: un badge duplicado es un badge que un día discrepa.
//
// 🔴 LOS BOTONES DE CONTACTO NO MANDAN NADA. Abren wa.me / tel: / mailto:
// en el navegador de quien vende y dejan la constancia en la bitácora. El
// producto todavía no manda un WhatsApp por su cuenta, y una pantalla que
// dijera "enviado" estaría mintiendo: lo que se registra es "se abrió".
// ═══════════════════════════════════════════════════════════════════════
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Mail, MessageCircle, Phone, Globe, Handshake, X } from "lucide-react";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import {
  crmEtapa,
  crmMailLink,
  crmPlantillaWhatsapp,
  crmSemaforo,
  crmSemaforoTexto,
  crmSemaforoTono,
  crmTelLink,
  crmTelefonoLegible,
  crmVertical,
  crmWhatsappLink,
  CRM_ETAPAS,
} from "@/lib/admin/crm/crm-core";
import type { CrmProspectoDTO } from "@/lib/admin/crm/service";
import { contactoRapidoAccion } from "./actions";

// ── Formato de fechas ───────────────────────────────────────────────────
// Los formateadores se construyen UNA vez, al cargar el módulo: crear un
// Intl.DateTimeFormat por render es caro y en una tabla de cientos de
// filas se nota. La zona va FIJA a México y no a la del navegador para que
// el servidor y el cliente pinten exactamente el mismo texto (si no, la
// hidratación cambiaría las fechas al montar).
const TZ = "America/Mexico_City";
const FMT_FECHA = new Intl.DateTimeFormat("es-MX", {
  timeZone: TZ,
  day: "numeric",
  month: "short",
  year: "numeric",
});
const FMT_FECHA_CORTA = new Intl.DateTimeFormat("es-MX", {
  timeZone: TZ,
  day: "numeric",
  month: "short",
});
const FMT_FECHA_HORA = new Intl.DateTimeFormat("es-MX", {
  timeZone: TZ,
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function crmFmtFecha(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return FMT_FECHA.format(d);
}

export function crmFmtFechaCorta(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return FMT_FECHA_CORTA.format(d);
}

export function crmFmtFechaHora(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return FMT_FECHA_HORA.format(d);
}

const FMT_MXN = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0,
});

export function crmFmtMxn(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "—";
  return FMT_MXN.format(Number(n));
}

// ── Color por giro ──────────────────────────────────────────────────────
// Decorativo, no semántico: por eso vive aquí y no en el catálogo. Sirve
// para reconocer de un vistazo si el tablero trae mezclados dentistas,
// escuelas y barberías.
const COLOR_VERTICAL: Record<string, string> = {
  DENTAL: "#7c3aed",
  INSTITUCION: "#2563eb",
  BARBERIA: "#d97706",
  INMOBILIARIA: "#0d9488",
  LABORATORIO: "#db2777",
  PROVEEDOR: "#475569",
  OTRO: "#64748b",
};

export function crmColorVertical(vertical: string | null | undefined): string {
  return COLOR_VERTICAL[String(vertical ?? "")] ?? COLOR_VERTICAL.OTRO;
}

/** Iniciales del negocio sobre el color de su giro. */
export function CrmAvatar({
  name,
  vertical,
  size = 32,
}: {
  name: string;
  vertical?: string | null;
  size?: number;
}) {
  const iniciales = String(name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
  const color = crmColorVertical(vertical);
  return (
    <div
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: 8,
        flexShrink: 0,
        display: "grid",
        placeItems: "center",
        background: `${color}22`,
        color,
        border: `1px solid ${color}44`,
        fontSize: Math.round(size * 0.36),
        fontWeight: 700,
        letterSpacing: "0.02em",
      }}
    >
      {iniciales || "?"}
    </div>
  );
}

// ── Etiquetas ───────────────────────────────────────────────────────────

export function CrmEtapaBadge({ stage }: { stage: string | null | undefined }) {
  const e = crmEtapa(stage);
  return (
    <BadgeNew tone={e.tono} dot>
      {e.label}
    </BadgeNew>
  );
}

export function CrmVerticalChip({ vertical }: { vertical: string | null | undefined }) {
  const v = crmVertical(vertical);
  const color = crmColorVertical(v.id);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 11,
        color: "var(--text-3)",
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{ width: 6, height: 6, borderRadius: 99, background: color, flexShrink: 0 }}
        aria-hidden
      />
      {v.label}
    </span>
  );
}

/**
 * De dónde salió el prospecto cuando NO lo dio de alta DaleControl. Se
 * pinta en la tarjeta, en la lista y en la ficha: saber que una clínica la
 * recomendó un socio cambia cómo se le habla y a quién se le paga.
 *
 * `affiliateId` con `affiliateName` en null = el socio ya no existe. Se
 * dice, en vez de callar el origen.
 */
export function CrmOrigenChip({ p }: { p: CrmProspectoDTO }) {
  if (!p.affiliateId) return null;
  return (
    <span
      title={
        p.affiliateName
          ? `Lo recomendó ${p.affiliateName} desde su panel de afiliado`
          : "Lo recomendó un socio que ya no está dado de alta"
      }
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 10.5,
        padding: "1px 7px",
        borderRadius: 99,
        background: "var(--brand-soft)",
        color: "var(--text-2)",
        border: "1px solid var(--border-soft)",
        whiteSpace: "nowrap",
        maxWidth: 200,
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      <Handshake size={11} />
      {p.affiliateName ?? "Socio dado de baja"}
    </span>
  );
}

/** El chip del próximo paso. Es lo primero que se busca con la vista. */
export function CrmSemaforoChip({
  fecha,
  nota,
  ahora,
}: {
  fecha: string | null | undefined;
  nota?: string | null;
  ahora?: Date;
}) {
  const estado = crmSemaforo(fecha, ahora ?? new Date());
  if (estado === "sin-fecha") {
    return (
      <span style={{ fontSize: 11, color: "var(--text-4)" }}>Sin próximo paso</span>
    );
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
      <BadgeNew tone={crmSemaforoTono(estado)} dot>
        {crmSemaforoTexto(fecha, ahora ?? new Date())}
      </BadgeNew>
      {nota && (
        <span
          title={nota}
          style={{
            fontSize: 11.5,
            color: "var(--text-3)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {nota}
        </span>
      )}
    </span>
  );
}

// ── Botones de contacto ─────────────────────────────────────────────────

const ESTILO_BOTON: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  height: 28,
  padding: "0 10px",
  borderRadius: 7,
  border: "1px solid var(--border-soft)",
  background: "var(--bg-elev-2)",
  color: "var(--text-2)",
  fontSize: 11.5,
  fontWeight: 500,
  textDecoration: "none",
  whiteSpace: "nowrap",
  cursor: "pointer",
};

const ESTILO_APAGADO: React.CSSProperties = {
  ...ESTILO_BOTON,
  opacity: 0.4,
  cursor: "not-allowed",
};

/**
 * WhatsApp, llamar y correo. Cada uno es un <a> de verdad —no un
 * window.open— para que ningún bloqueador de emergentes se coma el clic, y
 * al soltarlo se anota el intento en la bitácora.
 *
 * `soloIconos` es para las tarjetas del tablero, donde no cabe el texto.
 */
export function CrmAccionesContacto({
  p,
  soloIconos,
  alRegistrar,
}: {
  p: CrmProspectoDTO;
  soloIconos?: boolean;
  alRegistrar?: () => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const mensaje = crmPlantillaWhatsapp(p.vertical, { negocio: p.name, contacto: p.contactName });
  const wa = crmWhatsappLink(p.phone, mensaje);
  const tel = crmTelLink(p.phone);
  const correo = crmMailLink(
    p.email,
    `DaleControl para ${p.name}`,
    `${mensaje}\n\n— Equipo DaleControl`,
  );

  function registrar(kind: string) {
    startTransition(async () => {
      const r = await contactoRapidoAccion(p.id, kind);
      if (!r.ok) {
        toast.error(r.error ?? "No se pudo anotar el intento.");
        return;
      }
      const datos: any = r.datos;
      toast.success(
        datos?.etapaNueva
          ? "Anotado. El prospecto pasó a Contactado."
          : "Anotado en la bitácora.",
      );
      alRegistrar?.();
      router.refresh();
    });
  }

  const items: {
    kind: string;
    href: string | null;
    icono: React.ReactNode;
    label: string;
    titulo: string;
  }[] = [
    {
      kind: "WHATSAPP",
      href: wa,
      icono: <MessageCircle size={13} />,
      label: "WhatsApp",
      titulo: wa
        ? "Abre WhatsApp con el mensaje ya escrito y lo anota"
        : "Sin un número de 10 dígitos no se puede abrir WhatsApp",
    },
    {
      kind: "LLAMADA",
      href: tel,
      icono: <Phone size={13} />,
      label: "Llamar",
      titulo: tel ? `Marcar a ${crmTelefonoLegible(p.phone)}` : "No hay teléfono",
    },
    {
      kind: "EMAIL",
      href: correo,
      icono: <Mail size={13} />,
      label: "Correo",
      titulo: correo ? `Escribir a ${p.email}` : "No hay correo",
    },
  ];

  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {items.map((it) =>
        it.href ? (
          <a
            key={it.kind}
            href={it.href}
            target={it.kind === "WHATSAPP" ? "_blank" : undefined}
            rel="noopener noreferrer"
            title={it.titulo}
            style={ESTILO_BOTON}
            onClick={(e) => {
              e.stopPropagation();
              registrar(it.kind);
            }}
          >
            {it.icono}
            {!soloIconos && it.label}
          </a>
        ) : (
          <span key={it.kind} title={it.titulo} style={ESTILO_APAGADO} aria-disabled="true">
            {it.icono}
            {!soloIconos && it.label}
          </span>
        ),
      )}
      {p.website && (
        <a
          href={/^https?:\/\//i.test(p.website) ? p.website : `https://${p.website}`}
          target="_blank"
          rel="noopener noreferrer"
          title="Abrir su sitio"
          style={ESTILO_BOTON}
          onClick={(e) => e.stopPropagation()}
        >
          <Globe size={13} />
          {!soloIconos && "Sitio"}
        </a>
      )}
    </div>
  );
}

// ── Tarjeta del prospecto (la del tablero) ──────────────────────────────

export function CrmTarjeta({
  p,
  ahora,
  arrastrable,
  alArrastrar,
}: {
  p: CrmProspectoDTO;
  ahora: Date;
  arrastrable?: boolean;
  alArrastrar?: (id: string) => void;
}) {
  const [levantada, setLevantada] = useState(false);
  const v = crmVertical(p.vertical);

  return (
    <div
      draggable={arrastrable}
      onDragStart={(e) => {
        setLevantada(true);
        alArrastrar?.(p.id);
        e.dataTransfer.effectAllowed = "move";
        // Algunos navegadores ignoran el arrastre si no viaja nada.
        e.dataTransfer.setData("text/plain", p.id);
      }}
      onDragEnd={() => setLevantada(false)}
      style={{
        background: "var(--bg-elev)",
        border: "1px solid var(--border-soft)",
        borderRadius: 10,
        padding: 10,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        opacity: levantada ? 0.45 : 1,
        cursor: arrastrable ? "grab" : "default",
      }}
    >
      {/* draggable={false}: un <a> se arrastra solo, y arrastrando desde el
          nombre el navegador movía la URL en vez de la tarjeta. */}
      <Link
        href={`/admin/crm/${p.id}`}
        draggable={false}
        style={{ display: "flex", gap: 8, textDecoration: "none", minWidth: 0 }}
      >
        <CrmAvatar name={p.name} vertical={p.vertical} size={30} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              color: "var(--text-1)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {p.name}
          </div>
          <div
            style={{
              fontSize: 11,
              color: "var(--text-3)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {[p.city, p.contactName].filter(Boolean).join(" · ") || v.label}
          </div>
          {p.affiliateId && (
            <div style={{ marginTop: 3 }}>
              <CrmOrigenChip p={p} />
            </div>
          )}
        </div>
      </Link>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <CrmSemaforoChip fecha={p.nextActionAt} ahora={ahora} />
        {p.monthlyValue ? (
          <span className="mono" style={{ fontSize: 11, color: "var(--text-2)", fontWeight: 600 }}>
            {crmFmtMxn(p.monthlyValue)}
          </span>
        ) : null}
      </div>

      {p.nextActionNote && (
        <div
          style={{
            fontSize: 11.5,
            color: "var(--text-2)",
            background: "var(--bg-elev-2)",
            border: "1px solid var(--border-soft)",
            borderRadius: 7,
            padding: "5px 7px",
            lineHeight: 1.35,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {p.nextActionNote}
        </div>
      )}

      <CrmAccionesContacto p={p} soloIconos />
    </div>
  );
}

// ── Selector de etapa ───────────────────────────────────────────────────

/**
 * El camino de teclado para mover de etapa: lo mismo que hace arrastrar la
 * tarjeta, pero accesible. Llama al `mover` del padre para que el pintado
 * optimista, la reversión y la pregunta del motivo de pérdida vivan en un
 * solo lugar.
 */
export function CrmEtapaSelect({
  stage,
  mover,
  ancho,
}: {
  stage: string;
  mover: (etapa: string) => void;
  ancho?: number | string;
}) {
  return (
    <select
      className="input-new"
      aria-label="Etapa del prospecto"
      value={crmEtapa(stage).id}
      onChange={(e) => mover(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      style={{ width: ancho ?? 150, height: 30, fontSize: 11.5 }}
    >
      {CRM_ETAPAS.map((e) => (
        <option key={e.id} value={e.id}>
          {e.label}
        </option>
      ))}
      {/* Una etapa fuera del catálogo se ofrece igual para no "cambiarla"
          sola al abrir el selector. */}
      {CRM_ETAPAS.every((e) => e.id !== crmEtapa(stage).id) && (
        <option value={crmEtapa(stage).id}>{crmEtapa(stage).label}</option>
      )}
    </select>
  );
}

// ── Motivo de pérdida ───────────────────────────────────────────────────

export const CRM_MOTIVOS_PERDIDA = [
  "Le pareció caro",
  "Ya usa otro sistema",
  "Nunca contestó",
  "No es el momento",
  "No es el cliente que buscamos",
];

/**
 * Se pregunta AL CERRAR, no después. Es el único momento en que alguien se
 * acuerda de por qué se perdió; un embudo sin motivos de pérdida no enseña
 * nada el día que hay que decidir qué cambiar del discurso.
 */
export function CrmMotivoPerdida({
  nombre,
  alCerrar,
  alConfirmar,
}: {
  nombre: string;
  alCerrar: () => void;
  alConfirmar: (motivo: string | null) => void;
}) {
  const [motivo, setMotivo] = useState("");

  return (
    <div className="modal-overlay" onClick={alCerrar}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="crm-perdida-titulo"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__header">
          <div className="modal__title" id="crm-perdida-titulo">
            ¿Por qué se perdió {nombre}?
          </div>
          <ButtonNew
            size="sm"
            variant="ghost"
            icon={<X size={14} />}
            onClick={alCerrar}
            aria-label="Cerrar"
          />
        </div>
        <div className="modal__body">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
            {CRM_MOTIVOS_PERDIDA.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMotivo(m)}
                style={{
                  height: 28,
                  padding: "0 10px",
                  borderRadius: 99,
                  fontSize: 11.5,
                  cursor: "pointer",
                  border: `1px solid ${motivo === m ? "var(--brand)" : "var(--border-soft)"}`,
                  background: motivo === m ? "var(--brand-soft)" : "var(--bg-elev-2)",
                  color: motivo === m ? "var(--text-1)" : "var(--text-2)",
                }}
              >
                {m}
              </button>
            ))}
          </div>
          <div className="field-new">
            <label className="field-new__label" htmlFor="crm-motivo">
              Motivo
            </label>
            <input
              id="crm-motivo"
              className="input-new"
              autoFocus
              placeholder="Se puede dejar vacío"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
          </div>
          <p style={{ fontSize: 11.5, color: "var(--text-3)", margin: "10px 0 0" }}>
            Al cerrarlo se le quita el próximo paso para que deje de salir en &laquo;hoy
            toca&raquo;. Si vuelve a moverse, se reabre cambiándole la etapa.
          </p>
        </div>
        <div className="modal__footer">
          <ButtonNew variant="ghost" onClick={alCerrar}>
            Cancelar
          </ButtonNew>
          <ButtonNew variant="danger" onClick={() => alConfirmar(motivo.trim() || null)}>
            Marcar como perdido
          </ButtonNew>
        </div>
      </div>
    </div>
  );
}
