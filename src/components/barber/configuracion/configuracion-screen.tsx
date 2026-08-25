"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import toast from "react-hot-toast";
import {
  AlertTriangle,
  Award,
  CalendarCheck,
  Check,
  Copy,
  ExternalLink,
  Image as ImageIcon,
  Link2,
  MessageCircle,
  Store,
  Trash2,
  Upload,
  UserX,
  X,
} from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import type { BarberSettingsView, BarberShopProfile, SlugCheck, SlugChange } from "@/lib/barber/settings";
import { useBarberT } from "@/components/barber/cash/use-barber-t";
import {
  Banner,
  Btn,
  ErrorText,
  Field,
  Select,
  Switch,
  TextInput,
  apiCall,
  useSaving,
} from "@/components/barber/team/admin-ui";
import { prepararFoto } from "@/components/barber/landing/imagen";
import s from "./configuracion.module.css";

// ═══════════════════════════════════════════════════════════════════════
// /barber/configuracion — todo lo que hasta hoy no se podía tocar.
//
// Cada tarjeta se guarda SOLA (su propio botón, su propio error): un número
// fuera de rango en fidelidad no impide guardar el teléfono. Y cada ajuste
// lleva una línea que dice qué cambia en la práctica, no solo su nombre.
//
// i18n: el servidor baja el sub-árbol `barber.ajustes` ya recortado; las
// llaves aquí son cortas (t("configuracion.title")).
// ═══════════════════════════════════════════════════════════════════════

type T = ReturnType<typeof useBarberT>;

const SQL_FILES = {
  loyalty: "sql/barber_clientes.sql",
  inactivity: "sql/barber_clientes.sql",
  campaigns: "sql/barber_campanas.sql",
  booking: "sql/barber_settings.sql",
} as const;

export function ConfiguracionScreen({
  dict,
  initial,
  publicBookingInPlan,
}: {
  dict: Dictionary;
  initial: BarberSettingsView;
  /** El plan trae `publicBooking` (si no, el ajuste se guarda pero se avisa). */
  publicBookingInPlan: boolean;
}) {
  const t = useBarberT(dict);
  const [settings, setSettings] = useState<BarberSettingsView>(initial);

  return (
    <div className={s.page}>
      <header className={s.header}>
        <h1 className={s.title}>{t("configuracion.title")}</h1>
        <p className={s.subtitle}>{t("configuracion.subtitle")}</p>
      </header>

      <div className={s.gridWrap}>
      <div className={s.grid}>
        <ProfileCard
          t={t}
          profile={settings.profile}
          timezones={settings.timezones}
          limits={settings.limits}
          onSaved={(profile) => setSettings((v) => ({ ...v, profile }))}
        />
        <SlugCard
          t={t}
          slug={settings.slug}
          limits={settings.limits}
          onSaved={(slug) => setSettings((v) => ({ ...v, slug }))}
        />
        <LoyaltyCard
          t={t}
          value={settings.loyalty}
          onSaved={(loyalty) => setSettings((v) => ({ ...v, loyalty }))}
        />
        <InactivityCard
          t={t}
          value={settings.inactivity}
          onSaved={(inactivity) => setSettings((v) => ({ ...v, inactivity }))}
        />
        <CampaignsCard
          t={t}
          value={settings.campaigns}
          onSaved={(campaigns) => setSettings((v) => ({ ...v, campaigns }))}
        />
        <BookingCard
          t={t}
          value={settings.booking}
          inPlan={publicBookingInPlan}
          onSaved={(booking) => setSettings((v) => ({ ...v, booking }))}
        />
      </div>
      </div>
    </div>
  );
}

// ── Tarjeta ────────────────────────────────────────────────────────────

function Card({
  icon,
  title,
  sub,
  children,
  foot,
  wide,
}: {
  icon: ReactNode;
  title: string;
  sub?: string;
  children: ReactNode;
  foot?: ReactNode;
  wide?: boolean;
}) {
  return (
    <section className={[s.card, wide ? s.span2 : ""].filter(Boolean).join(" ")} aria-label={title}>
      <div className={s.cardHead}>
        <div className={s.cardIcon}>{icon}</div>
        <div style={{ minWidth: 0 }}>
          <h2 className={s.cardTitle}>{title}</h2>
          {sub ? <p className={s.cardSub}>{sub}</p> : null}
        </div>
      </div>
      <div className={s.cardBody}>{children}</div>
      {foot ? <div className={s.cardFoot}>{foot}</div> : null}
    </section>
  );
}

function SqlPending({ t, file }: { t: T; file: string }) {
  return (
    <Banner icon={<AlertTriangle size={16} />}>{t("common.sqlPending", { file })}</Banner>
  );
}

// ── Datos de la barbería + logo ────────────────────────────────────────

function ProfileCard({
  t,
  profile,
  timezones,
  limits,
  onSaved,
}: {
  t: T;
  profile: BarberShopProfile;
  timezones: string[];
  limits: BarberSettingsView["limits"];
  onSaved: (p: BarberShopProfile) => void;
}) {
  const [form, setForm] = useState({
    name: profile.name,
    phone: profile.phone ?? "",
    email: profile.email ?? "",
    address: profile.address ?? "",
    city: profile.city ?? "",
    state: profile.state ?? "",
    timezone: profile.timezone,
  });
  const { saving, error, run } = useSaving();

  const dirty =
    form.name !== profile.name ||
    form.phone !== (profile.phone ?? "") ||
    form.email !== (profile.email ?? "") ||
    form.address !== (profile.address ?? "") ||
    form.city !== (profile.city ?? "") ||
    form.state !== (profile.state ?? "") ||
    form.timezone !== profile.timezone;

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save() {
    const ok = await run(async () => {
      const r = await apiCall<{ profile: BarberShopProfile }>("/api/barber/settings", {
        method: "PATCH",
        json: { section: "profile", ...form },
      });
      onSaved(r.profile);
    });
    if (ok) toast.success(t("configuracion.profile.saved"));
  }

  return (
    <Card
      wide
      icon={<Store size={18} />}
      title={t("configuracion.profile.title")}
      sub={t("configuracion.profile.sub")}
      foot={
        <>
          <ErrorText>{error}</ErrorText>
          <Btn variant="primary" onClick={save} disabled={!dirty || saving || !form.name.trim()}>
            {saving ? t("common.saving") : t("common.save")}
          </Btn>
        </>
      }
    >
      <LogoRow t={t} logoUrl={profile.logoUrl} name={profile.name} onSaved={(logoUrl) => onSaved({ ...profile, logoUrl })} />

      {!profile.isMainBranch && profile.branchName ? (
        <Banner>{t("configuracion.profile.branchNote", { branch: profile.branchName })}</Banner>
      ) : null}

      <div className={s.formGrid}>
        <div className={s.full}>
          <Field label={t("configuracion.profile.name")} hint={t("configuracion.profile.nameHint")}>
            {(id) => <TextInput id={id} value={form.name} maxLength={limits.name} onChange={set("name")} />}
          </Field>
        </div>
        <Field label={t("configuracion.profile.phone")} hint={t("configuracion.profile.phoneHint")}>
          {(id) => (
            <TextInput id={id} type="tel" inputMode="tel" value={form.phone} maxLength={limits.phone} onChange={set("phone")} />
          )}
        </Field>
        <Field label={t("configuracion.profile.email")} hint={t("configuracion.profile.emailHint")}>
          {(id) => (
            <TextInput id={id} type="email" inputMode="email" value={form.email} maxLength={limits.email} onChange={set("email")} />
          )}
        </Field>
        <div className={s.full}>
          <Field label={t("configuracion.profile.address")} hint={t("configuracion.profile.addressHint")}>
            {(id) => <TextInput id={id} value={form.address} maxLength={limits.address} onChange={set("address")} />}
          </Field>
        </div>
        <Field label={t("configuracion.profile.city")}>
          {(id) => <TextInput id={id} value={form.city} maxLength={limits.city} onChange={set("city")} />}
        </Field>
        <Field label={t("configuracion.profile.state")}>
          {(id) => <TextInput id={id} value={form.state} maxLength={limits.city} onChange={set("state")} />}
        </Field>
        <div className={s.full}>
          <Field label={t("configuracion.profile.timezone")} hint={t("configuracion.profile.timezoneHint")}>
            {(id) => (
              <Select id={id} value={form.timezone} onChange={set("timezone")}>
                {(timezones.includes(form.timezone) ? timezones : [form.timezone, ...timezones]).map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </div>
    </Card>
  );
}

function LogoRow({
  t,
  logoUrl,
  name,
  onSaved,
}: {
  t: T;
  logoUrl: string | null;
  name: string;
  onSaved: (url: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { saving, error, run } = useSaving();

  async function upload(file: File) {
    const ok = await run(async () => {
      const listo = await prepararFoto(file);
      const form = new FormData();
      form.append("file", listo);
      const res = await fetch("/api/barber/settings/logo", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as { logoUrl?: string; error?: string };
      if (!res.ok) throw new Error(data.error || t("common.genericError"));
      onSaved(data.logoUrl ?? null);
    });
    if (ok) toast.success(t("configuracion.logo.saved"));
  }

  async function remove() {
    const ok = await run(async () => {
      await apiCall<{ logoUrl: null }>("/api/barber/settings/logo", { method: "DELETE" });
      onSaved(null);
    });
    if (ok) toast.success(t("configuracion.logo.removed"));
  }

  return (
    <div className={s.logoRow}>
      <div className={[s.logoBox, logoUrl ? s.logoHas : ""].filter(Boolean).join(" ")}>
        {logoUrl ? (
          // Liga pública de Storage: <img> normal a propósito (next/image exige allowlist de dominios).
          <img src={logoUrl} alt={name} />
        ) : (
          <ImageIcon size={22} aria-hidden="true" />
        )}
      </div>
      <div className={s.logoActions}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)" }}>{t("configuracion.logo.title")}</div>
        <p className={s.hint}>{t("configuracion.logo.hint")}</p>
        <div className={s.logoBtns}>
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void upload(f);
            }}
          />
          <Btn size="sm" onClick={() => inputRef.current?.click()} disabled={saving}>
            <Upload size={13} />
            {saving ? t("configuracion.logo.uploading") : logoUrl ? t("configuracion.logo.change") : t("configuracion.logo.upload")}
          </Btn>
          {logoUrl ? (
            <Btn size="sm" variant="danger" onClick={remove} disabled={saving}>
              <Trash2 size={13} />
              {t("configuracion.logo.remove")}
            </Btn>
          ) : null}
        </div>
        <ErrorText>{error}</ErrorText>
      </div>
    </div>
  );
}

// ── Dirección pública (slug) ───────────────────────────────────────────

function SlugCard({
  t,
  slug,
  limits,
  onSaved,
}: {
  t: T;
  slug: string;
  limits: BarberSettingsView["limits"];
  onSaved: (slug: string) => void;
}) {
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const [draft, setDraft] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [check, setCheck] = useState<SlugCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [copied, setCopied] = useState(false);
  const { saving, error, run } = useSaving();

  const trimmed = draft.trim();

  // Disponibilidad con retardo: una petición por pausa de tecleo, no por tecla.
  useEffect(() => {
    if (!trimmed) {
      setCheck(null);
      setChecking(false);
      return;
    }
    let alive = true;
    setChecking(true);
    const timer = window.setTimeout(async () => {
      try {
        const r = await apiCall<SlugCheck>(`/api/barber/settings/slug?slug=${encodeURIComponent(trimmed)}`);
        if (alive) setCheck(r);
      } catch {
        if (alive) setCheck(null);
      } finally {
        if (alive) setChecking(false);
      }
    }, 400);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [trimmed]);

  const publicUrl = `${origin}/b/${slug}`;
  const canSave = Boolean(check?.available) && confirm && !saving && !checking;

  async function save() {
    const ok = await run(async () => {
      const r = await apiCall<SlugChange>("/api/barber/settings/slug", {
        method: "PATCH",
        json: { slug: trimmed, confirm: true },
      });
      onSaved(r.slug);
      setDraft("");
      setConfirm(false);
      setCheck(null);
    });
    if (ok) toast.success(t("configuracion.slug.saved"));
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* sin portapapeles: la liga sigue visible para copiarla a mano */
    }
  }

  function checkLabel(): { text: string; tone: "ok" | "bad" | "muted" } {
    if (checking) return { text: t("configuracion.slug.check.checking"), tone: "muted" };
    if (!check) return { text: "", tone: "muted" };
    if (check.current) return { text: t("configuracion.slug.check.current"), tone: "muted" };
    if (check.available) return { text: t("configuracion.slug.check.available"), tone: "ok" };
    switch (check.problem) {
      case "taken":
        return { text: t("configuracion.slug.check.taken"), tone: "bad" };
      case "reserved":
        return { text: t("configuracion.slug.check.reserved"), tone: "bad" };
      case "short":
        return { text: t("configuracion.slug.check.short", { min: limits.slugMin }), tone: "bad" };
      case "long":
        return { text: t("configuracion.slug.check.long", { max: limits.slugMax }), tone: "bad" };
      case "empty":
        return { text: t("configuracion.slug.check.empty"), tone: "bad" };
      default:
        return { text: t("configuracion.slug.check.invalid"), tone: "bad" };
    }
  }
  const label = checkLabel();

  return (
    <Card
      wide
      icon={<Link2 size={18} />}
      title={t("configuracion.slug.title")}
      sub={t("configuracion.slug.sub")}
      foot={
        <>
          <ErrorText>{error}</ErrorText>
          <Btn variant="primary" onClick={save} disabled={!canSave}>
            {saving ? t("common.saving") : t("configuracion.slug.save")}
          </Btn>
        </>
      }
    >
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)", marginBottom: 5 }}>
          {t("configuracion.slug.current")}
        </div>
        <div className={s.urlBox}>
          <span className={s.url}>
            <span className={s.urlPrefix}>{origin}/b/</span>
            <span className={s.urlSlug}>{slug}</span>
          </span>
          <Btn size="sm" variant="ghost" onClick={copy}>
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? t("configuracion.slug.copied") : t("configuracion.slug.copy")}
          </Btn>
          <a className={s.check} href={`/b/${slug}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--brand)" }}>
            <ExternalLink size={13} />
            {t("configuracion.slug.open")}
          </a>
        </div>
      </div>

      <div className={s.warn} role="note">
        <AlertTriangle size={16} className={s.warnIcon} />
        <div>
          <p className={s.warnTitle}>{t("configuracion.slug.warningTitle")}</p>
          <p className={s.warnBody}>{t("configuracion.slug.warningBody")}</p>
        </div>
      </div>

      <Field label={t("configuracion.slug.label")}>
        {(id) => (
          <>
            <div className={s.slugInputWrap}>
              <span className={s.slugPrefix}>/b/</span>
              <input
                id={id}
                className={s.slugInput}
                value={draft}
                maxLength={limits.slugMax + 20}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder={slug}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setConfirm(false);
                }}
              />
            </div>
            <div className={s.check + " " + (label.tone === "ok" ? s.checkOk : label.tone === "bad" ? s.checkBad : s.checkMuted)} aria-live="polite">
              {label.tone === "ok" ? <Check size={13} /> : label.tone === "bad" ? <X size={13} /> : null}
              {label.text}
              {check && check.slug && check.slug !== trimmed && !check.current ? (
                <span className={s.checkMuted}>
                  {" "}· {t("configuracion.slug.preview")} <code>/b/{check.slug}</code>
                </span>
              ) : null}
            </div>
          </>
        )}
      </Field>

      {check?.available ? (
        <label className={s.confirmRow}>
          <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
          {t("configuracion.slug.confirm")}
        </label>
      ) : null}
    </Card>
  );
}

// ── Fidelidad ──────────────────────────────────────────────────────────

function LoyaltyCard({
  t,
  value,
  onSaved,
}: {
  t: T;
  value: BarberSettingsView["loyalty"];
  onSaved: (v: BarberSettingsView["loyalty"]) => void;
}) {
  const [enabled, setEnabled] = useState(value.enabled);
  const [threshold, setThreshold] = useState(String(value.threshold));
  const [reward, setReward] = useState(value.reward);
  const { saving, error, run } = useSaving();

  const n = Number(threshold);
  const thresholdOk = Number.isInteger(n) && n >= value.min && n <= value.max;
  const dirty = enabled !== value.enabled || n !== value.threshold || reward.trim() !== value.reward;
  const canSave = value.persisted && dirty && thresholdOk && reward.trim().length > 0 && !saving;

  async function save() {
    const ok = await run(async () => {
      const r = await apiCall<{ value: BarberSettingsView["loyalty"] }>("/api/barber/settings", {
        method: "PATCH",
        json: { section: "loyalty", enabled, threshold: n, reward: reward.trim() },
      });
      onSaved(r.value);
    });
    if (ok) toast.success(t("configuracion.loyalty.saved"));
  }

  return (
    <Card
      icon={<Award size={18} />}
      title={t("configuracion.loyalty.title")}
      sub={t("configuracion.loyalty.sub")}
      foot={
        <>
          <ErrorText>{error}</ErrorText>
          <Btn variant="primary" onClick={save} disabled={!canSave}>
            {saving ? t("common.saving") : t("common.save")}
          </Btn>
        </>
      }
    >
      {!value.persisted ? <SqlPending t={t} file={SQL_FILES.loyalty} /> : null}

      <div className={s.numRow} style={{ justifyContent: "space-between" }}>
        <div style={{ minWidth: 0, flex: "1 1 200px" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>{t("configuracion.loyalty.enabled")}</div>
          <p className={s.hint} style={{ marginTop: 2 }}>{t("configuracion.loyalty.enabledHint")}</p>
        </div>
        <Switch checked={enabled} onChange={setEnabled} label={t("configuracion.loyalty.enabled")} disabled={!value.persisted} />
      </div>

      <Field label={t("configuracion.loyalty.threshold")} hint={t("configuracion.loyalty.thresholdHint")}>
        {(id) => (
          <div className={s.numRow}>
            <input
              id={id}
              className={s.numInput}
              type="number"
              inputMode="numeric"
              min={value.min}
              max={value.max}
              value={threshold}
              disabled={!value.persisted || !enabled}
              onChange={(e) => setThreshold(e.target.value)}
            />
          </div>
        )}
      </Field>

      <Field label={t("configuracion.loyalty.reward")} hint={t("configuracion.loyalty.rewardHint")}>
        {(id) => (
          <TextInput
            id={id}
            value={reward}
            maxLength={value.rewardMax}
            disabled={!value.persisted || !enabled}
            onChange={(e) => setReward(e.target.value)}
          />
        )}
      </Field>

      {enabled && thresholdOk && reward.trim() ? (
        <div className={s.summary}>{t("configuracion.loyalty.summary", { count: n, reward: reward.trim() })}</div>
      ) : null}
    </Card>
  );
}

// ── Inactividad ────────────────────────────────────────────────────────

function InactivityCard({
  t,
  value,
  onSaved,
}: {
  t: T;
  value: BarberSettingsView["inactivity"];
  onSaved: (v: BarberSettingsView["inactivity"]) => void;
}) {
  const [days, setDays] = useState(String(value.days));
  const { saving, error, run } = useSaving();
  const n = Number(days);
  const ok = Number.isInteger(n) && n >= value.min && n <= value.max;
  const canSave = value.persisted && ok && n !== value.days && !saving;

  async function save() {
    const done = await run(async () => {
      const r = await apiCall<{ value: BarberSettingsView["inactivity"] }>("/api/barber/settings", {
        method: "PATCH",
        json: { section: "inactivity", days: n },
      });
      onSaved(r.value);
    });
    if (done) toast.success(t("configuracion.inactivity.saved"));
  }

  return (
    <Card
      icon={<UserX size={18} />}
      title={t("configuracion.inactivity.title")}
      sub={t("configuracion.inactivity.sub")}
      foot={
        <>
          <ErrorText>{error}</ErrorText>
          <Btn variant="primary" onClick={save} disabled={!canSave}>
            {saving ? t("common.saving") : t("common.save")}
          </Btn>
        </>
      }
    >
      {!value.persisted ? <SqlPending t={t} file={SQL_FILES.inactivity} /> : null}
      <Field label={t("configuracion.inactivity.days")} hint={t("configuracion.inactivity.daysHint")}>
        {(id) => (
          <div className={s.numRow}>
            <input
              id={id}
              className={s.numInput}
              type="number"
              inputMode="numeric"
              min={value.min}
              max={value.max}
              value={days}
              disabled={!value.persisted}
              onChange={(e) => setDays(e.target.value)}
            />
            <span className={s.numUnit}>{value.min}–{value.max}</span>
          </div>
        )}
      </Field>
    </Card>
  );
}

// ── Campañas ───────────────────────────────────────────────────────────

function CampaignsCard({
  t,
  value,
  onSaved,
}: {
  t: T;
  value: BarberSettingsView["campaigns"];
  onSaved: (v: BarberSettingsView["campaigns"]) => void;
}) {
  const [days, setDays] = useState(String(value.cooldownDays));
  const { saving, error, run } = useSaving();
  const n = Number(days);
  const ok = Number.isInteger(n) && n >= value.min && n <= value.max;
  const canSave = value.persisted && ok && n !== value.cooldownDays && !saving;

  async function save() {
    const done = await run(async () => {
      const r = await apiCall<{ value: BarberSettingsView["campaigns"] }>("/api/barber/settings", {
        method: "PATCH",
        json: { section: "campaigns", cooldownDays: n },
      });
      onSaved(r.value);
    });
    if (done) toast.success(t("configuracion.campaigns.saved"));
  }

  return (
    <Card
      icon={<MessageCircle size={18} />}
      title={t("configuracion.campaigns.title")}
      sub={t("configuracion.campaigns.sub")}
      foot={
        <>
          <ErrorText>{error}</ErrorText>
          <Btn variant="primary" onClick={save} disabled={!canSave}>
            {saving ? t("common.saving") : t("common.save")}
          </Btn>
        </>
      }
    >
      {!value.persisted ? <SqlPending t={t} file={SQL_FILES.campaigns} /> : null}
      <Field label={t("configuracion.campaigns.cooldown")} hint={t("configuracion.campaigns.cooldownHint")}>
        {(id) => (
          <div className={s.numRow}>
            <input
              id={id}
              className={s.numInput}
              type="number"
              inputMode="numeric"
              min={value.min}
              max={value.max}
              value={days}
              disabled={!value.persisted}
              onChange={(e) => setDays(e.target.value)}
            />
            <span className={s.numUnit}>{value.min}–{value.max}</span>
          </div>
        )}
      </Field>
    </Card>
  );
}

// ── Reservas en línea ──────────────────────────────────────────────────

function BookingCard({
  t,
  value,
  inPlan,
  onSaved,
}: {
  t: T;
  value: BarberSettingsView["booking"];
  inPlan: boolean;
  onSaved: (v: BarberSettingsView["booking"]) => void;
}) {
  const [policy, setPolicy] = useState(value.policy);
  const { saving, error, run } = useSaving();
  const canSave = value.persisted && policy !== value.policy && !saving;

  async function save() {
    const done = await run(async () => {
      const r = await apiCall<{ value: BarberSettingsView["booking"]["policy"] }>("/api/barber/settings", {
        method: "PATCH",
        json: { section: "booking", policy },
      });
      onSaved({ policy: r.value, persisted: true });
    });
    if (done) toast.success(t("configuracion.booking.saved"));
  }

  const options: Array<{ id: BarberSettingsView["booking"]["policy"]; title: string; hint: string }> = [
    { id: "auto", title: t("configuracion.booking.auto"), hint: t("configuracion.booking.autoHint") },
    { id: "manual", title: t("configuracion.booking.manual"), hint: t("configuracion.booking.manualHint") },
  ];

  return (
    <Card
      icon={<CalendarCheck size={18} />}
      title={t("configuracion.booking.title")}
      sub={t("configuracion.booking.sub")}
      foot={
        <>
          <ErrorText>{error}</ErrorText>
          <Btn variant="primary" onClick={save} disabled={!canSave}>
            {saving ? t("common.saving") : t("common.save")}
          </Btn>
        </>
      }
    >
      {!value.persisted ? <SqlPending t={t} file={SQL_FILES.booking} /> : null}
      {!inPlan ? <Banner>{t("configuracion.booking.planNote")}</Banner> : null}
      <div className={s.optionList} role="radiogroup" aria-label={t("configuracion.booking.title")}>
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={policy === o.id}
            className={s.option}
            disabled={!value.persisted}
            onClick={() => setPolicy(o.id)}
          >
            <span className={s.optionDot} aria-hidden="true" />
            <span style={{ minWidth: 0 }}>
              <span className={s.optionTitle} style={{ display: "block" }}>{o.title}</span>
              <span className={s.optionHint} style={{ display: "block" }}>{o.hint}</span>
            </span>
          </button>
        ))}
      </div>
      <p className={s.hint}>{t("configuracion.booking.note")}</p>
    </Card>
  );
}
