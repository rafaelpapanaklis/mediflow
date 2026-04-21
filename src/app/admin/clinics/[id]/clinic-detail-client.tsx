"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Eye, Shield, Clock, Users, FileText, CreditCard, Activity, Trash2, BarChart3, MessageCircle, Mail, Download } from "lucide-react";
import toast from "react-hot-toast";
import { ClinicActivityTab } from "@/components/admin/clinic-activity-tab";
import { ClinicUsageTab } from "@/components/admin/clinic-usage-tab";
import { ClinicStripeTab } from "@/components/admin/clinic-stripe-tab";
import { SendMessageModal } from "@/components/admin/send-message-modal";
import { DeleteClinicModal } from "@/components/admin/delete-clinic-modal";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { AvatarNew } from "@/components/ui/design-system/avatar-new";
import { KpiCard } from "@/components/ui/design-system/kpi-card";
import { fmtMXN, formatRelativeDate } from "@/lib/format";
import type { TemplateChannel } from "@/lib/admin-templates";

interface AdminNote {
  id: string;
  content: string;
  createdAt: string;
  author?: { firstName: string; lastName: string; email: string } | null;
}

const PLAN_PRICES: Record<string, number> = { BASIC: 49, PRO: 99, CLINIC: 249 };
const BANK_INFO = { nombre: "Efthymios Rafail Papanaklis", clabe: "012910015008025244", banco: "BBVA" };

type BadgeTone = "success" | "warning" | "danger" | "info" | "brand" | "neutral";

function planTone(plan: string): BadgeTone {
  if (plan === "CLINIC") return "brand";
  if (plan === "PRO")    return "info";
  return "neutral";
}

interface Props {
  clinic:               any;
  recentActivity:       any[];
  totalRevenue:         number;
  totalInvoices:        number;
  stripeConfigured:     boolean;
  stripeInstructions:   string;
  totalClinicsInSystem: number;
}

export function AdminClinicDetailClient({
  clinic,
  recentActivity,
  totalRevenue,
  totalInvoices,
  stripeConfigured,
  stripeInstructions,
  totalClinicsInSystem,
}: Props) {
  const [saving, setSaving]   = useState(false);
  const [note, setNote]       = useState("");
  const [notes, setNotes]     = useState<AdminNote[]>([]);
  const [notesLoaded, setNotesLoaded] = useState(false);
  const [savingNote, setSavingNote]   = useState(false);
  const [editPlan, setEditPlan] = useState(clinic.plan);
  const [tab, setTab]         = useState("overview");
  const [modalChannel, setModalChannel] = useState<TemplateChannel | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  // Cargar notas al entrar al tab (la primera vez)
  useEffect(() => {
    if (tab !== "notes" || notesLoaded) return;
    (async () => {
      try {
        const res = await fetch(`/api/admin/clinics/${clinic.id}/notes`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        setNotes(data);
      } catch {
        toast.error("Error al cargar notas");
      } finally {
        setNotesLoaded(true);
      }
    })();
  }, [tab, notesLoaded, clinic.id]);

  const expired   = clinic.trialEndsAt && new Date(clinic.trialEndsAt) < new Date();
  const daysLeft  = clinic.trialEndsAt ? Math.ceil((new Date(clinic.trialEndsAt).getTime() - Date.now()) / 86400000) : null;
  const owner     = clinic.users[0];

  async function updatePlan() {
    setSaving(true);
    try {
      const newExpiry = new Date();
      newExpiry.setMonth(newExpiry.getMonth() + 1);
      await fetch(`/api/admin/clinics/${clinic.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: editPlan, trialEndsAt: newExpiry.toISOString() }),
      });
      toast.success("Plan actualizado y extendido 1 mes");
    } catch {
      toast.error("Error al actualizar");
    } finally {
      setSaving(false);
    }
  }

  async function extendTrial(days: number) {
    setSaving(true);
    try {
      const base = expired ? new Date() : (clinic.trialEndsAt ? new Date(clinic.trialEndsAt) : new Date());
      base.setDate(base.getDate() + days);
      await fetch(`/api/admin/clinics/${clinic.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trialEndsAt: base.toISOString() }),
      });
      toast.success(`+${days} días agregados`);
    } catch {
      toast.error("Error");
    } finally {
      setSaving(false);
    }
  }

  async function suspendClinic() {
    if (!confirm("¿Suspender esta clínica? El doctor verá una pantalla de pago.")) return;
    setSaving(true);
    try {
      await fetch(`/api/admin/clinics/${clinic.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trialEndsAt: new Date("2000-01-01").toISOString() }),
      });
      toast.success("Clínica suspendida");
    } catch {
      toast.error("Error");
    } finally {
      setSaving(false);
    }
  }

  async function addNote() {
    const content = note.trim();
    if (!content) return;
    setSavingNote(true);
    try {
      const res = await fetch(`/api/admin/clinics/${clinic.id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Error");
      const created = await res.json();
      setNotes(prev => [created, ...prev]);
      setNote("");
      toast.success("Nota agregada");
    } catch (e: any) {
      toast.error(e.message ?? "Error");
    } finally {
      setSavingNote(false);
    }
  }

  async function deleteNote(noteId: string) {
    if (!confirm("¿Eliminar esta nota?")) return;
    try {
      const res = await fetch(`/api/admin/clinics/${clinic.id}/notes/${noteId}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setNotes(prev => prev.filter(n => n.id !== noteId));
      toast.success("Nota eliminada");
    } catch {
      toast.error("Error al eliminar");
    }
  }

  const TABS = [
    { id: "overview",  label: "Resumen",       icon: Activity    },
    { id: "account",   label: "Cuenta",         icon: Users      },
    { id: "billing",   label: "Facturación",    icon: CreditCard },
    { id: "stripe",    label: "Stripe",         icon: CreditCard },
    { id: "activity",  label: "Actividad",      icon: Clock      },
    { id: "usage",     label: "Uso",            icon: BarChart3  },
    { id: "notes",     label: "Notas internas", icon: FileText   },
  ];

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header */}
      <CardNew noPad>
        <div style={{ padding: 20, display: "flex", alignItems: "flex-start", gap: 16 }}>
          <Link
            href="/admin/clinics"
            style={{
              padding: 8,
              borderRadius: 8,
              display: "grid",
              placeItems: "center",
              color: "var(--text-3)",
              border: "1px solid var(--border-soft)",
              background: "var(--bg-elev)",
              flexShrink: 0,
            }}
            aria-label="Volver"
          >
            <ArrowLeft size={14} />
          </Link>
          <AvatarNew name={clinic.name} size="xl" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
              <h1 style={{ fontSize: 20, margin: 0, color: "var(--text-1)", fontWeight: 600 }}>{clinic.name}</h1>
              <BadgeNew tone={planTone(clinic.plan)}>{clinic.plan}</BadgeNew>
              <BadgeNew tone={expired ? "danger" : "success"} dot>
                {expired ? "Expirado" : (daysLeft !== null ? `${daysLeft}d activo` : "Activo")}
              </BadgeNew>
            </div>
            <div style={{ display: "flex", gap: 20, fontSize: 12, color: "var(--text-2)", flexWrap: "wrap" }}>
              <span>{clinic.specialty}</span>
              <span>{clinic.city ?? "—"}, {clinic.country}</span>
              {clinic.phone && <span>{clinic.phone}</span>}
              <span className="mono">/{clinic.slug}</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <ButtonNew variant="secondary" icon={<MessageCircle size={14} />} onClick={() => setModalChannel("whatsapp")}>
              WhatsApp
            </ButtonNew>
            <ButtonNew variant="secondary" icon={<Mail size={14} />} onClick={() => setModalChannel("email")}>
              Email
            </ButtonNew>
            <a
              href={`/api/admin/clinics/${clinic.id}/export`}
              target="_blank"
              style={{ textDecoration: "none" }}
              title="Descargar ZIP con CSVs + manifest"
            >
              <ButtonNew variant="secondary" icon={<Download size={14} />}>
                Exportar
              </ButtonNew>
            </a>
            <a
              href={`/api/admin/impersonate?clinicId=${clinic.id}`}
              target="_blank"
              style={{ textDecoration: "none" }}
            >
              <ButtonNew variant="primary" icon={<Eye size={14} />}>
                Impersonar
              </ButtonNew>
            </a>
          </div>
        </div>
      </CardNew>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
        <KpiCard label="Pacientes"   value={String(clinic._count.patients)}     icon={Users}    />
        <KpiCard label="Citas"       value={String(clinic._count.appointments)} icon={Clock}    />
        <KpiCard label="Expedientes" value={String(clinic._count.records)}      icon={FileText} />
        <KpiCard label="Facturas"    value={String(totalInvoices)}              icon={CreditCard} />
        <KpiCard label="Ingresos"    value={fmtMXN(totalRevenue)}               icon={BarChart3}  />
      </div>

      {/* Tabs */}
      <div className="tabs-new">
        {TABS.map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`tab-new ${tab === t.id ? "tab-new--active" : ""}`}
            >
              <Icon size={14} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* TAB: OVERVIEW */}
      {tab === "overview" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {/* Clinic info */}
            <CardNew>
              <div className="form-section__title">
                Datos de la clínica <span className="form-section__rule" />
              </div>
              <div style={{ display: "flex", flexDirection: "column", fontSize: 13 }}>
                {[
                  { label: "Nombre",       val: clinic.name },
                  { label: "Slug/URL",     val: `${clinic.slug}.mediflow.app` },
                  { label: "Especialidad", val: clinic.specialty },
                  { label: "País",         val: clinic.country },
                  { label: "Ciudad",       val: clinic.city ?? "—" },
                  { label: "Teléfono",     val: clinic.phone ?? "—" },
                  { label: "Email",        val: clinic.email ?? "—" },
                  { label: "Registro",     val: new Date(clinic.createdAt).toLocaleDateString("es-MX") },
                ].map(r => (
                  <div
                    key={r.label}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      padding: "8px 0",
                      borderBottom: "1px solid var(--border-soft)",
                    }}
                  >
                    <span style={{ color: "var(--text-3)" }}>{r.label}</span>
                    <span style={{ color: "var(--text-1)", fontWeight: 500 }}>{r.val}</span>
                  </div>
                ))}
              </div>
            </CardNew>

            {/* Plan management */}
            <CardNew>
              <div className="form-section__title">
                Gestión de plan <span className="form-section__rule" />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div className="field-new">
                  <label className="field-new__label">Plan actual</label>
                  <select
                    value={editPlan}
                    onChange={e => setEditPlan(e.target.value)}
                    className="input-new"
                  >
                    <option value="BASIC">BASIC — $49/mes</option>
                    <option value="PRO">PRO — $99/mes</option>
                    <option value="CLINIC">CLINIC — $249/mes</option>
                  </select>
                </div>

                <div className="field-new">
                  <label className="field-new__label">Vencimiento actual</label>
                  <div
                    style={{
                      background: "var(--bg-elev)",
                      border: "1px solid var(--border-soft)",
                      borderRadius: 8,
                      padding: "8px 12px",
                      fontSize: 13,
                      color: "var(--text-1)",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    <span>
                      {clinic.trialEndsAt
                        ? new Date(clinic.trialEndsAt).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })
                        : "Sin fecha"}
                    </span>
                    {daysLeft !== null && (
                      <BadgeNew tone={expired ? "danger" : "success"}>
                        {expired ? "Expirado" : `${daysLeft} días restantes`}
                      </BadgeNew>
                    )}
                  </div>
                </div>

                <ButtonNew variant="primary" onClick={updatePlan} disabled={saving}>
                  {saving ? "Guardando…" : "Activar plan + 1 mes"}
                </ButtonNew>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                  {[7, 14, 30].map(days => (
                    <ButtonNew
                      key={days}
                      variant="secondary"
                      size="sm"
                      onClick={() => extendTrial(days)}
                      disabled={saving}
                    >
                      +{days} días
                    </ButtonNew>
                  ))}
                </div>

                <ButtonNew variant="danger" onClick={suspendClinic} disabled={saving}>
                  Suspender clínica
                </ButtonNew>
              </div>
            </CardNew>
          </div>

          {/* Zona de peligro */}
          <div
            style={{
              borderRadius: 12,
              border: "1px solid var(--danger)",
              background: "color-mix(in oklab, var(--danger) 8%, transparent)",
              padding: 20,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Shield size={14} style={{ color: "var(--danger)" }} />
              <h2
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: "var(--danger)",
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  margin: 0,
                }}
              >
                Zona de peligro
              </h2>
            </div>
            <p style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.5, margin: 0 }}>
              Eliminar una clínica borra de forma permanente todos sus datos (pacientes, citas, expedientes,
              facturas, usuarios, archivos, etc.) y sus archivos en Supabase Storage. Esta acción no se puede deshacer.
            </p>
            <div>
              <ButtonNew variant="danger" icon={<Trash2 size={14} />} onClick={() => setShowDeleteModal(true)}>
                Eliminar clínica
              </ButtonNew>
            </div>
          </div>
        </div>
      )}

      {/* TAB: ACCOUNT */}
      {tab === "account" && (
        <CardNew>
          <div className="form-section__title">
            Usuarios de la clínica <span className="form-section__rule" />
          </div>
          <table className="table-new">
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Teléfono</th>
                <th>Rol</th>
                <th>Estado</th>
                <th>Registro</th>
              </tr>
            </thead>
            <tbody>
              {clinic.users.map((u: any) => (
                <tr key={u.id}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <AvatarNew name={`${u.firstName} ${u.lastName}`} size="sm" />
                      <div>
                        <div style={{ fontWeight: 500, color: "var(--text-1)" }}>
                          {u.firstName} {u.lastName}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text-3)" }}>{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ color: "var(--text-2)" }}>{u.phone ?? "—"}</td>
                  <td>
                    <BadgeNew tone="brand">{u.role}</BadgeNew>
                  </td>
                  <td>
                    <BadgeNew tone={u.isActive ? "success" : "neutral"} dot>
                      {u.isActive ? "Activo" : "Inactivo"}
                    </BadgeNew>
                  </td>
                  <td className="mono" style={{ color: "var(--text-3)", fontSize: 12 }}>
                    {new Date(u.createdAt).toLocaleDateString("es-MX")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardNew>
      )}

      {/* TAB: BILLING */}
      {tab === "billing" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            <KpiCard label="Plan"             value={clinic.plan}         icon={CreditCard} />
            <KpiCard label="Ingresos totales" value={fmtMXN(totalRevenue)} icon={BarChart3}  />
            <KpiCard label="Total facturas"   value={String(totalInvoices)} icon={FileText}  />
          </div>

          <CardNew>
            <div className="form-section__title">
              Datos para recibir pago <span className="form-section__rule" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
              <div>
                <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4 }}>Nombre</div>
                <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-1)" }}>{BANK_INFO.nombre}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4 }}>CLABE</div>
                <div className="mono" style={{ fontSize: 15, fontWeight: 600, color: "var(--brand)" }}>
                  {BANK_INFO.clabe}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4 }}>Banco</div>
                <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-1)" }}>{BANK_INFO.banco}</div>
              </div>
            </div>
            <div style={{ marginTop: 12, fontSize: 11, color: "var(--text-3)" }}>
              Envía estos datos al cliente cuando necesite renovar su plan.
            </div>
          </CardNew>
        </div>
      )}

      {/* TAB: ACTIVITY */}
      {tab === "activity" && <ClinicActivityTab clinicId={clinic.id} />}

      {/* TAB: USAGE */}
      {tab === "usage" && <ClinicUsageTab clinicId={clinic.id} />}

      {/* TAB: STRIPE */}
      {tab === "stripe" && (
        <ClinicStripeTab
          clinicId={clinic.id}
          clinicName={clinic.name}
          plan={clinic.plan}
          stripeCustomerId={clinic.stripeCustomerId ?? null}
          stripeSubscriptionId={clinic.stripeSubscriptionId ?? null}
          subscriptionStatus={clinic.subscriptionStatus ?? null}
          stripeConfigured={stripeConfigured}
          instructions={stripeInstructions}
        />
      )}

      {/* TAB: NOTES */}
      {tab === "notes" && (
        <CardNew>
          <div className="form-section__title">
            Notas internas <span className="form-section__rule" />
          </div>
          <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 0, marginBottom: 16 }}>
            Solo visibles para el super admin. Se persisten en la DB por clínica.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
            <textarea
              className="input-new"
              style={{ minHeight: 80, resize: "vertical" }}
              placeholder="Ej: Cliente pagó el 15/03, activar PRO por 1 año…"
              value={note}
              onChange={e => setNote(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) addNote(); }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <ButtonNew variant="primary" onClick={addNote} disabled={savingNote || !note.trim()}>
                {savingNote ? "Guardando…" : "Agregar nota"}
              </ButtonNew>
            </div>
          </div>

          {!notesLoaded ? (
            <p style={{ fontSize: 13, color: "var(--text-3)", textAlign: "center", padding: "24px 0" }}>
              Cargando…
            </p>
          ) : notes.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--text-3)", textAlign: "center", padding: "24px 0" }}>
              Sin notas aún
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {notes.map(n => {
                const authorLabel = n.author
                  ? `${n.author.firstName} ${n.author.lastName}`
                  : "Super admin";
                return (
                  <div key={n.id} className="list-row" style={{ alignItems: "flex-start", gap: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p
                        style={{
                          fontSize: 13,
                          color: "var(--text-1)",
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                          margin: 0,
                        }}
                      >
                        {n.content}
                      </p>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          marginTop: 6,
                          fontSize: 11,
                          color: "var(--text-3)",
                        }}
                      >
                        <span style={{ fontWeight: 500, color: "var(--text-2)" }}>{authorLabel}</span>
                        <span>·</span>
                        <span>{formatRelativeDate(n.createdAt)}</span>
                      </div>
                    </div>
                    <ButtonNew
                      variant="ghost"
                      size="sm"
                      icon={<Trash2 size={14} />}
                      onClick={() => deleteNote(n.id)}
                      aria-label="Eliminar nota"
                      title="Eliminar"
                    />
                  </div>
                );
              })}
            </div>
          )}
        </CardNew>
      )}

      {modalChannel && (
        <SendMessageModal
          clinicId={clinic.id}
          clinicName={clinic.name}
          channel={modalChannel}
          onClose={() => setModalChannel(null)}
        />
      )}

      {showDeleteModal && (
        <DeleteClinicModal
          clinicId={clinic.id}
          clinicName={clinic.name}
          counts={{
            users:        clinic._count?.users        ?? clinic.users?.length ?? 0,
            patients:     clinic._count?.patients     ?? 0,
            appointments: clinic._count?.appointments ?? 0,
            records:      clinic._count?.records      ?? 0,
            invoices:     clinic._count?.invoices     ?? 0,
            files:        clinic._count?.files        ?? 0,
          }}
          canDelete={totalClinicsInSystem > 1}
          reason={totalClinicsInSystem <= 1 ? "Es la única clínica del sistema. El admin no permite borrar la última para no dejar la app vacía (útil durante QA/testing)." : undefined}
          onClose={() => setShowDeleteModal(false)}
        />
      )}
    </div>
  );
}
