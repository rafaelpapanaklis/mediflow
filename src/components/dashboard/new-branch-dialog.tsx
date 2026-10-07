"use client";
import { useEffect, useState } from "react";
import { X, Users, Copy, CheckCircle2, AlertTriangle } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import toast from "react-hot-toast";
import { useLocale, useT } from "@/i18n/i18n-provider";
import { DIRECTORY_CATEGORIES } from "@/lib/directory/types";
import { esCategoriaFija } from "@/lib/clinic/categoria-fija";
import { PATIENT_SHARING_ENABLED } from "@/lib/branches-shared";
import type { BranchDefaults, BranchQuota, OwnedBranchRow } from "@/lib/branches-shared";
import { copioAlgo, seccionesFallidas, SECCIONES_COPIA, type ResultadoCopia, type SeccionCopia, type NoCopiado } from "@/lib/branches/copia-sede-core";

/**
 * ws1-t10 (auditoría BEVADENT · M4) — textos de la copia de configuración.
 * Viven aquí y no en los diccionarios (`es.json`/`en.json`) para no tocar un
 * archivo que otras pantallas editan a la vez; el idioma sale de `useLocale`.
 */
const TEXTOS_COPIA = {
  es: {
    casilla: "Copiar la configuración de mi sede principal",
    casillaHint:
      "Catálogo de procedimientos con precios, horario y ajustes de agenda, recordatorios, plantillas (notas, consentimientos, indicaciones) y los textos del bot de WhatsApp. No se copian pacientes, CFDI, WhatsApp conectado, Mercado Pago, usuarios ni módulos de pago.",
    creada: "Sucursal creada",
    copiadoDe: "Se copió de {origen}:",
    nadaQueCopiar: "Tu sede principal no tenía configuración que copiar: la sede nace con los valores de siempre.",
    fallo: "No se pudo copiar: {partes}. La sede existe; puedes configurarlas a mano.",
    conectar: "Falta conectar en la sede nueva:",
    entrar: "Entrar a la sede",
    secciones: {
      catalogo: "{n} procedimientos con precios",
      paquetes: "{n} paquetes",
      horario: "horario de {n} días",
      ajustes: "ajustes de agenda y recordatorios",
      plantillasNotas: "{n} plantillas de notas",
      plantillasConsentimientos: "{n} consentimientos",
      plantillasEvolucion: "{n} plantillas de evolución",
      indicaciones: "{n} hojas de indicaciones",
      botWhatsApp: "textos del bot de WhatsApp (apagado)",
    },
    noSeCopia: {
      cfdi: "Facturación CFDI (RFC y sello, con tu contador)",
      whatsapp: "WhatsApp (conectar el número de esta sede)",
      mercadoPago: "Mercado Pago (cuenta de cobro de esta sede)",
      pacientes: "Pacientes: cada sede tiene su propio expediente",
      usuarios: "Usuarios y permisos: se dan de alta por sede",
      modulos: "Módulos de pago (Ortodoncia…): se contratan por sede",
    },
  },
  en: {
    casilla: "Copy my main location's settings",
    casillaHint:
      "Procedure catalog with prices, hours and agenda settings, reminders, templates (notes, consents, instructions) and the WhatsApp bot texts. Patients, CFDI, connected WhatsApp, Mercado Pago, users and paid modules are not copied.",
    creada: "Location created",
    copiadoDe: "Copied from {origen}:",
    nadaQueCopiar: "Your main location had no settings to copy: the new one starts with the defaults.",
    fallo: "Could not copy: {partes}. The location exists; you can set them up by hand.",
    conectar: "Still to connect at the new location:",
    entrar: "Open the location",
    secciones: {
      catalogo: "{n} procedures with prices",
      paquetes: "{n} packages",
      horario: "{n}-day schedule",
      ajustes: "agenda and reminder settings",
      plantillasNotas: "{n} note templates",
      plantillasConsentimientos: "{n} consent templates",
      plantillasEvolucion: "{n} evolution templates",
      indicaciones: "{n} instruction sheets",
      botWhatsApp: "WhatsApp bot texts (off)",
    },
    noSeCopia: {
      cfdi: "CFDI invoicing (tax ID and seal, with your accountant)",
      whatsapp: "WhatsApp (connect this location's number)",
      mercadoPago: "Mercado Pago (this location's payment account)",
      pacientes: "Patients: each location keeps its own records",
      usuarios: "Users and permissions: added per location",
      modulos: "Paid modules (Orthodontics…): contracted per location",
    },
  },
} as const;

type TextosCopia = (typeof TEXTOS_COPIA)["es"];

function textosCopia(locale: string): TextosCopia {
  return locale.startsWith("en") ? (TEXTOS_COPIA.en as unknown as TextosCopia) : TEXTOS_COPIA.es;
}

/** Las secciones con filas copiadas, ya redactadas («12 procedimientos con precios»). */
function lineasCopiadas(r: ResultadoCopia, tx: TextosCopia): string[] {
  const out: string[] = [];
  for (const s of SECCIONES_COPIA) {
    const n = r.copiado[s];
    if (n === null || n === 0) continue;
    out.push(tx.secciones[s].replace("{n}", String(n)));
  }
  return out;
}

function nombresDeSecciones(secciones: SeccionCopia[], tx: TextosCopia): string {
  return secciones.map((s) => tx.secciones[s].replace("{n} ", "").replace("{n}-", "")).join(", ");
}

interface Props {
  open: boolean;
  onClose: () => void;
  defaults: BranchDefaults;
  quota: BranchQuota;
  /** Se llama tras crear: la cookie de clínica activa ya apunta a la sede nueva. */
  onCreated: () => void;
}

/**
 * MULTI-CLÍNICA · FASE 1 — alta de una sucursal bajo el mismo dueño.
 *
 * El form nace prellenado con la categoría/ciudad/estado de la sede actual
 * (una sucursal casi siempre es del mismo giro y zona). El gate REAL vive en
 * POST /api/clinics: aquí sólo evitamos pedir datos si ya sabemos que no puede.
 */
export function NewBranchDialog({ open, onClose, defaults, quota, onCreated }: Props) {
  const t = useT();
  const tx = textosCopia(useLocale());
  const [loading, setLoading] = useState(false);
  // M4 — copiar la configuración de la sede principal (marcado por defecto) y
  // el resultado de la copia, que se enseña ANTES de entrar a la sede nueva.
  const [copiar, setCopiar] = useState(true);
  const [resultado, setResultado] = useState<{ nombre: string; copia: ResultadoCopia | null } | null>(null);
  const [form, setForm] = useState({ name: "", category: defaults.category, city: defaults.city, state: defaults.state, phone: "" });
  const [nameError, setNameError] = useState(false);
  // FASE 2 — sedes existentes del dueño y cuáles compartirán pacientes con la
  // sucursal nueva. Se cargan al abrir el diálogo (no en cada render).
  const [branches, setBranches] = useState<OwnedBranchRow[]>([]);
  const [shareWith, setShareWith] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setForm({ name: "", category: defaults.category, city: defaults.city, state: defaults.state, phone: "" });
    setNameError(false);
    setShareWith([]);
    setCopiar(true);
    setResultado(null);
  }, [open, defaults.category, defaults.city, defaults.state]);

  useEffect(() => {
    if (!open || !PATIENT_SHARING_ENABLED) return;
    let cancelled = false;
    fetch("/api/clinics/links", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((payload) => {
        if (cancelled || !payload) return;
        setBranches(Array.isArray(payload.branches) ? payload.branches : []);
      })
      .catch(() => { /* el selector simplemente no aparece */ });
    return () => { cancelled = true; };
  }, [open]);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const toggleShare = (clinicId: string) =>
    setShareWith((prev) =>
      prev.indexOf(clinicId) === -1 ? [...prev, clinicId] : prev.filter((id) => id !== clinicId),
    );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (form.name.trim().length < 2) {
      setNameError(true);
      toast.error(t("sidebar.branches.errName"));
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/clinics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: form.name.trim(),
          category: form.category,
          city: form.city.trim() || undefined,
          state: form.state.trim() || undefined,
          phone: form.phone.trim() || undefined,
          sharePatientsWith: shareWith.length > 0 ? shareWith : undefined,
          copiarConfiguracion: copiar,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error ?? t("sidebar.branches.errCreate"));
      toast.success(t("sidebar.branches.created", { name: payload.name ?? form.name.trim() }));
      // Con copia, el diálogo dice primero qué se copió y qué falta conectar;
      // «Entrar a la sede» llama a onCreated. Sin copia, como siempre.
      if (copiar && payload.copia) {
        setResultado({ nombre: payload.name ?? form.name.trim(), copia: payload.copia as ResultadoCopia });
        return;
      }
      onCreated();
    } catch (err: any) {
      toast.error(err?.message ?? t("sidebar.branches.errCreate"));
    } finally {
      setLoading(false);
    }
  }

  // La sucursal de una clínica DENTAL nace DENTAL: no se pinta el selector
  // (la categoría viaja igual en el form y POST /api/clinics la vuelve a
  // imponer leyendo la de la madre en la sesión). Otras categorías eligen.
  const categoriaFija = esCategoriaFija(defaults.category);

  // 17 categorías del directorio + OTHER (el enum ClinicCategory completo).
  const categoryOptions = [
    ...DIRECTORY_CATEGORIES.map((c) => ({ value: c.category as string, label: c.label })),
    { value: "OTHER", label: t("sidebar.branches.categoryOther") },
  ];

  return (
    // Con el resumen de la copia a la vista la sede YA existe y la cookie ya
    // apunta a ella: cerrar (X, Escape, clic fuera) equivale a «Entrar a la sede».
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) (resultado ? onCreated() : onClose()); }}>
      <Dialog.Portal>
        <Dialog.Overlay
          style={{ position: "fixed", inset: 0, background: "rgba(15,10,30,0.55)", backdropFilter: "blur(4px)", zIndex: 90 }}
        />
        <Dialog.Content
          className="modal"
          onEscapeKeyDown={() => (resultado ? onCreated() : onClose())}
          aria-describedby={undefined}
          style={{
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            zIndex: 91,
            maxHeight: "92vh",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <Dialog.Title className="modal__title" style={{ display: "none" }}>{t("sidebar.branches.newTitle")}</Dialog.Title>
          <div className="modal__header" style={{ flexShrink: 0 }}>
            <div className="modal__title">{resultado ? tx.creada : t("sidebar.branches.newTitle")}</div>
            <Dialog.Close asChild>
              <button type="button" className="btn-new btn-new--ghost btn-new--sm" aria-label={t("common.close")}>
                <X size={14} />
              </button>
            </Dialog.Close>
          </div>

          {resultado ? (
            <ResumenCopia resultado={resultado} tx={tx} onEntrar={onCreated} />
          ) : (
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden" }}>
            <div className="modal__body" style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
              <p style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 16, lineHeight: 1.5 }}>
                {quota.max === null
                  ? t("sidebar.branches.introUnlimited")
                  : t("sidebar.branches.intro", { used: String(quota.used), max: String(quota.max) })}
              </p>

              <div className="field-new">
                <label className="field-new__label" htmlFor="branch-name">
                  {t("sidebar.branches.name")} <span className="req">*</span>
                </label>
                <input
                  id="branch-name"
                  className="input-new"
                  placeholder={t("sidebar.branches.namePlaceholder")}
                  maxLength={80}
                  value={form.name}
                  onChange={(e) => { set("name", e.target.value); if (nameError) setNameError(false); }}
                  style={{ borderColor: nameError ? "#ef4444" : undefined }}
                />
              </div>

              {!categoriaFija && (
                <div className="field-new">
                  <label className="field-new__label" htmlFor="branch-category">{t("sidebar.branches.category")}</label>
                  <select
                    id="branch-category"
                    className="input-new"
                    value={form.category}
                    onChange={(e) => set("category", e.target.value)}
                  >
                    {categoryOptions.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0 14px" }}>
                <div className="field-new">
                  <label className="field-new__label" htmlFor="branch-city">{t("sidebar.branches.city")}</label>
                  <input id="branch-city" className="input-new" maxLength={60} value={form.city} onChange={(e) => set("city", e.target.value)} />
                </div>
                <div className="field-new">
                  <label className="field-new__label" htmlFor="branch-state">{t("sidebar.branches.state")}</label>
                  <input id="branch-state" className="input-new" maxLength={60} value={form.state} onChange={(e) => set("state", e.target.value)} />
                </div>
              </div>

              <div className="field-new">
                <label className="field-new__label" htmlFor="branch-phone">{t("sidebar.branches.phone")}</label>
                <input id="branch-phone" className="input-new" maxLength={30} placeholder="999 123 4567" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
              </div>

              {/* M4 — copiar la configuración de la sede principal. */}
              <label
                htmlFor="branch-copiar"
                style={{
                  display: "flex", alignItems: "flex-start", gap: 10, marginTop: 6, marginBottom: 12,
                  padding: "10px 12px", border: "1px solid var(--border-strong)", borderRadius: 10,
                  background: "var(--bg-subtle, transparent)", cursor: "pointer",
                }}
              >
                <input
                  id="branch-copiar"
                  type="checkbox"
                  checked={copiar}
                  onChange={(e) => setCopiar(e.target.checked)}
                  style={{ flexShrink: 0, width: 15, height: 15, marginTop: 2, cursor: "pointer" }}
                />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: "var(--text-1)" }}>
                    <Copy size={13} aria-hidden /> {tx.casilla}
                  </span>
                  <span style={{ display: "block", fontSize: 11, color: "var(--text-3)", lineHeight: 1.45, marginTop: 2 }}>
                    {tx.casillaHint}
                  </span>
                </span>
              </label>

              {/* MULTI-CLÍNICA · FASE 2 — compartir pacientes selectivo.
                  Con PATIENT_SHARING_ENABLED apagado se pinta EXACTAMENTE el
                  aviso "próximamente" de siempre, así que mergear no cambia
                  nada en producción. Encendido, se vuelve un selector real. */}
              {!PATIENT_SHARING_ENABLED || branches.length === 0 ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    marginTop: 6,
                    padding: "10px 12px",
                    border: "1px dashed var(--border-strong)",
                    borderRadius: 10,
                    background: "var(--bg-subtle, transparent)",
                    opacity: 0.75,
                  }}
                >
                  <Users size={15} style={{ color: "var(--text-3)", flexShrink: 0, marginTop: 1 }} aria-hidden />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)" }}>
                      {t("sidebar.branches.sharePatients")}{" "}
                      {!PATIENT_SHARING_ENABLED && (
                        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-3)" }}>
                          {t("sidebar.branches.comingSoon")}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-3)", lineHeight: 1.45, marginTop: 2 }}>
                      {t("sidebar.branches.sharePatientsHint")}
                    </div>
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    marginTop: 6,
                    padding: "10px 12px",
                    border: "1px solid var(--border-strong)",
                    borderRadius: 10,
                    background: "var(--bg-subtle, transparent)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <Users size={15} style={{ color: "var(--text-3)", flexShrink: 0, marginTop: 1 }} aria-hidden />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)" }}>
                        {t("sidebar.branches.sharePatientsWith")}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-3)", lineHeight: 1.45, marginTop: 2 }}>
                        {t("sidebar.branches.sharePatientsSelectHint")}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 8 }}>
                    {branches.map((b) => (
                      <label
                        key={b.clinicId}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          padding: "6px 4px",
                          fontSize: 12,
                          color: "var(--text-1)",
                          cursor: "pointer",
                          minWidth: 0,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={shareWith.indexOf(b.clinicId) !== -1}
                          onChange={() => toggleShare(b.clinicId)}
                          style={{ flexShrink: 0, width: 15, height: 15, cursor: "pointer" }}
                        />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {b.clinicName}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="modal__footer" style={{ flexShrink: 0 }}>
              <ButtonNew variant="ghost" onClick={onClose} type="button">{t("common.cancel")}</ButtonNew>
              <ButtonNew variant="primary" type="submit" disabled={loading}>
                {loading ? t("common.saving") : t("sidebar.branches.create")}
              </ButtonNew>
            </div>
          </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * M4 — lo que se copió de la principal y lo que hay que conectar aparte. Se
 * enseña antes de entrar a la sede nueva para que el dueño no la crea
 * «completa» (CFDI, WhatsApp y Mercado Pago son por sede).
 */
function ResumenCopia({
  resultado,
  tx,
  onEntrar,
}: {
  resultado: { nombre: string; copia: ResultadoCopia | null };
  tx: TextosCopia;
  onEntrar: () => void;
}) {
  const copia = resultado.copia;
  const lineas = copia ? lineasCopiadas(copia, tx) : [];
  const fallidas = copia ? seccionesFallidas(copia) : [];
  const noSeCopia: readonly NoCopiado[] = copia?.noSeCopia ?? [];
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div className="modal__body" style={{ flex: 1, overflowY: "auto", minHeight: 0 }} data-testid="resumen-copia">
        <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)", margin: "0 0 10px" }}>{resultado.nombre}</p>
        {copia && copioAlgo(copia) ? (
          <>
            <p style={{ fontSize: 12, color: "var(--text-2)", margin: "0 0 6px" }}>
              {tx.copiadoDe.replace("{origen}", copia.origen.nombre)}
            </p>
            <ul style={{ margin: "0 0 14px", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
              {lineas.map((l) => (
                <li key={l} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "var(--text-1)" }}>
                  <CheckCircle2 size={14} style={{ color: "var(--success, #16a34a)", flexShrink: 0 }} aria-hidden />
                  {l}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p style={{ fontSize: 12, color: "var(--text-2)", margin: "0 0 14px" }}>{tx.nadaQueCopiar}</p>
        )}
        {fallidas.length > 0 && (
          <p
            role="alert"
            style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12, color: "var(--danger, #dc2626)", margin: "0 0 14px", lineHeight: 1.45 }}
          >
            <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden />
            <span>{tx.fallo.replace("{partes}", nombresDeSecciones(fallidas, tx))}</span>
          </p>
        )}
        <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)", margin: "0 0 6px" }}>{tx.conectar}</p>
        <ul style={{ margin: 0, padding: "0 0 0 18px", display: "flex", flexDirection: "column", gap: 3, fontSize: 12, color: "var(--text-2)", lineHeight: 1.45 }}>
          {noSeCopia.map((k) => (
            <li key={k}>{tx.noSeCopia[k]}</li>
          ))}
        </ul>
      </div>
      <div className="modal__footer" style={{ flexShrink: 0 }}>
        <ButtonNew variant="primary" type="button" onClick={onEntrar}>{tx.entrar}</ButtonNew>
      </div>
    </div>
  );
}
