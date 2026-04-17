"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

interface Announcement {
  id: string;
  message: string;
  type: string;
  createdAt: string;
}

const TYPE_STYLES: Record<string, string> = {
  info:        "bg-blue-600 text-white",
  warning:     "bg-amber-500 text-black",
  success:     "bg-emerald-600 text-white",
  maintenance: "bg-rose-600 text-white",
};

const STORAGE_KEY = "mf_dismissed_announcements";

function readDismissed(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveDismissed(ids: string[]) {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids)); } catch {}
}

export function GlobalAnnouncementBanner() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);

  useEffect(() => {
    setDismissed(readDismissed());
    fetch("/api/announcements/active")
      .then(r => (r.ok ? r.json() : []))
      .then((data: Announcement[]) => setAnnouncements(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  const visible = announcements.filter(a => !dismissed.includes(a.id));
  if (visible.length === 0) return null;

  function dismiss(id: string) {
    const next = [...dismissed, id];
    setDismissed(next);
    saveDismissed(next);
  }

  return (
    <div className="flex-shrink-0 flex flex-col">
      {visible.map(a => {
        const cls = TYPE_STYLES[a.type] ?? TYPE_STYLES.info;
        return (
          <div key={a.id} className={`${cls} px-4 py-2 text-sm font-semibold flex items-center gap-3`}>
            <div className="flex-1">{a.message}</div>
            <button
              onClick={() => dismiss(a.id)}
              className="flex-shrink-0 p-1 rounded hover:bg-black/20 transition-colors"
              aria-label="Descartar anuncio"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
