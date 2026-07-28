export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { toBlogPostDTO } from "@/lib/blog/types";
import { PostEditor } from "../post-editor";

export const metadata: Metadata = { title: "Editar artículo — Admin DaleControl" };

export default async function AdminBlogEditPage({ params }: { params: { id: string } }) {
  const row = await prisma.blogPost.findUnique({ where: { id: params.id } });
  if (!row) notFound();
  return <PostEditor post={toBlogPostDTO(row)} />;
}
