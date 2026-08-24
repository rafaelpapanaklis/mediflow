"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, CalendarClock, Contact, Pencil, Plus } from "lucide-react";
import Link from "next/link";
import type { BarberCommissionType } from "@/lib/barber/types";
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

  const seatText = seat.unlimited
    ? t("barbers.seatUnlimited", { used: seat.used, plan: seat.planName })
    : t("barbers.seat", { used: seat.used, max: seat.max, plan: seat.planName });

  const writeBranchId = activeBranchId ?? branches[0]?.id ?? "";
  const canCreate = seat.canCreate && !isConsolidated;

  function patch(next: Partial<FormState>) {
    setForm((f) => (f ? { ...f, ...next } : f));
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
      if (form.id) {
        const { barber } = await apiCall<{ barber: BarberProfileRow }>(
          `/api/barber/team/barbers/${form.id}`,
          { method: "PATCH", json: payload },
        );
        setBarbers((list) => list.map((b) => (b.id === barber.id ? barber : b)));
      } else {
        const { barber } = await apiCall<{ barber: BarberProfileRow }>(
          "/api/barber/team/barbers",
          { method: "POST", json: payload },
        );
        setBarbers((list) => [...list, barber]);
      }
    });
    if (ok) setForm(null);
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
      return `${t("barbers.payChairRent")} · $${b.chairRent ?? 0}`;
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
          <Chip tone={seat.canCreate ? undefined : "warn"}>{seatText}</Chip>
          <Btn
            variant="primary"
            onClick={() => setForm(emptyForm(writeBranchId))}
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

      {!seat.canCreate && !isConsolidated ? (
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
                <Btn variant="primary" onClick={() => setForm(emptyForm(writeBranchId))}>
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
                    <Btn size="sm" onClick={() => setForm(toForm(b))}>
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
          <Link href="/barber/agenda" className={[s.btn, s.btnSm].join(" ")}>
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
            setForm(null);
            setError(null);
          }}
          footer={
            <>
              <Btn variant="ghost" onClick={() => setForm(null)} disabled={saving}>
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
            <Field label={t("barbers.chairRent")}>
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
