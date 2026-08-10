// Panel del afiliado — "Bono por tu equipo" (BONOS POR RED).
//
// Bloque SEPARADO del "Bono por Clínicas Activas" y a propósito: aquel cuenta
// las clínicas que trajo ÉL, este las que trajeron SUS VENDEDORES. Son dos
// programas distintos con dos conteos distintos, y fundirlos en una sola cifra
// sería la forma más rápida de que un afiliado reclame un bono que no le toca.
//
// QUÉ SE PREMIA — clínicas ACTIVAS que PAGAN, nunca personas reclutadas. Esa
// distinción gobierna todo el copy de este archivo: se habla de "clínicas de tu
// equipo", jamás de cuánta gente tiene debajo. Es lo que separa un programa de
// ventas de un esquema piramidal, y se sostiene igual aquí, en los términos y
// en la landing.
//
// Server-safe: SIN "use client" (solo render de props). Lo único interactivo es
// elegir la forma de cobro, y eso vive en su propio cliente
// (network-bonus-choice.tsx). Ojo: `fmtMxn` vive en public-offer, que toca
// Prisma → este componente es de SERVIDOR. Es el mismo formateador de la
// landing y del resto del panel, así que los montos se leen igual en las tres.
//
// NI UN MONTO NI UN UMBRAL ESCRITO A MANO: todo llega en `panel`, que sale de
// getNetworkBonusPanel() sobre la config editable en /admin. Los meses de
// permanencia salen de SUSTAIN_MONTHS y las mensualidades exigidas de
// `panel.minPaidInvoices` (MIN_PAID_INVOICES), nunca de un "3" tecleado.
import Link from "next/link";
// Los tipos entran como `import type` para no arrastrar el módulo de BD hasta
// aquí; las constantes puras vienen de -core, que no toca Prisma.
import type { NetworkBonusPanel } from "@/lib/affiliates/network-bonus";
import type { NetworkTierView } from "@/lib/affiliates/network-bonus-core";
import { SUSTAIN_MONTHS } from "@/lib/affiliates/network-bonus-core";
import { fmtMxn } from "@/lib/affiliates/public-offer";
import { PanelCard, ProgressBar, Footnote, Chip, Note } from "./ui/panel-ui";
import { TierPiece, TIER_PIECES } from "./ui/tier-pieces";
import { NetworkBonusChoice } from "./network-bonus-choice";

export interface NetworkBonusCardProps {
  /** Todo lo que hay que pintar, de getNetworkBonusPanel(). */
  panel: NetworkBonusPanel;
}

/** "1 clínica" / "N clínicas" — se repite en media docena de frases. */
function clinicsLabel(n: number): string {
  return n === 1 ? "1 clínica" : `${n} clínicas`;
}

/** "1 mes" / "N meses". */
function monthsLabel(n: number): string {
  return n === 1 ? "1 mes" : `${n} meses`;
}

/** "1 mensualidad pagada" / "N mensualidades pagadas". */
function paymentsLabel(n: number): string {
  return n === 1 ? "1 mensualidad pagada" : `${n} mensualidades pagadas`;
}

/**
 * Monto formateado o cadena VACÍA cuando esa modalidad no se ofrece (monto en
 * 0). La cadena vacía es el contrato con NetworkBonusChoice: es lo que le dice
 * que no pinte ese botón.
 */
function amountLabel(mxn: number): string {
  return Number.isFinite(mxn) && mxn > 0 ? fmtMxn(mxn) : "";
}

export function NetworkBonusCard({ panel }: NetworkBonusCardProps) {
  // El programa apagado, sin escalones utilizables o con el SQL sin correr no
  // pinta nada: mismo criterio que MilestonesCard y que la landing.
  if (!panel?.enabled) return null;
  const view = panel.view;
  if (!view || view.tiers.length === 0) return null;

  const count = Math.max(0, Number(view.count) || 0);
  const active = Math.max(0, Number(panel.active) || 0);
  const attributed = Math.max(0, Number(panel.attributed) || 0);
  const minPaid = Math.max(1, Number(panel.minPaidInvoices) || 1);
  // Clínicas de su equipo que están activas pero todavía no llegan a las
  // mensualidades que exige la cláusula. Es justo la diferencia por la que se
  // abre un ticket, así que se explica en vez de esconderse.
  const shortOfPayments = Math.max(0, active - count);

  const next = view.next;
  const missing = Math.max(0, Number(view.missing) || 0);
  const top = view.tiers[view.tiers.length - 1];

  // La barra mide contra el escalón que persigue; alcanzados todos, va llena.
  const barMax = next ? next.clinics : top.clinics;
  const barValue = next ? count : barMax;

  // Muescas sobre los escalones YA superados: cada una marca dónde se ganó un
  // bono. Persiguiendo el primero no hay ninguna y se reparte en quintos, que
  // es lo que hace el diseño con la barra vacía.
  const barMarkers: number[] = [];
  for (const t of view.tiers) if (t.clinics < barMax) barMarkers.push(t.clinics);

  return (
    <PanelCard
      title="Bono por tu equipo"
      sub="Por las clínicas activas que traen tus vendedores, aparte de lo que ya ganas por las tuyas."
    >
      {/* ── Tu número ────────────────────────────────────────────────────
          El conteo que manda es el de las que YA CALIFICAN. Si aquí saliera el
          bruto de altas de su equipo, la barra diría "20 de 20" con el bono sin
          pagar y el reclamo sería justo. */}
      <div style={{ marginTop: 16, display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span
          className="dcafp-nums"
          style={{
            fontSize: 32,
            fontWeight: 800,
            letterSpacing: "-1px",
            lineHeight: 1,
            color: count > 0 ? "var(--dcafp-ink)" : "var(--dcafp-ink-4)",
          }}
        >
          {count}
        </span>
        <span style={{ fontSize: 14, fontWeight: 650, color: "var(--dcafp-ink-2)" }}>
          {count === 1 ? "clínica de tu equipo que ya califica" : "clínicas de tu equipo que ya califican"}
        </span>
        <span style={{ fontSize: 12.5, color: "var(--dcafp-ink-3)" }}>
          {attributed > 0 ? `· de las ${clinicsLabel(attributed)} que han traído tus vendedores ` : ""}·
          una clínica califica al llevar {paymentsLabel(minPaid)}
        </span>
      </div>

      {/* ── Avance hacia el siguiente escalón ────────────────────────────
          "Tu equipo va 12 de 20 · te faltan 8 para tus $15,000". */}
      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--dcafp-ink)" }}>
          {next ? (
            <>
              Tu equipo va {count} de {next.clinics}{" "}
              <span style={{ color: "var(--dcafp-ink-3)", fontWeight: 500 }}>
                · {missing === 1 ? "te falta 1 para tus" : `te faltan ${missing} para tus`}
              </span>{" "}
              <span className="dcafp-nums" style={{ color: "var(--dcafp-brand-deep)", fontWeight: 800 }}>
                {/* El escalón se anuncia por su pago único cuando lo hay: es la
                    cifra grande. Sin pago único, el mensual ES el bono. */}
                {next.onceMxn > 0 ? fmtMxn(next.onceMxn) : `${fmtMxn(next.monthlyMxn)} al mes`}
              </span>
            </>
          ) : (
            <>
              Tu equipo alcanzó {view.tiers.length === 1 ? "el escalón" : `los ${view.tiers.length} escalones`}{" "}
              <span style={{ color: "var(--dcafp-ink-3)", fontWeight: 500 }}>
                · {clinicsLabel(top.clinics)} es el más alto del programa
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
                ? `Avance de tu equipo hacia el escalón de ${next.clinics} clínicas: ${count} de ${next.clinics}`
                : "Todos los escalones alcanzados"
            }
          />
        </div>
        {shortOfPayments > 0 && (
          <div style={{ marginTop: 8, fontSize: 12.5, color: "var(--dcafp-ink-3)", lineHeight: 1.5 }}>
            Tu equipo tiene {clinicsLabel(active)} {active === 1 ? "activa" : "activas"}:{" "}
            {shortOfPayments === 1 ? "1 aún no llega" : `${shortOfPayments} aún no llegan`} a las{" "}
            {paymentsLabel(minPaid)}.
          </div>
        )}
      </div>

      {/* ── LO QUE ESPERA SU DECISIÓN ────────────────────────────────────
          Va ARRIBA de los escalones y con el borde de marca: mientras no elija,
          el bono NO se paga. Es lo único de todo el bloque que pide una acción
          y por eso es lo más visible. */}
      {view.pending.length > 0 && (
        <div style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 14 }}>
          {view.pending.map((tier) => (
            <PendingAward key={tier.n} tier={tier} />
          ))}
        </div>
      )}

      {/* ── Los escalones ───────────────────────────────────────────────── */}
      <div className="dcafp-autogrid" style={{ marginTop: 24 }}>
        {view.tiers.map((tier, i) => {
          const status = tier.award?.status ?? null;
          // "Conseguido" = el bono ya es suyo (otorgado o elegido). Llegar hoy
          // al umbral NO basta: faltan los meses sostenidos, y pintar la pieza
          // en verde antes de tiempo prometería un bono que aún no existe.
          const won = status !== null && status !== "tracking";
          const isNext = !won && next != null && next.n === tier.n;
          const piece = TIER_PIECES[i] ?? TIER_PIECES[TIER_PIECES.length - 1];
          const cls = ["dcafp-tier", isNext ? "dcafp-tier--next" : "", won ? "dcafp-tier--done" : ""]
            .filter(Boolean)
            .join(" ");

          return (
            <div key={tier.n} className={cls}>
              {isNext && <span className="dcafp-tier__tag">TU SIGUIENTE META</span>}
              <TierPiece kind={piece} done={won} />
              <div className="dcafp-tier__body">
                <div className="dcafp-tier__k">
                  {clinicsLabel(tier.clinics)} de tu equipo
                </div>
                <div className="dcafp-tier__v">
                  {/* Los DOS montos: es entre estos que va a elegir, así que
                      los dos se anuncian desde el primer día. */}
                  {tier.onceMxn > 0 ? fmtMxn(tier.onceMxn) : `${fmtMxn(tier.monthlyMxn)}/mes`}
                </div>
                {tier.onceMxn > 0 && tier.monthlyMxn > 0 && (
                  <div className="dcafp-tier__note">o {fmtMxn(tier.monthlyMxn)} cada mes</div>
                )}
                <TierStatusLine tier={tier} isNext={isNext} missing={missing} />
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Los que ya eligió ────────────────────────────────────────────
          Con su estado y, si está en pausa, QUÉ hacer para recuperarlo. Un
          mensual que dejó de llegar sin explicación es un ticket seguro. */}
      {view.chosen.length > 0 && (
        <div style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--dcafp-ink-2)" }}>
            Tus bonos de equipo
          </div>
          {view.chosen.map((tier) => (
            <ChosenAward key={tier.n} tier={tier} />
          ))}
          {view.monthlyActiveMxn > 0 && (
            <div style={{ fontSize: 12.5, color: "var(--dcafp-ink-3)", lineHeight: 1.5 }}>
              Tus bonos mensuales suman{" "}
              <span className="dcafp-nums" style={{ fontWeight: 700, color: "var(--dcafp-ink)" }}>
                {fmtMxn(view.monthlyActiveMxn)}
              </span>{" "}
              al mes, además de tus comisiones.
            </div>
          )}
        </div>
      )}

      {/* ── Las reglas, con su fuente ─────────────────────────────────── */}
      <div style={{ marginTop: 16 }}>
        <Footnote>
          Cuentan las clínicas activas que trajeron tus vendedores —no las tuyas, que ya cuentan
          para tu propio bono— con {paymentsLabel(minPaid)} cada una y el conteo sostenido{" "}
          {monthsLabel(SUSTAIN_MONTHS)} seguidos. Cada escalón se gana una sola vez, son
          acumulables y eliges cómo cobrarlo también una sola vez.{" "}
          <Link href="/terminos-afiliados" style={{ textDecoration: "underline" }}>
            Consulta las reglas completas
          </Link>
          .
        </Footnote>
      </div>
    </PanelCard>
  );
}

/**
 * Un escalón OTORGADO que espera decisión. Mientras esta tarjeta esté aquí, el
 * afiliado no cobra un peso por ese bono — así que dice exactamente eso, enseña
 * los DOS números y cuántos meses tarda el mensual en superar al único ANTES de
 * poner los botones. Decidir a ciegas sobre algo irreversible no es decidir.
 */
function PendingAward({ tier }: { tier: NetworkTierView }) {
  const award = tier.award;
  if (!award) return null;

  // Los montos CONGELADOS del award, no los vigentes en la config: es lo que se
  // le prometió al otorgarlo y es lo que se le va a pagar.
  const onceMxn = Number(award.onceMxn) || 0;
  const monthlyMxn = Number(award.monthlyMxn) || 0;
  const cmp = tier.comparison;
  const tierLabel = `${clinicsLabel(award.clinics)} activas de tu equipo`;

  return (
    <div
      style={{
        padding: "16px 18px",
        borderRadius: "var(--dcafp-r-box)",
        background: "var(--dcafp-surface)",
        border: "1.5px solid var(--dcafp-brand-300)",
        boxShadow: "var(--dcafp-shadow-tier)",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
        <Chip tone="brand" dot>
          Bono ganado
        </Chip>
        <span style={{ fontSize: 14, fontWeight: 750, color: "var(--dcafp-ink)" }}>
          Tu equipo sostuvo {tierLabel}
        </span>
      </div>

      <div style={{ fontSize: 13.5, color: "var(--dcafp-ink-2)", lineHeight: 1.6 }}>
        El bono ya es tuyo. Falta que elijas cómo lo cobras, y{" "}
        <strong>mientras no elijas no se te paga nada</strong> — no vence ni lo pierdes, pero
        tampoco avanza.
        {cmp.bothAvailable && cmp.monthsToBeat !== null ? (
          <>
            {" "}
            Para que lo compares sin sacar cuentas:{" "}
            {cmp.monthsToMatch === cmp.monthsToBeat ? (
              <>
                el mensual pasa al pago único a partir del mes{" "}
                <strong>{cmp.monthsToBeat}</strong>
              </>
            ) : (
              <>
                el mensual iguala al pago único en el mes <strong>{cmp.monthsToMatch}</strong> y lo
                supera desde el <strong>{cmp.monthsToBeat}</strong>
              </>
            )}
            , y en un año suma{" "}
            <strong className="dcafp-nums">{fmtMxn(cmp.monthlyYearlyMxn)}</strong>. El mensual solo
            corre mientras tu equipo sostenga las {award.clinics}; si baja, se pausa y vuelve solo
            en cuanto lo recuperen.
          </>
        ) : null}
      </div>

      <NetworkBonusChoice
        awardId={award.id}
        tierLabel={tierLabel}
        onceLabel={amountLabel(onceMxn)}
        monthlyLabel={amountLabel(monthlyMxn)}
        monthlyYearlyLabel={fmtMxn(cmp.monthlyYearlyMxn)}
        monthsToMatch={cmp.monthsToMatch}
        monthsToBeat={cmp.monthsToBeat}
      />

      <div style={{ fontSize: 12, color: "var(--dcafp-ink-4)", lineHeight: 1.5 }}>
        La elección es definitiva: se hace una sola vez por escalón y después no se puede cambiar.
      </div>
    </div>
  );
}

/**
 * Un escalón YA elegido. Los tres estados finales dicen cosas distintas y el
 * que más importa es la pausa: es dinero que dejó de llegar, y sin decir POR
 * QUÉ y QUÉ hacer, se lee como un impago.
 */
function ChosenAward({ tier }: { tier: NetworkTierView }) {
  const award = tier.award;
  if (!award) return null;

  const paused = award.status === "monthly_paused";
  const monthlyActive = award.status === "monthly_active";

  return (
    <Note tone={paused ? "warn" : monthlyActive ? "ok" : "neutral"}>
      <span style={{ display: "block", fontWeight: 700 }}>
        {clinicsLabel(award.clinics)} de tu equipo ·{" "}
        {award.status === "once_paid" ? (
          <>pago único de {fmtMxn(award.onceMxn)}</>
        ) : (
          <>{fmtMxn(award.monthlyMxn)} cada mes</>
        )}
      </span>
      <span style={{ display: "block", marginTop: 3, lineHeight: 1.55 }}>
        {award.status === "once_paid" && (
          <>Ya está generado y se liquida con el resto de tus comisiones. Este escalón queda cerrado.</>
        )}
        {monthlyActive && (
          <>
            Se te genera cada mes mientras tu equipo sostenga las {award.clinics} clínicas que
            califican.
          </>
        )}
        {paused && (
          <>
            En pausa: tu equipo bajó de las {award.clinics} clínicas que califican y hoy van{" "}
            {tier.reachedNow ? "de vuelta en el umbral" : `${Math.max(0, award.lastCount)}`}. No lo
            pierdes — en cuanto vuelvan a las {award.clinics}, el mensual se reactiva solo y vuelves
            a cobrarlo.
          </>
        )}
      </span>
    </Note>
  );
}

/**
 * La línea de estado bajo cada escalón de la rejilla. Sin award, dice cuánto
 * falta; con award, en qué va — incluida la racha en curso, que es el único
 * sitio donde el afiliado ve que el reloj de los meses ya arrancó.
 */
function TierStatusLine({
  tier,
  isNext,
  missing,
}: {
  tier: NetworkTierView;
  isNext: boolean;
  missing: number;
}) {
  const award = tier.award;

  if (award && award.status !== "tracking") {
    const tone = award.status === "monthly_paused" ? "amber" : "ok";
    return (
      <span className={`dcafp-chip dcafp-chip--${tone} dcafp-chip--sm`} style={{ marginTop: 5 }}>
        {award.status === "pending_choice"
          ? "Te falta elegir"
          : award.status === "once_paid"
            ? "Cobrado"
            : award.status === "monthly_active"
              ? "Cobrando cada mes"
              : "Mensual en pausa"}
      </span>
    );
  }

  // En racha: cuántos de los meses sostenidos lleva. Es lo que explica que
  // haya llegado al número y todavía no vea el bono.
  if (award && tier.monthsSustained !== null && tier.reachedNow) {
    return (
      <div className="dcafp-tier__note dcafp-tier__note--next">
        Sostenido {tier.monthsSustained} de {SUSTAIN_MONTHS} meses
      </div>
    );
  }

  return (
    <div className={isNext ? "dcafp-tier__note dcafp-tier__note--next" : "dcafp-tier__note"}>
      {isNext ? `Te ${missing === 1 ? "falta 1" : `faltan ${missing}`}` : "Eliges cómo lo cobras"}
    </div>
  );
}
