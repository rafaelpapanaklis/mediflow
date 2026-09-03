"use client";

// ═══════════════════════════════════════════════════════════════════════
// La ficha del prospecto: los datos a la izquierda, la BITÁCORA a la
// derecha.
//
// La bitácora ocupa la mitad grande porque es lo que se consulta de
// verdad: "¿ya le escribí?", "¿qué me dijo la última vez?". Los datos casi
// no cambian; la conversación, todo el tiempo.
//
// Lo que se anota es lo que PASÓ, no lo que el sistema hizo: el botón de
// WhatsApp abre WhatsApp en este equipo y deja escrito "se abrió". Nadie
// puede leer esta pantalla y creer que DaleControl mandó un mensaje solo.
// ═══════════════════════════════════════════════════════════════════════
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CalendarClock,
  Mail,
  MapPin,
  MessageCircle,
  Pencil,
  Phone,
  StickyNote,
  Trash2,
  Users,
  Video,
} from "lucide-react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  crmActividad,
  crmDiaRelativo,
  crmDiasSinContacto,
  crmEtapa,
  crmEtapaSiguiente,
  crmFuenteLabel,
  crmResultadoLabel,
  crmResultadoTono,
  crmTelefonoLegible,
  crmValorDeInput,
  crmVertical,
  CRM_ACTIVIDADES_MANUALES,
  CRM_RESULTADOS,
} from "@/lib/admin/crm/crm-core";
import type { CrmActividadDTO, CrmFicha } from "@/lib/admin/crm/service";
import type { CrmTextoDTO } from "@/lib/admin/crm/textos-core";
import {
  eliminarProspectoAccion,
  moverEtapaAccion,
  programarSeguimientoAccion,
  registrarActividadAccion,
} from "../actions";
import { CrmFormulario, type CrmClinicaLite } from "../crm-form";
import { CrmTextosElegir } from "../crm-textos-panel";
import {
  CrmAccionesContacto,
  CrmAvatar,
  CrmEtapaSelect,
  CrmMotivoPerdida,
  CrmOrigenChip,
  CrmSemaforoChip,
  CrmVerticalChip,
  crmFmtFecha,
  crmFmtFechaHora,
  crmFmtMxn,
} from "../crm-ui";

const ICONO_ACTIVIDAD: Record<string, React.ReactNode> = {
  WHATSAPP: <MessageCircle size={13} />,
  LLAMADA: <Phone size={13} />,
  EMAIL: <Mail size={13} />,
  REUNION: <Video size={13} />,
  VISITA: <MapPin size={13} />,
  NOTA: <StickyNote size={13} />,
  ETAPA: <ArrowRight size={13} />,
};

export function CrmProspectoClient({
  ficha,
  clinicas,
  textos,
}: {
  ficha: CrmFicha;
  /** Las cuentas de /admin/clinics, para vincular un prospecto ganado. */
  clinicas: CrmClinicaLite[];
  /** "Mis textos". Vacío si no hay ninguno o si falta aplicar su SQL. */
  textos: CrmTextoDTO[];
}) {
  const router = useRouter();
  const askConfirm = useConfirm();
  const [, startTransition] = useTransition();
  const p = ficha.prospecto;

  const [editando, setEditando] = useState(false);
  const [perdiendo, setPerdiendo] = useState(false);

  const ahora = useMemo(() => new Date(), [p.updatedAt]);
  const etapa = crmEtapa(p.stage);
  const v = crmVertical(p.vertical);
  const siguiente = crmEtapaSiguiente(p.stage);
  const dias = crmDiasSinContacto(p.lastContactAt, ahora);

  function mover(nueva: string, motivoPerdida?: string | null) {
    if (nueva === "PERDIDO" && motivoPerdida === undefined) {
      setPerdiendo(true);
      return;
    }
    startTransition(async () => {
      const r = await moverEtapaAccion(p.id, nueva, { motivoPerdida: motivoPerdida ?? null });
      if (!r.ok) {
        toast.error(r.error ?? "No se pudo mover.");
        return;
      }
      toast.success(`Movido a ${crmEtapa(nueva).label}.`);
      router.refresh();
    });
  }

  async function eliminar() {
    const ok = await askConfirm({
      title: `¿Eliminar a ${p.name}?`,
      description:
        "Se borra el prospecto y toda su bitácora — cada WhatsApp, llamada y nota que tenga anotados. No se puede deshacer. Si sólo se enfrió, muévelo a Perdido: así queda el registro y el motivo.",
      variant: "danger",
      confirmText: "Eliminar de la lista",
    });
    if (!ok) return;
    startTransition(async () => {
      const r = await eliminarProspectoAccion(p.id);
      if (!r.ok) {
        toast.error(r.error ?? "No se pudo eliminar.");
        return;
      }
      toast.success(r.mensaje ?? "Eliminado.");
      router.push("/admin/crm");
    });
  }

  return (
    <div>
      <Link
        href="/admin/crm"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 12,
          color: "var(--text-3)",
          textDecoration: "none",
          marginBottom: 14,
        }}
      >
        <ArrowLeft size={13} />
        CRM de ventas
      </Link>

      {/* ── Encabezado ─────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          gap: 14,
          alignItems: "flex-start",
          flexWrap: "wrap",
          marginBottom: 16,
        }}
      >
        <CrmAvatar name={p.name} vertical={p.vertical} size={46} />
        <div style={{ flex: "1 1 260px", minWidth: 0 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: "var(--text-1)" }}>
            {p.name}
          </h1>
          <div
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
              flexWrap: "wrap",
              marginTop: 5,
            }}
          >
            <CrmVerticalChip vertical={p.vertical} />
            {(p.city || p.state || p.country) && (
              <span style={{ fontSize: 11.5, color: "var(--text-4)" }}>
                {[p.city, p.state, p.country].filter(Boolean).join(", ")}
              </span>
            )}
            <CrmOrigenChip p={p} />
            <span style={{ fontSize: 11.5, color: "var(--text-4)" }}>
              {crmFuenteLabel(p.source)}
            </span>
            {p.tags.map((t) => (
              <span
                key={t}
                style={{
                  fontSize: 10.5,
                  padding: "1px 7px",
                  borderRadius: 99,
                  background: "var(--bg-elev-2)",
                  border: "1px solid var(--border-soft)",
                  color: "var(--text-3)",
                }}
              >
                {t}
              </span>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <CrmEtapaSelect stage={p.stage} mover={(e) => mover(e)} ancho={168} />
          {siguiente && (
            <ButtonNew
              variant="secondary"
              size="sm"
              icon={<ArrowRight size={13} />}
              onClick={() => mover(siguiente)}
              title={`Pasar a ${crmEtapa(siguiente).label}`}
            >
              {crmEtapa(siguiente).label}
            </ButtonNew>
          )}
          <ButtonNew variant="ghost" size="sm" icon={<Pencil size={13} />} onClick={() => setEditando(true)}>
            Editar
          </ButtonNew>
          <ButtonNew variant="ghost" size="sm" icon={<Trash2 size={13} />} onClick={eliminar} aria-label="Eliminar" />
        </div>
      </div>

      {/* Estado de cierre, si ya cerró */}
      {etapa.terminal && (
        <div
          style={{
            marginBottom: 16,
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid var(--border-soft)",
            background: p.stage === "GANADO" ? "var(--success-soft)" : "var(--danger-soft)",
            fontSize: 12.5,
            color: "var(--text-2)",
          }}
        >
          {p.stage === "GANADO" ? (
            <>
              Cerrado como cliente el {crmFmtFecha(p.wonAt)}.
              {ficha.clinica ? (
                <>
                  {" "}
                  Su cuenta es{" "}
                  <Link href={`/admin/clinics/${ficha.clinica.id}`} style={{ color: "var(--brand)" }}>
                    {ficha.clinica.name}
                  </Link>
                  .
                </>
              ) : (
                " Todavía no se le vinculó una clínica de /admin/clinics."
              )}
            </>
          ) : (
            <>
              Se dio por perdido el {crmFmtFecha(p.lostAt)}
              {p.lostReason ? `: ${p.lostReason}` : "."} Cambiándole la etapa se reabre.
            </>
          )}
        </div>
      )}

      {/* ── Dos columnas ───────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
        {/* Izquierda: datos */}
        <div style={{ flex: "1 1 320px", minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
          <CardNew title="Contacto">
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <CrmAccionesContacto p={p} />
              <Dato icono={<Users size={13} />} label="Persona">
                {p.contactName ? (
                  <>
                    {p.contactName}
                    {p.contactRole && <span style={{ color: "var(--text-4)" }}> · {p.contactRole}</span>}
                  </>
                ) : (
                  <Vacio>Sin nombre</Vacio>
                )}
              </Dato>
              <Dato icono={<Phone size={13} />} label="Teléfono">
                {p.phone ? <span className="mono">{crmTelefonoLegible(p.phone)}</span> : <Vacio>Sin teléfono</Vacio>}
              </Dato>
              <Dato icono={<Mail size={13} />} label="Correo">
                {p.email ?? <Vacio>Sin correo</Vacio>}
              </Dato>
              <Dato icono={<Building2 size={13} />} label={v.medida}>
                {p.size ? String(p.size) : <Vacio>Sin dato</Vacio>}
              </Dato>
              <Dato icono={<CalendarClock size={13} />} label="Último contacto">
                {dias === null ? (
                  <Vacio>Nunca se le ha contactado</Vacio>
                ) : (
                  <>
                    {crmFmtFecha(p.lastContactAt)}
                    <span style={{ color: "var(--text-4)" }}>
                      {" "}
                      · {dias === 0 ? "hoy" : `hace ${dias} ${dias === 1 ? "día" : "días"}`}
                    </span>
                  </>
                )}
              </Dato>
              <Dato label="Valor mensual estimado">
                {p.monthlyValue ? (
                  <span className="mono" style={{ fontWeight: 600 }}>
                    {crmFmtMxn(p.monthlyValue)}
                  </span>
                ) : (
                  <Vacio>Sin estimar</Vacio>
                )}
              </Dato>
            </div>
          </CardNew>

          <ProximoPaso p={p} ahora={ahora} />

          {/* ── Mis textos, ya con SUS datos puestos ──────────────────
              Va aquí, junto a los botones de contacto y no en otra
              pantalla, porque es el momento exacto en que sirve: se acaba
              de leer con quién se habla y qué se le dijo la última vez, y
              lo que sigue es escribirle. */}
          <CardNew
            title="Mis textos"
            sub={
              textos.length > 0
                ? "Ya con el nombre y la ciudad de este prospecto puestos."
                : undefined
            }
          >
            <CrmTextosElegir textos={textos} prospecto={p} compacto />
          </CardNew>

          {p.notes && (
            <CardNew
              title="Notas"
              sub={
                p.affiliateId
                  ? "Las ve también el socio que lo recomendó. Lo interno del equipo va en la bitácora."
                  : undefined
              }
            >
              <p
                style={{
                  fontSize: 12.5,
                  color: "var(--text-2)",
                  lineHeight: 1.6,
                  margin: 0,
                  whiteSpace: "pre-wrap",
                }}
              >
                {p.notes}
              </p>
            </CardNew>
          )}

          <p style={{ fontSize: 11, color: "var(--text-4)", margin: 0, lineHeight: 1.5 }}>
            Dado de alta el {crmFmtFecha(p.createdAt)}
            {p.affiliateId
              ? ` por ${p.affiliateName ?? "un socio que ya no está dado de alta"}, desde el panel de afiliados`
              : p.createdByEmail
                ? ` por ${p.createdByEmail}`
                : ""}
            .
          </p>
        </div>

        {/* Derecha: bitácora */}
        <div style={{ flex: "2 1 420px", minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
          <Compositor prospectId={p.id} />
          <CardNew noPad title={`Bitácora (${ficha.actividades.length})`}>
            {ficha.actividades.length === 0 ? (
              <div
                style={{
                  padding: "34px 18px",
                  textAlign: "center",
                  color: "var(--text-3)",
                  fontSize: 12.5,
                }}
              >
                Todavía no hay nada anotado. En cuanto le escribas o le marques desde aquí, queda
                registrado solo.
              </div>
            ) : (
              <div>
                {ficha.actividades.map((a) => (
                  <Anotacion key={a.id} a={a} />
                ))}
              </div>
            )}
          </CardNew>
        </div>
      </div>

      {editando && (
        <CrmFormulario
          prospecto={p}
          clinicas={clinicas}
          alCerrar={() => setEditando(false)}
          alGuardar={() => router.refresh()}
        />
      )}
      {perdiendo && (
        <CrmMotivoPerdida
          nombre={p.name}
          alCerrar={() => setPerdiendo(false)}
          alConfirmar={(motivo) => {
            setPerdiendo(false);
            mover("PERDIDO", motivo);
          }}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════

function Dato({
  label,
  icono,
  children,
}: {
  label: string;
  icono?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          fontSize: 10.5,
          fontWeight: 600,
          color: "var(--text-4)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          marginBottom: 3,
        }}
      >
        {icono}
        {label}
      </div>
      <div style={{ fontSize: 12.5, color: "var(--text-1)", wordBreak: "break-word" }}>{children}</div>
    </div>
  );
}

function Vacio({ children }: { children: React.ReactNode }) {
  return <span style={{ color: "var(--text-4)" }}>{children}</span>;
}

// ── Próximo paso ────────────────────────────────────────────────────────

function ProximoPaso({ p, ahora }: { p: CrmFicha["prospecto"]; ahora: Date }) {
  const router = useRouter();
  const [fecha, setFecha] = useState(crmValorDeInput(p.nextActionAt));
  const [nota, setNota] = useState(p.nextActionNote ?? "");
  const [pendiente, startTransition] = useTransition();

  function guardar(nuevaFecha: string | null, nuevaNota?: string) {
    startTransition(async () => {
      const r = await programarSeguimientoAccion(p.id, nuevaFecha, nuevaNota ?? nota);
      if (!r.ok) {
        toast.error(r.error ?? "No se pudo guardar.");
        return;
      }
      toast.success(r.mensaje ?? "Guardado.");
      setFecha(nuevaFecha ?? "");
      router.refresh();
    });
  }

  return (
    <CardNew title="Próximo paso" sub="Lo que hace que este prospecto no se te pierda.">
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <CrmSemaforoChip fecha={p.nextActionAt} ahora={ahora} />
        <div className="field-new">
          <label className="field-new__label" htmlFor="crm-ficha-fecha">
            ¿Cuándo?
          </label>
          <input
            id="crm-ficha-fecha"
            className="input-new"
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
          />
        </div>
        <div className="field-new">
          <label className="field-new__label" htmlFor="crm-ficha-nota">
            ¿Qué hay que hacer?
          </label>
          <input
            id="crm-ficha-nota"
            className="input-new"
            placeholder="Quiere junta pero aún no confirma"
            value={nota}
            onChange={(e) => setNota(e.target.value)}
          />
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <ButtonNew variant="primary" size="sm" onClick={() => guardar(fecha || null)} disabled={pendiente}>
            {pendiente ? "Guardando…" : "Guardar"}
          </ButtonNew>
          <ButtonNew variant="ghost" size="sm" onClick={() => guardar(crmDiaRelativo(1, ahora))} disabled={pendiente}>
            Mañana
          </ButtonNew>
          <ButtonNew variant="ghost" size="sm" onClick={() => guardar(crmDiaRelativo(7, ahora))} disabled={pendiente}>
            En una semana
          </ButtonNew>
          {p.nextActionAt && (
            <ButtonNew variant="ghost" size="sm" onClick={() => guardar(null)} disabled={pendiente}>
              Quitar
            </ButtonNew>
          )}
        </div>
      </div>
    </CardNew>
  );
}

// ── Compositor de la bitácora ───────────────────────────────────────────

function Compositor({ prospectId }: { prospectId: string }) {
  const router = useRouter();
  const [kind, setKind] = useState("NOTA");
  const [body, setBody] = useState("");
  const [outcome, setOutcome] = useState("");
  const [fecha, setFecha] = useState("");
  const [pendiente, startTransition] = useTransition();

  const esContacto = crmActividad(kind).cuentaComoContacto;

  function anotar() {
    if (!body.trim() && !esContacto) {
      toast.error("Escribe la nota.");
      return;
    }
    startTransition(async () => {
      const r = await registrarActividadAccion(prospectId, {
        kind,
        body,
        outcome: esContacto ? outcome || null : null,
        fecha: fecha || null,
      });
      if (!r.ok) {
        toast.error(r.error ?? "No se pudo anotar.");
        return;
      }
      const datos: any = r.datos;
      toast.success(
        datos?.etapaNueva ? "Anotado. El prospecto pasó a Contactado." : "Anotado en la bitácora.",
      );
      setBody("");
      setOutcome("");
      setFecha("");
      router.refresh();
    });
  }

  return (
    <CardNew title="Anotar lo que pasó">
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {CRM_ACTIVIDADES_MANUALES.map((a) => {
            const activo = kind === a.id;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => setKind(a.id)}
                aria-pressed={activo}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  height: 30,
                  padding: "0 11px",
                  borderRadius: 99,
                  fontSize: 11.5,
                  cursor: "pointer",
                  border: `1px solid ${activo ? "var(--brand)" : "var(--border-soft)"}`,
                  background: activo ? "var(--brand-soft)" : "var(--bg-elev-2)",
                  color: activo ? "var(--text-1)" : "var(--text-2)",
                }}
              >
                {ICONO_ACTIVIDAD[a.id]}
                {a.label}
              </button>
            );
          })}
        </div>

        <textarea
          className="input-new"
          style={{ height: "auto", minHeight: 68, padding: "8px 12px", lineHeight: 1.45, resize: "vertical" }}
          placeholder={
            esContacto
              ? "¿Qué te dijo? Ej.: contestó la recepcionista, la doctora entra a las 4."
              : "Lo que conviene recordar de este prospecto."
          }
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          {esContacto && (
            <div className="field-new" style={{ flex: "1 1 190px" }}>
              <label className="field-new__label" htmlFor="crm-outcome">
                ¿Cómo salió?
              </label>
              <select
                id="crm-outcome"
                className="input-new"
                value={outcome}
                onChange={(e) => setOutcome(e.target.value)}
              >
                <option value="">Sin especificar</option>
                {CRM_RESULTADOS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="field-new" style={{ flex: "0 1 160px" }}>
            <label className="field-new__label" htmlFor="crm-cuando">
              ¿Cuándo pasó?
            </label>
            <input
              id="crm-cuando"
              className="input-new"
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              title="Vacío = ahora mismo. Sirve para registrar algo de días atrás."
            />
          </div>
          <ButtonNew variant="primary" onClick={anotar} disabled={pendiente} style={{ marginLeft: "auto" }}>
            {pendiente ? "Anotando…" : "Anotar"}
          </ButtonNew>
        </div>
      </div>
    </CardNew>
  );
}

// ── Una entrada de la bitácora ──────────────────────────────────────────

function Anotacion({ a }: { a: CrmActividadDTO }) {
  const meta = crmActividad(a.kind);
  const esEtapa = a.kind === "ETAPA";

  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        padding: "11px 14px",
        borderBottom: "1px solid var(--border-soft)",
      }}
    >
      <div
        style={{
          width: 26,
          height: 26,
          borderRadius: 7,
          flexShrink: 0,
          display: "grid",
          placeItems: "center",
          background: "var(--bg-elev-2)",
          border: "1px solid var(--border-soft)",
          color: "var(--text-3)",
        }}
        aria-hidden
      >
        {ICONO_ACTIVIDAD[a.kind] ?? <StickyNote size={13} />}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)" }}>
            {esEtapa
              ? `${crmEtapa(a.stageFrom).label} → ${crmEtapa(a.stageTo).label}`
              : meta.label}
          </span>
          {a.outcome && (
            <BadgeNew tone={crmResultadoTono(a.outcome)}>{crmResultadoLabel(a.outcome)}</BadgeNew>
          )}
          <span style={{ fontSize: 11, color: "var(--text-4)" }}>{crmFmtFechaHora(a.happenedAt)}</span>
          {a.authorEmail && (
            <span style={{ fontSize: 11, color: "var(--text-4)" }}>· {a.authorEmail}</span>
          )}
        </div>
        {a.body && (
          <p
            style={{
              margin: "4px 0 0",
              fontSize: 12.5,
              color: "var(--text-2)",
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
            }}
          >
            {a.body}
          </p>
        )}
      </div>
    </div>
  );
}
