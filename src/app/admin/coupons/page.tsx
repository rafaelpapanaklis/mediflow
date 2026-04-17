export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { CouponsClient } from "./coupons-client";

export const metadata: Metadata = { title: "Cupones — Admin MediFlow" };

export default async function AdminCouponsPage() {
  const coupons = await prisma.coupon.findMany({
    orderBy: { createdAt: "desc" },
  });
  return <CouponsClient initial={coupons as any} />;
}
