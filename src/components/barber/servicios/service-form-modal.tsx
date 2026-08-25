"use client";

import { useId, useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import type { BarberServiceRow, ServiceUpdateResult } from "@/lib/barber/services";
import { useBarberT } from "@/components/barber/cash/use-barber-t";
import { fmtMoney, parseAmountText } from "@/components/barber/cash/money";
import {
  Btn,
  ErrorText,
  Field,
  Modal,
  SwitchRow,
  TextArea,
  TextInput,
  apiCall,
  useSaving,
} from "@/components/barber/team/admin-ui";
import s from "./servicios.module.css";

// Límites espejo de src/lib/barber/services.ts. El servidor es quien manda;
// aquí solo se evita mandar algo que se sabe que va a rebotar.
const DURATION_MIN = 5;
const DURATION_MAX = 600;
const DURATION_STEP = 5;
const NAME_MAX = 120;
const DESCRIPTION_MAX = 600;
const CATEGORY_MAX = 40;

/** "corte" → "Corte" (igual que agrupa la mini-web). */
export function capitalizeCategory(v: string): string {
  const k = (v || "").trim();
  return k ? k.charAt(0).toUpperCase() + k.slice(1) : "";
}

function parseDuration(text: string): number | null {
  const n = Number(text.trim());
  if (!Number.isInteger(n)) return null;
  if (n < DURATION_MIN || n > DURATION_MAX || n % DURATION_STEP !== 0) return null;
  return n;
}

/**
 * Alta y edición de un servicio.
 *
 * Lo importante está en el aviso de precio: si el servicio ya existe y el
 * precio que se escribe es distinto, ANTES de guardar se dice con todas sus
 * letras que las citas ya agendadas conservan el precio anterior (y cuántas
 * son). El dueño decide sabiendo, no se entera después.
 */
export function ServiceFormModal({
  dict,
  service,
  categories,
  onClose,
  onDone,
}: {
  dict: Dictionary;
  service: BarberServiceRow | null;
  /** Sugeridas + las que ya usa el catálogo, para el datalist. */
  categories: string[];
  onClose: () => void;
  onDone: (row: BarberServiceRow, created: boolean) => void;
}) {
  const t = useBarberT(dict);
  const editing = service !== null;
  const listId = useId();

  const [name, setName] = useState(service?.name ?? "");
  const [description, setDescription] = useState(service?.description ?? "");
  const [duration, setDuration] = useState(String(service?.durationMin ?? 30));
  const [price, setPrice] = useState(service ? String(service.price) : "");
  const [category, setCategory] = useState(service?.category ?? "");
  const [isActive, setIsActive] = useState(service?.isActive ?? true);
  const { saving, error, setError, run } = useSaving();

  const nameOk = name.trim().length > 0;
  const durationValue = parseDuration(duration);
  const priceText = price.trim().replace(/,/g, "");
  const priceValue = priceText === "" ? null : parseAmountText(priceText);
  const priceOk = priceValue !== null;
  const canSave = nameOk && durationValue !== null && priceOk && !saving;

  // El aviso se enseña en cuanto el precio escrito difiere del guardado.
  const priceChanged = editing && priceOk && priceValue !== service!.price;

  async function submit() {
    if (!canSave) return;
    const body: Record<string, unknown> = {
      name: name.trim(),
      description: description.trim(),
      durationMin: durationValue,
      // El precio viaja como TEXTO tal cual se escribió: el servidor lo
      // convierte a Decimal (máx. 2 decimales). Ningún float de por medio.
      price: priceText,
      category: category.trim(),
    };
    if (editing) body.isActive = isActive;

    const ok = await run(async () => {
      if (editing) {
        const r = await apiCall<ServiceUpdateResult>(`/api/barber/services/${service!.id}`, {
          method: "PATCH",
          json: body,
        });
        onDone(r.service, false);
      } else {
        const r = await apiCall<{ service: BarberServiceRow }>("/api/barber/services", {
          method: "POST",
          json: body,
        });
        onDone(r.service, true);
      }
    });
    if (!ok && !error) setError(t("common.genericError"));
  }

  return (
    <Modal
      title={editing ? t("servicios.form.editTitle") : t("servicios.form.createTitle")}
      onClose={onClose}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose} disabled={saving}>
            {t("common.cancel")}
          </Btn>
          <Btn variant="primary" onClick={submit} disabled={!canSave}>
            {saving ? t("common.saving") : t("common.save")}
          </Btn>
        </>
      }
    >
      <ErrorText>{error}</ErrorText>

      <Field label={t("servicios.form.name")}>
        {(id) => (
          <TextInput
            id={id}
            autoFocus
            value={name}
            maxLength={NAME_MAX}
            placeholder={t("servicios.form.namePlaceholder")}
            onChange={(e) => setName(e.target.value)}
          />
        )}
      </Field>

      <Field
        label={`${t("servicios.form.description")} (${t("common.optional")})`}
        hint={t("servicios.form.descriptionHint")}
      >
        {(id) => (
          <TextArea
            id={id}
            value={description}
            maxLength={DESCRIPTION_MAX}
            rows={3}
            onChange={(e) => setDescription(e.target.value)}
          />
        )}
      </Field>

      <div className={s.formGrid}>
        <Field
          label={t("servicios.form.duration")}
          hint={
            durationValue === null && duration.trim() !== ""
              ? t("servicios.form.errors.duration", { min: DURATION_MIN, max: DURATION_MAX })
              : t("servicios.form.durationHint")
          }
        >
          {(id) => (
            <TextInput
              id={id}
              type="number"
              inputMode="numeric"
              min={DURATION_MIN}
              max={DURATION_MAX}
              step={DURATION_STEP}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
          )}
        </Field>

        <Field
          label={t("servicios.form.price")}
          hint={
            !priceOk && price.trim() !== ""
              ? t("servicios.form.errors.price")
              : t("servicios.form.priceHint")
          }
        >
          {(id) => (
            <TextInput
              id={id}
              className={s.priceInput}
              inputMode="decimal"
              placeholder="0.00"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          )}
        </Field>
      </div>

      {priceChanged ? (
        <div className={s.priceWarn} role="status">
          <AlertTriangle size={16} className={s.priceWarnIcon} />
          <div>
            <p className={s.priceWarnTitle}>{t("servicios.form.priceChange.title")}</p>
            <p className={s.priceWarnBody}>
              {t("servicios.form.priceChange.body", { old: fmtMoney(service!.price) })}
              {service!.upcomingCount > 0
                ? ` ${t("servicios.form.priceChange.upcoming", {
                    count: service!.upcomingCount,
                    old: fmtMoney(service!.price),
                  })}`
                : ""}
            </p>
          </div>
        </div>
      ) : null}

      <Field label={t("servicios.form.category")} hint={t("servicios.form.categoryHint")}>
        {(id) => (
          <>
            <TextInput
              id={id}
              list={listId}
              value={category}
              maxLength={CATEGORY_MAX}
              placeholder="general"
              onChange={(e) => setCategory(e.target.value)}
            />
            <datalist id={listId}>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {capitalizeCategory(c)}
                </option>
              ))}
            </datalist>
          </>
        )}
      </Field>

      {editing ? (
        <SwitchRow
          title={t("servicios.form.active")}
          hint={t("servicios.form.activeHint")}
          checked={isActive}
          onChange={setIsActive}
        />
      ) : null}
    </Modal>
  );
}
