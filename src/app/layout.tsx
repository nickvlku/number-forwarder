import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "THE VLKU", description: "Calls, voicemails, and texts for 415-THE-VLKU" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
