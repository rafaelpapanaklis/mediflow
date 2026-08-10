export const dynamic = "force-dynamic";

/**
 * /afiliados/inicio — portada del panel del afiliado.
 *
 * Diseño Panel-Afiliado-DaleControl.dc.html. El archivo traía DOS estados
 * apilados (afiliado nuevo / afiliado activo); NO son dos pantallas: es esta
 * misma, y lo que cambia son los datos. Por eso hay una sola ruta y una sola
 * composición, con `hasEarnings` decidiendo qué versión de cada bloque sale.
 *
 * NI UN MONTO ESCRITO A MANO: la comisión mensual sale de
 * projectFixedMonthlyMxn() sobre las clínicas que hoy pagan, los montos por
 * plan de la config del motor (fixedAmountFor) con las etiquetas de
 * plan_configs, y los bonos de la config de hitos. Si Rafael cambia un monto
 * en /admin, esta pantalla cambia sola.
 *
 * PRIVACIDAD: de las clínicas referidas solo salen conteos y el nombre en la
 * tabla de comisiones propias. Nada de planes, correos ni facturación ajena.
 */

import { redirect } from "next/navigation";
import { getAffiliateContext } from "@/lib/affiliate-auth";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/utils";
import { getAffiliateLevelInfo } from "@/lib/affiliate-levels";
import { LEVEL_LABELS } from "@/lib/affiliate-levels";
import { LevelProgress, type LevelAmountRow } from "@/components/afiliados/level-progress";
import { getResolvedPlans } from "@/lib/plans";
import {
  getPayoutSettings,
  effectiveAffiliateMode,
  fixedAmountFor,
  milestoneTiers,
  normalizePlanKey,
  normalizePayoutMode,
  commissionKindLabel,
  isNetworkBonusKind,
  PAYOUT_MODE_LABELS,
  type PayoutMode,
  type ProgramMode,
} from "@/lib/affiliates/payout";
import { payingClinicWhere, projectFixedMonthlyMxn } from "@/lib/affiliates/stats";
import { baseReferralUrl } from "@/lib/affiliates/link-url";
import { getMilestoneProgress } from "@/lib/affiliates/milestones-progress";
import { getNetworkBonusPanel } from "@/lib/affiliates/network-bonus";
import { getInviter } from "@/lib/affiliates/invites";
import { fmtMxn } from "@/lib/affiliates/public-offer";
import { MilestonesCard } from "@/components/afiliados/milestones-card";
import { NetworkBonusCard } from "@/components/afiliados/network-bonus-card";
import { ReferralLinks } from "@/components/afiliados/referral-links";
import {
  PageHead,
  PanelCard,
  Eyebrow,
  Chip,
  Stat,
  StatRow,
  EmptyState,
  GridTable,
  GridRow,
} from "@/components/afiliados/ui/panel-ui";
import { CopyButton, CopyCodeButton } from "@/components/afiliados/ui/copy-button";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.dalecontrol.com";

/** Clínica que hoy paga, reducida a lo mínimo para proyectar la comisión. */
type PayingClinic = { id: string; plan: string | null };
type FrozenTerms = { clinicId: string; payoutMode: string };
type ClinicName = { id: string; name: string };

/** Tono del chip de nivel: el metal se lee por color, no solo por la palabra. */
const LEVEL_CHIP: Record<string, "amber" | "neutral" | "brand"> = {
  bronze: "amber",
  silver: "neutral",
  gold: "brand",
};

export default async function AffiliateHomePage() {
  const ctx = await getAffiliateContext();
  if (!ctx) redirect("/afiliados/login");

  const affiliateId = ctx.affiliateId;

  // affiliateId SIEMPRE de la sesión, nunca del request. Promise.all ≤ 6
  // (PgBouncer), por eso van dos tandas.
  //
  // `getPayoutSettings` es la MISMA lectura de la fila id=1 que
  // `getPayoutConfig` pero trae también los bonos por clínicas activas, así
  // que ese bloque no cuesta un SELECT extra. cfg = null si
  // sql/afiliados-comisiones.sql no está aplicado (motor inactivo → todo se
  // queda en el % del nivel). Nunca lanza.
  const [referredClinics, byStatus, recent, payoutSettings, plans, payingList] = await Promise.all([
    prisma.clinic.count({ where: { affiliateId } }),
    prisma.affiliateCommission.groupBy({
      by: ["status"],
      where: { affiliateId },
      _sum: { commissionMxn: true },
      _count: { _all: true },
    }),
    prisma.affiliateCommission.findMany({
      where: { affiliateId },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
    getPayoutSettings(),
    getResolvedPlans(),
    // Clínicas que HOY pagan: la base de la comisión mensual. Solo id y plan
    // — es un agregado propio, no una lista de clínicas para mirar.
    prisma.clinic
      .findMany({ where: { affiliateId, ...payingClinicWhere() }, select: { id: true, plan: true } })
      .then((rows): PayingClinic[] => rows.map((r) => ({ id: r.id, plan: r.plan })))
      .catch((): PayingClinic[] => []),
  ]);

  const payoutCfg = payoutSettings.cfg;
  const payingIds = payingList.map((c) => c.id);

  // Nombres de clínica para la tabla (AffiliateCommission no tiene relación a
  // Clinic en el schema; se resuelven aparte). Sin dedupe con Set: el target
  // de TS del repo no permite spread de iterables, y `in` con repetidos es
  // igual de válido — pero filtramos para no pedir 8 veces la misma.
  const clinicIds: string[] = [];
  for (const c of recent) if (clinicIds.indexOf(c.clinicId) === -1) clinicIds.push(c.clinicId);

  // Segunda tanda: lo que depende de la primera (los términos congelados) más
  // lo que no cabía en la de arriba.
  const [milestoneProgress, networkBonus, inviter, termsRows, clinics] = await Promise.all([
    // Progreso del bono por clínicas activas. Nunca lanza: degrada a ceros.
    getMilestoneProgress(affiliateId),
    // BONO POR TU RED: las clínicas activas de los afiliados que ÉL INVITÓ. Es
    // otro programa y otro conteo (los bonos propios cuentan las que trajo él),
    // por eso va su propia lectura. Nunca lanza: sin sql/afiliados-bonos-red.sql
    // devuelve `enabled: false` y la tarjeta no se pinta.
    getNetworkBonusPanel(affiliateId),
    // Quién lo invitó, si alguien lo invitó. Se enseña como un dato más: el
    // invitado es un afiliado NORMAL y su invitador no toca ni un peso de sus
    // comisiones, así que no lleva advertencia ninguna. Nunca lanza → null.
    getInviter(affiliateId),
    // Modalidad CONGELADA de cada clínica que paga. Sin motor no hay nada que
    // cruzar y nos ahorramos la query.
    payoutCfg && payingIds.length
      ? prisma.affiliateClinicTerms
          .findMany({ where: { clinicId: { in: payingIds } }, select: { clinicId: true, payoutMode: true } })
          .catch((): FrozenTerms[] => [])
      : Promise.resolve<FrozenTerms[]>([]),
    clinicIds.length
      ? prisma.clinic.findMany({ where: { id: { in: clinicIds } }, select: { id: true, name: true } })
      : Promise.resolve<ClinicName[]>([]),
  ]);

  const clinicNameById = new Map(clinics.map((c) => [c.id, c.name]));

  // Bono por Clínicas Activas: el bloque NO aparece si el admin lo apagó o si
  // no queda ni un escalón utilizable (mismo criterio que la landing pública).
  const milestoneTiersList = payoutSettings.milestones ? milestoneTiers(payoutSettings.milestones) : [];
  const showMilestones =
    payoutSettings.milestones?.milestonesEnabled === true && milestoneTiersList.length > 0;

  const pendingTotal = byStatus.find((g) => g.status === "pending")?._sum.commissionMxn ?? 0;
  const paidTotal = byStatus.find((g) => g.status === "paid")?._sum.commissionMxn ?? 0;
  const accrued = pendingTotal + paidTotal;
  const commissionsCount = byStatus.reduce((acc, g) => acc + g._count._all, 0);

  // Nivel bronce/plata/oro y % vigente (fuera del Promise.all: tiene sus
  // propios try/catch internos y cae a legacy si la tabla de config no existe).
  const levelInfo = await getAffiliateLevelInfo(affiliateId, ctx.affiliate.commissionPct);

  // Motor de comisiones: modo del programa + modalidad vigente del afiliado y
  // los montos reales por plan (labels de plan_configs, montos de la config —
  // ni un precio ni un monto escrito a mano aquí).
  const programMode: ProgramMode = payoutCfg ? payoutCfg.defaultMode : "pct";
  const payoutMode = effectiveAffiliateMode(ctx.affiliate.payoutMode, payoutCfg);
  const amounts: LevelAmountRow[] = payoutCfg
    ? plans.map((p) => ({
        plan: p.id,
        label: p.label,
        recurringMxn: fixedAmountFor(normalizePlanKey(p.id), "recurring", payoutCfg),
        oneTimeMxn: fixedAmountFor(normalizePlanKey(p.id), "onetime", payoutCfg),
      }))
    : [];

  // ── La cifra grande ────────────────────────────────────────────────────
  // Comisión mensual = suma de lo que el programa paga por cada clínica que
  // hoy paga y quedó en modalidad recurrente, con los montos de la config.
  // Es la MISMA función que alimenta /api/afiliados/stats: si aquí y allá
  // contáramos distinto, el afiliado vería dos números suyos que no cuadran.
  const modeByClinic = new Map<string, string>();
  for (const t of termsRows) modeByClinic.set(t.clinicId, t.payoutMode);
  const clinicTerms: Array<{ plan: string | null; mode: PayoutMode }> = [];
  if (payoutCfg) {
    for (const c of payingList) {
      const raw = modeByClinic.get(c.id);
      const mode = raw === undefined ? payoutCfg.defaultPayoutMode : normalizePayoutMode(raw);
      clinicTerms.push({ plan: c.plan, mode });
    }
  }
  const monthlyMxn = payoutCfg ? projectFixedMonthlyMxn(clinicTerms, payoutCfg) : 0;

  // En pago único la comisión NO se repite cada mes: encabezar con un
  // "$X al mes" que siempre daría $0 sería mentir. Ahí la cifra grande es lo
  // acumulado. Mismo criterio si el motor está en % o inactivo.
  const isMonthly = programMode === "fixed" && payoutMode === "recurring";
  const heroValue = isMonthly ? monthlyMxn : accrued;
  const hasEarnings = heroValue > 0;

  // Montos por plan de la modalidad vigente. Un plan en $0 es un plan que el
  // programa apagó: no genera comisión, no se lista.
  const perUnit = payoutMode === "onetime" ? "una vez" : "/mes";
  const planRows = (programMode === "fixed" ? amounts : []).filter(
    (a) => (payoutMode === "onetime" ? a.oneTimeMxn : a.recurringMxn) > 0,
  );
  const planAmount = (a: LevelAmountRow) => (payoutMode === "onetime" ? a.oneTimeMxn : a.recurringMxn);

  return (
    <>
      <PageHead
        title={`Hola, ${ctx.affiliate.name}`}
        sub={
          hasEarnings
            ? `Así va tu cartera al ${new Date().toLocaleDateString("es-MX", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}.`
            : "Tu cuenta de afiliado ya está activa. Todo empieza con el primer link que compartas."
        }
      />

      <div className="dcafp-hero">
        {/* ── Comisión ─────────────────────────────────────────────────── */}
        <PanelCard tight style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="dcafp-cardhead">
            <Eyebrow>{isMonthly ? "Comisión mensual" : "Tus comisiones"}</Eyebrow>
            <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Chip tone={LEVEL_CHIP[levelInfo.level] ?? "neutral"} dot>
                Nivel {LEVEL_LABELS[levelInfo.level]}
              </Chip>
              {programMode === "fixed" ? (
                <Chip tone="brand">{PAYOUT_MODE_LABELS[payoutMode]}</Chip>
              ) : (
                <Chip tone="brand">{levelInfo.pct}% de comisión</Chip>
              )}
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
            <span className={hasEarnings ? "dcafp-bignum" : "dcafp-bignum dcafp-bignum--idle"}>
              {fmtMxn(heroValue)}
            </span>
            <span style={{ fontSize: hasEarnings ? 16 : 13.5, color: "var(--dcafp-ink-3)", fontWeight: 650 }}>
              {hasEarnings
                ? isMonthly
                  ? "al mes"
                  : "acumulado"
                : isMonthly
                  ? "se estrena con tu primera clínica activa"
                  : "tu primera comisión llega cuando una clínica pague"}
            </span>
          </div>

          {/* Sin ganancias todavía, los montos por plan son LA promesa: van en
              rejilla, grandes. Ya con ganancias pasan a una línea de apoyo y
              la cifra real se queda con el protagonismo. */}
          {planRows.length > 0 && !hasEarnings && (
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 650, color: "var(--dcafp-ink-2)", marginBottom: 8 }}>
                {payoutMode === "onetime"
                  ? "Ganas por cada clínica, una sola vez:"
                  : "Ganas por cada clínica, cada mes que siga pagando:"}
              </div>
              <div className="dcafp-plangrid">
                {planRows.map((a) => (
                  <div key={a.plan} className="dcafp-planbox">
                    <div className="dcafp-planbox__k">{a.label}</div>
                    <div className="dcafp-planbox__v">
                      {fmtMxn(planAmount(a))}
                      <span className="dcafp-planbox__u"> {perUnit}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <StatRow>
            <Stat
              label="Clínicas referidas"
              value={referredClinics}
              tone={referredClinics > 0 ? "default" : "idle"}
            />
            <Stat label="Comisión acumulada" value={fmtMxn(accrued)} tone={accrued > 0 ? "default" : "idle"} />
            <Stat
              label="Pendiente de pago"
              value={fmtMxn(pendingTotal)}
              tone={pendingTotal > 0 ? "default" : "idle"}
            />
            <Stat label="Pagado" value={fmtMxn(paidTotal)} tone={paidTotal > 0 ? "ok" : "idle"} />
          </StatRow>

          {planRows.length > 0 && hasEarnings && (
            <div style={{ fontSize: 12.5, color: "var(--dcafp-ink-3)", lineHeight: 1.6 }}>
              Ganas por clínica:{" "}
              {planRows.map((a, i) => (
                <span key={a.plan}>
                  {i > 0 ? " · " : ""}
                  <span className="dcafp-nums" style={{ fontWeight: 700, color: "var(--dcafp-ink)" }}>
                    {a.label} {fmtMxn(planAmount(a))}
                  </span>
                </span>
              ))}
              {payoutMode === "onetime" ? ", una sola vez." : ", cada mes mientras siga pagando."}
            </div>
          )}

          {/* Quién lo invitó. Va aquí, entre sus cifras, porque es un dato de
              su cuenta y no una advertencia: el invitado gana lo mismo que
              cualquier afiliado y su invitador no participa de sus comisiones
              (solo cobra sus propios bonos por red). Decirlo en una línea evita
              la sospecha de que alguien se lleva una parte por encima de él. */}
          {inviter && (
            <div style={{ fontSize: 12.5, color: "var(--dcafp-ink-3)", lineHeight: 1.6 }}>
              Te invitó{" "}
              <span style={{ fontWeight: 700, color: "var(--dcafp-ink)" }}>{inviter.name}</span>. Ganas
              exactamente lo mismo que cualquier afiliado: tu invitador no recibe ninguna parte de tus
              comisiones.
            </div>
          )}
        </PanelCard>

        {/* ── Enlaces ──────────────────────────────────────────────────────
            Sin ganancias todavía, esta tarjeta es LO que hay que hacer: se
            destaca con el borde de marca y la etiqueta "EMPIEZA AQUÍ". En
            cuanto entra la primera comisión deja de gritar. */}
        <PanelCard
          tight
          accent={!hasEarnings}
          tag={!hasEarnings ? "EMPIEZA AQUÍ" : undefined}
          style={{ display: "flex", flexDirection: "column", gap: 11 }}
        >
          <div className="dcafp-cardhead">
            <Eyebrow>Tus enlaces</Eyebrow>
            <CopyCodeButton code={ctx.affiliate.referralCode} />
          </div>
          {/* El link corto se arma en el servidor: link-url.ts (fuente única de
              estas URLs) importa prisma y no puede cruzar al cliente. */}
          <ReferralLinks
            siteUrl={SITE_URL}
            slug={ctx.affiliate.slug}
            referralCode={ctx.affiliate.referralCode}
            shortUrl={baseReferralUrl(ctx.affiliate.referralCode)}
          />
        </PanelCard>
      </div>

      {/* Con el programa en %, la escalera de niveles es información REAL que
          la tarjeta de arriba no muestra (ahí solo cabe el % vigente). Con
          montos fijos los % no aplican y pintarla sería duplicar. */}
      {programMode !== "fixed" && (
        <LevelProgress info={levelInfo} mode={programMode} payoutMode={payoutMode} amounts={amounts} />
      )}

      {/* Bono por Clínicas Activas: su progreso personal (solo conteos, jamás
          datos de las clínicas referidas). */}
      {showMilestones && (
        <MilestonesCard
          tiers={milestoneTiersList}
          progress={milestoneProgress}
          referredClinics={referredClinics}
        />
      )}

      {/* Bono por tu red: BLOQUE APARTE del de arriba. Aquel cuenta las
          clínicas que trajo él; este las de los afiliados que invitó. Fundirlos
          en una sola cifra sería prometer un bono que no le toca. La tarjeta se
          apaga sola si el programa está apagado o falta el SQL. */}
      <NetworkBonusCard panel={networkBonus} />

      {/* ── Comisiones recientes ───────────────────────────────────────── */}
      <PanelCard
        flush
        title="Comisiones recientes"
        sub={
          recent.length > 0
            ? "Cada clínica te genera una comisión al pagar su mensualidad."
            : undefined
        }
      >
        {recent.length === 0 ? (
          <div style={{ padding: "4px 24px 22px" }}>
            <EmptyState
              icon={
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 3.5h10v17l-2.5-1.7-2.5 1.7-2.5-1.7L7 20.5z" />
                  <path d="M10 9.5h4.5" />
                  <path d="M10 13h3" />
                </svg>
              }
              title="Aún no tienes comisiones"
              action={
                <CopyButton
                  text={baseReferralUrl(ctx.affiliate.referralCode)}
                  toast="Link corto copiado"
                  ariaLabel="Copiar mi link corto"
                  label="Copiar mi link corto"
                  variant="outline"
                />
              }
            >
              Cuando una clínica se suscriba con tu enlace y pague su primera mensualidad, tu primera
              comisión aparecerá aquí
              {payoutMode === "onetime"
                ? " — es un solo pago por clínica."
                : " — y se repetirá cada mes mientras la clínica siga activa."}
            </EmptyState>
          </div>
        ) : (
          // Estrechada, la rejilla baja a tres columnas (fecha · clínica ·
          // monto, el reparto del diseño). Tipo y Estado pierden su columna,
          // pero el estado NO se pierde: reaparece como chip bajo el nombre de
          // la clínica. Un "pendiente" que se esconde a 375px es justo el dato
          // por el que se abre un ticket.
          <GridTable
            cols="104px 1fr 130px 104px 96px"
            colsSm="80px 1fr 84px"
            head={
              <>
                <span>Fecha</span>
                <span>Clínica</span>
                <span className="dcafp-col-opt">Tipo</span>
                <span className="dcafp-col-opt">Estado</span>
                <span style={{ textAlign: "right" }}>Monto</span>
              </>
            }
            foot={
              commissionsCount > recent.length
                ? `Mostrando las ${recent.length} más recientes de ${commissionsCount} comisiones.`
                : undefined
            }
          >
            {recent.map((c) => (
              <GridRow key={c.id}>
                <span className="dcafp-td--muted dcafp-nums">{formatDate(c.createdAt)}</span>
                <span style={{ minWidth: 0 }}>
                  <span className="dcafp-td--name" style={{ display: "block" }}>
                    {/* Un BONO POR TU RED no nace de una clínica (su
                        `clinicId` va vacío a propósito): sin este corte esta
                        tabla pintaría una "Clínica" fantasma justo en la fila
                        donde el afiliado espera ver su bono. Mismo criterio que
                        el estado de cuenta, la exportación y el admin. */}
                    {isNetworkBonusKind(c.kind)
                      ? commissionKindLabel(c.kind)
                      : (clinicNameById.get(c.clinicId) ?? "Clínica")}
                  </span>
                  {/* La factura que la originó: sin ella no se puede cuadrar
                      una comisión con el cobro que la generó. Un bono no tiene
                      factura detrás (`amountMxn` = 0), así que en su lugar se
                      dice de dónde salió. */}
                  <span
                    style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", minWidth: 0 }}
                  >
                    <span className="dcafp-nums" style={{ fontSize: 11.5, color: "var(--dcafp-ink-4)" }}>
                      {isNetworkBonusKind(c.kind) ? "bono por tu red" : `factura ${fmtMxn(c.amountMxn)}`}
                    </span>
                    {/* El estado, cuando su columna ya no cabe. */}
                    <span className="dcafp-col-only-sm">
                      <Chip tone={c.status === "paid" ? "ok" : "amber"} sm>
                        {c.status === "paid" ? "Pagada" : "Pendiente"}
                      </Chip>
                    </span>
                  </span>
                </span>
                {/* Cómo se calculó; el anual cubre 12 meses de una sola factura. */}
                <span className="dcafp-col-opt dcafp-td--muted" style={{ fontSize: 12.5, minWidth: 0 }}>
                  {commissionKindLabel(c.kind)}
                  {c.monthsCovered > 1 ? ` · ${c.monthsCovered} meses` : ""}
                </span>
                <span className="dcafp-col-opt" style={{ minWidth: 0 }}>
                  <Chip tone={c.status === "paid" ? "ok" : "amber"} sm>
                    {c.status === "paid" ? "Pagada" : "Pendiente"}
                  </Chip>
                </span>
                <span
                  className="dcafp-nums"
                  style={{
                    textAlign: "right",
                    fontWeight: 750,
                    color: c.status === "paid" ? "var(--dcafp-ok)" : "var(--dcafp-ink)",
                  }}
                >
                  {fmtMxn(c.commissionMxn)}
                </span>
              </GridRow>
            ))}
          </GridTable>
        )}
      </PanelCard>
    </>
  );
}
