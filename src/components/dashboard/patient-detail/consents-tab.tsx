"use client";
// Tab "Consentimientos" del expediente.
//
// Vive en su propio archivo y no dentro de patient-detail-client.tsx (3.400
// líneas) a propósito: el monolito ya cuesta de leer y este módulo tiene tres
// modales propios.
//
// Lo que la pantalla tiene que dejar claro de un vistazo es la COMPLETITUD del
// documento, no solo si está firmado: una carta con la firma del paciente pero
// sin la del profesional está incompleta según la NOM-004 numeral 10.1.1, y
// hasta ahora no había forma de notarlo.
//
// EN VIVO: la firma del paciente sucede fuera de esta pantalla, así que la
// lista se recarga sola al recuperar el foco y, mientras quede alguna carta
// pendiente, cada 30 s con la pestaña visible. Sin eso había que apretar F5
// para enterarse de que ya se podía firmar como doctor.
//
// JERARQUÍA (ola de pulido tras el QA visual): el acto que de verdad importa es
// FIRMAR, y estaba escondido entre seis botones del mismo tamaño con la URL
// cruda de protagonista. Ahora cada fila lleva al frente las dos acciones que se
// usan en el sillón —firmar en la tableta y mandar la liga por WhatsApp— y el
// resto (copiar, regenerar, eliminar) se va a un menú.
//
// LA CARTA SE ABRE (ws1-t3): cada fila lleva a la carta vista como documento
// —`ConsentVisor`—, con la misma hoja y la misma barra de PDF, imprimir,
// WhatsApp y correo que la nota de evolución. Vale para cualquier fila, también
// las firmadas con el sistema viejo. La lista y sus modales siguen como estaban.
//
// EN BLANCO (ws1-t1): «Nuevo consentimiento» abre la HOJA EN BLANCO en esta
// misma pestaña —`ConsentEditor`—, como la nota de evolución: la cabecera que
// calcula el servidor y el texto vacío. La plantilla es un botón dentro del
// editor y ya no es obligatoria: una clínica sin plantillas escribe su carta
// igual. El modal se queda solo para lo de DESPUÉS de crear (firmar ahora,
// WhatsApp, copiar, imprimir), que no cambia.
//
// Estilos: los del design system de facturación (card / badge-new / btn-new /
// field-new / input-new de globals.css), para que el módulo se vea hermano de
// los modales de cobro y no de una pantalla aparte.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, Check, Clock, Copy, FileSignature, FileText, Loader2, MessageCircle, MoreHorizontal,
  PenLine, Plus, Printer, RefreshCw, Trash2, XCircle, Link2, ShieldCheck,
} from "lucide-react";
import toast from "react-hot-toast";
import { useT } from "@/i18n/i18n-provider";
import { useConfirm, useConfirmWithReason } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CardNew } from "@/components/ui/design-system/card-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { SignaturePad } from "@/components/ui/signature-pad";
import type { ConsentDTO, ConsentStatus } from "@/lib/consent/types";
import { ConsentVisor } from "./consent-documento";
import { ConsentEditor, urlPreviewCarta, type PreviewCarta } from "./consent-editor";
import styles from "./patient-detail.module.css";

interface DoctorOption {
  id: string;
  firstName: string;
  lastName: string;
}

export interface ConsentsTabProps {
  patientId: string;
  /**
   * Fecha de nacimiento del paciente (ISO). Decide si la carta la firma un
   * representante legal: con un menor la casilla se marca sola y no se puede
   * quitar. `null` = sin dato, y entonces no se afirma nada.
   */
  patientDob?: string | null;
  /** Snapshot del server component: la lista se pinta sin esperar al fetch. */
  initialConsents: ConsentDTO[];
  doctors: DoctorOption[];
  /** Usuario de la sesión — default del selector de responsable. */
  currentUserId: string;
  canCreate: boolean;
  canRevoke: boolean;
  /** "whatsapp.send" — sin él no se ofrece el envío (la API lo revalida). */
  canSendWhatsApp: boolean;
  /** Solo el doctor responsable estampa su firma (la API revalida el rol). */
  canCountersign: boolean;
  /**
   * WS1-T5 · rediseño de Pacientes, mismo interruptor que patient-detail-client
   * pasa a todos sus tabs clínicos. Aquí solo corrige el contraste de las
   * pastillas de estado: `.badge-new--*` trae colores de texto fijos para
   * fondo oscuro (ver globals.css) y este panel corre en claro, así que hoy
   * salen casi ilegibles. Con `false` (default) el texto sigue exactamente
   * como está — el bug de contraste no se toca sin la bandera.
   */
  pacientesRediseno?: boolean;
}

type BadgeTone = "success" | "warning" | "danger" | "info" | "brand" | "neutral";

/** Texto theme-aware (`--*-strong`) para pisar el color fijo de `.badge-new--*`. */
const BADGE_TEXT_FIX: Record<BadgeTone, string> = {
  success: "var(--success-strong)",
  warning: "var(--warning-strong)",
  danger: "var(--danger-strong)",
  info: "var(--info-strong)",
  brand: "var(--violet-700)",
  neutral: "var(--text-2)",
};

const STATUS_TONE: Record<ConsentStatus, { labelKey: string; tone: BadgeTone }> = {
  PENDING: { labelKey: "patients.consents.statusPending", tone: "warning" },
  EXPIRED: { labelKey: "patients.consents.statusExpired", tone: "neutral" },
  SIGNED: { labelKey: "patients.consents.statusSigned", tone: "success" },
  REVOKED: { labelKey: "patients.consents.statusRevoked", tone: "danger" },
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
}

export function ConsentsTab(props: ConsentsTabProps) {
  const {
    patientId, patientDob = null, initialConsents, doctors, currentUserId,
    canCreate, canRevoke, canSendWhatsApp, canCountersign,
    pacientesRediseno = false,
  } = props;
  const t = useT();
  const confirm = useConfirm();
  const confirmWithReason = useConfirmWithReason();

  const [list, setList] = useState<ConsentDTO[]>(initialConsents);
  const [busy, setBusy] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // La hoja en blanco abierta (null = la lista), y la carta recién creada que
  // enseña el modal de «firmar ahora».
  const [nueva, setNueva] = useState<PreviewCarta | null>(null);
  const [abriendo, setAbriendo] = useState(false);
  const [creada, setCreada] = useState<{ id: string; signUrl: string } | null>(null);
  const doctorInicial = doctors.some((d) => d.id === currentUserId) ? currentUserId : (doctors[0]?.id ?? "");
  const [countersigning, setCountersigning] = useState<ConsentDTO | null>(null);
  // La carta abierta como documento. Se guarda el id y no la fila: la lista se
  // refresca sola y la hoja tiene que ver la fila NUEVA (con la firma recién hecha).
  const [viewingId, setViewingId] = useState<string | null>(null);
  const viewing = useMemo(() => list.find((c) => c.id === viewingId) ?? null, [list, viewingId]);

  useEffect(() => { setList(initialConsents); }, [initialConsents]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/consent?patientId=${encodeURIComponent(patientId)}`);
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data)) setList(data);
    } catch {
      /* la lista anterior sigue siendo válida: no se vacía por un fallo de red */
    }
  }, [patientId]);

  // ── Refresco en vivo ──────────────────────────────────────────────────────
  //
  // La firma ocurre FUERA de este panel: en otra pestaña (el botón "Firma del
  // paciente" abre la liga) o directamente en el teléfono del paciente. La
  // lista solo se recargaba con acciones propias o con F5, así que la recepción
  // veía "PENDIENTE" para siempre y el botón de firma del doctor —que solo
  // aparece cuando el paciente ya firmó— no salía nunca.
  //
  // Volver el foco a la ventana es la señal más fiable de que algo pudo pasar
  // fuera: cubre el caso de la tableta (firmar en la otra pestaña y volver) sin
  // pedirle nada al usuario.
  useEffect(() => {
    const refetch = () => {
      // `focus` también llega en pestañas de segundo plano de algunos
      // navegadores; sin el guard se pediría la lista sin nadie mirándola.
      if (document.visibilityState !== "visible") return;
      void load();
    };
    window.addEventListener("focus", refetch);
    document.addEventListener("visibilitychange", refetch);
    return () => {
      window.removeEventListener("focus", refetch);
      document.removeEventListener("visibilitychange", refetch);
    };
  }, [load]);

  // Cuando el paciente firma desde su casa no hay ningún foco que recuperar: el
  // panel está abierto en el mostrador y nadie lo toca. Ahí hace falta
  // preguntar, pero SOLO mientras haya algo que esperar (una carta pendiente de
  // firma) y con la pestaña delante — un consultorio deja el expediente abierto
  // horas y esto no puede convertirse en tráfico de fondo perpetuo.
  const hasPending = useMemo(() => list.some((c) => c.status === "PENDING"), [list]);

  useEffect(() => {
    if (!hasPending) return;
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void load();
    }, 30_000);
    return () => clearInterval(timer);
  }, [hasPending, load]);

  // La hoja en blanco: solo la cabecera de hoy. No pasa por ninguna plantilla.
  async function abrirNueva() {
    setAbriendo(true);
    try {
      const res = await fetch(urlPreviewCarta({ patientId, doctorId: doctorInicial }));
      const out = await res.json().catch(() => null);
      if (!res.ok || !out) throw new Error((out && out.error) || t("patients.consents.genericError"));
      setViewingId(null);
      setNueva(out as PreviewCarta);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAbriendo(false);
    }
  }

  function publicUrl(token: string): string {
    return `${window.location.origin}/consentimiento/${token}`;
  }

  async function copyLink(c: ConsentDTO) {
    try {
      await navigator.clipboard.writeText(publicUrl(c.token));
      setCopiedId(c.id);
      setTimeout(() => setCopiedId((v) => (v === c.id ? null : v)), 2000);
    } catch {
      toast.error(t("patients.consents.copyFailed"));
    }
  }

  async function post(c: ConsentDTO, path: string, key: string, body?: unknown) {
    setBusy(`${c.id}:${key}`);
    try {
      const res = await fetch(`/api/consent/${c.id}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error ?? t("patients.consents.genericError"));
      await load();
      return out;
    } catch (e) {
      toast.error((e as Error).message);
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function sendWhatsApp(c: ConsentDTO) {
    const out = await post(c, "/send-whatsapp", "wa");
    if (out) toast.success(t("patients.consents.sentWhatsApp"));
  }

  async function renew(c: ConsentDTO) {
    const out = await post(c, "/renew", "renew");
    if (out) toast.success(t("patients.consents.linkRenewed"));
  }

  async function revoke(c: ConsentDTO) {
    const result = await confirmWithReason({
      title: t("patients.consents.revokeTitle"),
      description: t("patients.consents.revokeBody", { procedure: c.procedure }),
      variant: "warning",
      withReason: true,
      reasonLabel: t("patients.consents.revokeReasonLabel"),
      reasonPlaceholder: t("patients.consents.revokeReasonPlaceholder"),
      confirmText: t("patients.consents.revokeConfirm"),
    });
    if (!result.confirmed) return;
    const reason = (result.reason ?? "").trim();
    if (!reason) {
      // El motivo queda en el expediente: sin él la revocación no dice nada.
      toast.error(t("patients.consents.revokeReasonRequired"));
      return;
    }
    const out = await post(c, "/revoke", "revoke", { reason });
    if (out) toast.success(t("patients.consents.revoked"));
  }

  async function remove(c: ConsentDTO) {
    const ok = await confirm({
      title: t("patients.consents.deleteTitle"),
      description: t("patients.consents.deleteBody", { procedure: c.procedure }),
      variant: "danger",
      confirmText: t("patients.consents.deleteConfirm"),
    });
    if (!ok) return;
    setBusy(`${c.id}:delete`);
    try {
      const res = await fetch(`/api/consent/${c.id}`, { method: "DELETE" });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error ?? t("patients.consents.genericError"));
      toast.success(t("patients.consents.deleted"));
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const countersignModal = countersigning && (
    <CountersignModal
      consent={countersigning}
      onClose={() => setCountersigning(null)}
      onDone={async () => { setCountersigning(null); await load(); }}
    />
  );

  const createdModal = canCreate && (
    <CreatedDialog
      created={creada}
      canSendWhatsApp={canSendWhatsApp}
      onClose={() => setCreada(null)}
      onChanged={load}
    />
  );

  if (nueva && canCreate) {
    return (
      <ConsentEditor
        hoja={nueva}
        patientId={patientId}
        patientDob={patientDob}
        doctors={doctors}
        doctorInicial={doctorInicial}
        onVolver={() => setNueva(null)}
        onCreado={async (c) => {
          setNueva(null);
          setCreada(c);
          await load();
        }}
      />
    );
  }

  if (viewing) {
    return (
      <div>
        <ConsentVisor
          consent={viewing}
          patientId={patientId}
          // Mismos permisos que ya pedían las rutas: el canal y el módulo.
          puedeWhatsApp={canSendWhatsApp && canCreate}
          puedeCorreo={canCreate}
          canCountersign={canCountersign && canCreate}
          onCountersign={() => setCountersigning(viewing)}
          inicio={
            <ButtonNew variant="ghost" size="sm" onClick={() => setViewingId(null)}>
              <ArrowLeft size={14} aria-hidden /> {t("consentDoc.back")}
            </ButtonNew>
          }
        />
        {countersignModal}
      </div>
    );
  }

  return (
    <div>
      <CardNew
        noPad
        title={t("patients.consents.title")}
        sub={t("patients.consents.subtitle")}
        action={
          canCreate ? (
            <ButtonNew
              variant="primary"
              className={styles.botonQueCabe}
              disabled={abriendo}
              icon={abriendo ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Plus size={14} />}
              onClick={() => void abrirNueva()}
            >
              {t("patients.consents.new")}
            </ButtonNew>
          ) : undefined
        }
      >
        {list.length === 0 ? (
          <ConsentsEmptyState canCreate={canCreate} busy={abriendo} onNew={() => void abrirNueva()} />
        ) : (
          <div>
            {list.map((c) => (
              <ConsentRow
                key={c.id}
                consent={c}
                busy={busy}
                copied={copiedId === c.id}
                pacientesRediseno={pacientesRediseno}
                canCreate={canCreate}
                canRevoke={canRevoke}
                canSendWhatsApp={canSendWhatsApp}
                canCountersign={canCountersign}
                onCopyLink={() => copyLink(c)}
                onSendWhatsApp={() => sendWhatsApp(c)}
                onRenew={() => renew(c)}
                onRevoke={() => revoke(c)}
                onDelete={() => remove(c)}
                onCountersign={() => setCountersigning(c)}
                onOpen={() => setViewingId(c.id)}
              />
            ))}
          </div>
        )}
      </CardNew>

      {createdModal}

      {countersignModal}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Estado vacío — explica el flujo completo en tres pasos
// ---------------------------------------------------------------------------

/**
 * Quien abre este tab por primera vez no sabe que el paciente firma desde su
 * teléfono ni que el profesional tiene que contrafirmar. Decirlo aquí ahorra la
 * pregunta y evita la carta a medias (firmada por el paciente y nunca
 * contrafirmada), que es incompleta según la NOM-004.
 */
function ConsentsEmptyState({
  canCreate, busy, onNew,
}: { canCreate: boolean; busy: boolean; onNew: () => void }) {
  const t = useT();
  const steps = [
    { icon: FileSignature, title: t("patients.consents.step1Title"), body: t("patients.consents.step1Body") },
    { icon: PenLine, title: t("patients.consents.step2Title"), body: t("patients.consents.step2Body") },
    { icon: ShieldCheck, title: t("patients.consents.step3Title"), body: t("patients.consents.step3Body") },
  ];
  return (
    <div style={{ padding: "28px 24px 30px" }}>
      <div style={{ textAlign: "center", marginBottom: 22 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-1)" }}>
          {t("patients.consents.empty")}
        </div>
        <div style={{ fontSize: 12.5, color: "var(--text-3)", marginTop: 4 }}>
          {t("patients.consents.emptyHint")}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
          gap: 12,
          maxWidth: 760,
          margin: "0 auto",
        }}
      >
        {steps.map((s, i) => {
          const Icon = s.icon;
          return (
            <div
              key={s.title}
              style={{
                border: "1px solid var(--border-soft)",
                background: "var(--bg-elev)",
                borderRadius: 12,
                padding: "14px 14px 16px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span
                  style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    width: 22, height: 22, borderRadius: 999,
                    background: "var(--brand-soft)", color: "var(--brand)",
                    fontSize: 11, fontWeight: 700,
                  }}
                >
                  {i + 1}
                </span>
                <Icon size={14} style={{ color: "var(--brand)" }} aria-hidden />
                <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-1)" }}>
                  {s.title}
                </span>
              </div>
              <p style={{ fontSize: 12, lineHeight: 1.6, color: "var(--text-3)", margin: 0 }}>
                {s.body}
              </p>
            </div>
          );
        })}
      </div>

      {canCreate && (
        <div style={{ textAlign: "center", marginTop: 20 }}>
          <ButtonNew
            variant="primary"
            disabled={busy}
            icon={busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Plus size={14} />}
            onClick={onNew}
          >
            {t("patients.consents.new")}
          </ButtonNew>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fila de la lista
// ---------------------------------------------------------------------------

function ConsentRow({
  consent: c, busy, copied, pacientesRediseno,
  canCreate, canRevoke, canSendWhatsApp, canCountersign,
  onCopyLink, onSendWhatsApp, onRenew, onRevoke, onDelete, onCountersign, onOpen,
}: {
  consent: ConsentDTO;
  busy: string | null;
  copied: boolean;
  pacientesRediseno: boolean;
  canCreate: boolean;
  canRevoke: boolean;
  canSendWhatsApp: boolean;
  canCountersign: boolean;
  onCopyLink: () => void;
  onSendWhatsApp: () => void;
  onRenew: () => void;
  onRevoke: () => void;
  onDelete: () => void;
  onCountersign: () => void;
  onOpen: () => void;
}) {
  const t = useT();
  const style = STATUS_TONE[c.status] ?? STATUS_TONE.PENDING;
  const isBusy = busy?.startsWith(`${c.id}:`) ?? false;
  const unsigned = c.status === "PENDING" || c.status === "EXPIRED";
  const canSend = canSendWhatsApp && canCreate && !c.revokedAt;
  const canRenew = c.status === "EXPIRED" && canCreate;
  const canCounter = canCountersign && canCreate && Boolean(c.signedAt) && !c.doctorSignedAt && !c.revokedAt;

  // Sin esta cuenta, una carta REVOCADA abría un menú vacío: ahí no queda nada
  // que copiar, regenerar, revocar ni eliminar, y el PDF ya es botón visible.
  const menuItems =
    Number(!c.signedAt) +
    Number(!c.revokedAt) +
    Number(canCreate && c.status === "PENDING") +
    Number(canRevoke && c.status === "SIGNED") +
    Number(canRevoke && unsigned);

  return (
    <div
      style={{
        borderTop: "1px solid var(--border-soft)",
        padding: "14px 18px",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <div style={{ minWidth: 220, flex: "1 1 320px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          {/* El nombre ES la puerta a la carta: se abre como documento. */}
          <button
            type="button"
            onClick={onOpen}
            style={{
              fontSize: 14, fontWeight: 700, color: "var(--text-1)", textAlign: "left",
              background: "none", border: 0, padding: 0, cursor: "pointer",
            }}
          >
            {c.procedure}
          </button>
          <BadgeNew tone={style.tone} dot style={pacientesRediseno ? { color: BADGE_TEXT_FIX[style.tone] } : undefined}>
            {t(style.labelKey)}
          </BadgeNew>
          {c.signerName ? (
            <BadgeNew tone="neutral" style={pacientesRediseno ? { color: BADGE_TEXT_FIX.neutral } : undefined}>
              {t("patients.consents.byRepresentative")}
            </BadgeNew>
          ) : null}
        </div>

        <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 5 }}>
          {t("patients.consents.createdOn", { date: fmtDate(c.createdAt) })}
          {c.signedAt
            ? ` · ${t("patients.consents.signedOn", { date: fmtDate(c.signedAt) })}`
            : ` · ${t("patients.consents.expiresOn", { date: fmtDate(c.expiresAt) })}`}
          {c.viewedAt && !c.signedAt
            ? ` · ${t("patients.consents.viewedOn", { date: fmtDate(c.viewedAt) })}`
            : ""}
        </div>

        {/* Completitud de firmas — lo que dice si el documento está entero.
            Una marca por firma, no una frase con rayas que había que descifrar. */}
        <div
          style={{
            display: "flex", flexWrap: "wrap", gap: "4px 14px", marginTop: 6,
            fontSize: 12, fontWeight: 600,
          }}
        >
          {([
            [c.signerName ? t("consentDoc.strip.representative") : t("consentDoc.strip.patient"), Boolean(c.signedAt)],
            [t("consentDoc.strip.doctor"), Boolean(c.doctorSignedAt)],
          ] as Array<[string, boolean]>).map(([rotulo, hecha]) => (
            <span
              key={rotulo}
              style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                color: hecha ? "var(--success-strong)" : "var(--text-3)",
              }}
            >
              {hecha ? <Check size={13} aria-hidden /> : <Clock size={13} aria-hidden />}
              {rotulo}: {hecha ? t("consentDoc.strip.signed") : t("consentDoc.strip.pending")}
            </span>
          ))}
          {c.witnessCount > 0 ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--success-strong)" }}>
              <Check size={13} aria-hidden /> {t("consentDoc.strip.witnesses", { count: c.witnessCount })}
            </span>
          ) : null}
        </div>

        {c.revokedAt ? (
          <div style={{ fontSize: 11.5, color: "var(--danger)", marginTop: 4 }}>
            {t("patients.consents.revokedOn", { date: fmtDate(c.revokedAt) })}
            {c.revokedReason ? ` · ${c.revokedReason}` : ""}
          </div>
        ) : null}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        {/* Flujo de tableta: la liga se abre en otra pestaña y el paciente firma
            ahí mismo, delante del equipo. En VENCIDO no se ofrece porque el
            enlace ya no admite firma: primero se regenera. */}
        {c.status === "PENDING" && (
          <a
            href={`/consentimiento/${c.token}`}
            target="_blank"
            rel="noreferrer"
            className="btn-new btn-new--primary btn-new--sm"
          >
            <PenLine size={13} aria-hidden /> {t("patients.consents.actionSign")}
          </a>
        )}

        {canRenew && (
          <ButtonNew
            variant="primary"
            size="sm"
            disabled={isBusy}
            icon={busy === `${c.id}:renew`
              ? <Loader2 size={13} className="animate-spin" aria-hidden />
              : <RefreshCw size={13} aria-hidden />}
            onClick={onRenew}
          >
            {t("patients.consents.actionRenew")}
          </ButtonNew>
        )}

        {canCounter && (
          <ButtonNew
            variant="primary"
            size="sm"
            icon={<PenLine size={13} aria-hidden />}
            onClick={onCountersign}
          >
            {t("patients.consents.actionCountersign")}
          </ButtonNew>
        )}

        {canSend && (
          <ButtonNew
            variant="secondary"
            size="sm"
            disabled={isBusy}
            icon={busy === `${c.id}:wa`
              ? <Loader2 size={13} className="animate-spin" aria-hidden />
              : <MessageCircle size={13} aria-hidden />}
            onClick={onSendWhatsApp}
          >
            {t("patients.consents.actionWhatsApp")}
          </ButtonNew>
        )}

        {/* La carta como documento: ahí están el PDF, imprimir, WhatsApp y
            correo, con la misma barra que la nota de evolución. */}
        <ButtonNew variant="secondary" size="sm" icon={<FileText size={13} aria-hidden />} onClick={onOpen}>
          {t("consentDoc.open")}
        </ButtonNew>

        {menuItems > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="btn-new btn-new--ghost btn-new--sm"
              aria-label={t("patients.consents.moreActions")}
            >
              <MoreHorizontal size={15} aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className={styles.rowMenu}>
            {!c.signedAt && (
              <DropdownMenuItem className={styles.rowMenuItem} asChild>
                {/* Sin firmar, el PDF ES la hoja para firmar a mano: trae las
                    líneas de paciente, doctor y testigos en blanco. Se llama
                    por lo que sirve, no "Ver PDF". */}
                <a href={`/api/consent/${c.id}/pdf`} target="_blank" rel="noreferrer">
                  <Printer size={14} aria-hidden />
                  <span className={styles.rowMenuLabel}>{t("patients.consents.actionPrint")}</span>
                </a>
              </DropdownMenuItem>
            )}

            {!c.revokedAt && (
              <DropdownMenuItem className={styles.rowMenuItem} onSelect={onCopyLink}>
                {copied ? <Check size={14} aria-hidden /> : <Link2 size={14} aria-hidden />}
                <span className={styles.rowMenuLabel}>
                  {copied ? t("patients.consents.copied") : t("patients.consents.actionCopyLink")}
                </span>
              </DropdownMenuItem>
            )}

            {/* Regenerar también en PENDIENTE: la liga se comparte por error más
                veces de las que se admite, y ahí lo que hace falta es matar la
                anterior. En VENCIDO no se repite — ya está como botón visible. */}
            {canCreate && c.status === "PENDING" && (
              <DropdownMenuItem className={styles.rowMenuItem} disabled={isBusy} onSelect={onRenew}>
                <RefreshCw size={14} aria-hidden />
                <span className={styles.rowMenuLabel}>{t("patients.consents.actionRenew")}</span>
              </DropdownMenuItem>
            )}

            {canRevoke && c.status === "SIGNED" && (
              <DropdownMenuItem className={styles.rowMenuItem} disabled={isBusy} onSelect={onRevoke}>
                <XCircle size={14} aria-hidden />
                <span className={styles.rowMenuLabel}>{t("patients.consents.actionRevoke")}</span>
              </DropdownMenuItem>
            )}

            {/* Eliminar SOLO pendientes: uno firmado se conserva siempre (la API
                responde 409 aunque se fuerce la petición). */}
            {canRevoke && unsigned && (
              <DropdownMenuItem
                className={styles.rowMenuItem}
                disabled={isBusy}
                onSelect={onDelete}
                style={{ color: "var(--danger)" }}
              >
                <Trash2 size={14} aria-hidden />
                <span className={styles.rowMenuLabel}>{t("patients.consents.actionDelete")}</span>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal: la carta recién creada
// ---------------------------------------------------------------------------

/**
 * Lo que sigue a «Crear consentimiento» en la hoja: firmar ahora en la tableta,
 * mandar la liga o imprimirla. Era el segundo paso del modal de alta; el alta
 * se escribe ahora en la hoja (`ConsentEditor`) y aquí queda solo este paso.
 */
function CreatedDialog({
  created, canSendWhatsApp, onClose, onChanged,
}: {
  created: { id: string; signUrl: string } | null;
  canSendWhatsApp: boolean;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const t = useT();
  const [saving, setSaving] = useState(false);

  async function sendCreated() {
    if (!created) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/consent/${created.id}/send-whatsapp`, { method: "POST" });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error ?? t("patients.consents.genericError"));
      toast.success(t("patients.consents.sentWhatsApp"));
      await onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={created !== null} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] bg-card text-foreground border border-border">
        <DialogHeader>
          <DialogTitle className="text-foreground font-bold">{t("patients.consents.createdTitle")}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-4">
          {created ? (
            <CreatedPanel
              consentId={created.id}
              signUrl={created.signUrl}
              saving={saving}
              canSendWhatsApp={canSendWhatsApp}
              onSendWhatsApp={sendCreated}
            />
          ) : null}
        </div>
        <DialogFooter>
          <ButtonNew variant="ghost" onClick={onClose}>{t("common.close")}</ButtonNew>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Pantalla posterior a crear la carta.
 *
 * La jerarquía está invertida respecto a la primera versión, y esa es toda la
 * gracia: el caso normal es el paciente sentado en el sillón con la tableta
 * delante, no un correo con una URL. Así que manda "Firmar ahora en este
 * dispositivo"; mandar la liga por WhatsApp y copiarla son las alternativas, y
 * la URL cruda pasa a ser una nota al pie.
 */
function CreatedPanel({
  consentId, signUrl, saving, canSendWhatsApp, onSendWhatsApp,
}: {
  consentId: string;
  signUrl: string;
  saving: boolean;
  canSendWhatsApp: boolean;
  onSendWhatsApp: () => void;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(signUrl).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 2000); },
      () => toast.error(t("patients.consents.copyFailed")),
    );
  }

  return (
    <div className="space-y-4">
      <div
        className="flex items-start gap-3 rounded-xl p-3.5"
        style={{ border: "1px solid var(--success)", background: "var(--success-soft)" }}
      >
        <ShieldCheck size={18} style={{ color: "var(--success)", flexShrink: 0, marginTop: 1 }} aria-hidden />
        <p className="text-xs leading-relaxed" style={{ color: "var(--text-2)", margin: 0 }}>
          {t("patients.consents.createdHint")}
        </p>
      </div>

      <a
        href={signUrl}
        target="_blank"
        rel="noreferrer"
        className={`btn-new btn-new--primary ${styles.botonQueCabe}`}
        style={{ width: "100%", minHeight: 52, justifyContent: "center", textAlign: "center", fontSize: 14 }}
      >
        <PenLine size={17} aria-hidden /> {t("patients.consents.actionSignNow")}
      </a>
      <p className="text-[11px] text-center" style={{ color: "var(--text-4)", marginTop: 6 }}>
        {t("patients.consents.signNowHint")}
      </p>

      <div className="flex flex-wrap gap-2">
        {canSendWhatsApp && (
          <ButtonNew
            variant="secondary"
            disabled={saving}
            onClick={onSendWhatsApp}
            icon={saving
              ? <Loader2 size={13} className="animate-spin" aria-hidden />
              : <MessageCircle size={13} aria-hidden />}
          >
            {t("patients.consents.actionWhatsApp")}
          </ButtonNew>
        )}
        <ButtonNew
          variant="secondary"
          onClick={copy}
          icon={copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
        >
          {copied ? t("patients.consents.copied") : t("patients.consents.actionCopyLink")}
        </ButtonNew>
        {/* La otra vía: papel. El PDF de una carta sin firmar sale con las
            líneas de firma del paciente, el doctor y los testigos en blanco. */}
        <a
          href={`/api/consent/${consentId}/pdf`}
          target="_blank"
          rel="noreferrer"
          className="btn-new btn-new--secondary"
        >
          <Printer size={13} aria-hidden /> {t("patients.consents.actionPrint")}
        </a>
      </div>
      <p className="text-[11px]" style={{ color: "var(--text-4)", marginTop: 6 }}>
        {t("patients.consents.printHint")}
      </p>

      <div>
        <div className="text-[11px] font-semibold" style={{ color: "var(--text-4)" }}>
          {t("patients.consents.linkLabel")}
        </div>
        <div className="text-[11px] break-all" style={{ color: "var(--text-4)" }}>{signUrl}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal: firma del doctor (countersign en la API y en el modelo de datos)
// ---------------------------------------------------------------------------

function CountersignModal({
  consent, onClose, onDone,
}: {
  consent: ConsentDTO;
  onClose: () => void;
  onDone: () => Promise<void> | void;
}) {
  const t = useT();
  const [signature, setSignature] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!signature) { setError(t("patients.consents.countersignEmpty")); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/consent/${consent.id}/countersign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signatureDataUrl: signature }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error ?? t("patients.consents.genericError"));
      toast.success(t("patients.consents.countersigned"));
      await onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg bg-card text-foreground border border-border">
        <DialogHeader>
          <DialogTitle className="text-foreground font-bold">
            {t("patients.consents.countersignTitle")}
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-3">
          <p className="text-xs leading-relaxed" style={{ color: "var(--text-3)" }}>
            {t("patients.consents.countersignBody", { procedure: consent.procedure })}
          </p>
          <SignaturePad
            width={560}
            height={180}
            onChange={setSignature}
            ariaLabel={t("patients.consents.countersignAria")}
          />
          {error ? <p className="text-xs" style={{ color: "var(--danger)" }}>{error}</p> : null}
        </div>
        <DialogFooter>
          <ButtonNew variant="ghost" onClick={onClose}>{t("common.cancel")}</ButtonNew>
          <ButtonNew
            variant="primary"
            disabled={busy || !signature}
            onClick={save}
            icon={busy
              ? <Loader2 size={13} className="animate-spin" aria-hidden />
              : <Check size={13} aria-hidden />}
          >
            {t("patients.consents.countersignCta")}
          </ButtonNew>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
