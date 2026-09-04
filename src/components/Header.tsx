import Link from "next/link";
import { ForwardingToggle } from "./ForwardingToggle";
import { logout } from "@/app/login/actions";

export function Header({ forwarding }: { forwarding: boolean }) {
  return (
    <header className="flex items-center justify-between px-3 sm:px-4 h-14 border-b" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
      <nav className="flex items-center gap-3 sm:gap-5">
        <Link href="/" className="wordmark whitespace-nowrap">THE VLKU</Link>
        <Link href="/contacts" className="muted text-sm font-semibold hover:underline whitespace-nowrap">Contacts</Link>
        <Link href="/settings" className="muted text-sm font-semibold hover:underline whitespace-nowrap">Settings</Link>
      </nav>
      <div className="flex items-center gap-3 sm:gap-4">
        <ForwardingToggle enabled={forwarding} />
        <form action={logout}><button className="muted text-sm hover:underline whitespace-nowrap" type="submit">Sign out</button></form>
      </div>
    </header>
  );
}
