"use client";

import { useEffect, useState } from "react";
import {
  Building2,
  CalendarCheck,
  Contact,
  KeyRound,
  ListTodo,
  Percent,
  TriangleAlert,
  Users,
} from "lucide-react";
import type { OffboardImpact, OffboardResult, RealtyMemberRow } from "@/lib/realty/team";
import { REALTY_ROLE_LABELS } from "@/lib/realty/types";
import { formatMoney } from "@/lib/realty/commissions";
import { apiCall, Banner, Btn, ErrorText, Modal, plural, Select, styles as s, useSaving } from "./ui";

// ═══════════════════════════════════════════════════════════════════════
// BAJA DE UN ASESOR — la pantalla que enseña TODO antes de confirmar.
//
// Una baja a ciegas es cómo se pierde una cartera: los inmuebles se quedan
// sin dueño en el panel, los prospectos dejan de contestarse y nadie se
// entera hasta que un cliente reclama. Por eso aquí se cuenta qué hay
// colgando de esa persona y se decide en el MISMO paso a quién se le pasa.
//
// La regla de negocio la ejecuta el servidor (src/lib/realty/team.ts). Esta
// pantalla la EXPLICA con las mismas palabras, para que nadie confirme algo
// que no entendió.
// ═══════════════════════════════════════════════════════════════════════

const SIN_ASESOR = "__sin_asesor__";

export function OffboardModal({
  member,
  onClose,
  onDone,
}: {
  member: RealtyMemberRow;
  onClose: () => void;
  onDone: (result: OffboardResult) => void;
}) {
  const { saving, error, setError, run } = useSaving();
  const [impact, setImpact] = useState<OffboardImpact | null>(null);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<string>(SIN_ASESOR);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    let alive = true;
    apiCall<OffboardImpact>(`/api/realty/team/${member.id}/baja`)
      .then((data) => {
        if (!alive) return;
        setImpact(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : "No pudimos calcular la baja.");
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [member.id, setError]);

  async function confirm() {
    await run(async () => {
      const result = await apiCall<OffboardResult>(`/api/realty/team/${member.id}/baja`, {
        method: "POST",
        json: { reassignToUserId: target === SIN_ASESOR ? null : target },
      });
      onDone(result);
    });
  }

  const nothingPending =
    impact !== null &&
    impact.properties === 0 &&
    impact.leads === 0 &&
    impact.contacts === 0 &&
    impact.upcomingVisits === 0 &&
    impact.openTasks === 0;

  return (
    <Modal
      wide
      title={`Dar de baja a ${member.fullName}`}
      subtitle={`${REALTY_ROLE_LABELS[member.role]} · ${member.email}`}
      onClose={onClose}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Btn>
          <Btn
            variant="danger"
            onClick={confirm}
            disabled={saving || loading || impact === null || !confirmed}
          >
            {saving ? "Dando de baja…" : "Confirmar la baja"}
          </Btn>
        </>
      }
    >
      <ErrorText>{error}</ErrorText>

      {loading ? (
        <p className={s.hint}>Contando lo que trae esta persona…</p>
      ) : impact === null ? null : (
        <>
          {/* ── 1. El conteo, en una frase que se entiende sola ── */}
          {nothingPending ? (
            <Banner icon={<Users size={16} />}>
              {member.fullName} no trae inmuebles, prospectos ni visitas colgando. La baja no le
              mueve nada a nadie.
            </Banner>
          ) : (
            <Banner tone="warn" title="Esto es lo que trae" icon={<TriangleAlert size={16} />}>
              {member.fullName} tiene {plural(impact.properties, "inmueble", "inmuebles")},{" "}
              {plural(impact.upcomingVisits, "visita agendada", "visitas agendadas")} y{" "}
              {plural(impact.activeLeads, "prospecto activo", "prospectos activos")}. ¿A quién se
              los paso?
            </Banner>
          )}

          <div className={s.kpis}>
            <Stat icon={<Building2 size={15} />} label="Inmuebles" value={impact.properties} hint={`${impact.publishedProperties} publicados`} />
            <Stat icon={<Users size={15} />} label="Prospectos activos" value={impact.activeLeads} hint={`${impact.leads} en total`} />
            <Stat icon={<CalendarCheck size={15} />} label="Visitas por venir" value={impact.upcomingVisits} />
            <Stat icon={<Contact size={15} />} label="Contactos" value={impact.contacts} />
            <Stat icon={<ListTodo size={15} />} label="Pendientes abiertos" value={impact.openTasks} />
            <Stat icon={<KeyRound size={15} />} label="Llaves sin devolver" value={impact.keysOut} />
          </div>

          {/* ── 2. A quién se le pasa ── */}
          <div className={s.field}>
            <label className={s.label} htmlFor="realty-offboard-target">
              ¿A quién le paso su cartera?
            </label>
            <Select
              id="realty-offboard-target"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              disabled={saving}
            >
              <option value={SIN_ASESOR}>Dejarlos sin asesor (bandeja general)</option>
              {impact.candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.fullName} · {REALTY_ROLE_LABELS[c.role]}
                </option>
              ))}
            </Select>
            <p className={s.hint}>
              {target === SIN_ASESOR
                ? "Los inmuebles quedan en la cartera SIN asesor y los prospectos caen en la bandeja general, hasta que alguien los reparta."
                : "Se le pasan los inmuebles, los prospectos, los contactos, las visitas por venir y los pendientes abiertos."}
            </p>
          </div>

          {/* ── 3. Qué pasa exactamente. Sin letra chica. ── */}
          <div className={s.card} style={{ padding: 14 }}>
            <div className={s.sectionTitle}>Qué va a pasar</div>
            <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 7 }}>
              <Rule>
                Sus {plural(impact.publishedProperties, "inmueble publicado", "inmuebles publicados")}{" "}
                <strong>siguen publicados</strong> en la web de la inmobiliaria. La cartera es de la
                casa, no del asesor.
              </Rule>
              <Rule>
                {target === SIN_ASESOR ? (
                  <>
                    Los inmuebles quedan <strong>sin asesor asignado</strong> hasta que decidas a
                    quién dárselos.
                  </>
                ) : (
                  <>
                    Los inmuebles pasan a{" "}
                    <strong>{impact.candidates.find((c) => c.id === target)?.fullName}</strong>.
                  </>
                )}
              </Rule>
              <Rule>
                {impact.publicSlug ? (
                  <>
                    Su página pública <code>/agentes/{impact.publicSlug}</code> se apaga y{" "}
                    <strong>redirige (301) a la página de la inmobiliaria</strong>. No se tira el
                    posicionamiento que ya ganó esa dirección.
                  </>
                ) : (
                  <>No tiene página pública propia, así que no hay nada que apagar en la web.</>
                )}
              </Rule>
              <Rule>
                Los prospectos que lleguen de esos inmuebles{" "}
                {target === SIN_ASESOR ? (
                  <>
                    caen en la <strong>bandeja general</strong>.
                  </>
                ) : (
                  <>llegan a su nuevo asesor.</>
                )}
              </Rule>
              <Rule>
                Sus visitas por venir y sus pendientes se reasignan igual. Las visitas{" "}
                <strong>ya realizadas</strong> conservan su nombre: son historia y no se reescribe.
              </Rule>
              <Rule>
                Deja de poder entrar al panel de inmediato. No se borra: sus comisiones, su
                bitácora y sus operaciones cerradas siguen intactas.
              </Rule>
            </ul>
          </div>

          {/* ── 4. Lo que NO se resuelve solo y hay que atender ── */}
          {impact.keysOut > 0 ? (
            <Banner tone="danger" title="Se va con llaves" icon={<KeyRound size={16} />}>
              Tiene {plural(impact.keysOut, "juego de llaves sin devolver", "juegos de llaves sin devolver")}.
              No se los pasamos a nadie porque siguen físicamente con esta persona: recupéralos y
              regístralos como devueltos.
            </Banner>
          ) : null}

          {impact.unpaidCommissions.count > 0 ? (
            <Banner tone="warn" title="Le debes comisiones" icon={<Percent size={16} />}>
              Quedan {plural(impact.unpaidCommissions.count, "parte", "partes")} sin pagar por{" "}
              <strong>{formatMoney(impact.unpaidCommissions.amount)}</strong>. La baja no las borra
              ni las convierte en dinero de la oficina: las sigues viendo en Comisiones hasta que
              las marques pagadas.
            </Banner>
          ) : null}

          {/* ── 5. Confirmación explícita ── */}
          <label
            className={s.switchRow}
            style={{ cursor: "pointer", alignItems: "flex-start" }}
          >
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              disabled={saving}
              style={{ marginTop: 3, width: 16, height: 16, accentColor: "var(--pine-600)" }}
            />
            <span className={s.switchRowText}>
              <span className={s.switchRowTitle}>Entendido, dar de baja a {member.fullName}</span>
              <span className={s.hint}>
                Puedes reactivarla después desde Equipo, pero la cartera no vuelve sola: habría que
                reasignársela otra vez.
              </span>
            </span>
          </label>
        </>
      )}
    </Modal>
  );
}

function Stat({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <div className={s.kpi}>
      <span className={s.kpiLabel} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        {icon}
        {label}
      </span>
      <span className={s.kpiValue}>{value}</span>
      {hint ? <span className={s.kpiHint}>{hint}</span> : null}
    </div>
  );
}

function Rule({ children }: { children: React.ReactNode }) {
  return (
    <li style={{ fontSize: 13, lineHeight: 1.55, color: "var(--text-2)" }}>{children}</li>
  );
}
