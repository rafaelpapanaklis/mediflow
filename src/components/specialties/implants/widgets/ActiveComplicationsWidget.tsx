"use client";
// Implants — widget de complicaciones activas. Spec §6.17.

import Link from "next/link";

export type ActiveComplicationRow = {
  complicationId: string;
  implantId: string;
  patientId: string;
  patientName: string;
  toothFdi: number;
  type: string;
  severity: string;
  detectedAt: Date;
  daysSinceDetection: number;
  doctorName: string | null;
};

export interface ActiveComplicationsWidgetProps {
  rows: ActiveComplicationRow[];
}

const SEVERITY_BADGE: Record<string, string> = {
  leve:     "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  moderada: "bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300",
  severa:   "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300",
};

function fmtType(t: string): string {
  return t.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ActiveComplicationsWidget({ rows }: ActiveComplicationsWidgetProps) {
  return (
    <section className="rounded-lg border border-[var(--border-soft,theme(colors.gray.200))] dark:border-gray-800 bg-white dark:bg-gray-900">
      <header className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-gray-500">Vigilancia</p>
          <h2 className="text-base font-semibold">Complicaciones activas</h2>
        </div>
        <span className="text-xs text-gray-500">{rows.length} implantes</span>
      </header>
      {rows.length === 0 ? (
        <p className="p-6 text-sm text-gray-500 text-center">Sin complicaciones activas. 🎉</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800/40 text-xs">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Paciente</th>
                <th className="text-left px-2 py-2 font-medium">FDI</th>
                <th className="text-left px-2 py-2 font-medium">Complicación</th>
                <th className="text-left px-2 py-2 font-medium">Severidad</th>
                <th className="text-left px-2 py-2 font-medium">Días</th>
                <th className="text-left px-2 py-2 font-medium">Detectó</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.complicationId} className="border-t border-gray-100 dark:border-gray-800">
                  <td className="px-4 py-2">
                    <Link href={`/dashboard/specialties/implants/${r.patientId}`} className="text-blue-600 hover:underline">
                      {r.patientName}
                    </Link>
                  </td>
                  <td className="px-2 py-2 font-mono">{r.toothFdi}</td>
                  <td className="px-2 py-2 text-xs">{fmtType(r.type)}</td>
                  <td className="px-2 py-2">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${SEVERITY_BADGE[r.severity] ?? ""}`}>
                      {r.severity}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-xs text-gray-600 dark:text-gray-400">{r.daysSinceDetection}</td>
                  <td className="px-2 py-2 text-xs text-gray-600 dark:text-gray-400">{r.doctorName ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
