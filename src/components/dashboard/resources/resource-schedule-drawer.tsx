"use client";

import { useCallback, useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import toast from "react-hot-toast";
import { X, Copy, Plus, Trash2, Clock } from "lucide-react";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useT } from "@/i18n/i18n-provider";
import {
  getResourceSchedule,
  saveResourceSchedule,
  type ApiError,
} from "@/lib/agenda/mutations";
import type {
  ResourceDTO,
  ResourceScheduleWindow,
  WeekScheduleDTO,
} from "@/lib/agenda/types";
import styles from "./resource-schedule-drawer.module.css";

interface Props {
  resource: ResourceDTO | null;
  isOpen: boolean;
  onClose: () => void;
}

// Maps each weekday index to a translation key; resolved via t() at render time.
const DAY_LABEL_KEYS = [
  "procurement.resScheduleDrawer.dayMonday",
  "procurement.resScheduleDrawer.dayTuesday",
  "procurement.resScheduleDrawer.dayWednesday",
  "procurement.resScheduleDrawer.dayThursday",
  "procurement.resScheduleDrawer.dayFriday",
  "procurement.resScheduleDrawer.daySaturday",
  "procurement.resScheduleDrawer.daySunday",
];

function emptyWeek(): WeekScheduleDTO {
  return {
    days: { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] },
  };
}

function defaultBusinessWeek(): WeekScheduleDTO {
  // Mon-Fri 09:00-18:00, weekend off — a sensible starting point when the
  // user enables a schedule on a resource that was previously always-open.
  const window: ResourceScheduleWindow = { startTime: "09:00", endTime: "18:00" };
  return {
    days: {
      0: [window],
      1: [window],
      2: [window],
      3: [window],
      4: [window],
      5: [],
      6: [],
    },
  };
}

function isApiError(err: unknown): err is ApiError {
  return typeof err === "object" && err !== null && "status" in err;
}

export function ResourceScheduleDrawer({ resource, isOpen, onClose }: Props) {
  const t = useT();
  const askConfirm = useConfirm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [alwaysOpen, setAlwaysOpen] = useState(true);
  const [week, setWeek] = useState<WeekScheduleDTO>(emptyWeek);

  const reload = useCallback(async (resourceId: string) => {
    setLoading(true);
    try {
      const body = await getResourceSchedule(resourceId);
      setAlwaysOpen(body.alwaysOpen);
      setWeek(body.schedule ?? emptyWeek());
    } catch {
      toast.error(t("procurement.resScheduleDrawer.loadError"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen && resource) {
      void reload(resource.id);
    }
  }, [isOpen, resource, reload]);

  function setDayWindows(day: 0 | 1 | 2 | 3 | 4 | 5 | 6, windows: ResourceScheduleWindow[]) {
    setWeek((prev) => ({ days: { ...prev.days, [day]: windows } }));
    setAlwaysOpen(false);
  }

  function addWindow(day: 0 | 1 | 2 | 3 | 4 | 5 | 6) {
    const existing = week.days[day];
    // Pick a sensible default: continue after the last window, or 09:00-18:00.
    const last = existing[existing.length - 1];
    const next: ResourceScheduleWindow = last
      ? { startTime: last.endTime, endTime: bumpHour(last.endTime, 2) }
      : { startTime: "09:00", endTime: "18:00" };
    setDayWindows(day, [...existing, next]);
  }

  function removeWindow(day: 0 | 1 | 2 | 3 | 4 | 5 | 6, idx: number) {
    setDayWindows(day, week.days[day].filter((_, i) => i !== idx));
  }

  function updateWindow(
    day: 0 | 1 | 2 | 3 | 4 | 5 | 6,
    idx: number,
    patch: Partial<ResourceScheduleWindow>,
  ) {
    setDayWindows(
      day,
      week.days[day].map((w, i) => (i === idx ? { ...w, ...patch } : w)),
    );
  }

  function copyMondayToWeekdays() {
    const monday = week.days[0];
    setWeek({
      days: { ...week.days, 1: [...monday], 2: [...monday], 3: [...monday], 4: [...monday] },
    });
    setAlwaysOpen(false);
  }

  function enableSchedule() {
    setWeek(defaultBusinessWeek());
    setAlwaysOpen(false);
  }

  async function clearSchedule() {
    if (!resource) return;
    const confirmed = await askConfirm({
      title: t("procurement.resScheduleDrawer.clearConfirmTitle"),
      description: t("procurement.resScheduleDrawer.clearConfirmDesc"),
      variant: "warning",
      confirmText: t("procurement.resScheduleDrawer.clearConfirmAction"),
    });
    if (!confirmed) return;
    setSaving(true);
    try {
      await saveResourceSchedule(resource.id, null);
      toast.success(t("procurement.resScheduleDrawer.clearSuccess"));
      setAlwaysOpen(true);
      setWeek(emptyWeek());
    } catch (err) {
      const reason = isApiError(err)
        ? err.reason ?? err.error ?? t("procurement.resScheduleDrawer.saveError")
        : t("procurement.resScheduleDrawer.saveError");
      toast.error(reason);
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    if (!resource) return;
    // Client-side validation for the most common mistakes — server also validates.
    for (let d = 0; d <= 6; d++) {
      const windows = week.days[d as 0 | 1 | 2 | 3 | 4 | 5 | 6];
      const dayLabel = t(DAY_LABEL_KEYS[d]!);
      for (const w of windows) {
        if (!isHHMM(w.startTime) || !isHHMM(w.endTime)) {
          toast.error(t("procurement.resScheduleDrawer.invalidTimeFormat", { day: dayLabel }));
          return;
        }
        if (w.startTime >= w.endTime) {
          toast.error(t("procurement.resScheduleDrawer.startBeforeEnd", { day: dayLabel }));
          return;
        }
      }
      // Overlap check: sort by start, ensure no overlap.
      const sorted = [...windows].sort((a, b) => a.startTime.localeCompare(b.startTime));
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i]!.startTime < sorted[i - 1]!.endTime) {
          toast.error(t("procurement.resScheduleDrawer.windowsOverlap", { day: dayLabel }));
          return;
        }
      }
    }

    setSaving(true);
    try {
      const body = await saveResourceSchedule(resource.id, week);
      setAlwaysOpen(body.alwaysOpen);
      setWeek(body.schedule ?? emptyWeek());
      toast.success(t("procurement.resScheduleDrawer.saveSuccess"));
      onClose();
    } catch (err) {
      const reason = isApiError(err)
        ? err.reason ?? err.error ?? t("procurement.resScheduleDrawer.saveError")
        : t("procurement.resScheduleDrawer.saveError");
      toast.error(reason);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog.Root open={isOpen} onOpenChange={(o) => !o && !saving && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.drawer} aria-describedby={undefined}>
          <div className={styles.header}>
            <div className={styles.headerInner}>
              <Clock size={18} className={styles.headerIcon} aria-hidden />
              <div>
                <Dialog.Title className={styles.title}>
                  {t("procurement.resScheduleDrawer.title")} · {resource?.name ?? ""}
                </Dialog.Title>
                <p className={styles.subtitle}>
                  {t("procurement.resScheduleDrawer.subtitle")}
                </p>
              </div>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className={styles.closeBtn}
                aria-label={t("common.close")}
                disabled={saving}
              >
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>

          <div className={styles.body}>
            {loading ? (
              <div className={styles.loading}>{t("common.loading")}</div>
            ) : alwaysOpen && week.days[0].length === 0 ? (
              <div className={styles.banner}>
                <div className={styles.bannerTitle}>{t("procurement.resScheduleDrawer.alwaysAvailableTitle")}</div>
                <div className={styles.bannerText}>
                  {t("procurement.resScheduleDrawer.alwaysAvailableText")}
                </div>
                <button
                  type="button"
                  className={styles.bannerBtn}
                  onClick={enableSchedule}
                >
                  {t("procurement.resScheduleDrawer.configureSchedule")}
                </button>
              </div>
            ) : (
              <>
                <div className={styles.quickActions}>
                  <button
                    type="button"
                    className={styles.quickBtn}
                    onClick={copyMondayToWeekdays}
                    title={t("procurement.resScheduleDrawer.copyMondayTitle")}
                  >
                    <Copy size={12} /> {t("procurement.resScheduleDrawer.copyMonday")}
                  </button>
                </div>

                {DAY_LABEL_KEYS.map((labelKey, dIdx) => {
                  const label = t(labelKey);
                  const day = dIdx as 0 | 1 | 2 | 3 | 4 | 5 | 6;
                  const windows = week.days[day];
                  return (
                    <div key={labelKey} className={styles.dayBlock}>
                      <div className={styles.dayHead}>
                        <span className={styles.dayLabel}>{label}</span>
                        {windows.length === 0 && (
                          <span className={styles.closedBadge}>{t("procurement.resScheduleDrawer.closed")}</span>
                        )}
                        <button
                          type="button"
                          className={styles.addWindowBtn}
                          onClick={() => addWindow(day)}
                        >
                          <Plus size={11} /> {t("common.add")}
                        </button>
                      </div>
                      {windows.length > 0 && (
                        <div className={styles.windowList}>
                          {windows.map((w, i) => (
                            <div key={i} className={styles.windowRow}>
                              <input
                                type="time"
                                className={styles.timeInput}
                                value={w.startTime}
                                onChange={(e) =>
                                  updateWindow(day, i, { startTime: e.target.value })
                                }
                                aria-label={t("procurement.resScheduleDrawer.windowStartAria", { day: label, n: i + 1 })}
                              />
                              <span className={styles.windowArrow}>→</span>
                              <input
                                type="time"
                                className={styles.timeInput}
                                value={w.endTime}
                                onChange={(e) =>
                                  updateWindow(day, i, { endTime: e.target.value })
                                }
                                aria-label={t("procurement.resScheduleDrawer.windowEndAria", { day: label, n: i + 1 })}
                              />
                              <button
                                type="button"
                                className={styles.removeWindowBtn}
                                onClick={() => removeWindow(day, i)}
                                aria-label={t("procurement.resScheduleDrawer.removeWindowAria", { n: i + 1 })}
                                title={t("procurement.resScheduleDrawer.removeWindowTitle")}
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </div>

          <div className={styles.footer}>
            {!loading && !alwaysOpen && (
              <button
                type="button"
                className={styles.dangerBtn}
                onClick={() => void clearSchedule()}
                disabled={saving}
              >
                {t("procurement.resScheduleDrawer.clearSchedule")}
              </button>
            )}
            <div className={styles.footerRight}>
              <button
                type="button"
                className={styles.cancelBtn}
                onClick={onClose}
                disabled={saving}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className={styles.saveBtn}
                onClick={() => void handleSave()}
                disabled={saving || loading || alwaysOpen}
              >
                {saving ? t("common.saving") : t("procurement.resScheduleDrawer.saveSchedule")}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function isHHMM(s: string): boolean {
  return /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(s);
}

function bumpHour(time: string, hours: number): string {
  const [h, m] = time.split(":").map((n) => parseInt(n, 10));
  const newH = Math.min(23, h + hours);
  return `${newH.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}
