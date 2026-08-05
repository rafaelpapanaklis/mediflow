// Panel del afiliado — "Bono por Clínicas Activas" como PROGRESO PERSONAL.
//
// La landing pública anuncia los tres escalones; aquí el afiliado ve DÓNDE va
// él. El número grande es el que CALIFICA (clínicas activas con las
// mensualidades pagadas que exigen los términos), nunca el bruto de altas: si
// la barra dijera "50 de 50" y el bono no se pagara, el reclamo sería justo.
//
// Server-safe: SIN "use client" (solo render de props, sin hooks ni handlers).
// Ojo: `fmtMxn` vive en public-offer, que toca Prisma → este componente es de
// SERVIDOR. Es el mismo formateador que usa /afiliados, así que los montos se
// leen igual en la landing y en el panel.
//
// Estética: coherente con la landing (tres escalones, el mayor en morado) pero
// con los TOKENS del panel (--text-*, --bg-elev-2, --brand-*), no con los hex
// claros de la página pública. Nada de las escenas 3D ni de los IconoHito de
// la landing: sus animaciones dependen de keyframes de afiliados.css, que el
// panel no importa — se verían estáticos y rotos.
import Link from "next/link";
import { Award, CheckCircle2, Sparkles, Trophy, type LucideIcon } from "lucide-react";
import { CardNew } from "@/components/ui/design-system/card-new";
// payout-core es PURO (sin Prisma); el tipo del progreso entra como `import
// type` para no arrastrar el módulo de BD hasta aquí.
import type { MilestoneTier } from "@/lib/affiliates/payout-core";
import type { MilestoneProgress } from "@/lib/affiliates/milestones-progress";
import { fmtMxn } from "@/lib/affiliates/public-offer";

export interface MilestonesCardProps {
  /** Escalones vigentes, ya ordenados y sin apagados (milestoneTiers). */
  tiers: MilestoneTier[];
  /** Progreso REAL del afiliado de la sesión (getMilestoneProgress). */
  progress: MilestoneProgress;
}

/** Un ícono por escalón; el último se queda con el trofeo. */
const TIER_ICONS: LucideIcon[] = [Sparkles, Award, Trophy];

/** "1 clínica" / "N clínicas" — el español correcto importa en un panel de trabajo. */
function clinicsLabel(n: number): string {
  return n === 1 ? "1 clínica" : `${n} clínicas`;
}

/** "3 mensualidades pagadas" / "1 mensualidad pagada". */
function paymentsLabel(n: number): string {
  return n === 1 ? "1 mensualidad pagada" : `${n} mensualidades pagadas`;
}

export function MilestonesCard({ tiers, progress }: MilestonesCardProps) {
  // Sin escalones utilizables no hay nada que mostrar. El switch
  // `milestonesEnabled` lo decide la página (misma regla que la landing).
  if (!tiers || tiers.length === 0) return null;

  const qualifying = Math.max(0, Number(progress?.qualifying) || 0);
  const active = Math.max(0, Number(progress?.active) || 0);
  const shortOfPayments = Math.max(0, Number(progress?.shortOfPayments) || 0);
  const minPaid = Math.max(1, Number(progress?.minPaidInvoices) || 1);

  // Siguiente escalón = el primero que todavía no alcanza (los tiers ya vienen
  // ascendentes). undefined = los alcanzó todos.
  const next = tiers.find((t) => qualifying < t.clinics);
  const achievedCount = tiers.filter((t) => qualifying >= t.clinics).length;
  const allDone = !next;

  // Suma de lo que ya tiene ganado (acumulables: se cobran todos los alcanzados).
  let earnedMxn = 0;
  for (const t of tiers) if (qualifying >= t.clinics) earnedMxn += t.mxn;
  let totalMxn = 0;
  for (const t of tiers) totalMxn += t.mxn;

  const missing = next ? Math.max(0, next.clinics - qualifying) : 0;
  const progressPct = next
    ? Math.min(100, Math.max(0, (qualifying / next.clinics) * 100))
    : 100;

  return (
    <CardNew
      title="Bono por Clínicas Activas"
      sub="Un pago extra, además de tus comisiones mensuales, cuando tu cartera crece."
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* ── Tu número + avance hacia el siguiente escalón ─────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: 10 }}>
            <span
              className="mono"
              style={{
                fontSize: 34,
                fontWeight: 700,
                lineHeight: 1,
                letterSpacing: "-0.02em",
                color: "var(--text-1)",
              }}
            >
              {qualifying}
            </span>
            <span style={{ fontSize: 13, color: "var(--text-2)" }}>
              {qualifying === 1 ? "clínica que ya califica" : "clínicas que ya califican"}
            </span>
            {achievedCount > 0 && (
              <span
                style={{
                  marginLeft: "auto",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "3px 10px",
                  borderRadius: 999,
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--success)",
                  background: "rgba(16,185,129,0.12)",
                  border: "1px solid rgba(16,185,129,0.32)",
                  whiteSpace: "nowrap",
                }}
              >
                <CheckCircle2 size={13} aria-hidden />
                {achievedCount === 1 ? "1 bono conseguido" : `${achievedCount} bonos conseguidos`} ·{" "}
                {fmtMxn(earnedMxn)}
              </span>
            )}
          </div>

          {allDone ? (
            // Estado final: nada de una barra llena y muda. Se le dice qué logró.
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "14px 16px",
                borderRadius: 12,
                background: "var(--brand-soft)",
                border: "1px solid var(--border-brand)",
              }}
            >
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  flexShrink: 0,
                  display: "grid",
                  placeItems: "center",
                  color: "#fff",
                  background: "var(--brand-grad)",
                }}
              >
                <Trophy size={18} aria-hidden />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)" }}>
                  Alcanzaste {tiers.length === 1 ? "el bono" : `los ${tiers.length} bonos`} ·{" "}
                  {fmtMxn(totalMxn)}
                </div>
                <div style={{ fontSize: 12.5, color: "var(--text-3)", marginTop: 3, lineHeight: 1.5 }}>
                  Es el escalón más alto del programa. Tus comisiones mensuales siguen corriendo igual
                  mientras tus clínicas sigan activas.
                </div>
              </div>
            </div>
          ) : (
            <>
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={next.clinics}
                aria-valuenow={Math.min(qualifying, next.clinics)}
                aria-label={`Avance hacia el bono de ${fmtMxn(next.mxn)}`}
                style={{
                  height: 10,
                  borderRadius: 999,
                  background: "var(--bg-elev-2)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${progressPct}%`,
                    borderRadius: 999,
                    background: "var(--brand-grad)",
                  }}
                />
              </div>
              <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.5 }}>
                Vas <strong style={{ color: "var(--text-1)" }}>{qualifying}</strong> de{" "}
                <strong style={{ color: "var(--text-1)" }}>{next.clinics}</strong> ·{" "}
                {missing === 1 ? "te falta 1 clínica" : `te faltan ${missing} clínicas`} para tus{" "}
                <strong style={{ color: "var(--violet-400)" }}>{fmtMxn(next.mxn)}</strong>
              </div>
            </>
          )}

          {/* La diferencia entre activas y las que califican se EXPLICA, no se
              esconde: es justo el punto donde nacen las discusiones. */}
          {shortOfPayments > 0 ? (
            <div style={{ fontSize: 12.5, color: "var(--text-3)", lineHeight: 1.5 }}>
              {clinicsLabel(active)} {active === 1 ? "activa" : "activas"} ·{" "}
              {qualifying === 1 ? "1 ya califica" : `${qualifying} ya califican`} ·{" "}
              {shortOfPayments === 1 ? "1 aún no llega" : `${shortOfPayments} aún no llegan`} a las{" "}
              {paymentsLabel(minPaid)}.
            </div>
          ) : active > 0 ? (
            <div style={{ fontSize: 12.5, color: "var(--text-3)", lineHeight: 1.5 }}>
              {active === 1
                ? `Tu clínica activa ya califica: lleva al menos ${paymentsLabel(minPaid)}.`
                : `Tus ${active} clínicas activas ya califican: todas llevan al menos ${paymentsLabel(minPaid)}.`}
            </div>
          ) : (
            <div style={{ fontSize: 12.5, color: "var(--text-3)", lineHeight: 1.5 }}>
              Cuenta cada clínica activa con al menos {paymentsLabel(minPaid)}.
            </div>
          )}
        </div>

        {/* ── Los escalones ─────────────────────────────────────────────── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 168px), 1fr))",
            gap: 10,
          }}
        >
          {tiers.map((tier, i) => {
            // El escalón mayor es el último (mismo criterio que la landing) y
            // es el único que se lleva el morado.
            const isTop = i === tiers.length - 1;
            const done = qualifying >= tier.clinics;
            const isNext = !done && next != null && next.n === tier.n;
            const Icon = TIER_ICONS[i] ?? Trophy;

            const accent = done
              ? "var(--success)"
              : isTop
                ? "var(--violet-400)"
                : "var(--text-2)";
            const border = done
              ? "1px solid rgba(16,185,129,0.32)"
              : isTop || isNext
                ? "1px solid var(--border-brand)"
                : "1px solid var(--border-soft)";

            return (
              <div
                key={tier.n}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  padding: "13px 14px",
                  borderRadius: 12,
                  border,
                  background: isTop ? "var(--brand-soft)" : "var(--bg-elev-2)",
                  opacity: done || isNext || isTop ? 1 : 0.82,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <span style={{ color: accent, display: "inline-flex" }}>
                    {done ? <CheckCircle2 size={16} aria-hidden /> : <Icon size={16} aria-hidden />}
                  </span>
                  <span style={{ fontSize: 12.5, color: "var(--text-2)" }}>
                    {clinicsLabel(tier.clinics)} {tier.clinics === 1 ? "activa" : "activas"}
                  </span>
                </div>

                <span
                  className="mono"
                  style={{
                    fontSize: isTop ? 24 : 21,
                    fontWeight: 700,
                    letterSpacing: "-0.02em",
                    lineHeight: 1.1,
                    color: isTop ? "var(--violet-400)" : "var(--text-1)",
                    overflowWrap: "anywhere",
                  }}
                >
                  {fmtMxn(tier.mxn)}
                </span>

                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: ".02em",
                    color: done ? "var(--success)" : isNext ? "var(--violet-400)" : "var(--text-3)",
                  }}
                >
                  {done ? "Conseguido" : isNext ? "Tu siguiente meta" : "Pago único"}
                </span>
              </div>
            );
          })}
        </div>

        {/* ── La condición que más se olvida, con su fuente ──────────────── */}
        {/* Los 3 meses de permanencia son una REGLA publicada, no un campo de
            la config (MilestonesConfig solo guarda umbrales y montos): por eso
            va como texto y enlazada a los términos, igual que en la landing. */}
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-3)", lineHeight: 1.55 }}>
          Tu conteo tiene que sostenerse 3 meses seguidos antes de que el bono se pague, y cada bono se
          entrega una sola vez. Los bonos son adicionales a tus comisiones mensuales, que siguen
          corriendo.{" "}
          <Link
            href="/terminos-afiliados"
            style={{ color: "var(--violet-400)", textDecoration: "underline" }}
          >
            Consulta las reglas completas
          </Link>
          .
        </p>
      </div>
    </CardNew>
  );
}
