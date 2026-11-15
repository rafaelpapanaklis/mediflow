"use client";

// ═══════════════════════════════════════════════════════════════════════
// Piezas de la ventana de la cita (appointment-detail.tsx): la columna del
// cliente, la nota, las fotos, «su próxima» y los paneles de cancelar,
// anticipo y producto. Se separan solo por tamaño; la lógica pura está en
// cita-core.ts y el armado (qué se pinta y cuándo) en appointment-detail.
// ═══════════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  CalendarPlus,
  IdCard,
  MessageCircle,
  NotebookPen,
  Package,
  Phone,
  Repeat,
  Scissors,
  Star,
  User,
} from "lucide-react";
import { formatBarberPhone } from "@/lib/barber/phone-format";
import { ChatClienteLink } from "../wa-chat";
import type {
  BarberAppointmentDTO,
  BarberDTO,
  BarberPaymentMethod,
  BarberPhotoKind,
  BarberProductDTO,
} from "@/lib/barber/types";
import {
  appointmentMinutes,
  formatMXN,
  minuteToLabel,
  shopDateISO,
  shopMinuteOfDay,
} from "@/lib/barber/agenda";
import type { BarberClientDetail } from "@/lib/barber/loyalty";
import type { StarsView } from "@/lib/barber/stars-core";
import type { BarberVisitPhotoView } from "@/lib/barber/clients";
import { PhotoUploader, type UploadedPhoto } from "@/components/barber/clients/photo-uploader";
import { initials } from "./agenda-ui";
import {
  CANCEL_REASONS,
  CANCEL_REASON_MAX,
  cancelReasonText,
  findNextVisitSlot,
  nextVisitDateISO,
  nextVisitOptions,
  parseDepositAmount,
  type CitaDTO,
  type DayWindow,
  type NextSlot,
  type NextVisitResult,
} from "./cita-core";
import css from "./cita.module.css";

export type T = (key: string, vars?: Record<string, string | number>) => string;

const DEPOSIT_METHODS: BarberPaymentMethod[] = ["CASH", "CARD", "SPEI"];

// ── Lo del cliente que vive en su ficha ─────────────────────────────────
export interface ClientInfo {
  loading: boolean;
  error: boolean;
  detail: BarberClientDetail | null;
  stars: StarsView | null;
}

export function useClientInfo(clientId: string | null, enabled: boolean): ClientInfo {
  const [info, setInfo] = useState<ClientInfo>({ loading: false, error: false, detail: null, stars: null });
  useEffect(() => {
    if (!clientId || !enabled) {
      setInfo({ loading: false, error: false, detail: null, stars: null });
      return;
    }
    const controller = new AbortController();
    setInfo({ loading: true, error: false, detail: null, stars: null });
    void Promise.all([
      fetch(`/api/barber/clients/${clientId}`, { signal: controller.signal })
        .then((r) => (r.ok ? (r.json() as Promise<BarberClientDetail>) : null))
        .catch(() => null),
      fetch(`/api/barber/clients/${clientId}/stars`, { signal: controller.signal })
        .then((r) => (r.ok ? (r.json() as Promise<{ stars?: StarsView }>) : null))
        .catch(() => null),
    ]).then(([detail, stars]) => {
      if (controller.signal.aborted) return;
      setInfo({ loading: false, error: !detail, detail, stars: stars?.stars ?? null });
    });
    return () => controller.abort();
  }, [clientId, enabled]);
  return info;
}

export async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}
export function errorOf(data: Record<string, unknown>, fallback: string): string {
  return typeof data.error === "string" ? data.error : fallback;
}

// ═══ Columna del cliente ═══════════════════════════════════════════════
export function ClientColumn(props: {
  appt: CitaDTO;
  info: ClientInfo;
  canViewClients: boolean;
  phoneDigits: string;
  totalVisits: number | null;
  usual: number | null;
  lastVisit: { at: string; barberName: string | null } | null;
  timezone: string;
  intlLocale: string;
  t: T;
}) {
  const { appt, info, t } = props;
  const name = appt.clientName || t("barber.agenda.card.noClient");
  const fileHref = appt.clientId && props.canViewClients ? `/barber/clientes/${appt.clientId}` : null;
  const prefs = info.detail?.preferences ?? null;
  const isNew = props.totalVisits === 0;

  const fmtDate = (iso: string) =>
    new Intl.DateTimeFormat(props.intlLocale, { timeZone: props.timezone, day: "numeric", month: "short", year: "numeric" }).format(
      new Date(iso),
    );

  return (
    <div className={css.cli}>
      <div className={css.cl}>
        <span className={css.clAv} aria-hidden="true">
          {appt.clientName ? initials(appt.clientName) : <User size={20} />}
        </span>
        <div style={{ minWidth: 0 }}>
          <h3 className={css.clName}>{fileHref ? <Link href={fileHref}>{name}</Link> : name}</h3>
          <div className={css.clMeta}>
            {isNew ? <span className={css.tagNew}>{t("barber.agenda.cita.client.new")}</span> : null}
            {props.totalVisits && props.totalVisits > 0 ? (
              <span>{t("barber.agenda.cita.client.visits", { count: props.totalVisits })}</span>
            ) : null}
            {appt.clientPhone ? (
              props.phoneDigits.length === 10 ? (
                <a href={`tel:+52${props.phoneDigits}`}>{formatBarberPhone(appt.clientPhone)}</a>
              ) : (
                <span>{formatBarberPhone(appt.clientPhone)}</span>
              )
            ) : null}
          </div>
        </div>
      </div>

      {props.phoneDigits.length === 10 || fileHref ? (
        <div className={css.contact}>
          {props.phoneDigits.length === 10 ? (
            <>
              <ChatClienteLink className={css.btn} phone={props.phoneDigits}>
                <MessageCircle size={16} /> {t("barber.agenda.cita.client.whatsapp")}
              </ChatClienteLink>
              <a className={css.btn} href={`tel:+52${props.phoneDigits}`}>
                <Phone size={16} /> {t("barber.agenda.cita.client.call")}
              </a>
            </>
          ) : null}
          {fileHref ? (
            <Link className={css.btn} href={fileHref}>
              <IdCard size={16} /> {t("barber.agenda.cita.client.file")}
            </Link>
          ) : null}
        </div>
      ) : null}

      {!appt.clientId ? <p className={css.small}>{t("barber.agenda.cita.client.none")}</p> : null}
      {info.loading ? <p className={css.small}>{t("barber.agenda.cita.client.loading")}</p> : null}
      {info.error ? <p className={css.small}>{t("barber.agenda.cita.client.loadError")}</p> : null}

      <StarsBlock info={info} starsFromDto={appt.client?.stars ?? null} isNew={isNew} t={t} />

      {appt.clientId && props.canViewClients && !info.loading && !info.error ? (
        <section className={css.blk}>
          <div className={css.blkHead}>
            <Scissors size={15} />
            <span className={css.grow}>{t("barber.agenda.cita.likes.title")}</span>
          </div>
          {prefs && hasPrefs(prefs) ? (
            <dl className={css.corte}>
              {PREF_ROWS.filter((r) => prefs[r.key]).map((r) => (
                <div key={r.key} className={`${r.full ? css.full : ""} ${r.key === "avoidProducts" ? css.avoid : ""}`}>
                  <dt>{t(`barber.clientes.preferences.${r.key}`)}</dt>
                  <dd>{prefs[r.key]}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <div className={css.vacio}>
              <p>{isNew ? t("barber.agenda.cita.likes.emptyNew") : t("barber.agenda.cita.likes.empty")}</p>
              {fileHref ? (
                <Link className={css.btn} href={fileHref}>
                  <NotebookPen size={15} /> {t("barber.agenda.cita.likes.edit")}
                </Link>
              ) : null}
            </div>
          )}
        </section>
      ) : null}

      {appt.clientId && props.canViewClients && info.detail ? (
        <section className={css.blk}>
          <div className={css.blkHead}>
            <span className={css.grow}>{t("barber.agenda.cita.history.title")}</span>
          </div>
          {props.lastVisit ? (
            <p className={css.muted}>
              {props.lastVisit.barberName
                ? t("barber.agenda.cita.history.last", { date: fmtDate(props.lastVisit.at), barber: props.lastVisit.barberName })
                : t("barber.agenda.cita.history.lastNoBarber", { date: fmtDate(props.lastVisit.at) })}
            </p>
          ) : (
            <p className={css.muted}>{t("barber.agenda.cita.history.none")}</p>
          )}
          {props.usual ? (
            <p className={css.muted}>
              {props.usual === 1
                ? t("barber.agenda.cita.history.usualOne")
                : t("barber.agenda.cita.history.usual", { weeks: props.usual })}
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

const PREF_ROWS: { key: keyof BarberClientDetail["preferences"]; full?: boolean }[] = [
  { key: "clipperNumber" },
  { key: "fade" },
  { key: "topLength" },
  { key: "sideLength" },
  { key: "part" },
  { key: "beard" },
  { key: "products", full: true },
  { key: "avoidProducts", full: true },
  { key: "barberNotes", full: true },
];
function hasPrefs(p: BarberClientDetail["preferences"]): boolean {
  return PREF_ROWS.some((r) => Boolean(p[r.key]));
}

function StarsBlock(props: { info: ClientInfo; starsFromDto: number | null; isNew: boolean; t: T }) {
  const { info, t } = props;
  const sv = info.stars;
  if (sv && sv.enabled) {
    const filled = Math.min(sv.stars, sv.slots);
    return (
      <section className={css.blk}>
        <div className={css.blkHead}>{t("barber.agenda.cita.stars.title")}</div>
        <div className={css.stars}>
          <span className={css.starsRow} aria-hidden="true">
            {Array.from({ length: sv.slots }, (_, i) => (
              <Star key={i} size={13} fill="currentColor" data-off={i >= filled ? "" : undefined} />
            ))}
          </span>
          <span className={css.starsTxt}>
            <b>{t("barber.agenda.cita.stars.count", { stars: sv.stars, slots: sv.slots })}</b>
          </span>
        </div>
        <p className={css.muted}>
          {sv.available.length > 0
            ? t("barber.agenda.cita.stars.ready", { bonus: sv.available[0].name })
            : sv.stars === 0 && props.isNew
              ? t("barber.agenda.cita.stars.first")
              : sv.next
                ? t("barber.agenda.cita.stars.next", { remaining: sv.next.remaining, bonus: sv.next.bonus.name })
                : null}
        </p>
      </section>
    );
  }
  // Sin tarjeta de estrellas: los sellos de lealtad de la ficha, si están encendidos.
  const loyalty = info.detail?.loyalty;
  if (loyalty && loyalty.enabled) {
    return (
      <section className={css.blk}>
        <div className={css.blkHead}>{t("barber.agenda.cita.stars.stamps")}</div>
        <div className={css.stars}>
          <span className={css.starsTxt}>
            <b>{t("barber.agenda.cita.stars.stampsCount", { count: loyalty.progress, threshold: loyalty.threshold })}</b>
          </span>
        </div>
        {loyalty.rewardAvailable ? (
          <p className={css.muted}>{t("barber.agenda.cita.stars.stampsReady", { reward: loyalty.reward })}</p>
        ) : null}
      </section>
    );
  }
  if (props.starsFromDto !== null && !info.loading) {
    return (
      <section className={css.blk}>
        <div className={css.blkHead}>{t("barber.agenda.cita.stars.title")}</div>
        <span className={css.starsTxt}>
          <b>{props.starsFromDto}</b>
        </span>
      </section>
    );
  }
  return null;
}

// ═══ Nota de la visita (editable con agenda.edit) ══════════════════════
export function VisitNote(props: {
  appt: CitaDTO;
  canEdit: boolean;
  busy: string | null;
  onSave: (notes: string | null) => Promise<boolean>;
  t: T;
}) {
  const { t } = props;
  const saved = props.appt.notes ?? "";
  const [text, setText] = useState(saved);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) setText(saved);
  }, [saved, dirty]);

  return (
    <section className={css.blk}>
      <div className={css.blkHead}>
        <NotebookPen size={15} />
        <span className={css.grow}>{t("barber.agenda.cita.note.title")}</span>
        <span className={css.small}>{t("barber.agenda.cita.note.hint")}</span>
      </div>
      {props.canEdit ? (
        <>
          <textarea
            className={css.textarea}
            value={text}
            maxLength={500}
            placeholder={t("barber.agenda.cita.note.placeholder")}
            aria-label={t("barber.agenda.cita.note.title")}
            onChange={(e) => {
              setText(e.target.value);
              setDirty(e.target.value !== saved);
            }}
          />
          {dirty ? (
            <div>
              <button
                type="button"
                className={css.btn}
                disabled={props.busy !== null}
                onClick={async () => {
                  const ok = await props.onSave(text.trim() || null);
                  if (ok) setDirty(false);
                }}
              >
                {props.busy === "notes" ? t("barber.agenda.modal.saving") : t("barber.agenda.cita.note.save")}
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <p className={saved ? css.noteRead : css.small}>{saved || t("barber.agenda.cita.note.empty")}</p>
      )}
    </section>
  );
}

// ═══ Fotos antes / después (el cargador de la ficha) ═══════════════════
export function VisitPhotos(props: {
  appointmentId: string;
  clientId: string;
  canUpload: boolean;
  t: T;
  tc: T;
  onMessage: (m: string) => void;
}) {
  const { t } = props;
  const [photos, setPhotos] = useState<BarberVisitPhotoView[] | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/barber/clients/${props.clientId}/photos?appointmentId=${props.appointmentId}`, {
      signal: controller.signal,
    })
      .then((r) => (r.ok ? (r.json() as Promise<{ photos?: BarberVisitPhotoView[] }>) : null))
      .then((d) => {
        if (!controller.signal.aborted) setPhotos(d?.photos ?? []);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [props.clientId, props.appointmentId]);

  if (photos === null) return null;
  if (photos.length === 0 && !props.canUpload) return null;
  return (
    <section className={css.blk}>
      <div className={css.blkHead}>
        <span className={css.grow}>{t("barber.agenda.cita.photos.title")}</span>
      </div>
      {photos.length > 0 ? (
        <div className={css.fotos}>
          {photos.map((p) => (
            <figure key={p.id} className={css.foto}>
              {p.signedUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={p.signedUrl} alt="" decoding="async" loading="lazy" />
              ) : null}
              <figcaption>{t(`barber.agenda.cita.photos.kinds.${p.kind as BarberPhotoKind}`)}</figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <p className={css.small}>{t("barber.agenda.cita.photos.empty")}</p>
      )}
      {props.canUpload ? (
        <PhotoUploader
          clientId={props.clientId}
          appointmentId={props.appointmentId}
          canPublish={false}
          t={props.tc}
          onUploaded={(photo: UploadedPhoto) =>
            setPhotos((list) => [...(list ?? []), photo as unknown as BarberVisitPhotoView])
          }
          onMessage={props.onMessage}
        />
      ) : null}
    </section>
  );
}

// ═══ Agendar su próxima (2 / 3 / 4 semanas) ════════════════════════════
export function NextVisit(props: {
  appt: CitaDTO;
  usual: number | null;
  timezone: string;
  branchId: string;
  intlLocale: string;
  barbers: BarberDTO[];
  onRepeat?: () => void;
  onCreated?: (appointment: BarberAppointmentDTO, note: string) => void;
  t: T;
}) {
  const { appt, t, timezone } = props;
  const [weeks, setWeeks] = useState<number | null>(null);
  const [state, setState] = useState<"idle" | "searching" | "ready" | "error" | "saving">("idle");
  const [result, setResult] = useState<NextVisitResult | null>(null);
  const [picked, setPicked] = useState<NextSlot | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Al elegir hora, el botón «Agendar» puede quedar bajo el pliegue: se trae.
  const confirmRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (picked) confirmRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [picked]);

  const barber = props.barbers.find((b) => b.id === appt.barberId);
  const barberName = barber ? barber.nickname || barber.name : appt.barberName || t("barber.agenda.card.noBarber");
  const fmtDay = (dateISO: string) =>
    new Intl.DateTimeFormat(props.intlLocale, { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(
      new Date(`${dateISO}T12:00:00Z`),
    );
  const fmtTime = (d: Date) => minuteToLabel(shopMinuteOfDay(d, timezone));

  const search = async (w: number) => {
    setWeeks(w);
    setPicked(null);
    setError(null);
    setResult(null);
    setState("searching");
    try {
      const dateISO = nextVisitDateISO(appt.startAt, w, timezone);
      const res = await fetch(`/api/barber/appointments?date=${dateISO}&days=1&branchId=${props.branchId}`);
      if (!res.ok) {
        setState("error");
        return;
      }
      const day = (await res.json()) as DayWindow;
      const r = findNextVisitSlot({ appointment: appt, weeks: w, timezone, day, now: new Date() });
      setResult(r);
      setPicked(r?.exact ?? null);
      setState("ready");
    } catch {
      setState("error");
    }
  };

  const book = async () => {
    if (!picked) return;
    setState("saving");
    setError(null);
    try {
      const res = await fetch("/api/barber/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId: props.branchId,
          barberId: picked.barberId,
          startAt: picked.startAt.toISOString(),
          serviceIds: appt.services.map((s) => s.serviceId),
          // Dura lo mismo que esta (si se alargó, la próxima también).
          durationMin: appointmentMinutes(appt),
          notes: null,
          clientId: appt.clientId,
          clientName: appt.clientName ?? "",
          clientPhone: appt.clientPhone ?? "",
        }),
      });
      const data = await readJson(res);
      if (!res.ok) {
        setError(errorOf(data, t("barber.agenda.queue.errors.generic")));
        setState("ready");
        return;
      }
      const note = t("barber.agenda.cita.next.created", {
        day: fmtDay(shopDateISO(picked.startAt, timezone)),
        time: fmtTime(picked.startAt),
      });
      props.onCreated?.(data.appointment as BarberAppointmentDTO, note);
      setWeeks(null);
      setResult(null);
      setPicked(null);
      setState("idle");
    } catch {
      setError(t("barber.agenda.queue.errors.generic"));
      setState("ready");
    }
  };

  const options = nextVisitOptions(props.usual);

  return (
    <section className={css.next} aria-live="polite">
      <div className={css.blkHead}>
        <CalendarPlus size={15} />
        <span className={css.grow}>{t("barber.agenda.cita.next.title")}</span>
        {props.usual ? <span className={css.chipUsual}>{t("barber.agenda.cita.next.usual", { weeks: props.usual })}</span> : null}
      </div>
      {!appt.barberId ? (
        <p className={css.muted}>{t("barber.agenda.cita.next.noBarber")}</p>
      ) : (
        <div className={css.chips}>
          {options.map((w) => (
            <button
              key={w}
              type="button"
              className={css.chip}
              aria-pressed={weeks === w}
              aria-label={t("barber.agenda.cita.next.weeksLabel", { weeks: w })}
              onClick={() => void search(w)}
              disabled={state === "searching" || state === "saving"}
            >
              {t("barber.agenda.cita.next.weeks", { weeks: w })}
            </button>
          ))}
        </div>
      )}
      {state === "searching" ? <p className={css.small}>{t("barber.agenda.cita.next.searching")}</p> : null}
      {state === "error" ? <p className={css.small}>{t("barber.agenda.cita.next.error")}</p> : null}
      {result && (state === "ready" || state === "saving") ? (
        result.exact ? (
          <p className={css.muted}>
            {t("barber.agenda.cita.next.exact", {
              day: fmtDay(result.dateISO),
              time: fmtTime(result.exact.startAt),
              barber: barberName,
            })}
          </p>
        ) : result.nearby.length > 0 ? (
          <>
            <p className={css.muted}>{t("barber.agenda.cita.next.nearby", { day: fmtDay(result.dateISO), barber: barberName })}</p>
            <div className={css.slotRow}>
              {result.nearby.map((s) => (
                <button
                  key={s.startAt.toISOString()}
                  type="button"
                  className={css.chip}
                  aria-pressed={picked?.startAt.getTime() === s.startAt.getTime()}
                  onClick={() => setPicked(s)}
                >
                  {fmtTime(s.startAt)}
                </button>
              ))}
            </div>
          </>
        ) : (
          <p className={css.muted}>{t("barber.agenda.cita.next.none", { day: fmtDay(result.dateISO), barber: barberName })}</p>
        )
      ) : null}
      {error ? (
        <div className={css.errorBox} role="alert">
          {error}
        </div>
      ) : null}
      {picked ? (
        <div className={css.slotRow} ref={confirmRef}>
          <button type="button" className={css.go} onClick={() => void book()} disabled={state === "saving"}>
            <CalendarPlus size={18} />
            {state === "saving" ? t("barber.agenda.modal.saving") : `${t("barber.agenda.cita.next.confirm")} · ${fmtTime(picked.startAt)}`}
          </button>
        </div>
      ) : null}
      {props.onRepeat && result && !result.exact && result.nearby.length === 0 ? (
        <div>
          <button type="button" className={css.lnk} onClick={props.onRepeat}>
            <Repeat size={15} /> {t("barber.agenda.cita.actions.repeat")}
          </button>
        </div>
      ) : null}
    </section>
  );
}


// ═══ Paneles encima de la ventana ══════════════════════════════════════
function SubPanel(props: { title: string; children: React.ReactNode; onBack: () => void; error?: string | null }) {
  return (
    <div
      className={css.subVelo}
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onBack();
      }}
    >
      <div className={css.sub} role="dialog" aria-modal="true" aria-label={props.title}>
        <h3 className={css.subTitle}>{props.title}</h3>
        {/* El error del servidor se ve AQUÍ: el de la ventana de atrás queda tapado por el velo. */}
        {props.error ? (
          <div className={css.errorBox} role="alert">
            {props.error}
          </div>
        ) : null}
        {props.children}
      </div>
    </div>
  );
}

export function CancelPanel(props: {
  error?: string | null;
  name: string;
  withReason: boolean;
  busy: boolean;
  onBack: () => void;
  onConfirm: (reason: string | null) => void;
  t: T;
}) {
  const { t } = props;
  const [picked, setPicked] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  return (
    <SubPanel title={t("barber.agenda.cita.cancel.title", { name: props.name })} onBack={props.onBack} error={props.error}>
      {props.withReason ? (
        <div className={css.field}>
          {t("barber.agenda.cita.cancel.reason")}
          <div className={css.chips}>
            {CANCEL_REASONS.map((k) => {
              const label = t(`barber.agenda.cita.cancel.reasons.${k}`);
              return (
                <button
                  key={k}
                  type="button"
                  className={css.chip}
                  aria-pressed={picked === label}
                  onClick={() => setPicked(picked === label ? null : label)}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <input
            className={css.input}
            value={typed}
            maxLength={CANCEL_REASON_MAX}
            placeholder={t("barber.agenda.cita.cancel.other")}
            aria-label={t("barber.agenda.cita.cancel.other")}
            onChange={(e) => setTyped(e.target.value)}
          />
        </div>
      ) : null}
      <div className={css.subFoot}>
        <button type="button" className={css.btn} onClick={props.onBack} disabled={props.busy}>
          {t("barber.agenda.cita.cancel.back")}
        </button>
        <button
          type="button"
          className={`${css.btn} ${css.btnSolidDanger}`}
          onClick={() => props.onConfirm(props.withReason ? cancelReasonText(picked, typed) : null)}
          disabled={props.busy}
          data-cancel-confirm=""
        >
          {t("barber.agenda.cita.cancel.confirm")}
        </button>
      </div>
    </SubPanel>
  );
}

export function DepositPanel(props: {
  error?: string | null;
  max: number | null;
  busy: boolean;
  onBack: () => void;
  onConfirm: (amount: number, method: BarberPaymentMethod) => Promise<void>;
  t: T;
}) {
  const { t } = props;
  const [raw, setRaw] = useState("");
  const [method, setMethod] = useState<BarberPaymentMethod>("CASH");
  const [bad, setBad] = useState(false);
  return (
    <SubPanel title={t("barber.agenda.cita.deposit.title")} onBack={props.onBack} error={props.error}>
      <label className={css.field}>
        {t("barber.agenda.cita.deposit.amount")}
        <input
          className={css.input}
          inputMode="decimal"
          value={raw}
          onChange={(e) => {
            // Solo dígitos, punto y coma: una letra en un monto no se queda.
            setRaw(e.target.value.replace(/[^\d.,]/g, "").slice(0, 12));
            setBad(false);
          }}
          placeholder="$0.00"
          autoFocus
        />
      </label>
      <div className={css.field}>
        {t("barber.agenda.cita.deposit.method")}
        <div className={css.chips}>
          {DEPOSIT_METHODS.map((m) => (
            <button key={m} type="button" className={css.chip} aria-pressed={method === m} onClick={() => setMethod(m)}>
              {t(`barber.agenda.cita.deposit.methods.${m}`)}
            </button>
          ))}
        </div>
      </div>
      {bad ? (
        <div className={css.errorBox} role="alert">
          {t("barber.agenda.cita.deposit.bad")}
        </div>
      ) : null}
      <div className={css.subFoot}>
        <button type="button" className={css.btn} onClick={props.onBack} disabled={props.busy}>
          {t("barber.agenda.cita.cancel.back")}
        </button>
        <button
          type="button"
          className={`${css.btn} ${css.go}`}
          disabled={props.busy}
          onClick={() => {
            const amount = parseDepositAmount(raw, props.max);
            if (amount === null) {
              setBad(true);
              return;
            }
            void props.onConfirm(amount, method);
          }}
        >
          {t("barber.agenda.cita.deposit.save")}
        </button>
      </div>
    </SubPanel>
  );
}

export function ProductPanel(props: {
  error?: string | null;
  busy: boolean;
  onBack: () => void;
  onConfirm: (product: BarberProductDTO, qty: number) => Promise<void>;
  t: T;
}) {
  const { t } = props;
  const [products, setProducts] = useState<BarberProductDTO[] | null>(null);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<BarberProductDTO | null>(null);
  const [qty, setQty] = useState(1);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/barber/products?forSale=1", { signal: controller.signal })
      .then((r) => (r.ok ? (r.json() as Promise<{ products?: BarberProductDTO[] }>) : null))
      .then((d) => {
        if (!controller.signal.aborted) setProducts(d?.products ?? []);
      })
      .catch(() => {
        if (!controller.signal.aborted) setProducts([]);
      });
    return () => controller.abort();
  }, []);
  const needle = q.trim().toLowerCase();
  const list = (products ?? []).filter((p) => !needle || p.name.toLowerCase().includes(needle)).slice(0, 30);

  return (
    <SubPanel title={t("barber.agenda.cita.product.title")} onBack={props.onBack} error={props.error}>
      <input
        className={css.input}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t("barber.agenda.cita.product.search")}
        aria-label={t("barber.agenda.cita.product.search")}
        autoFocus
      />
      {products === null ? (
        <p className={css.small}>{t("barber.agenda.cita.client.loading")}</p>
      ) : products.length === 0 ? (
        <p className={css.small}>{t("barber.agenda.cita.product.empty")}</p>
      ) : list.length === 0 ? (
        <p className={css.small}>{t("barber.agenda.cita.product.noMatch")}</p>
      ) : (
        <div className={css.pick}>
          {list.map((p) => (
            <button
              key={p.id}
              type="button"
              className={css.pickItem}
              aria-pressed={picked?.id === p.id}
              onClick={() => setPicked(p)}
            >
              <span>{p.name}</span>
              <span>{formatMXN(p.price)}</span>
              <small>{t("barber.agenda.cita.product.stock", { stock: p.stock })}</small>
            </button>
          ))}
        </div>
      )}
      {picked ? (
        <label className={css.field}>
          {t("barber.agenda.cita.product.qty")}
          <input
            className={css.input}
            type="number"
            min={1}
            max={99}
            inputMode="numeric"
            value={qty}
            onChange={(e) => setQty(Math.max(1, Math.min(99, Math.trunc(Number(e.target.value)) || 1)))}
          />
        </label>
      ) : null}
      <div className={css.subFoot}>
        <button type="button" className={css.btn} onClick={props.onBack} disabled={props.busy}>
          {t("barber.agenda.cita.cancel.back")}
        </button>
        <button
          type="button"
          className={`${css.btn} ${css.go}`}
          disabled={props.busy || !picked}
          onClick={() => picked && void props.onConfirm(picked, qty)}
        >
          <Package size={16} /> {t("barber.agenda.cita.product.add")}
        </button>
      </div>
    </SubPanel>
  );
}
