"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, CalendarClock, Contact, Pencil, Plus, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import type { BarberCommissionType } from "@/lib/barber/types";
import { esFotoSubida } from "@/lib/barber/barber-photo";
import { prepararFoto } from "@/components/barber/landing/imagen";
import type { BarberProfileRow, BarberSeatLimit } from "@/lib/barber/team";
import type { AdminBranchOption } from "./admin-nav";
import {
  adminStyles as s,
  apiCall,
  Avatar,
  Banner,
  Btn,
  Chip,
  EmptyState,
  ErrorText,
  Field,
  Modal,
  Segmented,
  Select,
  SwitchRow,
  TextArea,
  TextInput,
  useSaving,
  useT,
} from "./admin-ui";

// ═══════════════════════════════════════════════════════════════════════
// /barber/barberos — la ficha del profesional.
//
// Administra los campos que consumen las otras terminales (agenda, caja,
// comisiones, mini-web). NO calcula pagos: eso es de la ola de caja; aquí
// solo se guardan commissionType / commissionPct / chairRent.
// ═══════════════════════════════════════════════════════════════════════

type FormState = {
  id: string | null;
  name: string;
  nickname: string;
  photoUrl: string;
  bio: string;
  commissionType: BarberCommissionType;
  commissionPct: string;
  chairRent: string;
  isActive: boolean;
  barbershopId: string;
};

function emptyForm(barbershopId: string): FormState {
  return {
    id: null,
    name: "",
    nickname: "",
    photoUrl: "",
    bio: "",
    commissionType: "COMMISSION",
    commissionPct: "50",
    chairRent: "",
    isActive: true,
    barbershopId,
  };
}

function toForm(b: BarberProfileRow): FormState {
  return {
    id: b.id,
    name: b.name,
    nickname: b.nickname ?? "",
    photoUrl: b.photoUrl ?? "",
    bio: b.bio ?? "",
    commissionType: b.commissionType,
    commissionPct: b.commissionPct === null ? "" : String(b.commissionPct),
    chairRent: b.chairRent === null ? "" : String(b.chairRent),
    isActive: b.isActive,
    barbershopId: b.barbershopId,
  };
}

export function BarbersClient({
  initialBarbers,
  seat,
  branches,
  activeBranchId,
  isConsolidated,
}: {
  initialBarbers: BarberProfileRow[];
  seat: BarberSeatLimit;
  branches: AdminBranchOption[];
  activeBranchId: string | null;
  isConsolidated: boolean;
}) {
  const t = useT();
  const [barbers, setBarbers] = useState(initialBarbers);
  const [form, setForm] = useState<FormState | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const { saving, error, setError, run } = useSaving();

  const branchLabelById = useMemo(
    () => new Map(branches.map((b) => [b.id, b.label])),
    [branches],
  );

  // El contador es el del servidor (toda la cadena) CORREGIDO por lo que pasó
  // en esta pantalla: dar de alta, dar de baja o reactivar a un barbero mueve
  // el número y el tope sin recargar. Se parte del dato del servidor y se le
  // suma la diferencia de barberos ACTIVOS desde que cargó la página.
  const activeNow = barbers.filter((b) => b.isActive).length;
  const activeAtLoad = useMemo(
    () => initialBarbers.filter((b) => b.isActive).length,
    [initialBarbers],
  );
  const used = Math.max(0, seat.used + (activeNow - activeAtLoad));
  const seatCanCreate = seat.unlimited || used < seat.max;

  const seatText = seat.unlimited
    ? t("barbers.seatUnlimited", { used, plan: seat.planName })
    : t("barbers.seat", { used, max: seat.max, plan: seat.planName });

  const writeBranchId = activeBranchId ?? branches[0]?.id ?? "";
  const canCreate = seatCanCreate && !isConsolidated;

  function patch(next: Partial<FormState>) {
    setForm((f) => (f ? { ...f, ...next } : f));
  }

  // ── Foto subida desde el teléfono ────────────────────────────────────
  // La foto se elige y se COMPRIME ya (un celular da 8–15 MB y el servidor
  // corta en 4), pero se sube al GUARDAR: así un barbero nuevo ya tiene id
  // para su carpeta y la ficha y la foto se guardan con un solo botón.
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  // «Quitar foto» en un barbero que ya existe: al guardar, el servidor borra
  // también el archivo del bucket (no basta con vaciar la liga de la ficha).
  const [photoRemoved, setPhotoRemoved] = useState(false);

  // La vista previa es una URL de objeto: se suelta al cambiarla y al salir.
  useEffect(() => {
    return () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview);
    };
  }, [photoPreview]);

  function openForm(next: FormState | null) {
    setPhotoFile(null);
    setPhotoPreview(null);
    setPhotoRemoved(false);
    setForm(next);
  }

  async function pickPhoto(file: File) {
    setError(null);
    try {
      const listo = await prepararFoto(file);
      setPhotoFile(listo);
      setPhotoPreview(URL.createObjectURL(listo));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.genericError"));
    }
  }

  function removePhoto() {
    setPhotoFile(null);
    setPhotoPreview(null);
    if (form?.id && form.photoUrl) setPhotoRemoved(true);
    patch({ photoUrl: "" });
  }

  async function save() {
    if (!form) return;
    const payload = {
      name: form.name,
      nickname: form.nickname,
      photoUrl: form.photoUrl,
      bio: form.bio,
      commissionType: form.commissionType,
      commissionPct: form.commissionType === "COMMISSION" ? form.commissionPct : null,
      chairRent: form.commissionType === "CHAIR_RENT" ? form.chairRent : null,
      isActive: form.isActive,
      barbershopId: form.barbershopId,
    };
    const ok = await run(async () => {
      let saved: BarberProfileRow;
      // Primero se borra el archivo (el servidor lo lee de la ficha): si se
      // vaciara photoUrl antes, ya no sabría cuál objeto quitar del bucket.
      if (form.id && photoRemoved) {
        const res = await fetch(`/api/barber/team/barbers/${form.id}/photo`, { method: "DELETE" });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error || t("common.genericError"));
        }
        setPhotoRemoved(false);
      }
      if (form.id) {
        const { barber } = await apiCall<{ barber: BarberProfileRow }>(
          `/api/barber/team/barbers/${form.id}`,
          { method: "PATCH", json: payload },
        );
        saved = barber;
        setBarbers((list) => list.map((b) => (b.id === barber.id ? barber : b)));
      } else {
        const { barber } = await apiCall<{ barber: BarberProfileRow }>(
          "/api/barber/team/barbers",
          { method: "POST", json: payload },
        );
        saved = barber;
        setBarbers((list) => [...list, barber]);
        // Ya existe: si la foto falla, reintentar NO debe crear otro barbero.
        patch({ id: barber.id });
      }

      if (photoFile) {
        const body = new FormData();
        body.append("file", photoFile);
        const res = await fetch(`/api/barber/team/barbers/${saved.id}/photo`, { method: "POST", body });
        const data = (await res.json().catch(() => ({}))) as { photoUrl?: string; error?: string };
        if (!res.ok || !data.photoUrl) {
          throw new Error(
            t("barbers.photoSavedNoUpload", { error: data.error || t("common.genericError") }),
          );
        }
        const photoUrl = data.photoUrl;
        setBarbers((list) => list.map((b) => (b.id === saved.id ? { ...b, photoUrl } : b)));
      }
    });
    if (ok) openForm(null);
  }

  async function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= barbers.length) return;
    const next = barbers.slice();
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    setBarbers(next);
    setListError(null);
    try {
      await apiCall("/api/barber/team/barbers/reorder", {
        method: "POST",
        json: { barbershopId: writeBranchId, ids: next.map((b) => b.id) },
      });
    } catch (err) {
      setBarbers(barbers);
      setListError(err instanceof Error ? err.message : t("common.genericError"));
    }
  }

  function payChip(b: BarberProfileRow) {
    if (b.commissionType === "COMMISSION") {
      return `${t("barbers.payCommission")} · ${b.commissionPct ?? 0}%`;
    }
    if (b.commissionType === "CHAIR_RENT") {
      return `${t("barbers.payChairRent")} · $${b.chairRent ?? 0} ${t("barbers.perMonth")}`;
    }
    return t("barbers.paySalary");
  }

  return (
    <>
      <header className={s.header}>
        <div className={s.headerText}>
          <h1 className={s.title}>{t("barbers.title")}</h1>
          <p className={s.subtitle}>{t("barbers.subtitle")}</p>
        </div>
        <div className={s.headerActions}>
          <Chip tone={seatCanCreate ? undefined : "warn"}>{seatText}</Chip>
          <Btn
            variant="primary"
            onClick={() => openForm(emptyForm(writeBranchId))}
            disabled={!canCreate}
          >
            <Plus size={15} />
            {t("barbers.new")}
          </Btn>
        </div>
      </header>

      {isConsolidated ? (
        <Banner icon={<Contact size={16} />}>
          {t("branch.consolidatedHint", { count: branches.length })}
        </Banner>
      ) : null}

      {!seatCanCreate && !isConsolidated ? (
        <Banner tone="danger">{t("barbers.seatFull", { plan: seat.planName })}</Banner>
      ) : null}

      {listError ? <ErrorText>{listError}</ErrorText> : null}

      {barbers.length === 0 ? (
        <div className={s.card}>
          <EmptyState
            icon={<Contact size={22} />}
            title={t("barbers.empty")}
            action={
              canCreate ? (
                <Btn variant="primary" onClick={() => openForm(emptyForm(writeBranchId))}>
                  <Plus size={15} />
                  {t("barbers.emptyCta")}
                </Btn>
              ) : undefined
            }
          />
        </div>
      ) : (
        <>
          <p className={s.hint}>{t("barbers.orderHint")}</p>
          <div className={s.grid}>
            {barbers.map((b, i) => (
              <article
                key={b.id}
                className={[s.rowCard, b.isActive ? "" : s.rowCardMuted].filter(Boolean).join(" ")}
              >
                <Avatar name={b.name} url={b.photoUrl} />
                <div className={s.rowMain}>
                  <div className={s.rowTitle}>
                    <span className={s.truncate}>{b.name}</span>
                    {b.nickname ? (
                      <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--text-3)" }}>
                        {b.nickname}
                      </span>
                    ) : null}
                  </div>
                  <div className={s.rowMeta}>
                    <Chip tone="brand">{payChip(b)}</Chip>
                    {!b.isActive ? <Chip tone="muted">{t("common.inactive")}</Chip> : null}
                    {isConsolidated ? (
                      <Chip tone="muted">{branchLabelById.get(b.barbershopId) ?? ""}</Chip>
                    ) : null}
                  </div>
                  {b.bio ? (
                    <p className={s.hint} style={{ marginTop: 2 }}>
                      {b.bio.length > 120 ? `${b.bio.slice(0, 120)}...` : b.bio}
                    </p>
                  ) : null}
                  <div className={s.rowActions}>
                    <Btn size="sm" onClick={() => openForm(toForm(b))}>
                      <Pencil size={13} />
                      {t("common.edit")}
                    </Btn>
                  </div>
                </div>
                {!isConsolidated ? (
                  <div className={s.orderCol}>
                    <Btn
                      size="sm"
                      variant="ghost"
                      aria-label={t("common.moveUp")}
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                    >
                      <ArrowUp size={14} />
                    </Btn>
                    <Btn
                      size="sm"
                      variant="ghost"
                      aria-label={t("common.moveDown")}
                      disabled={i === barbers.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      <ArrowDown size={14} />
                    </Btn>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </>
      )}

      <Banner
        title={t("barbers.scheduleTitle")}
        icon={<CalendarClock size={16} />}
        action={
          <Link href="/barber/agenda/horarios" className={[s.btn, s.btnSm].join(" ")}>
            {t("barbers.scheduleLink")}
          </Link>
        }
      >
        {t("barbers.scheduleBody")}
      </Banner>

      {form ? (
        <Modal
          title={form.id ? t("barbers.formEdit") : t("barbers.formNew")}
          onClose={() => {
            openForm(null);
            setError(null);
          }}
          footer={
            <>
              <Btn variant="ghost" onClick={() => openForm(null)} disabled={saving}>
                {t("common.cancel")}
              </Btn>
              <Btn variant="primary" onClick={save} disabled={saving}>
                {saving ? t("common.saving") : t("common.save")}
              </Btn>
            </>
          }
        >
          <ErrorText>{error}</ErrorText>

          <div className={s.formGrid}>
            <Field label={t("barbers.name")}>
              {(id) => (
                <TextInput
                  id={id}
                  value={form.name}
                  maxLength={80}
                  placeholder={t("barbers.namePlaceholder")}
                  onChange={(e) => patch({ name: e.target.value })}
                />
              )}
            </Field>
            <Field label={t("barbers.nickname")}>
              {(id) => (
                <TextInput
                  id={id}
                  value={form.nickname}
                  maxLength={40}
                  placeholder={t("barbers.nicknamePlaceholder")}
                  onChange={(e) => patch({ nickname: e.target.value })}
                />
              )}
            </Field>
            <Field label={t("barbers.photo")} hint={t("barbers.photoHint")} full>
              {() => {
                const shown = photoPreview ?? (form.photoUrl || null);
                return (
                  <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <Avatar name={form.name || "?"} url={shown} />
                    {/* image/* en el celular ofrece la cámara y la galería. */}
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/*"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        if (f) void pickPhoto(f);
                      }}
                    />
                    <Btn size="sm" onClick={() => fileRef.current?.click()} disabled={saving}>
                      <Upload size={13} />
                      {shown ? t("barbers.photoChange") : t("barbers.photoUpload")}
                    </Btn>
                    {shown ? (
                      <Btn size="sm" variant="danger" onClick={removePhoto} disabled={saving}>
                        <Trash2 size={13} />
                        {t("barbers.photoRemove")}
                      </Btn>
                    ) : null}
                  </div>
                );
              }}
            </Field>
            {/* La liga solo se ofrece a quien YA tenía una pegada: se respeta y se
                puede editar, pero la forma de poner una foto nueva es subirla. */}
            {form.photoUrl && !photoFile && !esFotoSubida(form.photoUrl) ? (
              <Field label={t("barbers.photoLink")} hint={t("barbers.photoLinkHint")} full>
                {(id) => (
                  <TextInput
                    id={id}
                    value={form.photoUrl}
                    inputMode="url"
                    placeholder={t("barbers.photoPlaceholder")}
                    onChange={(e) => patch({ photoUrl: e.target.value })}
                  />
                )}
              </Field>
            ) : null}
            <Field label={t("barbers.bio")} hint={t("barbers.bioHint")} full>
              {(id) => (
                <TextArea
                  id={id}
                  value={form.bio}
                  maxLength={1000}
                  placeholder={t("barbers.bioPlaceholder")}
                  onChange={(e) => patch({ bio: e.target.value })}
                />
              )}
            </Field>
          </div>

          <div className={s.field}>
            <span className={s.label}>{t("barbers.pay")}</span>
            <Segmented<BarberCommissionType>
              value={form.commissionType}
              onChange={(v) => patch({ commissionType: v })}
              options={[
                { value: "COMMISSION", label: t("barbers.payCommission") },
                { value: "CHAIR_RENT", label: t("barbers.payChairRent") },
                { value: "SALARY", label: t("barbers.paySalary") },
              ]}
            />
            <p className={s.hint}>{t("barbers.payHint")}</p>
          </div>

          {form.commissionType === "COMMISSION" ? (
            <Field label={t("barbers.commissionPct")}>
              {(id) => (
                <TextInput
                  id={id}
                  value={form.commissionPct}
                  inputMode="decimal"
                  onChange={(e) => patch({ commissionPct: e.target.value })}
                />
              )}
            </Field>
          ) : null}

          {form.commissionType === "CHAIR_RENT" ? (
            <Field label={t("barbers.chairRent")} hint={t("barbers.chairRentHint")}>
              {(id) => (
                <TextInput
                  id={id}
                  value={form.chairRent}
                  inputMode="decimal"
                  onChange={(e) => patch({ chairRent: e.target.value })}
                />
              )}
            </Field>
          ) : null}

          {form.commissionType === "SALARY" ? (
            <p className={s.hint}>{t("barbers.salaryHint")}</p>
          ) : null}

          {!form.id && branches.length > 1 ? (
            <Field label={t("branch.label")}>
              {(id) => (
                <Select
                  id={id}
                  value={form.barbershopId}
                  onChange={(e) => patch({ barbershopId: e.target.value })}
                >
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}

          <SwitchRow
            title={t("barbers.activeLabel")}
            hint={form.isActive ? undefined : t("barbers.inactiveNote")}
            checked={form.isActive}
            onChange={(v) => patch({ isActive: v })}
          />
        </Modal>
      ) : null}
    </>
  );
}
