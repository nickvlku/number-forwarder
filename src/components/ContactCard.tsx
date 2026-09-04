"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { saveContact } from "@/app/(dashboard)/actions";

export function ContactCard({ phone, name, notes }: { phone: string; name: string; notes: string }) {
  const [n, setN] = useState(name);
  const [t, setT] = useState(notes);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved">("idle");
  const [, start] = useTransition();

  const save = () => {
    if (n === name && t === notes) return;
    setSaved("saving");
    start(async () => {
      await saveContact(phone, n, t);
      setSaved("saved");
      setTimeout(() => setSaved("idle"), 1500);
    });
  };

  return (
    <section className="surface p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="label">Contact</div>
        <div className="flex items-center gap-3">
          <span className="muted text-xs" aria-live="polite">{saved === "saving" ? "Saving…" : saved === "saved" ? "Saved" : ""}</span>
          <Link href={`/contacts/${encodeURIComponent(phone)}`} className="muted text-xs hover:underline">History</Link>
        </div>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        <span className="muted text-xs">Name</span>
        <input className="input" value={n} onChange={(e) => setN(e.target.value)} onBlur={save} placeholder="Add a name" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="muted text-xs">Notes</span>
        <textarea className="textarea" value={t} onChange={(e) => setT(e.target.value)} onBlur={save} placeholder="Anything worth remembering" />
      </label>
    </section>
  );
}
