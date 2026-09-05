import type { Metadata } from "next";
import { loadLegal } from "@/lib/legal";
import { LegalDocument } from "@/components/LegalDocument";

export const metadata: Metadata = { title: "Privacy Policy · THE VLKU" };

export default function Page() {
  return <LegalDocument doc={loadLegal("privacy")} />;
}
