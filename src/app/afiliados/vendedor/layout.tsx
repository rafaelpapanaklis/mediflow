export const dynamic = "force-dynamic";

// Layout del área de VENDEDOR (equipo). Gatea por getAffiliateSellerContext():
// sin sesión/vendedor → login; si el afiliado padre no está APPROVED, el
// vendedor aún no puede operar → /afiliados/pendiente. Renderiza <SellerShell/>.
import { redirect } from "next/navigation";
import { getAffiliateSellerContext } from "@/lib/affiliate-seller-auth";
import { SellerShell } from "@/components/afiliados/seller-shell";

export default async function VendedorLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getAffiliateSellerContext();
  if (!ctx) redirect("/afiliados/login");
  if (ctx.parentStatus !== "APPROVED") redirect("/afiliados/pendiente");

  return (
    <SellerShell sellerName={ctx.seller.name} parentName={ctx.parentName}>
      {children}
    </SellerShell>
  );
}
