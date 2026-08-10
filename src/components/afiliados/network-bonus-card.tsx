// Panel del afiliado — "Bono por tu red" (BONOS POR RED).
//
// Bloque SEPARADO del "Bono por Clínicas Activas" y a propósito: aquel cuenta
// las clínicas que trajo ÉL, este las de LOS AFILIADOS QUE INVITÓ. Son dos
// programas distintos con dos conteos distintos, y fundirlos en una sola cifra
// sería la forma más rápida de que un afiliado reclame un bono que no le toca.
//
// EL MODELO (ago 2026) — un afiliado invita a otro y el invitado es un afiliado
// NORMAL e idéntico: misma comisión, su propia modalidad, sus propios bonos.
// Quien invita NO cobra un peso de las comisiones de su invitado; su único
// premio son estos escalones. UN SOLO NIVEL: las clínicas de los invitados de
// sus invitados no le cuentan. Y se cobran en PAGO ÚNICO, que se genera solo al
// cumplirse la racha — no hay elección que hacer ni modalidad mensual (se
// retiró entera, junto con la pantalla que la elegía).
//
// QUÉ SE PREMIA — clínicas ACTIVAS que PAGAN, nunca personas invitadas. Esa
// distinción gobierna todo el copy de este archivo: se habla de "clínicas de tu
// red", jamás de cuánta gente tiene debajo. Es lo que separa un programa de
// ventas de un esquema piramidal, y se sostiene igual aquí, en los términos y
// en la landing.
//
// Server-safe: SIN "use client" (solo render de props; ya no queda nada
// interactivo en el bloque). Ojo: `fmtMxn` vive en public-offer, que toca
// Prisma → este componente es de SERVIDOR. Es el mismo formateador de la
// landing y del resto del panel, así que los montos se leen igual en las tres.
//
// NI UN MONTO NI UN UMBRAL ESCRITO A MANO: todo llega en `panel`, que sale de
// getNetworkBonusPanel() sobre la config editable en /admin. Los meses de
// permanencia salen de SUSTAIN_MONTHS y las mensualidades exigidas de
// `panel.minPaidInvoices` (MIN_PAID_INVOICES), nunca de un "3" tecleado.
import Link from "next/link";
import { formatDate } from "@/lib/utils";
// Los tipos entran como `import type` para no arrastrar el módulo de BD hasta
// aquí; las constantes puras vienen de -core, que no toca Prisma.
import type { NetworkBonusPanel } from "@/lib/affiliates/network-bonus";
import type { NetworkTierView } from "@/lib/affiliates/network-bonus-core";
import { SUSTAIN_MONTHS, NETWORK_AWARD_STATUS_LABELS } from "@/lib/affiliates/network-bonus-core";
import { fmtMxn } from "@/lib/affiliates/public-offer";
import { PanelCard, ProgressBar, Footnote, Note } from "./ui/panel-ui";
import { TierPiece, TIER_PIECES } from "./ui/tier-pieces";

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

/** "1 afiliado" / "N afiliados" — la gente que invitó, siempre como contexto. */
function affiliatesLabel(n: number): string {
  return n === 1 ? "1 afiliado" : `${n} afiliados`;
}

export function NetworkBonusCard({ panel }: NetworkBonusCardProps) {
  // El programa apagado, sin escalones utilizables o con el SQL sin correr no
  // pinta nada: mismo criterio que MilestonesCard y que la landing.
  if (!panel?.enabled) return null;
  const view = panel.view;
  if (!view || view.tiers.length === 0) return null;

  const count = Math.max(0, Number(view.count) || 0);
  const invited = Math.max(0, Number(panel.invited) || 0);
  const active = Math.max(0, Number(panel.active) || 0);
  const attributed = Math.max(0, Number(panel.attributed) || 0);
  const minPaid = Math.max(1, Number(panel.minPaidInvoices) || 1);
  // Clínicas de su red que están activas pero todavía no llegan a las
  // mensualidades que exige la cláusula. Es justo la diferencia por la que se
  // abre un ticket, así que se explica en vez de esconderse.
  const shortOfPayments = Math.max(0, active - count);

  const next = view.next;
  const missing = Math.max(0, Number(view.missing) || 0);
  const top = view.tiers[view.tiers.length - 1];

  // Cuándo se otorgó cada escalón. El snapshot que viaja en `tier.award` no
  // trae fechas (solo lo que necesita la matemática), así que salen de las
  // filas completas de `panel.awards`, cruzadas por número de escalón.
  const awardedAtByTier = new Map<number, Date | null>();
  for (const a of panel.awards ?? []) awardedAtByTier.set(a.tier, a.awardedAt ?? a.paidAt ?? null);

  // La barra mide contra el escalón que persigue; alcanzados todos, va llena.
  const barMax = next ? next.clinics : top.clinics;
  const barValue = next ? count : barMax;

  // Muescas sobre los escalones YA superados: cada una marca dónde se ganó un
  // bono. Persiguiendo el primero no hay ninguna y se reparte en quintos, que
  // es lo que hace el diseño con la barra vacía.
  const barMarkers: number[] = [];
  for (const t of view.tiers) if (t.clinics < barMax) barMarkers.push(t.clinics);

  // De dónde salen las clínicas del conteo, en una línea gris: sin esto, un
  // afiliado con invitados y el número en 0 no tiene forma de saber por qué.
  const sourceNote =
    invited > 0
      ? attributed > 0
        ? `· de las ${clinicsLabel(attributed)} que han traído tus ${affiliatesLabel(invited)} `
        : `· invitaste a ${affiliatesLabel(invited)} `
      : "";

  return (
    <PanelCard
      title="Bono por tu red"
      sub="Por las clínicas activas de los afiliados que invitaste, aparte de lo que ya ganas por las tuyas."
    >
      {/* ── Sin nadie invitado, el bloque explica CÓMO se empieza ─────────
          Un cero con una barra vacía no dice qué hacer; el link de invitación
          sí, y de paso deja claro que invitar no le quita nada al invitado. */}
      {invited === 0 && (
        <div style={{ marginTop: 16 }}>
          <Note tone="brand">
            <span style={{ display: "block", fontWeight: 700 }}>Todavía no has invitado a nadie</span>
            <span style={{ display: "block", marginTop: 3, lineHeight: 1.55 }}>
              Este bono empieza a contar cuando invitas a otro afiliado y las clínicas que él trae se
              activan. Tu link de invitación está en{" "}
              <Link href="/afiliados/equipo" style={{ textDecoration: "underline", fontWeight: 650 }}>
                tu sección de invitaciones
              </Link>
              . Quien entra con él es un afiliado normal: gana sus propias comisiones completas y tú
              cobras aparte, solo estos escalones.
            </span>
          </Note>
        </div>
      )}

      {/* ── Tu número ────────────────────────────────────────────────────
          El conteo que manda es el de las que YA CALIFICAN. Si aquí saliera el
          bruto de altas de su red, la barra diría "20 de 20" con el bono sin
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
          {count === 1 ? "clínica de tu red que ya califica" : "clínicas de tu red que ya califican"}
        </span>
        <span style={{ fontSize: 12.5, color: "var(--dcafp-ink-3)" }}>
          {sourceNote}· una clínica califica al llevar {paymentsLabel(minPaid)}
        </span>
      </div>

      {/* ── Avance hacia el siguiente escalón ────────────────────────────
          "Tu red va 12 de 20 · te faltan 8 para tus $15,000". */}
      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--dcafp-ink)" }}>
          {next ? (
            <>
              Tu red va {count} de {next.clinics}{" "}
              <span style={{ color: "var(--dcafp-ink-3)", fontWeight: 500 }}>
                · {missing === 1 ? "te falta 1 para tus" : `te faltan ${missing} para tus`}
              </span>{" "}
              <span className="dcafp-nums" style={{ color: "var(--dcafp-brand-deep)", fontWeight: 800 }}>
                {fmtMxn(next.onceMxn)}
              </span>
            </>
          ) : (
            <>
              Tu red alcanzó {view.tiers.length === 1 ? "el escalón" : `los ${view.tiers.length} escalones`}{" "}
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
                ? `Avance de tu red hacia el escalón de ${next.clinics} clínicas: ${count} de ${next.clinics}`
                : "Todos los escalones alcanzados"
            }
          />
        </div>
        {shortOfPayments > 0 && (
          <div style={{ marginTop: 8, fontSize: 12.5, color: "var(--dcafp-ink-3)", lineHeight: 1.5 }}>
            Tu red tiene {clinicsLabel(active)} {active === 1 ? "activa" : "activas"}:{" "}
            {shortOfPayments === 1 ? "1 aún no llega" : `${shortOfPayments} aún no llegan`} a las{" "}
            {paymentsLabel(minPaid)}.
          </div>
        )}
      </div>

      {/* ── El alcance, dicho antes de que lo pregunte ───────────────────
          Las dos cosas que un afiliado asume mal de un segundo nivel: que baja
          más de un salto y que se paga por gente. Ni una ni otra. */}
      <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--dcafp-ink-3)", lineHeight: 1.55 }}>
        Un solo nivel: cuentan las clínicas de los afiliados que invitaste tú, no las de los invitados
        de ellos. Y se paga por clínicas activas que pagan —{paymentsLabel(minPaid)} cada una y el
        conteo sostenido {monthsLabel(SUSTAIN_MONTHS)} seguidos—, nunca por cuánta gente invites.
      </div>

      {/* ── Los escalones ───────────────────────────────────────────────── */}
      <div className="dcafp-autogrid" style={{ marginTop: 24 }}>
        {view.tiers.map((tier, i) => {
          // "Conseguido" = el bono ya se otorgó. Llegar hoy al umbral NO basta:
          // faltan los meses sostenidos, y pintar la pieza en dorado antes de
          // tiempo prometería un bono que aún no existe.
          const won = tier.award?.status === "awarded";
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
                <div className="dcafp-tier__k">{clinicsLabel(tier.clinics)} de tu red</div>
                {/* Un solo monto: el pago único es la única forma de cobro. */}
                <div className="dcafp-tier__v">{fmtMxn(tier.onceMxn)}</div>
                <TierStatusLine tier={tier} isNext={isNext} missing={missing} />
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Los que ya ganó ──────────────────────────────────────────────
          Con su monto congelado y la fecha: es lo que el afiliado cruza contra
          su estado de cuenta cuando el depósito no cuadra con lo que esperaba. */}
      {view.awarded.length > 0 && (
        <div style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--dcafp-ink-2)" }}>
            Tus bonos por red
          </div>
          {view.awarded.map((tier) => (
            <AwardedTier key={tier.n} tier={tier} awardedAt={awardedAtByTier.get(tier.n) ?? null} />
          ))}
          {view.awardedMxn > 0 && (
            <div style={{ fontSize: 12.5, color: "var(--dcafp-ink-3)", lineHeight: 1.5 }}>
              Llevas{" "}
              <span className="dcafp-nums" style={{ fontWeight: 700, color: "var(--dcafp-ink)" }}>
                {fmtMxn(view.awardedMxn)}
              </span>{" "}
              generados en bonos por red, además de tus comisiones.
            </div>
          )}
        </div>
      )}

      {/* ── Las reglas, con su fuente ─────────────────────────────────── */}
      <div style={{ marginTop: 16 }}>
        <Footnote>
          Cuentan las clínicas activas de los afiliados que invitaste —no las tuyas, que ya cuentan
          para tu propio bono—. Cada escalón se gana una sola vez, son acumulables y se cobran en un
          pago único que se genera solo al cumplirse la racha: no tienes que pedirlo. Tus invitados
          son afiliados normales y tú no recibes ninguna parte de sus comisiones.{" "}
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
 * Un escalón YA OTORGADO. No hay nada que decidir ni nada que esperar: el bono
 * se ganó, su comisión se generó en la misma operación y entra al siguiente
 * corte. Lo único que importa aquí es el monto que se congeló y cuándo.
 */
function AwardedTier({ tier, awardedAt }: { tier: NetworkTierView; awardedAt: Date | null }) {
  const award = tier.award;
  if (!award) return null;

  return (
    <Note tone="ok">
      <span style={{ display: "block", fontWeight: 700 }}>
        {clinicsLabel(award.clinics)} de tu red · pago único de{" "}
        <span className="dcafp-nums">{fmtMxn(award.onceMxn)}</span>
      </span>
      <span style={{ display: "block", marginTop: 3, lineHeight: 1.55 }}>
        {awardedAt ? `Otorgado el ${formatDate(awardedAt)}. ` : ""}Tu comisión ya está generada y se
        liquida con el resto en tu próximo corte de pago. Este escalón queda cerrado: se gana una sola
        vez y no se pierde aunque tu red baje.
      </span>
    </Note>
  );
}

/**
 * La línea de estado bajo cada escalón de la rejilla. Solo hay dos estados
 * vivos —contando la racha y otorgado—, así que solo se dicen esos dos. Sin
 * award, dice cuánto falta; en racha, cuántos meses lleva, que es el único
 * sitio donde el afiliado ve que el reloj ya arrancó.
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

  if (award && award.status === "awarded") {
    return (
      <span className="dcafp-chip dcafp-chip--ok dcafp-chip--sm" style={{ marginTop: 5 }}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M4.5 12.5l4.5 4.5 10.5-10.5" />
        </svg>
        {NETWORK_AWARD_STATUS_LABELS.awarded}
      </span>
    );
  }

  // En racha: cuántos de los meses sostenidos lleva. Es lo que explica que haya
  // llegado al número y todavía no vea el bono.
  if (award && tier.monthsSustained !== null && tier.reachedNow) {
    return (
      <div className="dcafp-tier__note dcafp-tier__note--next">
        Sostenido {tier.monthsSustained} de {SUSTAIN_MONTHS} meses
      </div>
    );
  }

  return (
    <div className={isNext ? "dcafp-tier__note dcafp-tier__note--next" : "dcafp-tier__note"}>
      {isNext ? `Pago único · te ${missing === 1 ? "falta 1" : `faltan ${missing}`}` : "Pago único"}
    </div>
  );
}
