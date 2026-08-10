export const dynamic = "force-dynamic";

/**
 * Panel del afiliado — MI RED (antes "Mi equipo").
 *
 * QUÉ CAMBIÓ Y POR QUÉ. Aquí vivía el alta de VENDEDORES con un "% de tu
 * comisión". Ese modelo se retiró: ahora un afiliado INVITA a otros afiliados
 * con un link y el invitado es un afiliado NORMAL e idéntico a él —misma
 * comisión por plan, su propia modalidad, sus propios bonos, y puede invitar a
 * su vez. Quien invita NO cobra un peso de las comisiones de su invitado; su
 * único premio son los BONOS POR RED (@/lib/affiliates/network-bonus).
 *
 * UN SOLO NIVEL. Las clínicas de los invitados de sus invitados no le cuentan,
 * y la página lo dice con todas sus letras: si el afiliado se lo imagina de
 * otra manera, el reclamo llega el día del bono.
 *
 * PRIVACIDAD — REGLA DURA. De cada invitado salen SOLO nombre, fecha y
 * CONTEOS. Jamás su comisión, su modalidad, sus datos de pago, su correo ni un
 * dato de las clínicas que trajo. Es el mismo contrato que ya cumple
 * `getInvitedAffiliates`, y aquí no se le añade ninguna columna "por si acaso".
 *
 * NI UN MONTO NI UN UMBRAL ESCRITO A MANO: los escalones llegan en `panel`
 * (config editable en /admin), los meses de permanencia de SUSTAIN_MONTHS y
 * las mensualidades exigidas de `panel.minPaidInvoices`.
 *
 * DEGRADA SIN 500: con los bonos apagados (o el SQL sin correr) la página
 * sigue sirviendo —el link y la lista de invitados se pintan igual— y solo se
 * omite el bloque de escalones.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAffiliateContext } from "@/lib/affiliate-auth";
import { getInvitedAffiliates, getInviter, inviteUrl } from "@/lib/affiliates/invites";
import { getNetworkBonusPanel } from "@/lib/affiliates/network-bonus";
import { SUSTAIN_MONTHS } from "@/lib/affiliates/network-bonus-core";
import { fmtMxn } from "@/lib/affiliates/public-offer";
import { formatDate } from "@/lib/utils";
import {
  Chip,
  EmptyState,
  Footnote,
  GridRow,
  GridTable,
  Note,
  PageHead,
  PanelCard,
  ProgressBar,
  type ChipTone,
} from "@/components/afiliados/ui/panel-ui";
import { CopyButton } from "@/components/afiliados/ui/copy-button";

/** Lo que se MUESTRA quita el protocolo; lo que se COPIA lo conserva. */
function display(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function clinicsLabel(n: number): string {
  return n === 1 ? "1 clínica" : `${n} clínicas`;
}

function monthsLabel(n: number): string {
  return n === 1 ? "1 mes" : `${n} meses`;
}

function paymentsLabel(n: number): string {
  return n === 1 ? "1 mensualidad pagada" : `${n} mensualidades pagadas`;
}

/**
 * Estado de la cuenta del invitado. Solo se pinta cuando NO está aprobado:
 * es lo único que explica un conteo en 0 sin revelar nada más de él. Un
 * "APPROVED" en cada fila no diría nada y sí llenaría la tabla de ruido.
 */
const STATUS_CHIP: Record<string, { tone: ChipTone; label: string }> = {
  PENDING: { tone: "amber", label: "Cuenta por aprobar" },
  SUSPENDED: { tone: "danger", label: "Cuenta suspendida" },
  REJECTED: { tone: "danger", label: "Cuenta rechazada" },
};

const PEOPLE_ICON = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="9" cy="8" r="3.4" />
    <path d="M3.2 19.5c0-3.2 2.6-5.2 5.8-5.2s5.8 2 5.8 5.2" />
    <path d="M18.5 8.2v5.2" />
    <path d="M21.1 10.8h-5.2" />
  </svg>
);

export default async function MiRedPage() {
  const ctx = await getAffiliateContext();
  if (!ctx) redirect("/afiliados/login");

  const affiliateId = ctx.affiliateId;
  // El link lo arma el SERVIDOR: inviteUrl vive junto a link-url/prisma y no
  // puede cruzar al cliente. Al botón de copiar le llega ya hecho.
  const link = inviteUrl(ctx.affiliate.referralCode);

  const [invited, panel, inviter] = await Promise.all([
    getInvitedAffiliates(affiliateId),
    getNetworkBonusPanel(affiliateId),
    getInviter(affiliateId),
  ]);

  const view = panel.view;
  const minPaid = Math.max(1, Number(panel.minPaidInvoices) || 1);
  // El bloque de escalones se apaga solo: programa apagado, sin escalones
  // utilizables o SQL sin correr. Todo lo demás de la página sigue en pie.
  const showTiers = !!panel.enabled && !!view && view.tiers.length > 0;

  const count = Math.max(0, Number(view?.count) || 0);
  const next = showTiers ? view.next : null;
  const missing = Math.max(0, Number(view?.missing) || 0);
  const top = showTiers ? view.tiers[view.tiers.length - 1] : null;

  // La barra mide contra el escalón que persigue; alcanzados todos, va llena.
  const barMax = next ? next.clinics : top ? top.clinics : 1;
  const barValue = next ? count : barMax;
  // Muescas sobre los escalones ya superados: cada una marca un bono ganado.
  const barMarkers = showTiers
    ? view.tiers.filter((t) => t.clinics < barMax).map((t) => t.clinics)
    : [];

  // El escalón cuya racha ya arrancó: es lo único que explica haber llegado al
  // número y todavía no ver el bono.
  const tracking = showTiers
    ? view.tiers.find((t) => t.award && t.award.status === "tracking" && t.monthsSustained !== null)
    : null;

  // Fecha de otorgamiento por escalón: el snapshot de la vista no la trae.
  const awardedAtByTier = new Map<number, Date | null>(
    (panel.awards ?? []).map((a) => [a.tier, a.awardedAt]),
  );

  // Clínicas activas de la red que aún no llegan a las mensualidades exigidas.
  // Es justo la diferencia por la que se abre un ticket: se explica.
  const shortOfPayments = Math.max(0, Math.max(0, Number(panel.active) || 0) - count);

  const listQualifying = invited.reduce((n, a) => n + a.qualifyingClinics, 0);
  const listActive = invited.reduce((n, a) => n + a.activeClinics, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <PageHead
        title="Mi red"
        sub="Invita a otros afiliados con tu link. Ellos ganan lo mismo que tú por cada clínica y a ti te toca un bono cuando las clínicas activas de tu red llegan a un escalón."
      />

      {/* ── a) Su link de invitación ─────────────────────────────────────── */}
      <PanelCard
        accent
        tag="COMPARTE ESTE LINK"
        title="Tu link de invitación"
        sub="Quien se registre con él entra como afiliado y queda ligado a ti."
      >
        <div className="dcafp-linkhero">
          <div className="dcafp-linkhero__row">
            <code className="dcafp-code dcafp-code--lead" style={{ flex: 1, minWidth: 0 }}>
              {display(link)}
            </code>
            <CopyButton
              text={link}
              toast="Link de invitación copiado"
              ariaLabel="Copiar mi link de invitación"
              label="Copiar"
            />
          </div>
          <div className="dcafp-hint">
            Abre el alta de afiliado con tu código ya puesto. Ojo: este link NO trae clínicas —para
            eso está tu link de referido en{" "}
            <Link href="/afiliados/herramientas" style={{ textDecoration: "underline" }}>
              Herramientas de venta
            </Link>
            .
          </div>
        </div>
      </PanelCard>

      {/* ── b) Sus invitados ─────────────────────────────────────────────── */}
      <PanelCard
        flush
        title="Tus invitados"
        sub={
          invited.length > 0
            ? "De cada uno ves su nombre, desde cuándo está y cuántas de sus clínicas cuentan para tu bono. Nada más: sus comisiones y sus clientes son suyos."
            : undefined
        }
      >
        {invited.length === 0 ? (
          <div style={{ padding: "4px 24px 22px" }}>
            <EmptyState
              icon={PEOPLE_ICON}
              title="Todavía no has invitado a nadie"
              action={
                <CopyButton
                  text={link}
                  toast="Link de invitación copiado"
                  ariaLabel="Copiar mi link de invitación"
                  label="Copiar mi link de invitación"
                  variant="outline"
                />
              }
            >
              Compártelo con quien ya trata con clínicas —vendedores de equipo, consultores,
              proveedores—. Se registra como afiliado, gana exactamente la misma comisión que tú por
              cada clínica que traiga, y sus clínicas activas te acercan a tus bonos por red.
            </EmptyState>
          </div>
        ) : (
          <GridTable
            cols="1fr 130px 110px 120px"
            colsSm="1fr 96px"
            head={
              <>
                <span>Afiliado</span>
                <span className="dcafp-col-opt">Desde</span>
                <span className="dcafp-col-opt" style={{ textAlign: "right" }}>
                  Activas
                </span>
                <span style={{ textAlign: "right" }}>Califican</span>
              </>
            }
            foot={`${invited.length === 1 ? "1 invitado" : `${invited.length} invitados`} · ${listQualifying} de sus ${listActive} clínicas activas ya califican. Una clínica califica al llevar ${paymentsLabel(minPaid)}.`}
          >
            {invited.map((a) => {
              const chip = STATUS_CHIP[a.status];
              return (
                <GridRow key={a.id}>
                  <span style={{ minWidth: 0 }}>
                    <span className="dcafp-td--name" style={{ display: "block" }}>
                      {a.name}
                    </span>
                    <span
                      style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", minWidth: 0 }}
                    >
                      {/* La fecha, cuando su columna ya no cabe. */}
                      <span
                        className="dcafp-col-only-sm dcafp-nums"
                        style={{ fontSize: 11.5, color: "var(--dcafp-ink-4)" }}
                      >
                        desde {formatDate(a.since)}
                      </span>
                      {chip ? (
                        <Chip tone={chip.tone} sm>
                          {chip.label}
                        </Chip>
                      ) : null}
                    </span>
                  </span>
                  <span className="dcafp-col-opt dcafp-td--muted dcafp-nums">{formatDate(a.since)}</span>
                  <span className="dcafp-col-opt dcafp-td--num dcafp-td--muted">{a.activeClinics}</span>
                  <span className="dcafp-td--num">{a.qualifyingClinics}</span>
                </GridRow>
              );
            })}
          </GridTable>
        )}
      </PanelCard>

      {/* ── c) Avance hacia el siguiente escalón ─────────────────────────── */}
      {showTiers ? (
        <PanelCard
          title="Tu bono por red"
          sub="Un pago único cada vez que las clínicas activas de tus invitados llegan a un escalón y se sostienen."
        >
          <div style={{ marginTop: 4, display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
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
              {count === 1
                ? "clínica de tu red que ya califica"
                : "clínicas de tu red que ya califican"}
            </span>
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--dcafp-ink)" }}>
              {next ? (
                <>
                  Vas {count} de {next.clinics}{" "}
                  <span style={{ color: "var(--dcafp-ink-3)", fontWeight: 500 }}>
                    · {missing === 1 ? "te falta 1 para tus" : `te faltan ${missing} para tus`}
                  </span>{" "}
                  <span className="dcafp-nums" style={{ color: "var(--dcafp-brand-deep)", fontWeight: 800 }}>
                    {fmtMxn(next.onceMxn)}
                  </span>
                </>
              ) : (
                <>
                  Tu red alcanzó{" "}
                  {view.tiers.length === 1 ? "el escalón" : `los ${view.tiers.length} escalones`}{" "}
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
                Tu red tiene {clinicsLabel(panel.active)} {panel.active === 1 ? "activa" : "activas"}:{" "}
                {shortOfPayments === 1 ? "1 aún no llega" : `${shortOfPayments} aún no llegan`} a las{" "}
                {paymentsLabel(minPaid)}.
              </div>
            )}
          </div>

          {tracking && (
            <div style={{ marginTop: 14 }}>
              <Note tone="brand">
                Ya estás en el escalón de {clinicsLabel(tracking.clinics)}: llevas{" "}
                {monthsLabel(tracking.monthsSustained)} de {monthsLabel(SUSTAIN_MONTHS)} sosteniéndolo.
                Cuando se cumplan, tu bono de {fmtMxn(tracking.award.onceMxn)} se genera solo.
              </Note>
            </div>
          )}

          {view.awarded.length > 0 && (
            <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--dcafp-ink-2)" }}>
                Bonos por red que ya ganaste
              </div>
              {view.awarded.map((tier) => {
                const at = awardedAtByTier.get(tier.n);
                return (
                  <Note key={tier.n} tone="ok">
                    <span style={{ display: "block", fontWeight: 700 }}>
                      {clinicsLabel(tier.award.clinics)} activas de tu red ·{" "}
                      {fmtMxn(tier.award.onceMxn)}
                    </span>
                    <span style={{ display: "block", marginTop: 3, lineHeight: 1.55 }}>
                      {at ? `Otorgado el ${formatDate(at)}. ` : ""}Ya está generado y se liquida con
                      el resto de tus comisiones. Este escalón queda cerrado: se gana una sola vez.
                    </span>
                  </Note>
                );
              })}
              {view.awardedMxn > 0 && (
                <div style={{ fontSize: 12.5, color: "var(--dcafp-ink-3)", lineHeight: 1.5 }}>
                  Tus bonos por red suman{" "}
                  <span className="dcafp-nums" style={{ fontWeight: 700, color: "var(--dcafp-ink)" }}>
                    {fmtMxn(view.awardedMxn)}
                  </span>
                  , además de tus comisiones.
                </div>
              )}
            </div>
          )}
        </PanelCard>
      ) : (
        <Note tone="warn">
          Los bonos por red no están activos en este momento. Tu link y tus invitados siguen
          funcionando igual: cada uno gana sus propias comisiones desde su primera clínica.
        </Note>
      )}

      {/* ── d) Cómo funciona, sin letra chica ────────────────────────────── */}
      <PanelCard title="Cómo funciona tu red">
        <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 13.5, color: "var(--dcafp-ink-2)", lineHeight: 1.65 }}>
          <p>
            Tus invitados son afiliados normales, iguales a ti: ganan{" "}
            <strong>exactamente la misma comisión</strong> por cada clínica que traen, eligen su
            propia modalidad de cobro y ganan sus propios bonos.{" "}
            <strong>Tú no cobras nada de su comisión</strong> —ni ellos de la tuya—, así que
            invitarlos no le quita un peso a nadie.
          </p>
          <p>
            {showTiers ? (
              <>
                Lo que tú ganas es el <strong>bono por red</strong>: un pago único cuando la suma de
                clínicas activas de tus invitados llega a un escalón y ese número se sostiene{" "}
                {monthsLabel(SUSTAIN_MONTHS)} seguidos. Se cobra por{" "}
                <strong>clínicas activas que pagan</strong> —cada una cuenta al llevar{" "}
                {paymentsLabel(minPaid)}—, nunca por cuánta gente invites: invitados sin clínicas
                activas no generan un peso.
              </>
            ) : (
              <>
                Cuando los bonos por red estén activos, lo que tú ganas es un pago único al llegar a
                un escalón de clínicas activas de tus invitados y sostenerlo{" "}
                {monthsLabel(SUSTAIN_MONTHS)} seguidos. Se cobra por{" "}
                <strong>clínicas activas que pagan</strong> —cada una cuenta al llevar{" "}
                {paymentsLabel(minPaid)}—, nunca por cuánta gente invites.
              </>
            )}
          </p>
          <p>
            Es de <strong>un solo nivel</strong>: cuentan las clínicas de la gente que invitaste tú.
            Si alguien de tu red invita a su vez, esas clínicas cuentan para el bono de él y no
            suben al tuyo.
          </p>
        </div>

        {inviter && (
          <div style={{ marginTop: 14 }}>
            <Note tone="neutral">
              Te invitó {inviter.name} el {formatDate(inviter.since)}. Eso no cambia nada de lo que
              ganas: cobras la misma comisión que cualquier afiliado y {inviter.name} no recibe ni un
              peso de ella.
            </Note>
          </div>
        )}

        <div style={{ marginTop: 14 }}>
          <Footnote>
            Cuentan las clínicas activas que traen tus invitados; las tuyas cuentan para tu propio
            Bono por Clínicas Activas.{" "}
            <Link href="/terminos-afiliados" style={{ textDecoration: "underline" }}>
              Consulta las reglas completas
            </Link>
            .
          </Footnote>
        </div>
      </PanelCard>
    </div>
  );
}
