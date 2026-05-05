"use client";
// Implants — widget de controles vencidos. Spec §6.17.

import Link from "next/link";
import { Phone, MessageCircle } from "lucide-react";

export type OverdueFollowUpRow = {
  followUpId: string;
  implantId: string;
  patientId: string;
  patientName: string;
  toothFdi: number;
  milestone: string;
  scheduledAt: Date;
  daysOverdue: number;
  patientPhone: string | null;
};

export interface OverdueFollowUpsWidgetProps {
  rows: OverdueFollowUpRow[];
}

const MILESTONE_LABEL: Record<string, string> = {
  M_1_WEEK: "1 semana",
  M_2_WEEKS: "2 semanas",
  M_1_MONTH: "1 mes",
  M_3_MONTHS: "3 meses",
  M_6_MONTHS: "6 meses",
  M_12_MONTHS: "12 meses",
  M_24_MONTHS: "24 meses",
  M_5_YEARS: "5 años",
  M_10_YEARS: "10 años",
  UNSCHEDULED: "Sin programar",
};

export function OverdueFollowUpsWidget({ rows }: OverdueFollowUpsWidgetProps) {
  return (
    <section className="rounded-lg border border-[var(--border-soft,theme(colors.gray.200))] dark:border-gray-800 bg-white dark:bg-gray-900">
      <header className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-gray-500">Mantenimiento</p>
          <h2 className="text-base font-semibold">Controles vencidos</h2>
        </div>
        <span className="text-xs text-gray-500">{rows.length} pacientes</span>
      </header>
      {rows.length === 0 ? (
        <p className="p-6 text-sm text-gray-500 text-center">Sin controles vencidos. Excelente cumplimiento.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800/40 text-xs">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Paciente</th>
                <th className="text-left px-2 py-2 font-medium">Diente</th>
                <th className="text-left px-2 py-2 font-medium">Hito</th>
                <th className="text-left px-2 py-2 font-medium">Atrasado</th>
                <th className="text-left px-2 py-2 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.followUpId} className="border-t border-gray-100 dark:border-gray-800">
                  <td className="px-4 py-2">
                    <Link href={`/dashboard/specialties/implants/${r.patientId}`} className="text-blue-600 hover:underline">
                      {r.patientName}
                    </Link>
                  </td>
                  <td className="px-2 py-2 font-mono">{r.toothFdi}</td>
                  <td className="px-2 py-2 text-xs text-gray-600 dark:text-gray-400">{MILESTONE_LABEL[r.milestone] ?? r.milestone}</td>
                  <td className="px-2 py-2">
                    <span className={`text-xs font-medium ${r.daysOverdue > 60 ? "text-red-600" : r.daysOverdue > 30 ? "text-orange-600" : "text-amber-600"}`}>
                      {r.daysOverdue} días
                    </span>
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-1">
                      {r.patientPhone && (
                        <>
                          <a href={`tel:${r.patientPhone}`} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800" title="Llamar">
                            <Phone className="h-3.5 w-3.5" />
                          </a>
                          <a href={`https://wa.me/${r.patientPhone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800" title="WhatsApp">
                            <MessageCircle className="h-3.5 w-3.5" />
                          </a>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
