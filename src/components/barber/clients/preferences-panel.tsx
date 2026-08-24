"use client";

import { useState } from "react";
import { Check, Pencil, Scissors, X } from "lucide-react";
import type { BarberClientPreferences } from "@/lib/barber/clients";
import { Field, clientStyles as s, type BarberT } from "./ui";

/**
 * "Cómo le gusta el corte" — el panel que el barbero mira con el cliente ya
 * sentado en la silla. Por eso va ARRIBA de la ficha y en modo lectura se ve
 * de un golpe, sin abrir nada.
 *
 * Los campos salen de CLIENT_PREFERENCE_FIELDS (src/lib/barber/clients.ts):
 * el servidor tira cualquier llave que no esté en ese catálogo, así que este
 * formulario y la validación no pueden desincronizarse.
 */

type FieldKey = keyof BarberClientPreferences;

/** Orden de lectura del barbero: de la máquina hacia los detalles. */
const SHORT_FIELDS: FieldKey[] = [
  "clipperNumber",
  "fade",
  "part",
  "topLength",
  "sideLength",
  "beard",
];
const LONG_FIELDS: FieldKey[] = ["products", "avoidProducts", "barberNotes"];

export function PreferencesPanel({
  clientId,
  preferences,
  barbers,
  canEdit,
  t,
  onSaved,
  onMessage,
}: {
  clientId: string;
  preferences: BarberClientPreferences;
  barbers: Array<{ id: string; name: string }>;
  canEdit: boolean;
  t: BarberT;
  onSaved: (next: BarberClientPreferences) => void;
  onMessage: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<BarberClientPreferences>(preferences);
  const [busy, setBusy] = useState(false);

  const label = (key: FieldKey) => t(`preferences.${key}`);
  const placeholder = (key: FieldKey) => t(`preferences.${key}Placeholder`);

  const filled = SHORT_FIELDS.concat(LONG_FIELDS).filter((k) => preferences[k]);
  const favorite = preferences.favoriteBarberId
    ? barbers.filter((b) => b.id === preferences.favoriteBarberId)[0]
    : undefined;

  function open() {
    setDraft(preferences);
    setEditing(true);
  }

  async function save() {
    setBusy(true);
    try {
      const res = await fetch(`/api/barber/clients/${clientId}/preferences`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferences: draft }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        onMessage(data?.error || t("errors.generic"));
        return;
      }
      onSaved((data.preferences ?? {}) as BarberClientPreferences);
      setEditing(false);
      onMessage(t("form.saved"));
    } catch {
      onMessage(t("errors.generic"));
    } finally {
      setBusy(false);
    }
  }

  const set = (key: FieldKey, value: string) =>
    setDraft((d) => ({ ...d, [key]: value }));

  return (
    <section className={`${s.card} ${s.cardPad} ${s.prefs}`} aria-label={t("preferences.title")}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <h2 className={s.sectionTitle}>
            <Scissors size={15} style={{ verticalAlign: "-2px", marginRight: 6 }} />
            {t("preferences.title")}
          </h2>
          <p className={s.sectionSub}>{t("preferences.subtitle")}</p>
        </div>
        {canEdit && !editing ? (
          <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={open}>
            <Pencil size={13} />
            {t("preferences.edit")}
          </button>
        ) : null}
      </div>

      {editing ? (
        <>
          <div className={s.prefGrid}>
            {SHORT_FIELDS.map((key) => (
              <Field key={key} label={label(key)} htmlFor={`pref-${key}`}>
                <input
                  id={`pref-${key}`}
                  className={s.input}
                  value={draft[key] ?? ""}
                  placeholder={placeholder(key)}
                  onChange={(e) => set(key, e.target.value)}
                />
              </Field>
            ))}

            <Field label={t("preferences.favoriteBarber")} htmlFor="pref-favorite">
              <select
                id="pref-favorite"
                className={s.select}
                value={draft.favoriteBarberId ?? ""}
                onChange={(e) => set("favoriteBarberId", e.target.value)}
              >
                <option value="">{t("preferences.favoriteBarberNone")}</option>
                {barbers.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>

            {LONG_FIELDS.map((key) => (
              <Field key={key} label={label(key)} htmlFor={`pref-${key}`} wide>
                <textarea
                  id={`pref-${key}`}
                  className={s.textarea}
                  value={draft[key] ?? ""}
                  placeholder={placeholder(key)}
                  onChange={(e) => set(key, e.target.value)}
                />
              </Field>
            ))}
          </div>

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
            <button
              type="button"
              className={`${s.btn} ${s.btnGhost}`}
              onClick={() => setEditing(false)}
              disabled={busy}
            >
              <X size={14} />
              {t("form.cancel")}
            </button>
            <button
              type="button"
              className={`${s.btn} barber-btn-primary`}
              onClick={save}
              disabled={busy}
            >
              <Check size={14} />
              {busy ? t("form.saving") : t("form.save")}
            </button>
          </div>
        </>
      ) : filled.length === 0 && !favorite ? (
        <p className={s.sectionSub}>{t("preferences.empty")}</p>
      ) : (
        <div className={s.prefGrid}>
          {SHORT_FIELDS.filter((k) => preferences[k]).map((key) => (
            <div key={key} className={s.prefRead}>
              <span className={s.prefKey}>{label(key)}</span>
              <span className={s.prefValue}>{preferences[key]}</span>
            </div>
          ))}

          {favorite ? (
            <div className={s.prefRead}>
              <span className={s.prefKey}>{t("preferences.favoriteBarber")}</span>
              <span className={s.prefValue}>{favorite.name}</span>
            </div>
          ) : null}

          {LONG_FIELDS.filter((k) => preferences[k]).map((key) => (
            <div key={key} className={`${s.prefRead} ${s.prefWide}`}>
              <span className={s.prefKey}>{label(key)}</span>
              <span className={`${s.prefValue} ${s.prefValueLong}`}>{preferences[key]}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
