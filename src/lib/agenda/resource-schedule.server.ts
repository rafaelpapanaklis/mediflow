import "server-only";
import { prisma } from "@/lib/prisma";
import type { WeekScheduleDTO } from "./types";

/**
 * Load a resource's week schedule from DB.
 * Returns `null` if no rows exist for that resource → "always open".
 */
export async function loadResourceSchedule(
  resourceId: string,
): Promise<WeekScheduleDTO | null> {
  const rows = await prisma.resourceSchedule.findMany({
    where: { resourceId },
    select: { dayOfWeek: true, startTime: true, endTime: true },
    orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
  });
  if (rows.length === 0) return null;

  const days: WeekScheduleDTO["days"] = {
    0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [],
  };
  for (const r of rows) {
    if (r.dayOfWeek < 0 || r.dayOfWeek > 6) continue;
    days[r.dayOfWeek as 0 | 1 | 2 | 3 | 4 | 5 | 6].push({
      startTime: r.startTime,
      endTime: r.endTime,
    });
  }
  return { days };
}
