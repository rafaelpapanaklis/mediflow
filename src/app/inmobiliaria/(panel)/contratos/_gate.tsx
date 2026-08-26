// ═══════════════════════════════════════════════════════════════════════
// PUERTA ÚNICA de las PANTALLAS de contratos (el gemelo de _server.ts, que
// es la de las APIs).
//
// Las dos existen y las dos comprueban lo mismo, a propósito: esta decide
// qué se PINTA, aquella decide qué se EJECUTA. Esconder una pantalla NO es
// control de acceso —quien escriba la URL de la API llegaría igual—, y una
// API bien cerrada sin esto deja al usuario mirando una pantalla que falla
// en cada botón sin decirle por qué.
//
// Las tres rejas, en este orden:
//   1. SESIÓN  → /login.
//   2. MODO    → se lee del item `rentas` de REALTY_NAV_ITEMS, que hoy es
//                ALL_MODES. NO se copia el valor aquí: si mañana alguien
//                decide que el modo OWNER no lleva arrendamientos, este
//                módulo se entera solo.
//   3. FEATURE `rentals` + PERMISO `leases.manage` → aviso con texto, nunca
//                una pantalla en blanco.
//
// ⚠️ NO HAY ITEM DE MENÚ para Contratos: REALTY_NAV_ITEMS vive en
// src/lib/realty/types.ts y esta terminal tiene prohibido tocarlo. La
// sección funciona por URL y sus pantallas se enlazan entre sí. Es una
// línea, y queda anotada en el reporte como el único paso pendiente.
//
// i18n CONVENCIÓN B: aquí se RECORTA el sub-árbol (dict.es | dict.en) y el
// componente cliente llama a makeRealtyT SIN prefijo. Cruzarlas pinta la
// llave cruda.
// ═══════════════════════════════════════════════════════════════════════
import type { ReactElement } from "react";
import { redirect } from "next/navigation";
import { CreditCard, Lock } from "lucide-react";
import { getRealtyContext, type RealtyContext } from "@/lib/realty-auth";
import { hasRealtyPermission, type RealtyPermissionKey } from "@/lib/realty/permissions";
import { realtyPlanHasFeature } from "@/lib/realty/plan-shared";
import { REALTY_NAV_ITEMS, navItemAllowsMode } from "@/lib/realty/types";
import type { Dictionary } from "@/i18n/t";
import contractsDict from "@/i18n/dictionaries/realty/contracts.json";

/** El item cuyo MODO y cuyas rejas comparte esta sección. */
const ANCLA = "rentas";

export type ContractsGate =
  | { ok: true; ctx: RealtyContext; dict: Dictionary; locale: "es" | "en" }
  | { ok: false; screen: ReactElement };

function Aviso({ kind, texto }: { kind: "plan" | "permission"; texto: string }) {
  const Icon = kind === "plan" ? CreditCard : Lock;
  return (
    <div style={{ minHeight: "58vh", display: "grid", placeItems: "center", padding: 20 }}>
      <div
        style={{
          width: "100%",
          maxWidth: 520,
          background: "var(--bg-elev)",
          border: "1px solid var(--border-soft)",
          borderRadius: 16,
          padding: "clamp(22px, 4vw, 36px)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          gap: 14,
          boxShadow: "var(--shadow-2)",
        }}
      >
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: 15,
            display: "grid",
            placeItems: "center",
            background: "var(--brand-soft)",
            border: "1px solid var(--border-brand)",
            color: "var(--brand)",
          }}
        >
          <Icon size={23} />
        </div>
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: "var(--text-2)" }}>{texto}</p>
      </div>
    </div>
  );
}

export async function gateContractScreen(): Promise<ContractsGate> {
  const ctx = await getRealtyContext();
  if (!ctx) redirect("/login");

  const item = REALTY_NAV_ITEMS.find((i) => i.key === ANCLA);
  if (item && !navItemAllowsMode(item, ctx.mode)) redirect("/inmobiliaria/inicio");

  const locale: "es" | "en" = ctx.account.locale === "en" ? "en" : "es";
  const dict = (contractsDict as unknown as Record<string, Dictionary>)[locale];
  const errores = dict.errores as Dictionary;

  if (!realtyPlanHasFeature(ctx.plan, "rentals")) {
    return { ok: false, screen: <Aviso kind="plan" texto={errores.sinPlan as string} /> };
  }
  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasRealtyPermission(permUser, "leases.manage" as RealtyPermissionKey)) {
    return { ok: false, screen: <Aviso kind="permission" texto={errores.sinPermiso as string} /> };
  }

  return { ok: true, ctx, dict, locale };
}

/**
 * Las tablas no están todavía.
 *
 * No es "algo falló": es "falta correr un archivo", y el que lo lee tiene
 * que poder resolverlo sin abrir el código. Por eso se dice el nombre del
 * .sql. (El módulo además intenta crear las tablas solo la primera vez;
 * esto sale cuando el rol de la base no puede.)
 */
export function TablesMissing({ texto }: { texto: string }) {
  return (
    <div style={{ padding: 20 }}>
      <div
        style={{
          maxWidth: 620,
          padding: 18,
          borderRadius: 14,
          background: "var(--bg-elev)",
          border: "1px solid var(--border-soft)",
          color: "var(--text-2)",
          fontSize: 13.5,
          lineHeight: 1.6,
        }}
      >
        {texto}
      </div>
    </div>
  );
}
