import Link from "next/link";
import type { LegalDoc } from "@/lib/legal";

export function LegalDocument({ doc }: { doc: LegalDoc }) {
  return (
    <main className="min-h-screen">
      <header className="flex items-center gap-5 px-4 h-14 border-b" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
        <span className="wordmark">THE VLKU</span>
        <nav className="flex items-center gap-4 text-sm font-semibold muted">
          <Link href="/privacy" className="hover:underline">Privacy Policy</Link>
          <Link href="/terms" className="hover:underline">Terms</Link>
        </nav>
      </header>
      <article className="legal max-w-2xl mx-auto p-5 md:p-8" dangerouslySetInnerHTML={{ __html: doc.html }} />
    </main>
  );
}
