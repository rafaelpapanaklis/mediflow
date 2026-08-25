"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import type { AdminRealtyAccountDetail } from "@/lib/realty/admin";
import {
  MANUAL_ACTION_LABELS,
  MODE_LABELS,
  formatBytes,
  formatInt,
  formatLimit,
  formatQuota,
  fullDate,
  percentOf,
  relativeDate,
  shortDate,
  subscriptionFace,
  type AdminTone,
} from "@/components/admin/inmobiliarias/shared";
import {
  RealtyManualActionModal,
  type ManualActionKind,
} from "@/components/admin/inmobiliarias/manual-action-modal";
import "@/components/admin/inmobiliarias/inmobiliarias.css";

function chip(tone: AdminTone, label: string) {
  const cls =
    tone === "success"
      ? " dcin-chip--success"
      : tone === "warning"
        ? " dcin-chip--warning"
        : tone === "danger"
          ? " dcin-chip--danger"
          : tone === "info"
            ? " dcin-chip--info"
            : "";
  return <span className={`dcin-chip${cls}`}>{label}</span>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="dcin-label">{label}</div>
      <div className="dcin-value">{children}</div>
    </div>
  );
}

export function AdminRealtyAccountDetailClient({
  detail,
}: {
  detail: AdminRealtyAccountDetail;
}) {
  const router = useRouter();
  const [action, setAction] = useState<ManualActionKind | null>(null);
  const a = detail.account;
  const face = subscriptionFace(a.subscriptionStatus);

  const quotaBytes = a.storageQuotaMb * 1024 * 1024;
  const storagePct = percentOf(a.storageUsedBytes, quotaBytes);
  const messagePct = percentOf(a.messagesUsedPeriod, a.messageQuota);
  // `a.plan` es el ID del plan (string); los cupos viven en el plan RESUELTO
  // de la tabla, que llega en detail.plan.
  const usersPct =
    detail.plan.maxUsers < 0 ? 0 : percentOf(a.users, detail.plan.maxUsers);

  const suspended = a.subscriptionStatus === "suspended";

  return (
    <>
      <div className="dcin">
        <header className="dcin-head">
          <div>
            <Link className="dcin-backlink" href="/admin/inmobiliarias">
              <ArrowLeft size={12} style={{ verticalAlign: "-1px" }} aria-hidden /> Volver a
              inmobiliarias
            </Link>
            <h1 className="dcin-title" style={{ marginTop: 4 }}>
              {a.name}
            </h1>
            <p className="dcin-sub">
              /{a.slug} · {MODE_LABELS[a.mode]} · alta {shortDate(a.createdAt)}
            </p>
          </div>
          <div className="dcin-actions">
            {suspended ? (
              <button
                type="button"
                className="dcin-btn dcin-btn--primary"
                onClick={() => setAction("reactivate")}
              >
                Reactivar
              </button>
            ) : (
              <button
                type="button"
                className="dcin-btn dcin-btn--danger"
                onClick={() => setAction("suspend")}
              >
                Suspender
              </button>
            )}
            <button type="button" className="dcin-btn" onClick={() => setAction("plan")}>
              Cambiar plan
            </button>
            <button type="button" className="dcin-btn" onClick={() => setAction("grant-days")}>
              Otorgar días
            </button>
          </div>
        </header>

        {/* ── KPIs ─────────────────────────────────────────────────────── */}
        <div className="dcin-kpis">
          <div className="dcin-kpi">
            <span className="dcin-kpi__label">Plan</span>
            <span className="dcin-kpi__value" style={{ fontSize: 18 }}>
              {a.planName}
            </span>
            <span className="dcin-kpi__hint">{face.label}</span>
          </div>
          <div className="dcin-kpi">
            <span className="dcin-kpi__label">Usuarios</span>
            <span className="dcin-kpi__value">{formatInt(a.users)}</span>
            <span className="dcin-kpi__hint">de {formatLimit(detail.plan.maxUsers)}</span>
          </div>
          <div className="dcin-kpi">
            <span className="dcin-kpi__label">Oficinas</span>
            <span className="dcin-kpi__value">{formatInt(a.offices)}</span>
            <span className="dcin-kpi__hint">de {formatLimit(detail.plan.maxOffices)}</span>
          </div>
          <div className="dcin-kpi">
            <span className="dcin-kpi__label">Inmuebles</span>
            <span className="dcin-kpi__value">{formatInt(a.properties)}</span>
            <span className="dcin-kpi__hint">{formatInt(detail.leads)} prospectos</span>
          </div>
          <div className="dcin-kpi">
            <span className="dcin-kpi__label">Visitas del mes</span>
            <span className="dcin-kpi__value">{formatInt(detail.visitsThisMonth)}</span>
            <span className="dcin-kpi__hint">{formatInt(detail.leases)} contratos de renta</span>
          </div>
        </div>

        <div className="dcin-grid2">
          {/* ── Datos ─────────────────────────────────────────────────── */}
          <section className="dcin-card">
            <h2 className="dcin-cardtitle">Datos de la cuenta</h2>
            <div className="dcin-fields">
              <Field label="Correo">{a.email ?? "—"}</Field>
              <Field label="Teléfono">{a.phone ?? "—"}</Field>
              <Field label="Ciudad">
                {a.city ? `${a.city}${a.state ? `, ${a.state}` : ""}` : "—"}
              </Field>
              <Field label="Modo">{MODE_LABELS[a.mode]}</Field>
              <Field label="Alta">{fullDate(a.createdAt)}</Field>
              <Field label="Última actividad">{relativeDate(a.lastActivityAt)}</Field>
              <Field label="Cuenta habilitada">{a.isActive ? "Sí" : "No"}</Field>
              <Field label="Tickets abiertos">{formatInt(detail.openTickets)}</Field>
            </div>
          </section>

          {/* ── Plan y pago ───────────────────────────────────────────── */}
          <section className="dcin-card">
            <h2 className="dcin-cardtitle">Plan y estado de pago</h2>
            <div className="dcin-actions">
              {chip("info", a.planName)}
              {chip(face.tone, face.label)}
            </div>
            <div className="dcin-fields">
              <Field label="Estado crudo en la base">
                <code>{a.subscriptionStatus}</code>
              </Field>
              <Field label="Cupo de usuarios">{formatLimit(detail.plan.maxUsers)}</Field>
              <Field label="Cupo de oficinas">{formatLimit(detail.plan.maxOffices)}</Field>
              <Field label="Cupo de archivos">{formatQuota(detail.plan.storageQuotaMb)}</Field>
              <Field label="Cliente en Stripe">
                {a.hasStripeCustomer ? "Sí" : "No"}
              </Field>
              <Field label="Suscripción en Stripe">
                {a.hasStripeSubscription ? "Sí" : "No"}
              </Field>
            </div>
            <p className="dcin-note">
              Los precios y los cupos salen de <code>realty_plan_configs</code>:
              editarlos en{" "}
              <Link className="dcin-link" href="/admin/inmobiliarias/planes">
                Planes y precios
              </Link>{" "}
              cambia esta ficha sin volver a desplegar.
              {detail.stripeConfigured
                ? null
                : " Ojo: Stripe no está configurado en esta instalación, así que “Otorgar días” no está disponible."}
            </p>
          </section>
        </div>

        {/* ── Consumo ───────────────────────────────────────────────── */}
        <section className="dcin-card">
          <h2 className="dcin-cardtitle">Consumo</h2>
          <div className="dcin-fields">
            <div>
              <div className="dcin-label">Archivos</div>
              <div className="dcin-value">
                {formatBytes(a.storageUsedBytes)} de {formatQuota(a.storageQuotaMb)} ·{" "}
                {storagePct}%
              </div>
              <div className="dcin-meter">
                <div
                  className={`dcin-meter__fill${
                    storagePct >= 100
                      ? " dcin-meter__fill--danger"
                      : storagePct >= 90
                        ? " dcin-meter__fill--warning"
                        : ""
                  }`}
                  style={{ width: `${storagePct}%` }}
                />
              </div>
            </div>
            <div>
              <div className="dcin-label">Mensajes de WhatsApp (periodo)</div>
              <div className="dcin-value">
                {a.messageQuota === 0
                  ? "El plan no incluye WhatsApp"
                  : `${formatInt(a.messagesUsedPeriod)} de ${formatLimit(a.messageQuota)} · ${messagePct}%`}
              </div>
              {a.messageQuota > 0 ? (
                <div className="dcin-meter">
                  <div
                    className={`dcin-meter__fill${
                      messagePct >= 100
                        ? " dcin-meter__fill--danger"
                        : messagePct >= 90
                          ? " dcin-meter__fill--warning"
                          : ""
                    }`}
                    style={{ width: `${messagePct}%` }}
                  />
                </div>
              ) : null}
            </div>
            <div>
              <div className="dcin-label">Usuarios</div>
              <div className="dcin-value">
                {formatInt(a.users)} de {formatLimit(detail.plan.maxUsers)}
              </div>
              {detail.plan.maxUsers > 0 ? (
                <div className="dcin-meter">
                  <div
                    className={`dcin-meter__fill${
                      usersPct >= 100
                        ? " dcin-meter__fill--danger"
                        : usersPct >= 90
                          ? " dcin-meter__fill--warning"
                          : ""
                    }`}
                    style={{ width: `${usersPct}%` }}
                  />
                </div>
              ) : null}
            </div>
          </div>
        </section>

        {/* ── Equipo ────────────────────────────────────────────────── */}
        <section className="dcin-card">
          <h2 className="dcin-cardtitle">Equipo ({detail.users.length})</h2>
          <div className="dcin-tablewrap" style={{ border: "none" }}>
            <table className="dcin-table" style={{ minWidth: 520 }}>
              <thead>
                <tr>
                  <th className="dcin-th dcin-th--plain">Persona</th>
                  <th className="dcin-th dcin-th--plain">Correo</th>
                  <th className="dcin-th dcin-th--plain">Rol</th>
                  <th className="dcin-th dcin-th--plain">Último acceso</th>
                </tr>
              </thead>
              <tbody>
                {detail.users.length === 0 ? (
                  <tr className="dcin-row">
                    <td colSpan={4} className="dcin-empty">
                      Sin usuarios.
                    </td>
                  </tr>
                ) : (
                  detail.users.map((u) => (
                    <tr key={u.id} className="dcin-row">
                      <td>
                        {u.name}
                        {u.active ? null : (
                          <span style={{ opacity: 0.6 }}> · desactivado</span>
                        )}
                      </td>
                      <td className="dcin-ellipsis">{u.email}</td>
                      <td className="dcin-nowrap">{u.role}</td>
                      <td className="dcin-nowrap">{relativeDate(u.lastLogin)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Oficinas ──────────────────────────────────────────────── */}
        <section className="dcin-card">
          <h2 className="dcin-cardtitle">Oficinas ({detail.offices.length})</h2>
          {detail.offices.length === 0 ? (
            <p className="dcin-note">Sin oficinas.</p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--text-1)" }}>
              {detail.offices.map((o) => (
                <li key={o.id} style={{ marginBottom: 3 }}>
                  {o.name}
                  {o.isMain ? " · principal" : ""}
                  {o.isActive ? "" : " · inactiva"}
                  {o.city ? ` — ${o.city}` : ""}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Bitácora ──────────────────────────────────────────────── */}
        <section className="dcin-card">
          <h2 className="dcin-cardtitle">Bitácora de acciones manuales</h2>
          {detail.actions === null ? (
            <p className="dcin-note">
              La bitácora no está disponible: falta aplicar{" "}
              <code>sql/realty.sql</code> en la base. Las acciones se siguen
              pudiendo aplicar y quedan en los logs del servidor con el tag{" "}
              <code>[realty/admin-action]</code>.
            </p>
          ) : detail.actions.length === 0 ? (
            <p className="dcin-note">Nadie ha tocado esta cuenta desde el panel.</p>
          ) : (
            <div className="dcin-tablewrap" style={{ border: "none" }}>
              <table className="dcin-table" style={{ minWidth: 620 }}>
                <thead>
                  <tr>
                    <th className="dcin-th dcin-th--plain">Cuándo</th>
                    <th className="dcin-th dcin-th--plain">Qué</th>
                    <th className="dcin-th dcin-th--plain">Cambio</th>
                    <th className="dcin-th dcin-th--plain">Quién</th>
                    <th className="dcin-th dcin-th--plain">Nota</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.actions.map((row) => (
                    <tr key={row.id} className="dcin-row">
                      <td className="dcin-nowrap">{fullDate(row.createdAt)}</td>
                      <td className="dcin-nowrap">
                        {MANUAL_ACTION_LABELS[row.action] ?? row.action}
                      </td>
                      <td className="dcin-nowrap">
                        {row.before || row.after ? `${row.before ?? "—"} → ${row.after ?? "—"}` : "—"}
                      </td>
                      <td className="dcin-ellipsis">{row.actorEmail ?? "—"}</td>
                      <td>{row.note || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* 🔴 FUERA de .dcin: container-type atraparía el position:fixed. */}
      {action ? (
        <RealtyManualActionModal
          accountId={a.id}
          accountName={a.name}
          currentPlan={a.plan}
          planOptions={detail.planOptions}
          kind={action}
          onClose={() => setAction(null)}
          onDone={() => router.refresh()}
        />
      ) : null}
    </>
  );
}
