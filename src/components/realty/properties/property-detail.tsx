"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  ArrowLeft,
  BadgeCheck,
  Building2,
  ExternalLink,
  FileDown,
  FileText,
  Link2,
  Loader2,
  Lock,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import {
  REALTY_AMENITIES,
  REALTY_DOCUMENT_KIND_LABELS,
  REALTY_OPERATION_LABELS,
  REALTY_PROPERTY_KIND_LABELS,
  REALTY_PROPERTY_STATUS_UI,
  realtyAmenityLabel,
  type RealtyCurrency,
  type RealtyDocumentKind,
  type RealtyMode,
  type RealtyOperation,
  type RealtyPropertyKind,
  type RealtyPropertyStatus,
} from "@/lib/realty/types";
import type { RealtyPropertyDetail } from "@/lib/realty/properties-shared";
import { REALTY_EXCLUSIVE_WARN_DAYS, activeAmenityKeys } from "@/lib/realty/properties-shared";
import type { RealtyStorageUsage } from "@/lib/realty/properties-shared";
import {
  apiCall,
  Badge,
  ErrorText,
  Field,
  formatBytes,
  formatDate,
  Modal,
  numOrNull,
  styles as s,
  useRealtyT,
  useSaving,
} from "./ui";
import { PropertyGallery } from "./property-gallery";
import { PropertyTours } from "./property-tours";

/**
 * Ficha del inmueble: alta rellenada y edición.
 *
 * ── GUARDADO POR SECCIÓN, NO UN BOTÓN GIGANTE ──────────────────────────
 * Cada tarjeta se guarda sola, con su propio botón y su propio error. Con
 * un único botón al final, un porcentaje de comisión fuera de rango
 * impediría guardar la colonia; y quien captura una ficha se levanta a
 * media captura. Además, cada sección escribe SOLO sus columnas, así que
 * dos pestañas abiertas en el mismo inmueble no se pisan lo que la otra no
 * tocó.
 *
 * ── MODO DE LA CUENTA ──────────────────────────────────────────────────
 * En OWNER (rentista) el inmueble es SUYO: no hay propietario a quien
 * ligarlo, ni asesor a quien asignárselo, ni exclusiva que firmar consigo
 * mismo. Esas tres secciones desaparecen; no se pintan deshabilitadas.
 */

const PropertyMap = dynamic(() => import("./property-map"), {
  ssr: false,
  loading: () => <div className={s.mapBox} />,
});

const KINDS = Object.keys(REALTY_PROPERTY_KIND_LABELS) as RealtyPropertyKind[];
const STATUSES = Object.keys(REALTY_PROPERTY_STATUS_UI) as RealtyPropertyStatus[];
const OPERATIONS: RealtyOperation[] = ["VENTA", "RENTA", "AMBAS"];
const DOC_KINDS = Object.keys(REALTY_DOCUMENT_KIND_LABELS) as RealtyDocumentKind[];

export interface OwnerOption {
  id: string;
  name: string;
  phone: string | null;
}
export interface AgentOption {
  id: string;
  name: string;
}

export interface PropertyDetailProps {
  dict: Dictionary;
  locale: string;
  property: RealtyPropertyDetail;
  owners: OwnerOption[];
  agents: AgentOption[];
  usage: RealtyStorageUsage;
  mode: RealtyMode;
  canEdit: boolean;
  canManageOwners: boolean;
  hasLogo: boolean;
  accountSlug: string;
  origin: string;
}

export function PropertyDetail(props: PropertyDetailProps) {
  const { dict, locale, property, mode, canEdit, accountSlug, origin } = props;
  const t = useRealtyT(dict);
  const router = useRouter();
  const [published, setPublished] = useState(property.isPublished);
  const [publishing, setPublishing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isOwnerMode = mode === "OWNER";
  const refresh = useCallback(() => router.refresh(), [router]);

  const publicUrl =
    published && property.publicUrlSlug
      ? `${origin}/i/${accountSlug}/${property.publicUrlSlug}`
      : null;

  async function togglePublished() {
    const next = !published;
    setPublishing(true);
    // Optimista: el interruptor responde al instante y se revierte si falla.
    setPublished(next);
    try {
      await apiCall(`/api/realty/properties/${property.id}/publish`, {
        method: "PATCH",
        json: { isPublished: next },
      });
      toast.success(next ? t("detail.published") : t("detail.unpublished"));
      refresh();
    } catch (e) {
      setPublished(!next);
      toast.error(e instanceof Error ? e.message : t("errors.generic"));
    } finally {
      setPublishing(false);
    }
  }

  async function removeProperty() {
    setDeleting(true);
    try {
      await apiCall(`/api/realty/properties/${property.id}`, { method: "DELETE" });
      toast.success(t("actions.deleted"));
      router.push("/inmobiliaria/inmuebles");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errors.generic"));
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  async function copyLink() {
    if (!publicUrl) {
      toast.error(t("actions.noPublicLink"));
      return;
    }
    try {
      await navigator.clipboard.writeText(publicUrl);
      toast.success(t("actions.linkCopied"));
    } catch {
      toast.error(t("actions.linkFailed"));
    }
  }

  const statusUi = REALTY_PROPERTY_STATUS_UI[property.status];

  return (
    <>
      <div className={`realty-page ${s.page}`}>
        <header className={s.detailHead}>
          <Link href="/inmobiliaria/inmuebles" className={s.crumb}>
            <ArrowLeft size={13} />
            {t("detail.backToList")}
          </Link>
          <div className={s.detailTitleRow}>
            <div className={s.headerText}>
              <h1 className={s.title}>{property.title}</h1>
              <div className={s.detailMeta}>
                <Badge tone={statusUi.tone}>{statusUi.label}</Badge>
                <span>{REALTY_PROPERTY_KIND_LABELS[property.kind]}</span>
                <span>·</span>
                <span>{REALTY_OPERATION_LABELS[property.operation]}</span>
                <span>·</span>
                <span>
                  {property.shortTermFolio
                    ? t("detail.folio", { folio: property.shortTermFolio })
                    : t("detail.noFolio")}
                </span>
                <span>·</span>
                <span>{t("detail.createdAt", { date: formatDate(property.createdAt, locale) })}</span>
              </div>
            </div>
            <div className={s.headerActions}>
              {publicUrl ? (
                <a
                  className={`${s.btn} ${s.btnSm}`}
                  href={publicUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink size={13} />
                  {t("actions.publicPage")}
                </a>
              ) : null}
              <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => void copyLink()}>
                <Link2 size={13} />
                {t("actions.copyLink")}
              </button>
              <a
                className={`${s.btn} ${s.btnSm}`}
                href={`/api/realty/properties/${property.id}/pdf`}
                target="_blank"
                rel="noreferrer"
              >
                <FileDown size={13} />
                {t("pdf.generate")}
              </a>
              {canEdit ? (
                <button
                  type="button"
                  className={`${s.btn} ${s.btnSm} ${s.btnDanger}`}
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 size={13} />
                  {t("actions.delete")}
                </button>
              ) : null}
            </div>
          </div>
        </header>

        {/* Interruptor de publicación: separado de las secciones porque
            afecta a toda la ficha, no a un grupo de campos. */}
        <section className={`${s.card} ${s.cardPad}`}>
          <div className={s.switchRow}>
            <span className={s.switchText}>
              <span className={s.cardTitle}>{t("detail.publish")}</span>
              <span className={s.hint} style={{ display: "block", marginTop: 2 }}>
                {t("detail.publishHint")}
              </span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={published}
              aria-label={t("detail.publish")}
              className={`${s.switch} ${published ? s.switchOn : ""}`}
              disabled={!canEdit || publishing}
              onClick={() => void togglePublished()}
            />
          </div>
        </section>

        <div className={s.detailGrid}>
          <div className={s.detailCols}>
            <div className={s.col}>
              <BasicsSection {...props} t={t} onSaved={refresh} />
              <PriceSection {...props} t={t} onSaved={refresh} />
              <MeasuresSection {...props} t={t} onSaved={refresh} />
              <AmenitiesSection {...props} t={t} onSaved={refresh} />
              <LocationSection {...props} t={t} onSaved={refresh} />
            </div>

            <div className={s.col}>
              <SectionCard
                title={t("detail.sections.galeria")}
                sub={t("detail.hints.galeria")}
              >
                <PropertyGallery
                  propertyId={property.id}
                  photos={property.photos}
                  usage={props.usage}
                  canEdit={canEdit}
                  hasLogo={props.hasLogo}
                  t={t}
                  onChanged={refresh}
                />
              </SectionCard>

              <SectionCard
                title={t("detail.sections.recorridos")}
                sub={t("detail.hints.recorridos")}
              >
                <PropertyTours
                  propertyId={property.id}
                  tours={property.tours}
                  usage={props.usage}
                  canEdit={canEdit}
                  t={t}
                  onChanged={refresh}
                />
              </SectionCard>

              <DocumentsSection {...props} t={t} onSaved={refresh} />

              {!isOwnerMode ? <OwnerSection {...props} t={t} onSaved={refresh} /> : null}
              {!isOwnerMode ? <ExclusiveSection {...props} t={t} onSaved={refresh} /> : null}

              <NotesSection {...props} t={t} onSaved={refresh} />
            </div>
          </div>
        </div>
      </div>

      {/* Fuera de .realty-page: container-type atrapa position:fixed. */}
      {confirmDelete ? (
        <Modal
          title={t("actions.confirmDelete")}
          subtitle={property.title}
          onClose={() => setConfirmDelete(false)}
          closeLabel={t("actions.cancel")}
          footer={
            <>
              <button
                type="button"
                className={`${s.btn} ${s.btnGhost}`}
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
              >
                {t("actions.cancel")}
              </button>
              <button
                type="button"
                className={`${s.btn} ${s.btnDanger}`}
                onClick={() => void removeProperty()}
                disabled={deleting}
              >
                {deleting ? <Loader2 size={14} className={s.spin} /> : <Trash2 size={14} />}
                {t("actions.delete")}
              </button>
            </>
          }
        >
          <p className={s.hint}>{t("actions.confirmDeleteBody")}</p>
        </Modal>
      ) : null}
    </>
  );
}

// ── Envoltorio de sección ──────────────────────────────────────────────
function SectionCard({
  title,
  sub,
  action,
  footer,
  children,
}: {
  title: string;
  sub?: string;
  action?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className={s.card}>
      <div className={s.cardHead}>
        <div className={s.cardHeadText}>
          <h2 className={s.cardTitle}>{title}</h2>
          {sub ? <p className={s.cardSub}>{sub}</p> : null}
        </div>
        {action}
      </div>
      <div className={`${s.cardBody} ${s.formGrid}`}>{children}</div>
      {footer ? <div className={s.cardFoot}>{footer}</div> : null}
    </section>
  );
}

type SectionProps = PropertyDetailProps & {
  t: ReturnType<typeof useRealtyT>;
  onSaved: () => void;
};

/** Botón de guardar + error de la sección. Se repite en las seis. */
function SaveFoot({
  t,
  saving,
  error,
  dirty,
  onSave,
  disabled,
}: {
  t: ReturnType<typeof useRealtyT>;
  saving: boolean;
  error: string | null;
  dirty: boolean;
  onSave: () => void;
  disabled?: boolean;
}) {
  return (
    <>
      <ErrorText>{error}</ErrorText>
      <button
        type="button"
        className={`${s.btn} realty-btn-primary`}
        onClick={onSave}
        disabled={disabled || saving || !dirty}
      >
        {saving ? <Loader2 size={14} className={s.spin} /> : <BadgeCheck size={14} />}
        {saving ? t("form.saving") : t("form.save")}
      </button>
    </>
  );
}

/** PATCH de una sección. Un solo lugar: todas mandan el mismo shape. */
async function patchSection(
  propertyId: string,
  section: string,
  data: Record<string, unknown>,
): Promise<void> {
  await apiCall(`/api/realty/properties/${propertyId}`, {
    method: "PATCH",
    json: { section, ...data },
  });
}

// ── 1. Básicos ─────────────────────────────────────────────────────────
function BasicsSection({ property, canEdit, t, onSaved }: SectionProps) {
  const [form, setForm] = useState({
    kind: property.kind as RealtyPropertyKind,
    operation: property.operation as RealtyOperation,
    status: property.status as RealtyPropertyStatus,
    title: property.title,
    description: property.description ?? "",
  });
  const { saving, error, setError, run } = useSaving();

  const dirty =
    form.kind !== property.kind ||
    form.operation !== property.operation ||
    form.status !== property.status ||
    form.title !== property.title ||
    form.description !== (property.description ?? "");

  async function save() {
    if (!form.title.trim()) {
      setError(t("errors.titleRequired"));
      return;
    }
    const ok = await run(async () => {
      await patchSection(property.id, "basicos", {
        kind: form.kind,
        operation: form.operation,
        status: form.status,
        title: form.title.trim(),
        description: form.description.trim() || null,
      });
    });
    if (ok) {
      toast.success(t("form.saved"));
      onSaved();
    }
  }

  return (
    <SectionCard
      title={t("detail.sections.basicos")}
      sub={t("detail.hints.basicos")}
      footer={
        canEdit ? (
          <SaveFoot t={t} saving={saving} error={error} dirty={dirty} onSave={() => void save()} />
        ) : null
      }
    >
      <div className={s.grid2}>
        <Field label={t("form.kind")} htmlFor="b-kind">
          <select
            id="b-kind"
            className={s.select}
            value={form.kind}
            disabled={!canEdit}
            onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as RealtyPropertyKind }))}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {REALTY_PROPERTY_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t("form.operation")} htmlFor="b-op">
          <select
            id="b-op"
            className={s.select}
            value={form.operation}
            disabled={!canEdit}
            onChange={(e) =>
              setForm((f) => ({ ...f, operation: e.target.value as RealtyOperation }))
            }
          >
            {OPERATIONS.map((o) => (
              <option key={o} value={o}>
                {REALTY_OPERATION_LABELS[o]}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t("form.status")} htmlFor="b-status">
          <select
            id="b-status"
            className={s.select}
            value={form.status}
            disabled={!canEdit}
            onChange={(e) =>
              setForm((f) => ({ ...f, status: e.target.value as RealtyPropertyStatus }))
            }
          >
            {STATUSES.map((st) => (
              <option key={st} value={st}>
                {REALTY_PROPERTY_STATUS_UI[st].label}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label={t("form.propertyTitle")}
          htmlFor="b-title"
          hint={t("form.titleHint")}
          wide
        >
          <input
            id="b-title"
            className={s.input}
            value={form.title}
            disabled={!canEdit}
            placeholder={t("form.titlePlaceholder")}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          />
        </Field>

        <Field label={t("form.description")} htmlFor="b-desc" wide>
          <textarea
            id="b-desc"
            className={s.textarea}
            value={form.description}
            disabled={!canEdit}
            placeholder={t("form.descriptionPlaceholder")}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
        </Field>
      </div>
    </SectionCard>
  );
}

// ── 2. Precio ──────────────────────────────────────────────────────────
function PriceSection({ property, canEdit, mode, t, onSaved }: SectionProps) {
  const isOwnerMode = mode === "OWNER";
  const [form, setForm] = useState({
    price: property.price ? String(property.price) : "",
    rentPrice: property.rentPrice !== null ? String(property.rentPrice) : "",
    currency: property.currency as RealtyCurrency,
    maintenanceFee: property.maintenanceFee !== null ? String(property.maintenanceFee) : "",
    commissionPct: property.commissionPct !== null ? String(property.commissionPct) : "",
  });
  const { saving, error, run } = useSaving();

  const initial = useMemo(
    () => ({
      price: property.price ? String(property.price) : "",
      rentPrice: property.rentPrice !== null ? String(property.rentPrice) : "",
      currency: property.currency,
      maintenanceFee: property.maintenanceFee !== null ? String(property.maintenanceFee) : "",
      commissionPct: property.commissionPct !== null ? String(property.commissionPct) : "",
    }),
    [property],
  );
  const dirty = (Object.keys(initial) as (keyof typeof initial)[]).some(
    (k) => form[k] !== initial[k],
  );

  async function save() {
    const ok = await run(async () => {
      await patchSection(property.id, "precio", {
        price: numOrNull(form.price) ?? 0,
        rentPrice: numOrNull(form.rentPrice),
        currency: form.currency,
        maintenanceFee: numOrNull(form.maintenanceFee),
        commissionPct: numOrNull(form.commissionPct),
      });
    });
    if (ok) {
      toast.success(t("form.saved"));
      onSaved();
    }
  }

  return (
    <SectionCard
      title={t("detail.sections.precio")}
      sub={t("detail.hints.precio")}
      footer={
        canEdit ? (
          <>
            <span className={s.footNote}>{t("form.priceNote")}</span>
            <SaveFoot t={t} saving={saving} error={error} dirty={dirty} onSave={() => void save()} />
          </>
        ) : null
      }
    >
      <div className={s.grid2}>
        <Field label={t("form.price")} htmlFor="p-price">
          <input
            id="p-price"
            className={s.input}
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={form.price}
            disabled={!canEdit}
            onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
          />
        </Field>

        <Field label={t("form.rentPrice")} htmlFor="p-rent">
          <input
            id="p-rent"
            className={s.input}
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={form.rentPrice}
            disabled={!canEdit}
            onChange={(e) => setForm((f) => ({ ...f, rentPrice: e.target.value }))}
          />
        </Field>

        <Field label={t("form.currency")} htmlFor="p-cur">
          <select
            id="p-cur"
            className={s.select}
            value={form.currency}
            disabled={!canEdit}
            onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value as RealtyCurrency }))}
          >
            <option value="MXN">MXN</option>
            <option value="USD">USD</option>
          </select>
        </Field>

        <Field label={t("form.maintenanceFee")} htmlFor="p-maint">
          <input
            id="p-maint"
            className={s.input}
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={form.maintenanceFee}
            disabled={!canEdit}
            onChange={(e) => setForm((f) => ({ ...f, maintenanceFee: e.target.value }))}
          />
        </Field>

        {/* La comisión es de quien vende para OTRO: en modo propietario no
            existe (el inmueble es suyo y no se cobra a sí mismo). */}
        {!isOwnerMode ? (
          <Field label={t("form.commissionPct")} htmlFor="p-comm">
            <input
              id="p-comm"
              className={s.input}
              type="number"
              min={0}
              max={100}
              step={0.1}
              inputMode="decimal"
              value={form.commissionPct}
              disabled={!canEdit}
              onChange={(e) => setForm((f) => ({ ...f, commissionPct: e.target.value }))}
            />
          </Field>
        ) : null}
      </div>
    </SectionCard>
  );
}

// ── 3. Medidas ─────────────────────────────────────────────────────────
function MeasuresSection({ property, canEdit, t, onSaved }: SectionProps) {
  const initial = useMemo(
    () => ({
      landM2: property.landM2 !== null ? String(property.landM2) : "",
      builtM2: property.builtM2 !== null ? String(property.builtM2) : "",
      bedrooms: property.bedrooms !== null ? String(property.bedrooms) : "",
      bathrooms: property.bathrooms !== null ? String(property.bathrooms) : "",
      halfBathrooms: property.halfBathrooms !== null ? String(property.halfBathrooms) : "",
      parking: property.parking !== null ? String(property.parking) : "",
      ageYears: property.ageYears !== null ? String(property.ageYears) : "",
      levels: property.levels !== null ? String(property.levels) : "",
    }),
    [property],
  );
  const [form, setForm] = useState(initial);
  const { saving, error, run } = useSaving();
  const dirty = (Object.keys(initial) as (keyof typeof initial)[]).some(
    (k) => form[k] !== initial[k],
  );

  async function save() {
    const ok = await run(async () => {
      await patchSection(property.id, "medidas", {
        landM2: numOrNull(form.landM2),
        builtM2: numOrNull(form.builtM2),
        bedrooms: numOrNull(form.bedrooms),
        bathrooms: numOrNull(form.bathrooms),
        halfBathrooms: numOrNull(form.halfBathrooms),
        parking: numOrNull(form.parking),
        ageYears: numOrNull(form.ageYears),
        levels: numOrNull(form.levels),
      });
    });
    if (ok) {
      toast.success(t("form.saved"));
      onSaved();
    }
  }

  const num = (key: keyof typeof form, label: string, id: string, step = 1) => (
    <Field label={label} htmlFor={id}>
      <input
        id={id}
        className={s.input}
        type="number"
        min={0}
        step={step}
        inputMode={step === 1 ? "numeric" : "decimal"}
        value={form[key]}
        disabled={!canEdit}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
      />
    </Field>
  );

  return (
    <SectionCard
      title={t("detail.sections.medidas")}
      sub={t("detail.hints.medidas")}
      footer={
        canEdit ? (
          <SaveFoot t={t} saving={saving} error={error} dirty={dirty} onSave={() => void save()} />
        ) : null
      }
    >
      <div className={s.grid2}>
        {num("landM2", t("form.landM2"), "m-land", 0.01)}
        {num("builtM2", t("form.builtM2"), "m-built", 0.01)}
        {num("bedrooms", t("form.bedrooms"), "m-bed")}
        {num("bathrooms", t("form.bathrooms"), "m-bath")}
        {num("halfBathrooms", t("form.halfBathrooms"), "m-half")}
        {num("parking", t("form.parking"), "m-park")}
        {num("ageYears", t("form.ageYears"), "m-age")}
        {num("levels", t("form.levels"), "m-levels")}
      </div>
    </SectionCard>
  );
}

// ── 4. Amenidades ──────────────────────────────────────────────────────
function AmenitiesSection({ property, canEdit, t, onSaved }: SectionProps) {
  const initial = useMemo(() => activeAmenityKeys(property.amenities).sort(), [property.amenities]);
  const [selected, setSelected] = useState<string[]>(initial);
  const { saving, error, run } = useSaving();

  const dirty =
    selected.length !== initial.length ||
    selected.slice().sort().some((k, i) => k !== initial[i]);

  // Amenidades libres que ya tenía guardadas la cuenta y no están en el
  // catálogo: se siguen enseñando para poder desmarcarlas.
  const catalogKeys = REALTY_AMENITIES.map((a) => a.key as string);
  const extras = initial.filter((k) => !catalogKeys.includes(k));

  function toggle(key: string) {
    setSelected((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }

  async function save() {
    const ok = await run(async () => {
      await patchSection(property.id, "amenidades", { amenities: selected });
    });
    if (ok) {
      toast.success(t("form.saved"));
      onSaved();
    }
  }

  return (
    <SectionCard
      title={t("detail.sections.amenidades")}
      sub={t("detail.hints.amenidades")}
      footer={
        canEdit ? (
          <SaveFoot t={t} saving={saving} error={error} dirty={dirty} onSave={() => void save()} />
        ) : null
      }
    >
      <div className={s.amenityGrid}>
        {REALTY_AMENITIES.map((a) => (
          <label key={a.key} className={s.amenity}>
            <input
              type="checkbox"
              checked={selected.includes(a.key)}
              disabled={!canEdit}
              onChange={() => toggle(a.key)}
            />
            {a.label}
          </label>
        ))}
        {extras.map((k) => (
          <label key={k} className={s.amenity}>
            <input
              type="checkbox"
              checked={selected.includes(k)}
              disabled={!canEdit}
              onChange={() => toggle(k)}
            />
            {realtyAmenityLabel(k)}
          </label>
        ))}
      </div>
    </SectionCard>
  );
}

// ── 5. Ubicación ───────────────────────────────────────────────────────
function LocationSection({ property, canEdit, t, onSaved }: SectionProps) {
  const initial = useMemo(
    () => ({
      address: property.address ?? "",
      colonia: property.colonia ?? "",
      city: property.city ?? "",
      state: property.state ?? "",
      zip: property.zip ?? "",
      showExactAddress: property.showExactAddress,
      lat: property.lat,
      lng: property.lng,
    }),
    [property],
  );
  const [form, setForm] = useState(initial);
  const { saving, error, run } = useSaving();

  const dirty =
    form.address !== initial.address ||
    form.colonia !== initial.colonia ||
    form.city !== initial.city ||
    form.state !== initial.state ||
    form.zip !== initial.zip ||
    form.showExactAddress !== initial.showExactAddress ||
    form.lat !== initial.lat ||
    form.lng !== initial.lng;

  async function save() {
    const ok = await run(async () => {
      await patchSection(property.id, "ubicacion", {
        address: form.address.trim() || null,
        colonia: form.colonia.trim() || null,
        city: form.city.trim() || null,
        state: form.state.trim() || null,
        zip: form.zip.trim() || null,
        lat: form.lat,
        lng: form.lng,
        showExactAddress: form.showExactAddress,
      });
    });
    if (ok) {
      toast.success(t("form.saved"));
      onSaved();
    }
  }

  const text = (key: "address" | "colonia" | "city" | "state" | "zip", label: string, id: string) => (
    <Field label={label} htmlFor={id}>
      <input
        id={id}
        className={s.input}
        value={form[key]}
        disabled={!canEdit}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
      />
    </Field>
  );

  return (
    <SectionCard
      title={t("detail.sections.ubicacion")}
      sub={t("detail.hints.ubicacion")}
      footer={
        canEdit ? (
          <SaveFoot t={t} saving={saving} error={error} dirty={dirty} onSave={() => void save()} />
        ) : null
      }
    >
      <div className={s.grid2}>
        {text("address", t("form.address"), "u-addr")}
        {text("colonia", t("form.colonia"), "u-col")}
        {text("city", t("form.city"), "u-city")}
        {text("state", t("form.state"), "u-state")}
        {text("zip", t("form.zip"), "u-zip")}
      </div>

      {/* La privacidad NO es un adorno: en México nadie publica el número
          exacto de una casa habitada. Nace apagado. */}
      <label className={s.checkRow} style={{ marginTop: 14 }}>
        <input
          type="checkbox"
          checked={form.showExactAddress}
          disabled={!canEdit}
          onChange={(e) => setForm((f) => ({ ...f, showExactAddress: e.target.checked }))}
        />
        <span className={s.checkBody}>
          <span className={s.checkTitle}>{t("form.showExactAddress")}</span>
          <span className={s.hint} style={{ display: "block" }}>
            {t("form.showExactAddressHint")}
          </span>
        </span>
      </label>

      <div style={{ marginTop: 14 }}>
        <span className={s.label}>{t("form.map")}</span>
        <div style={{ marginTop: 6 }}>
          <PropertyMap
            lat={form.lat}
            lng={form.lng}
            dragHint={t("form.mapHint")}
            emptyHint={t("form.mapEmpty")}
            clearLabel={t("form.mapClear")}
            onChange={(c) =>
              setForm((f) => ({ ...f, lat: c ? c.lat : null, lng: c ? c.lng : null }))
            }
          />
        </div>
      </div>
    </SectionCard>
  );
}

// ── 6. Documentos ──────────────────────────────────────────────────────
function DocumentsSection({ property, canEdit, usage, t, onSaved }: SectionProps) {
  const [kind, setKind] = useState<RealtyDocumentKind>("ESCRITURA");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function upload(file: File) {
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("kind", kind);
      const res = await fetch(`/api/realty/properties/${property.id}/documents`, {
        method: "POST",
        body: form,
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(json.error ?? t("errors.uploadFailed"));
        return;
      }
      toast.success(t("documents.uploaded"));
      onSaved();
    } catch {
      toast.error(t("errors.uploadFailed"));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove(id: string) {
    if (!window.confirm(t("documents.confirmDelete"))) return;
    try {
      await apiCall(`/api/realty/properties/${property.id}/documents/${id}`, {
        method: "DELETE",
      });
      toast.success(t("documents.deleted"));
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errors.generic"));
    }
  }

  return (
    <SectionCard title={t("detail.sections.documentos")} sub={t("detail.hints.documentos")}>
      <div className={`${s.notice}`} style={{ marginBottom: 12 }}>
        <Lock size={14} className={s.noticeIcon} />
        <span>{t("documents.privateNote")}</span>
      </div>

      {canEdit ? (
        <div className={s.grid2} style={{ marginBottom: 12 }}>
          <Field label={t("documents.kind")} htmlFor="d-kind">
            <select
              id="d-kind"
              className={s.select}
              value={kind}
              onChange={(e) => setKind(e.target.value as RealtyDocumentKind)}
            >
              {DOC_KINDS.map((k) => (
                <option key={k} value={k}>
                  {REALTY_DOCUMENT_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </Field>
          <div className={s.field} style={{ justifyContent: "flex-end" }}>
            <button
              type="button"
              className={s.btn}
              onClick={() => inputRef.current?.click()}
              disabled={busy || usage.full}
            >
              {busy ? <Loader2 size={14} className={s.spin} /> : <Upload size={14} />}
              {busy ? t("documents.uploading") : t("documents.choose")}
            </button>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
              }}
            />
          </div>
        </div>
      ) : null}

      {property.documents.length === 0 ? (
        <p className={s.hint}>{t("documents.empty")}</p>
      ) : (
        <div className={s.docList}>
          {property.documents.map((doc) => (
            <div key={doc.id} className={s.docRow}>
              <span className={s.docIcon}>
                <FileText size={15} />
              </span>
              <span className={s.docBody}>
                <span className={s.docName}>{doc.name}</span>
                <span className={s.docMeta}>
                  {REALTY_DOCUMENT_KIND_LABELS[doc.kind]} · {formatBytes(doc.bytes)}
                </span>
              </span>
              <span className={s.rowActions}>
                {doc.url ? (
                  <a
                    className={s.iconBtn}
                    href={doc.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={t("documents.open")}
                    title={t("documents.open")}
                  >
                    <ExternalLink size={12} />
                  </a>
                ) : null}
                {canEdit ? (
                  <button
                    type="button"
                    className={s.iconBtn}
                    onClick={() => void remove(doc.id)}
                    aria-label={t("documents.delete")}
                    title={t("documents.delete")}
                  >
                    <Trash2 size={12} />
                  </button>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

// ── 7. Propietario y asesor ────────────────────────────────────────────
function OwnerSection({
  property,
  owners,
  agents,
  canEdit,
  canManageOwners,
  t,
  onSaved,
}: SectionProps) {
  const [ownerId, setOwnerId] = useState(property.ownerId ?? "");
  const [agentId, setAgentId] = useState(property.assignedUserId ?? "");
  const [list, setList] = useState<OwnerOption[]>(owners);
  const [quickOpen, setQuickOpen] = useState(false);
  const { saving, error, run } = useSaving();

  const dirty = ownerId !== (property.ownerId ?? "") || agentId !== (property.assignedUserId ?? "");

  async function save() {
    const ok = await run(async () => {
      await patchSection(property.id, "propietario", {
        ownerId: ownerId || null,
        assignedUserId: agentId || null,
      });
    });
    if (ok) {
      toast.success(t("form.saved"));
      onSaved();
    }
  }

  return (
    <>
      <SectionCard
        title={t("detail.sections.propietario")}
        sub={t("detail.hints.propietario")}
        action={
          canEdit && canManageOwners ? (
            <button
              type="button"
              className={`${s.btn} ${s.btnSm}`}
              onClick={() => setQuickOpen(true)}
            >
              <Plus size={13} />
              {t("form.ownerNew")}
            </button>
          ) : null
        }
        footer={
          canEdit ? (
            <SaveFoot t={t} saving={saving} error={error} dirty={dirty} onSave={() => void save()} />
          ) : null
        }
      >
        <div className={s.grid2}>
          <Field label={t("form.owner")} htmlFor="o-owner">
            <select
              id="o-owner"
              className={s.select}
              value={ownerId}
              disabled={!canEdit}
              onChange={(e) => setOwnerId(e.target.value)}
            >
              <option value="">{t("form.ownerNone")}</option>
              {list.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                  {o.phone ? ` · ${o.phone}` : ""}
                </option>
              ))}
            </select>
          </Field>

          <Field label={t("form.agent")} htmlFor="o-agent">
            <select
              id="o-agent"
              className={s.select}
              value={agentId}
              disabled={!canEdit}
              onChange={(e) => setAgentId(e.target.value)}
            >
              <option value="">{t("form.agentNone")}</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {property.ownerId ? (
          <p className={s.hint} style={{ marginTop: 10 }}>
            <Link href={`/inmobiliaria/propietarios/${property.ownerId}`} className={s.contactLink}>
              {property.ownerName ?? t("owners.open")}
            </Link>
          </p>
        ) : null}
      </SectionCard>

      {quickOpen ? (
        <QuickOwnerModal
          t={t}
          onClose={() => setQuickOpen(false)}
          onCreated={(owner) => {
            setList((prev) => [...prev, owner].sort((a, b) => a.name.localeCompare(b.name, "es")));
            setOwnerId(owner.id);
            setQuickOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

/** Alta rápida: el dueño se captura sin salir de la ficha del inmueble. */
function QuickOwnerModal({
  t,
  onClose,
  onCreated,
}: {
  t: ReturnType<typeof useRealtyT>;
  onClose: () => void;
  onCreated: (owner: OwnerOption) => void;
}) {
  const [form, setForm] = useState({ name: "", phone: "", email: "" });
  const { saving, error, setError, run } = useSaving();

  async function submit() {
    if (!form.name.trim()) {
      setError(t("owners.nameRequired"));
      return;
    }
    const ok = await run(async () => {
      const res = await apiCall<{ owner: { id: string; name: string } }>(
        "/api/realty/owners",
        {
          method: "POST",
          json: {
            name: form.name.trim(),
            phone: form.phone.trim() || null,
            email: form.email.trim() || null,
          },
        },
      );
      onCreated({ id: res.owner.id, name: res.owner.name, phone: form.phone.trim() || null });
    });
    if (ok) toast.success(t("owners.created"));
  }

  return (
    <Modal
      title={t("form.ownerNew")}
      onClose={onClose}
      closeLabel={t("actions.cancel")}
      footer={
        <>
          <button
            type="button"
            className={`${s.btn} ${s.btnGhost}`}
            onClick={onClose}
            disabled={saving}
          >
            {t("actions.cancel")}
          </button>
          <button
            type="button"
            className={`${s.btn} realty-btn-primary`}
            onClick={() => void submit()}
            disabled={saving}
          >
            {saving ? <Loader2 size={14} className={s.spin} /> : <Plus size={14} />}
            {saving ? t("owners.creating") : t("owners.create")}
          </button>
        </>
      }
    >
      <Field label={t("owners.name")} htmlFor="qo-name">
        <input
          id="qo-name"
          className={s.input}
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        />
      </Field>
      <Field label={t("owners.phone")} htmlFor="qo-phone">
        <input
          id="qo-phone"
          className={s.input}
          inputMode="tel"
          value={form.phone}
          onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
        />
      </Field>
      <Field label={t("owners.email")} htmlFor="qo-email">
        <input
          id="qo-email"
          className={s.input}
          type="email"
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
        />
      </Field>
      <ErrorText>{error}</ErrorText>
    </Modal>
  );
}

// ── 8. Exclusiva ───────────────────────────────────────────────────────
function ExclusiveSection({ property, owners, canEdit, canManageOwners, t, onSaved }: SectionProps) {
  const exc = property.exclusive;
  const initial = useMemo(
    () => ({
      ownerId: exc?.ownerId ?? property.ownerId ?? "",
      startsAt: exc ? exc.startsAt.slice(0, 10) : "",
      endsAt: exc ? exc.endsAt.slice(0, 10) : "",
      commissionPct: exc ? String(exc.commissionPct) : "",
    }),
    [exc, property.ownerId],
  );
  const [form, setForm] = useState(initial);
  const { saving, error, setError, run } = useSaving();

  const dirty = (Object.keys(initial) as (keyof typeof initial)[]).some(
    (k) => form[k] !== initial[k],
  );
  const editable = canEdit && canManageOwners;

  async function save() {
    if (!form.ownerId) {
      setError(t("exclusive.needOwner"));
      return;
    }
    if (!form.startsAt || !form.endsAt || form.endsAt <= form.startsAt) {
      setError(t("exclusive.badDates"));
      return;
    }
    const ok = await run(async () => {
      await apiCall(`/api/realty/properties/${property.id}/exclusive`, {
        method: "PUT",
        json: {
          ownerId: form.ownerId,
          startsAt: form.startsAt,
          endsAt: form.endsAt,
          commissionPct: numOrNull(form.commissionPct) ?? 0,
        },
      });
    });
    if (ok) {
      toast.success(t("exclusive.saved"));
      onSaved();
    }
  }

  async function remove() {
    if (!window.confirm(t("exclusive.confirmDelete"))) return;
    try {
      await apiCall(`/api/realty/properties/${property.id}/exclusive`, { method: "DELETE" });
      toast.success(t("exclusive.deleted"));
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errors.generic"));
    }
  }

  const status = !exc
    ? null
    : exc.isActive
      ? exc.daysLeft <= REALTY_EXCLUSIVE_WARN_DAYS
        ? {
            tone: "warning" as const,
            label:
              exc.daysLeft <= 0
                ? t("exclusive.endsToday")
                : t("exclusive.daysLeft", { count: exc.daysLeft }),
          }
        : { tone: "success" as const, label: t("exclusive.active") }
      : exc.daysLeft < 0
        ? { tone: "neutral" as const, label: t("exclusive.expired") }
        : { tone: "info" as const, label: t("exclusive.future") };

  return (
    <SectionCard
      title={t("detail.sections.exclusiva")}
      sub={t("detail.hints.exclusiva")}
      action={status ? <Badge tone={status.tone}>{status.label}</Badge> : null}
      footer={
        editable ? (
          <>
            {exc ? (
              <button
                type="button"
                className={`${s.btn} ${s.btnSm} ${s.btnGhost}`}
                style={{ marginRight: "auto" }}
                onClick={() => void remove()}
              >
                <Trash2 size={13} />
                {t("exclusive.delete")}
              </button>
            ) : null}
            <ErrorText>{error}</ErrorText>
            <button
              type="button"
              className={`${s.btn} realty-btn-primary`}
              onClick={() => void save()}
              disabled={saving || !dirty}
            >
              {saving ? <Loader2 size={14} className={s.spin} /> : <BadgeCheck size={14} />}
              {saving ? t("form.saving") : t("exclusive.save")}
            </button>
          </>
        ) : null
      }
    >
      {!exc && !editable ? <p className={s.hint}>{t("exclusive.none")}</p> : null}

      <div className={s.grid2}>
        <Field label={t("exclusive.owner")} htmlFor="e-owner" wide>
          <select
            id="e-owner"
            className={s.select}
            value={form.ownerId}
            disabled={!editable}
            onChange={(e) => setForm((f) => ({ ...f, ownerId: e.target.value }))}
          >
            <option value="">{t("form.ownerNone")}</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t("exclusive.startsAt")} htmlFor="e-start">
          <input
            id="e-start"
            className={s.input}
            type="date"
            value={form.startsAt}
            disabled={!editable}
            onChange={(e) => setForm((f) => ({ ...f, startsAt: e.target.value }))}
          />
        </Field>

        <Field label={t("exclusive.endsAt")} htmlFor="e-end">
          <input
            id="e-end"
            className={s.input}
            type="date"
            value={form.endsAt}
            disabled={!editable}
            onChange={(e) => setForm((f) => ({ ...f, endsAt: e.target.value }))}
          />
        </Field>

        <Field label={t("exclusive.commissionPct")} htmlFor="e-pct">
          <input
            id="e-pct"
            className={s.input}
            type="number"
            min={0}
            max={100}
            step={0.1}
            inputMode="decimal"
            value={form.commissionPct}
            disabled={!editable}
            onChange={(e) => setForm((f) => ({ ...f, commissionPct: e.target.value }))}
          />
        </Field>

        {exc?.signedDocUrl ? (
          <div className={s.field}>
            <span className={s.label}>{t("exclusive.signedDoc")}</span>
            <a
              className={`${s.btn} ${s.btnSm}`}
              href={exc.signedDocUrl}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink size={13} />
              {t("exclusive.signedDocOpen")}
            </a>
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}

// ── 9. Notas internas ──────────────────────────────────────────────────
function NotesSection({ property, canEdit, t, onSaved }: SectionProps) {
  const [notes, setNotes] = useState(property.internalNotes ?? "");
  const { saving, error, run } = useSaving();
  const dirty = notes !== (property.internalNotes ?? "");

  async function save() {
    const ok = await run(async () => {
      await patchSection(property.id, "notas", { internalNotes: notes.trim() || null });
    });
    if (ok) {
      toast.success(t("form.saved"));
      onSaved();
    }
  }

  return (
    <SectionCard
      title={t("detail.sections.notas")}
      sub={t("detail.hints.notas")}
      footer={
        canEdit ? (
          <SaveFoot t={t} saving={saving} error={error} dirty={dirty} onSave={() => void save()} />
        ) : null
      }
    >
      <textarea
        className={s.textarea}
        value={notes}
        disabled={!canEdit}
        placeholder={t("form.internalNotesPlaceholder")}
        aria-label={t("form.internalNotes")}
        onChange={(e) => setNotes(e.target.value)}
      />
    </SectionCard>
  );
}

// ── Alta: la pantalla de "nuevo inmueble" ──────────────────────────────
export function NewPropertyForm({
  dict,
  canEdit,
}: {
  dict: Dictionary;
  canEdit: boolean;
}) {
  const t = useRealtyT(dict);
  const router = useRouter();
  const [form, setForm] = useState({
    title: "",
    kind: "CASA" as RealtyPropertyKind,
    operation: "VENTA" as RealtyOperation,
    price: "",
    currency: "MXN" as RealtyCurrency,
    colonia: "",
    city: "",
  });
  const { saving, error, setError, run } = useSaving();

  async function submit() {
    if (!form.title.trim()) {
      setError(t("errors.titleRequired"));
      return;
    }
    await run(async () => {
      const res = await apiCall<{ id: string }>("/api/realty/properties", {
        method: "POST",
        json: {
          title: form.title.trim(),
          kind: form.kind,
          operation: form.operation,
          price: numOrNull(form.price) ?? 0,
          currency: form.currency,
          colonia: form.colonia.trim() || null,
          city: form.city.trim() || null,
        },
      });
      toast.success(t("new.created"));
      // Directo a la ficha: el alta sirve para EMPEZAR, no para terminar.
      router.push(`/inmobiliaria/inmuebles/${res.id}`);
    });
  }

  return (
    <div className={`realty-page ${s.page}`}>
      <header className={s.detailHead}>
        <Link href="/inmobiliaria/inmuebles" className={s.crumb}>
          <ArrowLeft size={13} />
          {t("detail.backToList")}
        </Link>
        <h1 className={s.title}>{t("new.title")}</h1>
        <p className={s.subtitle}>{t("new.subtitle")}</p>
      </header>

      <section className={s.card} style={{ maxWidth: 720 }}>
        <div className={`${s.cardBody} ${s.formGrid}`}>
          <div className={s.grid2}>
            <Field label={t("form.propertyTitle")} htmlFor="n-title" hint={t("form.titleHint")} wide>
              <input
                id="n-title"
                className={s.input}
                value={form.title}
                placeholder={t("form.titlePlaceholder")}
                disabled={!canEdit}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              />
            </Field>

            <Field label={t("form.kind")} htmlFor="n-kind">
              <select
                id="n-kind"
                className={s.select}
                value={form.kind}
                disabled={!canEdit}
                onChange={(e) =>
                  setForm((f) => ({ ...f, kind: e.target.value as RealtyPropertyKind }))
                }
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {REALTY_PROPERTY_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            </Field>

            <Field label={t("form.operation")} htmlFor="n-op">
              <select
                id="n-op"
                className={s.select}
                value={form.operation}
                disabled={!canEdit}
                onChange={(e) =>
                  setForm((f) => ({ ...f, operation: e.target.value as RealtyOperation }))
                }
              >
                {OPERATIONS.map((o) => (
                  <option key={o} value={o}>
                    {REALTY_OPERATION_LABELS[o]}
                  </option>
                ))}
              </select>
            </Field>

            <Field label={t("form.price")} htmlFor="n-price">
              <input
                id="n-price"
                className={s.input}
                type="number"
                min={0}
                inputMode="numeric"
                value={form.price}
                disabled={!canEdit}
                onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
              />
            </Field>

            <Field label={t("form.currency")} htmlFor="n-cur">
              <select
                id="n-cur"
                className={s.select}
                value={form.currency}
                disabled={!canEdit}
                onChange={(e) =>
                  setForm((f) => ({ ...f, currency: e.target.value as RealtyCurrency }))
                }
              >
                <option value="MXN">MXN</option>
                <option value="USD">USD</option>
              </select>
            </Field>

            <Field label={t("form.colonia")} htmlFor="n-col">
              <input
                id="n-col"
                className={s.input}
                value={form.colonia}
                disabled={!canEdit}
                onChange={(e) => setForm((f) => ({ ...f, colonia: e.target.value }))}
              />
            </Field>

            <Field label={t("form.city")} htmlFor="n-city">
              <input
                id="n-city"
                className={s.input}
                value={form.city}
                disabled={!canEdit}
                onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
              />
            </Field>
          </div>
        </div>
        <div className={s.cardFoot}>
          <ErrorText>{error}</ErrorText>
          <button
            type="button"
            className={`${s.btn} realty-btn-primary`}
            onClick={() => void submit()}
            disabled={!canEdit || saving}
          >
            {saving ? <Loader2 size={14} className={s.spin} /> : <Building2 size={14} />}
            {saving ? t("new.creating") : t("new.create")}
          </button>
        </div>
      </section>
    </div>
  );
}
