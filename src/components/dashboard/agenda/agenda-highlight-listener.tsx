"use client";

import { useEffect } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import styles from "./agenda.module.css";

interface Props {
  highlightId: string;
}

export function AgendaHighlightListener({ highlightId }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!highlightId) return;
    const start = Date.now();
    const timer = window.setInterval(() => {
      const el = document.querySelector(
        `[data-appt-id="${highlightId}"]`,
      ) as HTMLElement | null;
      if (el) {
        window.clearInterval(timer);
        el.classList.add(styles.apptHighlight);
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        const params = new URLSearchParams(searchParams.toString());
        params.delete("highlight");
        const qs = params.toString();
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
        window.setTimeout(() => el.classList.remove(styles.apptHighlight), 2200);
      } else if (Date.now() - start > 2000) {
        window.clearInterval(timer);
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [highlightId, pathname, router, searchParams]);

  return null;
}
