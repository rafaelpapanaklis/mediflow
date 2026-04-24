import type { LucideIcon } from "lucide-react";

export type CommandGroup =
  | "paciente-activo"
  | "pacientes"
  | "citas"
  | "facturas"
  | "acciones"
  | "ir-a";

export interface CommandItem {
  id: string;
  group: CommandGroup;
  label: string;
  sub?: string;
  icon?: LucideIcon;
  shortcut?: string;
  tone?: "brand" | "success" | "warning" | "danger" | "info" | "neutral";
  run: (ctx: CommandContext) => void | Promise<void>;
  keywords?: string[];
}

export interface CommandContext {
  close: () => void;
  push: (href: string) => void;
  activeConsultPatientId: string | null;
}

export interface RemoteSearchResult {
  patients?: Array<{ id: string; name: string; sub?: string; href: string }>;
  appointments?: Array<{ id: string; title: string; sub?: string; href: string }>;
  invoices?: Array<{ id: string; title: string; sub?: string; href: string }>;
}
