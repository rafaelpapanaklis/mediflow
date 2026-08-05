// Panel del afiliado — "Bono por Clínicas Activas" como PROGRESO PERSONAL.
//
// Diseño Panel-Afiliado-DaleControl.dc.html: cifra grande de las que YA
// califican, barra con muescas hacia el siguiente escalón, y los tres
// escalones con su pieza 3D. Los estilos viven en panel.css (`dcafp`).
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
// NI UN MONTO ESCRITO A MANO: los umbrales y los importes llegan en `tiers`,
// que sale de la config editable en /admin.
import Link from "next/link";
// payout-core es PURO (sin Prisma); el tipo del progreso entra como `import
// type` para no arrastrar el módulo de BD hasta aquí.
import type { MilestoneTier } from "@/lib/affiliates/payout-core";
import type { MilestoneProgress } from "@/lib/affiliates/milestones-progress";
import { fmtMxn } from "@/lib/affiliates/public-offer";
import { PanelCard, ProgressBar, Footnote } from "./ui/panel-ui";
import { TierPiece, TIER_PIECES } from "./ui/tier-pieces";

export interface MilestonesCardProps {
  /** Escalones vigentes, ya ordenados y sin apagados (milestoneTiers). */
  tiers: MilestoneTier[];
  /** Progreso REAL del afiliado de la sesión (getMilestoneProgress). */
  progress: MilestoneProgress;
  /** Clínicas referidas en total — para explicar la diferencia con las que califican. */
  referredClinics?: number;
}

/** "1 mensualidad pagada" / "N mensualidades pagadas". */
function paymentsLabel(n: number): string {
  return n === 1 ? "1 mensualidad pagada" : `${n} mensualidades pagadas`;
}

export function MilestonesCard({ tiers, progress, referredClinics = 0 }: MilestonesCardProps) {
  // Sin escalones utilizables no hay nada que mostrar. El switch
  // `milestonesEnabled` lo decide la página (misma regla que la landing).
  if (!tiers || tiers.length === 0) return null;

  const qualifying = Math.max(0, Number(progress?.qualifying) || 0);
  const active = Math.max(0, Number(progress?.active) || 0);
  const shortOfPayments = Math.max(0, Number(progress?.shortOfPayments) || 0);
  const minPaid = Math.max(1, Number(progress?.minPaidInvoices) || 1);
  const referred = Math.max(0, Number(referredClinics) || 0);

  // Siguiente escalón = el primero que todavía no alcanza (los tiers ya vienen
  // ascendentes). undefined = los alcanzó todos.
  const next = tiers.find((t) => qualifying < t.clinics);
  const missing = next ? Math.max(0, next.clinics - qualifying) : 0;

  // Suma de lo que ya tiene ganado (acumulables: se cobran todos los alcanzados).
  let earnedMxn = 0;
  let totalMxn = 0;
  for (const t of tiers) {
    if (qualifying >= t.clinics) earnedMxn += t.mxn;
    totalMxn += t.mxn;
  }

  // La barra mide contra el escalón que persigue; alcanzados todos, va llena.
  const barMax = next ? next.clinics : tiers[tiers.length - 1].clinics;
  const barValue = next ? qualifying : barMax;

  // Muescas sobre los escalones YA superados: cada una marca dónde se cobró un
  // bono, así la pista cuenta la historia en vez de dar una escala muda.
  // Persiguiendo el primero no hay ninguno que marcar, y ahí sí se reparte en
  // quintos para que la barra vacía tenga referencia (es lo que hace el diseño
  // en su estado de afiliado nuevo).
  const barMarkers: number[] = [];
  for (const t of tiers) if (t.clinics < barMax) barMarkers.push(t.clinics);

  return (
    <PanelCard
      title="Bono por Clínicas Activas"
      sub="Pagos únicos y acumulables, además de tu comisión mensual."
    >
      {/* ── Tu número ────────────────────────────────────────────────── */}
      <div style={{ marginTop: 16, display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span
          className="dcafp-nums"
          style={{
            fontSize: 32,
            fontWeight: 800,
            letterSpacing: "-1px",
            lineHeight: 1,
            color: qualifying > 0 ? "var(--dcafp-ink)" : "var(--dcafp-ink-4)",
          }}
        >
          {qualifying}
        </span>
        <span style={{ fontSize: 14, fontWeight: 650, color: "var(--dcafp-ink-2)" }}>
          {qualifying === 1 ? "clínica que ya califica" : "clínicas que ya califican"}
        </span>
        {/* La diferencia entre lo referido y lo que califica se EXPLICA, no se
            esconde: es justo el punto donde nacen las discusiones. */}
        <span style={{ fontSize: 12.5, color: "var(--dcafp-ink-3)" }}>
          {referred > 0 ? `· de tus ${referred} referidas ` : ""}· una clínica califica al llevar{" "}
          {paymentsLabel(minPaid)}
        </span>
      </div>

      {/* ── Avance hacia el siguiente escalón ────────────────────────── */}
      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--dcafp-ink)" }}>
          {next ? (
            <>
              Vas {qualifying} de {next.clinics}{" "}
              <span style={{ color: "var(--dcafp-ink-3)", fontWeight: 500 }}>
                · {missing === 1 ? "te falta 1 para tus" : `te faltan ${missing} para tus`}
              </span>{" "}
              <span className="dcafp-nums" style={{ color: "var(--dcafp-brand-deep)", fontWeight: 800 }}>
                {fmtMxn(next.mxn)}
              </span>
            </>
          ) : (
            <>
              Alcanzaste {tiers.length === 1 ? "el bono" : `los ${tiers.length} bonos`}{" "}
              <span className="dcafp-nums" style={{ color: "var(--dcafp-brand-deep)", fontWeight: 800 }}>
                {fmtMxn(totalMxn)}
              </span>{" "}
              <span style={{ color: "var(--dcafp-ink-3)", fontWeight: 500 }}>
                · es el escalón más alto del programa
              </span>
            </>
          )}
        </div>
        <div style={{ marginTop: 8 }}>
          <ProgressBar
            value={barValue}
            max={barMax}
            ticks={5}
            markers={barMarkers.length > 0 ? barMarkers : undefined}
            label={
              next
                ? `Avance hacia el bono de ${fmtMxn(next.mxn)}: ${qualifying} de ${next.clinics} clínicas`
                : "Todos los bonos alcanzados"
            }
          />
        </div>
        {shortOfPayments > 0 && (
          <div style={{ marginTop: 8, fontSize: 12.5, color: "var(--dcafp-ink-3)", lineHeight: 1.5 }}>
            Tienes {active === 1 ? "1 clínica activa" : `${active} clínicas activas`}:{" "}
            {shortOfPayments === 1 ? "1 aún no llega" : `${shortOfPayments} aún no llegan`} a las{" "}
            {paymentsLabel(minPaid)}.
          </div>
        )}
      </div>

      {/* ── Los escalones ───────────────────────────────────────────── */}
      <div className="dcafp-autogrid" style={{ marginTop: 24 }}>
        {tiers.map((tier, i) => {
          const done = qualifying >= tier.clinics;
          const isNext = !done && next != null && next.n === tier.n;
          const piece = TIER_PIECES[i] ?? TIER_PIECES[TIER_PIECES.length - 1];
          const cls = [
            "dcafp-tier",
            isNext ? "dcafp-tier--next" : "",
            done ? "dcafp-tier--done" : "",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <div key={tier.n} className={cls}>
              {isNext && <span className="dcafp-tier__tag">TU SIGUIENTE META</span>}
              <TierPiece kind={piece} done={done} />
              <div className="dcafp-tier__body">
                <div className="dcafp-tier__k">
                  {tier.clinics === 1 ? "1 clínica activa" : `${tier.clinics} clínicas activas`}
                </div>
                <div className="dcafp-tier__v">{fmtMxn(tier.mxn)}</div>
                {done ? (
                  <span className="dcafp-chip dcafp-chip--ok dcafp-chip--sm" style={{ marginTop: 5 }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M4.5 12.5l4.5 4.5 10.5-10.5" />
                    </svg>
                    Conseguido
                  </span>
                ) : (
                  <div className={isNext ? "dcafp-tier__note dcafp-tier__note--next" : "dcafp-tier__note"}>
                    {isNext
                      ? `Pago único · te ${missing === 1 ? "falta 1" : `faltan ${missing}`}`
                      : "Pago único"}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── La condición que más se olvida, con su fuente ─────────────── */}
      {/* Los 3 meses de permanencia son una REGLA publicada, no un campo de la
          config (MilestonesConfig solo guarda umbrales y montos): por eso va
          como texto y enlazada a los términos, igual que en la landing. */}
      <div style={{ marginTop: 16 }}>
        <Footnote>
          El conteo debe sostenerse 3 meses seguidos antes de que el bono se pague. Cada bono se
          entrega una sola vez; los tres se acumulan y son adicionales a tus comisiones mensuales.{" "}
          <Link href="/terminos-afiliados" style={{ textDecoration: "underline" }}>
            Consulta las reglas completas
          </Link>
          .{earnedMxn > 0 ? ` Llevas ${fmtMxn(earnedMxn)} en bonos alcanzados.` : ""}
        </Footnote>
      </div>
    </PanelCard>
  );
}
