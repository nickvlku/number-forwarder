"use client";

import { useOptimistic, useTransition } from "react";
import { toggleForwarding } from "@/app/(dashboard)/actions";

export function ForwardingToggle({ enabled }: { enabled: boolean }) {
  const [optimistic, setOptimistic] = useOptimistic(enabled);
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={optimistic}
      disabled={pending}
      onClick={() =>
        start(async () => {
          setOptimistic(!optimistic);
          await toggleForwarding(!optimistic);
        })
      }
      className="flex items-center gap-2 text-sm font-semibold"
    >
      <span className={optimistic ? "" : "muted"}>{optimistic ? "Forwarding on" : "Forwarding off"}</span>
      <span className={`switch ${optimistic ? "switch-on" : ""}`} aria-hidden />
    </button>
  );
}
