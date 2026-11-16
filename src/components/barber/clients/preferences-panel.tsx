"use client";

import { useState } from "react";
import { Check, ChevronRight, Pencil, Scissors, TriangleAlert, X } from "lucide-react";
import type { BarberClientPreferences } from "@/lib/barber/clients";
import { Field, clientStyles as s, type BarberT } from "./ui";
import f from "./ficha.module.css";

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
  variant = "full",
  onSeeAll,
  seeAllHref = "?tab=corte",
}: {
  clientId: string;
  preferences: BarberClientPreferences;
  barbers: Array<{ id: string; name: string }>;
  canEdit: boolean;
  t: BarberT;
  onSaved: (next: BarberClientPreferences) => void;
  onMessage: (text: string) => void;
  /** "summary" = la tarjeta corta del Resumen (sin editar: eso vive en Corte). */
  variant?: "full" | "summary";
  /** «Ver todo» del Resumen: abre la pestaña Corte. */
  onSeeAll?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
  seeAllHref?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<BarberClientPreferences>(preferences);
  const [busy, setBusy] = useState(false);

  const label = (key: FieldKey) => t(`preferences.${key}`);
  const placeholder = (key: FieldKey) => t(`preferences.${key}Placeholder`);

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

  // Lectura con el acomodo de la ficha «A»: la máquina en grande, lo que le
  // irrita en rojo, y cada dato una sola vez. En el Resumen va la versión
  // corta (máquina, desvanecido, arriba, barba, raya, irrita y la nota).
  if (!editing && variant === "summary") {
    return (
      <section className={`${f.card} ${f.cardPad}`} aria-label={t("preferences.title")}>
        <div className={f.cardHead}>
          <h2 className={f.cardTitle}>
            <Scissors size={16} aria-hidden="true" />
            {t("preferences.title")}
          </h2>
          {onSeeAll ? (
            <a href={seeAllHref} className={f.btnLink} onClick={onSeeAll}>
              {t("ficha.seeAll")} <ChevronRight size={14} aria-hidden="true" />
            </a>
          ) : null}
        </div>
        <PreferencesRead
          preferences={preferences}
          favorite={null}
          keys={["fade", "topLength", "beard", "part"]}
          t={t}
          label={label}
          showLong={["barberNotes"]}
        />
      </section>
    );
  }

  if (!editing) {
    return (
      <section className={`${f.card} ${f.cardPad}`} aria-label={t("preferences.title")}>
        <div className={f.cardHead}>
          <h2 className={f.cardTitle}>
            <Scissors size={16} aria-hidden="true" />
            {t("preferences.title")}
          </h2>
          {canEdit ? (
            <button type="button" className={`${f.btn} ${f.btnSm}`} onClick={open} data-accion="editar-corte">
              <Pencil size={13} aria-hidden="true" />
              {t("preferences.edit")}
            </button>
          ) : null}
        </div>
        <PreferencesRead
          preferences={preferences}
          favorite={favorite ?? null}
          keys={["fade", "topLength", "sideLength", "part", "beard"]}
          t={t}
          label={label}
          showLong={["products", "barberNotes"]}
        />
      </section>
    );
  }

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
      ) : null}
    </section>
  );
}

/** Lectura de «Cómo le gusta el corte»: cada dato una vez, la máquina en grande. */
function PreferencesRead({
  preferences,
  favorite,
  keys,
  showLong,
  t,
  label,
}: {
  preferences: BarberClientPreferences;
  favorite: { id: string; name: string } | null;
  /** Campos cortos que van en la rejilla (la máquina va aparte). */
  keys: FieldKey[];
  /** Campos largos que se enseñan además de «lo que le irrita». */
  showLong: FieldKey[];
  t: BarberT;
  label: (key: FieldKey) => string;
}) {
  const machine = (preferences.clipperNumber ?? "").trim();
  const grid = keys.filter((k) => (preferences[k] ?? "").trim());
  const avoid = (preferences.avoidProducts ?? "").trim();
  const products = showLong.includes("products") ? (preferences.products ?? "").trim() : "";
  const notes = showLong.includes("barberNotes") ? (preferences.barberNotes ?? "").trim() : "";
  // En el Resumen la nota va como cita; en Corte, junto a su barbero y productos.
  const notesAsQuote = !showLong.includes("products");

  if (!machine && grid.length === 0 && !avoid && !products && !notes && !favorite) {
    return <p className={f.empty}>{t("preferences.empty")}</p>;
  }

  return (
    <>
      {machine || grid.length > 0 ? (
        <div className={f.cut}>
          {machine ? (
            <div className={f.machine} data-maquina>
              <span className={`${f.machineNum} ${machine.length > 4 ? f.machineNumLong : ""}`}>{machine}</span>
              <span className={f.machineLabel}>{t("ficha.machine")}</span>
            </div>
          ) : null}
          {grid.length > 0 ? (
            <dl className={f.cutGrid} style={{ margin: 0 }}>
              {grid.map((k) => (
                <div key={k} style={{ minWidth: 0 }}>
                  <dt className={f.cutKey}>{label(k)}</dt>
                  <dd className={f.cutValue} style={{ margin: 0 }}>{preferences[k]}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      ) : null}

      {avoid ? (
        <p className={f.irritates} data-irrita>
          <TriangleAlert size={15} aria-hidden="true" />
          <span>
            <strong>{t("ficha.irritates")}</strong> {avoid}
          </span>
        </p>
      ) : null}

      {notesAsQuote ? (
        notes ? <p className={f.quote}>«{notes}»</p> : null
      ) : favorite || products || notes ? (
        <div className={f.facts}>
          {favorite ? (
            <div className={f.fact}>
              <span className={f.cutKey}>{t("preferences.favoriteBarber")}</span>
              <span className={f.cutValue}>{favorite.name}</span>
            </div>
          ) : null}
          {products ? (
            <div className={f.fact}>
              <span className={f.cutKey}>{label("products")}</span>
              <span className={f.cutValue}>{products}</span>
            </div>
          ) : null}
          {notes ? (
            <div className={`${f.fact} ${f.factWide}`}>
              <span className={f.cutKey}>{label("barberNotes")}</span>
              <span className={f.cutValue} style={{ fontWeight: 500, whiteSpace: "pre-wrap" }}>{notes}</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
