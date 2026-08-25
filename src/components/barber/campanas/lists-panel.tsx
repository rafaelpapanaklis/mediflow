"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Ban, Check, Send, Users } from "lucide-react";
import {
  apiCall,
  Banner,
  Btn,
  Chip,
  EmptyState,
  ErrorText,
  Modal,
  TextArea,
  useSaving,
} from "../team/admin-ui";
import { formatDay, formatMxn, formatUsd, prettyPhone, useCampT } from "./ui";
import {
  SKIP_REASONS,
  type AudienceDef,
  type AudiencePayload,
  type CampaignAudienceId,
  type CampaignLimits,
  type CampaignTarget,
  type SendResult,
} from "./types";
import s from "./campanas.module.css";

// ═══════════════════════════════════════════════════════════════════════
// Las listas y el envío.
//
// 🔴 LA REGLA DE ESTA PANTALLA: el costo SIEMPRE a la vista. La barra de
// costo se pinta apenas hay alguien seleccionado y vuelve a aparecer, en
// grande, dentro del modal de confirmación. Estos mensajes son de
// MARKETING (~4x un recordatorio en México) y los paga la barbería.
//
// El texto final se ve con el NOMBRE REAL de un cliente de la lista, no con
// un "{{1}}": si no se ve el mensaje de verdad, no se está revisando nada.
// ═══════════════════════════════════════════════════════════════════════

export function ListsPanel({
  locale,
  audiences,
  limits,
  canSend,
}: {
  locale: string;
  audiences: AudienceDef[];
  limits: CampaignLimits;
  canSend: boolean;
}) {
  const t = useCampT();
  const [audience, setAudience] = useState<CampaignAudienceId>("inactive");
  const [data, setData] = useState<AudiencePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [promo, setPromo] = useState("");
  const [promoTouched, setPromoTouched] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const { saving, error, setError, run } = useSaving();

  const load = useCallback(
    async (which: CampaignAudienceId) => {
      setLoading(true);
      setLoadError(null);
      try {
        const payload = await apiCall<AudiencePayload>(
          `/api/barber/campaigns?audience=${which}`,
        );
        setData(payload);
        // Se preselecciona la tanda completa: es lo que la barbería quiere
        // el 90 % de las veces, y de todos modos no se manda nada sin pasar
        // por la confirmación con el costo.
        const eligible = payload.targets.filter((x) => x.eligible).slice(0, payload.batchMax);
        setSelected(new Set(eligible.map((x) => x.clientId)));
        setPromoTouched((touched) => {
          if (!touched) setPromo(payload.promo);
          return touched;
        });
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : t("errors.generic"));
        setData(null);
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    void load(audience);
  }, [audience, load]);

  function pick(next: CampaignAudienceId) {
    if (next === audience) return;
    setResult(null);
    setError(null);
    // El texto vuelve al de la campaña nueva: cada lista tiene el suyo.
    setPromoTouched(false);
    setAudience(next);
  }

  const eligible = useMemo(
    () => (data?.targets ?? []).filter((x) => x.eligible),
    [data],
  );

  // El costo se cotiza sobre lo SELECCIONADO, recortado al tope de la
  // tanda. Nunca sobre la lista entera: sería un número que no va a pasar.
  const sendable = Math.min(selected.size, data?.batchMax ?? limits.batchMax);
  const totalUsd = Number((sendable * limits.unitUsd).toFixed(4));

  const templateBlocked = data ? data.templateStatus !== "APPROVED" : false;

  function toggle(clientId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(clientId)) next.delete(clientId);
      else next.add(clientId);
      return next;
    });
  }

  function selectAll() {
    const max = data?.batchMax ?? limits.batchMax;
    setSelected(new Set(eligible.slice(0, max).map((x) => x.clientId)));
  }

  function send() {
    if (!data) return;
    setResult(null);
    void run(async () => {
      const payload = await apiCall<SendResult>("/api/barber/campaigns/send", {
        method: "POST",
        json: {
          audience,
          clientIds: Array.from(selected),
          promo,
          confirmed: true,
          // El servidor compara este número con el suyo y NO manda si no
          // coinciden: nadie confirma un gasto distinto del que vio.
          confirmCost: totalUsd,
          month: data.month ?? undefined,
          days: data.days ?? undefined,
        },
      });
      setResult(payload);
      setConfirming(false);
      // Se recarga para que los que ya recibieron salgan de la lista.
      await load(audience);
    });
  }

  return (
    <div className={s.lists}>
      <nav className={s.audienceRow} aria-label={t("tabs.lists")}>
        {audiences.map((a) => (
          <button
            key={a.id}
            type="button"
            aria-pressed={audience === a.id}
            className={[s.audienceCard, audience === a.id ? s.audienceCardActive : ""]
              .filter(Boolean)
              .join(" ")}
            onClick={() => pick(a.id)}
          >
            <span className={s.audienceName}>{t(`audiences.${a.id}.name`)}</span>
            <span className={s.audienceHint}>
              {t(`audiences.${a.id}.hint`, {
                days:
                  a.id === "membershipExpiring"
                    ? limits.membershipExpiringDays
                    : (data?.days ?? limits.inactiveDays),
                count: limits.noShowMin,
              })}
            </span>
          </button>
        ))}
      </nav>

      {loadError ? <Banner tone="danger">{loadError}</Banner> : null}

      {templateBlocked && data ? (
        <Banner
          tone="danger"
          icon={<AlertTriangle size={16} />}
          action={
            <a className={s.bannerLink} href="/barber/whatsapp">
              WhatsApp
            </a>
          }
        >
          {data.templateStatus === "PENDING"
            ? t("send.templatePending", { name: data.templateName })
            : t("send.needsTemplate", { name: data.templateName })}
        </Banner>
      ) : null}

      {result ? <SendSummary result={result} /> : null}

      {loading ? (
        <p className={s.loading}>{t("list.loading")}</p>
      ) : !data || eligible.length === 0 ? (
        <>
          <EmptyState icon={<Users size={22} />} title={t("list.empty")} />
          {data ? <SkippedNote skipped={data.skipped} /> : null}
        </>
      ) : (
        <>
          <div className={s.listHead}>
            <div className={s.listCount}>
              <strong>{t("list.eligible", { count: eligible.length })}</strong>
              <span className={s.listCountSub}>
                {t("list.selected", { count: selected.size })}
              </span>
            </div>
            <div className={s.listActions}>
              <Btn size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                {t("list.clear")}
              </Btn>
              <Btn size="sm" onClick={selectAll}>
                {t("list.selectAll")}
              </Btn>
            </div>
          </div>

          {eligible.length > (data.batchMax ?? limits.batchMax) ? (
            <p className={s.note}>{t("list.batchNote", { max: data.batchMax })}</p>
          ) : null}

          <SkippedNote skipped={data.skipped} />

          <ul className={s.targets}>
            {eligible.map((target) => (
              <TargetRow
                key={target.clientId}
                target={target}
                audience={audience}
                locale={locale}
                checked={selected.has(target.clientId)}
                onToggle={() => toggle(target.clientId)}
              />
            ))}
          </ul>

          <PromoEditor
            promo={promo}
            max={limits.promoMax}
            tokens={limits.tokens}
            templateBody={data.templateBody}
            sample={eligible.find((x) => selected.has(x.clientId)) ?? eligible[0]}
            onChange={(value) => {
              setPromoTouched(true);
              setPromo(value);
            }}
          />

          <CostBar
            count={sendable}
            unitUsd={limits.unitUsd}
            totalUsd={totalUsd}
            quotaWarning={quotaWarning(data, sendable, t)}
          />

          <ErrorText>{error}</ErrorText>

          <div className={s.sendRow}>
            <Btn
              variant="primary"
              disabled={!canSend || sendable === 0 || templateBlocked || saving}
              onClick={() => setConfirming(true)}
            >
              <Send size={15} />
              {t("send.cta")}
            </Btn>
            {!canSend ? <span className={s.note}>{t("send.noPermission")}</span> : null}
          </div>
        </>
      )}

      {confirming && data ? (
        <ConfirmModal
          count={sendable}
          unitUsd={limits.unitUsd}
          totalUsd={totalUsd}
          saving={saving}
          onClose={() => setConfirming(false)}
          onConfirm={send}
        />
      ) : null}
    </div>
  );
}

/** Aviso de cupo: se dice ANTES, no cuando el envío se corta a la mitad. */
function quotaWarning(
  data: AudiencePayload,
  sendable: number,
  t: ReturnType<typeof useCampT>,
): string | null {
  const q = data.quota;
  if (q.limit < 0) return null;
  if (q.exhausted) return t("quota.exhausted");
  if (sendable > q.remaining) {
    return t("quota.over", { count: sendable, remaining: q.remaining });
  }
  if (q.nearLimit) {
    const pct = q.limit > 0 ? Math.round((q.used / q.limit) * 100) : 0;
    return t("quota.near", { pct });
  }
  return null;
}

function SkippedNote({ skipped }: { skipped: Record<string, number> }) {
  const t = useCampT();
  const parts = SKIP_REASONS.filter((r) => (skipped?.[r] ?? 0) > 0).map(
    (r) => `${skipped[r]} · ${t(`list.skip.${r}`)}`,
  );
  if (parts.length === 0) return null;
  return <p className={s.skipNote}>{t("list.skip.detail", { parts: parts.join("  ·  ") })}</p>;
}

function TargetRow({
  target,
  audience,
  locale,
  checked,
  onToggle,
}: {
  target: CampaignTarget;
  audience: CampaignAudienceId;
  locale: string;
  checked: boolean;
  onToggle: () => void;
}) {
  const t = useCampT();
  return (
    <li className={s.target}>
      <label className={s.targetLabel}>
        <input
          type="checkbox"
          className={s.checkbox}
          checked={checked}
          onChange={onToggle}
        />
        <span className={s.targetMain}>
          <span className={s.targetName}>{target.name}</span>
          <span className={s.targetPhone}>{prettyPhone(target.phone)}</span>
        </span>
        <span className={s.targetWhy}>{whyText(target, audience, locale, t)}</span>
        {target.spentMxn > 0 ? (
          <span className={s.targetSpent}>{formatMxn(target.spentMxn, locale)}</span>
        ) : (
          <span className={s.targetSpent} />
        )}
      </label>
    </li>
  );
}

function whyText(
  target: CampaignTarget,
  audience: CampaignAudienceId,
  locale: string,
  t: ReturnType<typeof useCampT>,
): string {
  if (audience === "birthday") {
    return t("list.why.birthday", { day: target.birthdayDay ?? "" });
  }
  if (audience === "membershipExpiring" || audience === "membershipExpired") {
    return t(`list.why.${audience}`, {
      name: target.membershipName ?? "",
      date: target.membershipEndAt ? formatDay(target.membershipEndAt, locale) : "",
    });
  }
  if (audience === "loyaltyReward") {
    return t("list.why.loyaltyReward", { count: target.loyaltyCount });
  }
  if (audience === "noShow") {
    return t("list.why.noShow", { count: target.noShowCount });
  }
  if (target.daysSinceLastVisit === null) return t("list.why.inactiveNever");
  return t("list.why.inactive", { days: target.daysSinceLastVisit });
}

function PromoEditor({
  promo,
  max,
  tokens,
  templateBody,
  sample,
  onChange,
}: {
  promo: string;
  max: number;
  tokens: string[];
  templateBody: string;
  sample: CampaignTarget | undefined;
  onChange: (value: string) => void;
}) {
  const t = useCampT();
  const firstName = (sample?.name ?? "").trim().split(/\s+/)[0] || "";

  // Vista previa CON EL NOMBRE REAL: se sustituye {{1}} por el cliente,
  // {{2}} por la barbería (que en el mensaje real pone el servidor) y
  // {{3}} por la promoción escrita. Las fichas del texto se muestran tal
  // cual salvo {nombre}, que sí se puede resolver aquí.
  const preview = templateBody
    .replace("{{1}}", firstName || "…")
    .replace("{{3}}", promo.replace(/\{nombre\}/g, firstName) || "…");

  return (
    <section className={s.promo}>
      <div className={s.promoHead}>
        <label className={s.promoLabel} htmlFor="camp-promo">
          {t("promo.label")}
        </label>
        <span className={s.promoCount}>
          {promo.length}/{max}
        </span>
      </div>
      <p className={s.promoHelp}>{t("promo.help")}</p>
      <TextArea
        id="camp-promo"
        rows={3}
        maxLength={max}
        value={promo}
        placeholder={t("promo.placeholder")}
        onChange={(e) => onChange(e.target.value)}
      />
      <p className={s.tokens}>
        <span className={s.tokensLabel}>{t("promo.tokens")}</span>
        {tokens.map((token) => (
          <button
            key={token}
            type="button"
            className={s.token}
            onClick={() => onChange(`${promo}${promo.endsWith(" ") || !promo ? "" : " "}{${token}}`)}
          >
            {`{${token}}`}
          </button>
        ))}
      </p>
      <p className={s.promoHelp}>{t("promo.tokenHelp")}</p>

      <div className={s.previewBox}>
        <span className={s.previewLabel}>
          {firstName ? t("promo.preview", { name: firstName }) : t("promo.previewNobody")}
        </span>
        <p className={s.previewText}>{preview}</p>
      </div>
    </section>
  );
}

/**
 * 🔴 La barra del costo. No se colapsa, no se esconde detrás de un clic y
 * no se enseña sólo al final: mientras haya alguien seleccionado, aquí está
 * cuánta gente y cuánto dinero.
 */
function CostBar({
  count,
  unitUsd,
  totalUsd,
  quotaWarning,
}: {
  count: number;
  unitUsd: number;
  totalUsd: number;
  quotaWarning: string | null;
}) {
  const t = useCampT();
  return (
    <section className={s.cost} aria-live="polite">
      <div className={s.costMain}>
        <span className={s.costLabel}>{t("cost.heading")}</span>
        {count === 0 ? (
          <span className={s.costNone}>{t("cost.none")}</span>
        ) : (
          <div className={s.costFigures}>
            <span className={s.costCount}>
              {count === 1 ? t("cost.oneMessage") : t("cost.messages", { count })}
            </span>
            <span className={s.costSep} aria-hidden="true">
              ·
            </span>
            <span className={s.costTotal}>{formatUsd(totalUsd)}</span>
          </div>
        )}
      </div>
      <p className={s.costUnit}>{t("cost.unit", { amount: formatUsd(unitUsd) })}</p>
      <p className={s.costWarn}>{t("cost.marketing")}</p>
      <p className={s.costWho}>{t("cost.whoPays")}</p>
      {quotaWarning ? (
        <p className={s.costQuota}>
          <AlertTriangle size={14} /> {quotaWarning}
        </p>
      ) : null}
    </section>
  );
}

function ConfirmModal({
  count,
  unitUsd,
  totalUsd,
  saving,
  onClose,
  onConfirm,
}: {
  count: number;
  unitUsd: number;
  totalUsd: number;
  saving: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const t = useCampT();
  // El consentimiento no viene marcado: marcarlo es el acto de confirmar
  // que los clientes aceptaron recibir marketing.
  const [consent, setConsent] = useState(false);

  return (
    <Modal
      title={t("send.confirmTitle")}
      onClose={onClose}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose} disabled={saving}>
            {t("send.cancel")}
          </Btn>
          <Btn variant="primary" onClick={onConfirm} disabled={!consent || saving}>
            {saving ? t("send.sending") : t("send.confirmCta", { count })}
          </Btn>
        </>
      }
    >
      <p className={s.confirmLead}>{t("send.confirmLead", { count })}</p>
      <div className={s.confirmCost}>
        <span className={s.confirmAmount}>{formatUsd(totalUsd)}</span>
        <span className={s.confirmDetail}>
          {t("cost.messages", { count })} · {t("cost.unit", { amount: formatUsd(unitUsd) })}
        </span>
      </div>
      <p className={s.costWarn}>{t("cost.marketing")}</p>
      <p className={s.costWho}>{t("cost.whoPays")}</p>
      <label className={s.consent}>
        <input
          type="checkbox"
          className={s.checkbox}
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
        <span>{t("send.confirmCheck")}</span>
      </label>
    </Modal>
  );
}

function SendSummary({ result }: { result: SendResult }) {
  const t = useCampT();
  const text =
    result.sent === 0
      ? t("send.doneNone")
      : result.failed > 0
        ? t("send.doneWithFailed", { sent: result.sent, failed: result.failed })
        : t("send.done", { sent: result.sent });

  return (
    <Banner
      icon={result.sent > 0 ? <Check size={16} /> : <Ban size={16} />}
      tone={result.sent === 0 ? "danger" : undefined}
    >
      <span className={s.summaryText}>{text}</span>{" "}
      <Chip tone="muted">{formatUsd(result.cost.totalUsd)}</Chip>
      {result.quotaExhausted ? (
        <span className={s.summaryWarn}> {t("send.quotaStopped")}</span>
      ) : null}
    </Banner>
  );
}
