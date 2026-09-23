"use client";

/**
 * El acceso al Saldo IA desde la pantalla de Sabina (ws1-t5).
 *
 * Sabina es lo que más saldo consume y no había forma de llegar a su saldo
 * desde aquí. Va en la CABECERA, junto a «Nueva conversación», como un chip
 * discreto: la conversación es el centro de la pantalla y un botón gordo en
 * medio la estropea. Tiene su propia hoja, a propósito, para vestirse igual
 * con las dos pieles de Sabina (la de siempre y la del rediseño) sin tocar el
 * mapa `CLASES_REDISENO` ni la hoja compartida del rediseño: solo lee tokens
 * globales (`--brand`, `--brand-soft`), los mismos con los que el menú realza
 * la opción Saldo IA. El mismo acento en los dos sitios.
 *
 * `importe` es lo que manda el servidor (`saldo-ia-importe.tsx`, en
 * Suspense): mientras llega, el chip dice solo «Saldo IA» y ya lleva a la
 * pantalla; al llegar, enseña la cifra. Quién lo ve lo decide `page.tsx` con
 * el MISMO permiso que exige la pantalla del saldo (`whatsapp.view`).
 */

import type { ReactNode } from "react";
import Link from "next/link";
import { Wallet } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import s from "./saldo-ia-chip.module.css";

/** La pantalla del saldo: la misma a la que lleva el menú. */
export const RUTA_SALDO_IA = "/dashboard/whatsapp/bot/saldo";

export function SaldoIaChip({ importe }: { importe: ReactNode }) {
  const t = useT();
  return (
    <Link
      href={RUTA_SALDO_IA}
      className={s.chip}
      title={t("sabina.saldoIa.titulo")}
      aria-label={t("sabina.saldoIa.titulo")}
      data-saldo-ia
    >
      <Wallet size={14} strokeWidth={2.2} aria-hidden className={s.icono} />
      <span className={s.texto}>{t("sabina.saldoIa.etiqueta")}</span>
      {importe !== null && importe !== undefined && (
        <span className={s.importe}>{importe}</span>
      )}
    </Link>
  );
}
