"use client";

// ═══════════════════════════════════════════════════════════════════════
// INVENTARIO DE ENTRADA Y DE SALIDA — el diferenciador de este vertical.
//
// Al final de TODO contrato hay la misma pelea: "la pared ya estaba así" /
// "no, la dejaste tú". Sin evidencia es la palabra de uno contra la del
// otro y el depósito se resuelve a gritos. Con esto es una tabla: cuarto
// por cuarto, concepto por concepto, con la foto de cuando se entregó al
// lado de la foto de cuando se recibió.
//
// Las fotos se comprimen EN EL NAVEGADOR antes de subirlas (1600 px, JPEG
// 0.72): una foto de teléfono pesa 5 MB y el cupo del plan Propietario son
// 2 GB. Y sí, cuentan contra ese cupo — la pantalla lo dice.
// ═══════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Camera, Plus, Trash2 } from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import { makeRealtyT } from "@/lib/realty/i18n";
import { formatLongDate } from "@/lib/realty/rent-charges";
import { formatRealtyStorage } from "@/lib/realty/plan-shared";
import {
  Card,
  EmptyState,
  Field,
  Modal,
  Note,
  Pill,
  compressImage,
  formatBytes,
  type Tone,
} from "./ui";

interface ItemView {
  id: string;
  room: string;
  item: string;
  condition: string;
  photoUrls: string[];
  photoPaths: string[];
}

interface CheckView {
  id: string;
  kind: "ENTRADA" | "SALIDA";
  performedAt: string;
  signedBy: string | null;
  notes: string | null;
  items: ItemView[];
}

interface Comparison {
  entrada: CheckView | null;
  salida: CheckView | null;
  rows: Array<{
    room: string;
    item: string;
    entrada: ItemView | null;
    salida: ItemView | null;
    verdict: "PEOR" | "IGUAL" | "MEJOR" | "SOLO_ENTRADA" | "SOLO_SALIDA";
  }>;
  worse: number;
  same: number;
  missing: number;
}

/** Los cuartos del recorrido. El usuario puede escribir otro. */
const ROOMS = [
  "Entrada",
  "Sala",
  "Comedor",
  "Cocina",
  "Recámara principal",
  "Recámara 2",
  "Recámara 3",
  "Baño principal",
  "Baño 2",
  "Área de lavado",
  "Cochera",
  "Patio o jardín",
  "Azotea",
];

/** Los conceptos que se revisan en cada cuarto. */
const ITEMS = [
  "Muros",
  "Pisos",
  "Plafón o techo",
  "Ventanas",
  "Puertas",
  "Clósets",
  "Muebles de cocina",
  "Muebles de baño",
  "Instalación eléctrica",
  "Instalación hidráulica",
  "Instalación de gas",
  "Llaves y cerraduras",
  "Persianas o cortinas",
  "Limpieza general",
];

const CONDITIONS = ["NUEVO", "BUENO", "USO", "DANADO", "FALTANTE"] as const;

const CONDITION_TONE: Record<string, Tone> = {
  NUEVO: "success",
  BUENO: "success",
  USO: "neutral",
  DANADO: "warning",
  FALTANTE: "danger",
};

const VERDICT_TONE: Record<Comparison["rows"][number]["verdict"], Tone> = {
  PEOR: "danger",
  IGUAL: "neutral",
  MEJOR: "success",
  SOLO_ENTRADA: "warning",
  SOLO_SALIDA: "info",
};

interface DraftItem {
  key: string;
  room: string;
  item: string;
  condition: string;
  photoPaths: string[];
  photoUrls: string[];
}

let draftSeq = 0;
function newKey(): string {
  draftSeq += 1;
  return `d${draftSeq}`;
}

export function InventoryPanel({
  dict,
  leaseId,
  storageUsedBytes,
  storageQuotaMb,
  canEdit,
}: {
  dict: Dictionary;
  leaseId: string;
  storageUsedBytes: number;
  storageQuotaMb: number;
  canEdit: boolean;
}) {
  const t = makeRealtyT(dict);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [loading, setLoading] = useState(true);
  const [used, setUsed] = useState(storageUsedBytes);

  const [editorOpen, setEditorOpen] = useState(false);
  const [kind, setKind] = useState<"ENTRADA" | "SALIDA">("ENTRADA");
  const [checkId, setCheckId] = useState<string | undefined>(undefined);
  const [performedAt, setPerformedAt] = useState("");
  const [signedBy, setSignedBy] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<DraftItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const targetKeyRef = useRef<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/realty/leases/${leaseId}/inventory`);
      const data = await res.json().catch(() => ({}));
      setComparison((data?.comparison as Comparison) ?? null);
    } catch {
      setComparison(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaseId]);

  function openEditor(target: "ENTRADA" | "SALIDA", existing: CheckView | null) {
    setKind(target);
    setCheckId(existing?.id);
    setPerformedAt((existing?.performedAt ?? new Date().toISOString()).slice(0, 10));
    setSignedBy(existing?.signedBy ?? "");
    setNotes(existing?.notes ?? "");
    setItems(
      (existing?.items ?? []).map((it) => ({
        key: newKey(),
        room: it.room,
        item: it.item,
        condition: it.condition,
        photoPaths: it.photoPaths ?? [],
        photoUrls: it.photoUrls ?? [],
      })),
    );
    setError(null);
    setEditorOpen(true);
  }

  /**
   * "Agregar un cuarto completo" mete los conceptos de siempre de una vez.
   * Capturar catorce renglones a mano por cuarto es exactamente donde
   * alguien decide que mejor no levanta el inventario.
   */
  function addRoom(room: string) {
    setItems((prev) => [
      ...prev,
      ...ITEMS.map((it) => ({
        key: newKey(),
        room,
        item: it,
        condition: "BUENO",
        photoPaths: [],
        photoUrls: [],
      })),
    ]);
  }

  function addRow() {
    setItems((prev) => [
      ...prev,
      { key: newKey(), room: ROOMS[0], item: ITEMS[0], condition: "BUENO", photoPaths: [], photoUrls: [] },
    ]);
  }

  function patchRow(key: string, patch: Partial<DraftItem>) {
    setItems((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function removeRow(key: string) {
    setItems((prev) => prev.filter((r) => r.key !== key));
  }

  function pickPhoto(key: string) {
    targetKeyRef.current = key;
    fileRef.current?.click();
  }

  async function onFile(file: File | undefined) {
    const key = targetKeyRef.current;
    if (!file || !key) return;
    setUploadingKey(key);
    try {
      const blob = await compressImage(file);
      const form = new FormData();
      form.append("file", blob, "evidencia.jpg");
      const res = await fetch(`/api/realty/leases/${leaseId}/inventory/fotos`, {
        method: "POST",
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(String(data?.error ?? t("common.genericError")));
        return;
      }
      // Actualización FUNCIONAL: `items` de la clausura ya está viejo si el
      // usuario tocó otro renglón mientras la foto subía, y con el estado
      // capturado se perderían las fotos de esos renglones.
      setItems((prev) =>
        prev.map((r) =>
          r.key === key
            ? {
                ...r,
                photoPaths: [...r.photoPaths, String(data.path)],
                photoUrls: [...r.photoUrls, String(data.signedUrl ?? "")],
              }
            : r,
        ),
      );
      if (data?.storage?.usedBytes) setUsed(Number(data.storage.usedBytes));
      toast.success(t("inventory.toast.photo"));
    } catch {
      toast.error(t("common.genericError"));
    } finally {
      setUploadingKey(null);
      targetKeyRef.current = null;
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/realty/leases/${leaseId}/inventory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          checkId,
          kind,
          performedAt,
          signedBy,
          notes,
          items: items.map((r) => ({
            room: r.room,
            item: r.item,
            condition: r.condition,
            photoUrls: r.photoPaths,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(String(data?.error ?? t("common.genericError")));
        setBusy(false);
        return;
      }
      toast.success(t("inventory.toast.saved"));
      setEditorOpen(false);
      await load();
    } catch {
      setError(t("common.genericError"));
    } finally {
      setBusy(false);
    }
  }

  const quotaLabel = formatRealtyStorage(storageQuotaMb);
  const entrada = comparison?.entrada ?? null;
  const salida = comparison?.salida ?? null;

  return (
    <>
      <Card
        title={t("inventory.title")}
        sub={t("inventory.subtitle")}
        action={
          canEdit ? (
            <div className="rnt-toolbar">
              <button
                type="button"
                className="rnt-btn rnt-btn--sm"
                onClick={() => openEditor("ENTRADA", entrada)}
              >
                <Plus size={13} />
                {entrada ? t("inventory.entrada") : t("inventory.newEntrada")}
              </button>
              <button
                type="button"
                className="rnt-btn rnt-btn--sm"
                onClick={() => openEditor("SALIDA", salida)}
              >
                <Plus size={13} />
                {salida ? t("inventory.salida") : t("inventory.newSalida")}
              </button>
            </div>
          ) : null
        }
      >
        {loading ? (
          <p style={{ color: "var(--text-3)", fontSize: 13, margin: 0 }}>{t("common.loading")}</p>
        ) : !entrada && !salida ? (
          <EmptyState title={t("inventory.empty.title")} body={t("inventory.empty.body")} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="rnt-grid rnt-grid--auto">
              <div>
                <div className="rnt-field__label">{t("inventory.entrada")}</div>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                  {entrada ? formatLongDate(entrada.performedAt) : t("common.none")}
                </div>
                {entrada?.signedBy ? (
                  <div className="rnt-field__hint">{entrada.signedBy}</div>
                ) : null}
              </div>
              <div>
                <div className="rnt-field__label">{t("inventory.salida")}</div>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                  {salida ? formatLongDate(salida.performedAt) : t("common.none")}
                </div>
                {salida?.signedBy ? <div className="rnt-field__hint">{salida.signedBy}</div> : null}
              </div>
              <div>
                <div className="rnt-field__label">{t("inventory.compareTitle")}</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 3 }}>
                  <Pill tone="danger">
                    {t("inventory.summary.worse", { count: comparison?.worse ?? 0 })}
                  </Pill>
                  <Pill tone="neutral">
                    {t("inventory.summary.same", { count: comparison?.same ?? 0 })}
                  </Pill>
                </div>
              </div>
            </div>

            {!salida ? <Note tone="warning">{t("inventory.onlyEntrada")}</Note> : null}
            {!entrada && salida ? <Note tone="danger">{t("inventory.onlySalida")}</Note> : null}

            {comparison && comparison.rows.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div className="rnt-field__hint">{t("inventory.compareBody")}</div>
                {comparison.rows.map((row, i) => (
                  <div className="rnt-inv-row" key={`${row.room}-${row.item}-${i}`}>
                    <div className="rnt-inv-row__head">
                      <div>
                        <div className="rnt-inv-row__title">{row.item}</div>
                        <div className="rnt-inv-row__where">{row.room}</div>
                      </div>
                      <Pill tone={VERDICT_TONE[row.verdict]} dot>
                        {t(`inventory.verdict.${row.verdict}`)}
                      </Pill>
                    </div>
                    <SideBox
                      label={t("inventory.entrada")}
                      item={row.entrada}
                      t={t}
                      emptyLabel={t("common.none")}
                    />
                    <SideBox
                      label={t("inventory.salida")}
                      item={row.salida}
                      t={t}
                      emptyLabel={t("common.none")}
                    />
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </Card>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={(e) => void onFile(e.target.files?.[0])}
      />

      <Modal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        size="full"
        closeLabel={t("common.close")}
        title={kind === "ENTRADA" ? t("inventory.entrada") : t("inventory.salida")}
        sub={t("inventory.subtitle")}
        footer={
          <>
            <button
              type="button"
              className="rnt-btn"
              onClick={() => setEditorOpen(false)}
              disabled={busy}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="rnt-btn rnt-btn--primary"
              onClick={save}
              disabled={busy || items.length === 0}
            >
              {busy ? t("common.saving") : t("common.save")}
            </button>
          </>
        }
      >
        {error ? <Note tone="danger">{error}</Note> : null}

        <div className="rnt-grid">
          <Field label={t("inventory.performedAt")}>
            <input
              className="rnt-input"
              type="date"
              value={performedAt}
              onChange={(e) => setPerformedAt(e.target.value)}
            />
          </Field>
          <Field label={t("inventory.signedBy")} hint={t("inventory.signedByHint")}>
            <input
              className="rnt-input"
              value={signedBy}
              onChange={(e) => setSignedBy(e.target.value)}
            />
          </Field>
        </div>

        <Field label={t("inventory.notes")}>
          <textarea
            className="rnt-textarea"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>

        <Note tone="info">
          {t("inventory.photoHint")}{" "}
          {t("inventory.storage", { used: formatBytes(used), quota: quotaLabel })}
        </Note>

        <div className="rnt-toolbar">
          <select
            className="rnt-select"
            style={{ maxWidth: 240 }}
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) addRoom(e.target.value);
              e.target.value = "";
            }}
            aria-label={t("inventory.addRoom")}
          >
            <option value="">{t("inventory.addRoom")}</option>
            {ROOMS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <button type="button" className="rnt-btn rnt-btn--sm" onClick={addRow}>
            <Plus size={13} />
            {t("inventory.addRow")}
          </button>
        </div>
        <div className="rnt-field__hint">{t("inventory.addRoomHint")}</div>

        {items.length === 0 ? (
          <EmptyState title={t("inventory.empty.title")} body={t("inventory.empty.body")} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {items.map((row) => (
              <div className="rnt-inv-side" key={row.key}>
                <div className="rnt-grid" style={{ gridTemplateColumns: "1fr" }}>
                  <div className="rnt-grid rnt-grid--auto">
                    <Field label={t("inventory.room")}>
                      <input
                        className="rnt-input"
                        value={row.room}
                        list="rnt-rooms"
                        onChange={(e) => patchRow(row.key, { room: e.target.value })}
                      />
                    </Field>
                    <Field label={t("inventory.item")}>
                      <input
                        className="rnt-input"
                        value={row.item}
                        list="rnt-items"
                        onChange={(e) => patchRow(row.key, { item: e.target.value })}
                      />
                    </Field>
                    <Field label={t("inventory.condition")}>
                      <select
                        className="rnt-select"
                        value={row.condition}
                        onChange={(e) => patchRow(row.key, { condition: e.target.value })}
                      >
                        {CONDITIONS.map((c) => (
                          <option key={c} value={c}>
                            {t(`inventory.conditions.${c}`)}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                </div>
                <div className="rnt-inv-photos">
                  {row.photoUrls.map((u, i) =>
                    u ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={i} src={u} alt="" className="rnt-inv-photo" />
                    ) : null,
                  )}
                  <button
                    type="button"
                    className="rnt-btn rnt-btn--sm"
                    onClick={() => pickPhoto(row.key)}
                    disabled={uploadingKey === row.key}
                  >
                    <Camera size={13} />
                    {uploadingKey === row.key ? t("common.uploading") : t("common.addPhoto")}
                  </button>
                  <button
                    type="button"
                    className="rnt-btn rnt-btn--sm rnt-btn--danger"
                    onClick={() => removeRow(row.key)}
                    aria-label={t("inventory.removeRow")}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <datalist id="rnt-rooms">
          {ROOMS.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
        <datalist id="rnt-items">
          {ITEMS.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
      </Modal>
    </>
  );
}

function SideBox({
  label,
  item,
  t,
  emptyLabel,
}: {
  label: string;
  item: ItemView | null;
  t: (key: string, vars?: Record<string, string | number>) => string;
  emptyLabel: string;
}) {
  return (
    <div className="rnt-inv-side">
      <div className="rnt-inv-side__label">{label}</div>
      {item ? (
        <>
          <Pill tone={CONDITION_TONE[item.condition] ?? "neutral"}>
            {t(`inventory.conditions.${item.condition}`)}
          </Pill>
          <div className="rnt-inv-photos">
            {item.photoUrls.filter(Boolean).length === 0 ? (
              <div className="rnt-inv-photo rnt-inv-photo--empty">{t("inventory.noPhotos")}</div>
            ) : (
              item.photoUrls
                .filter(Boolean)
                .map((u, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={i} src={u} alt="" className="rnt-inv-photo" />
                ))
            )}
          </div>
        </>
      ) : (
        <div style={{ fontSize: 12, color: "var(--text-4)" }}>{emptyLabel}</div>
      )}
    </div>
  );
}
