import type { CategoriaMovimiento } from "./catalogo";

export interface FiltroMovimientos {
  clinicIds: string[];
  patientId: string;
  categoria?: CategoriaMovimiento | null;
  desde?: Date | null;
  hasta?: Date | null;
  page?: number;
  pageSize?: number;
}

export interface MovimientoVista {
  id: string;
  fecha: string;
  actor: string;
  categoria: CategoriaMovimiento;
  texto: string;
  oculto: boolean;
}

export interface PaginaDeMovimientos {
  items: MovimientoVista[];
  total: number;
  page: number;
  pageSize: number;
  paginas: number;
  /** true cuando la columna `patientId` aún no existe y la lista viene del modo degradado. */
  degradado: boolean;
}

