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
      aria-label="Forwarding"
      disabled={pending}
      onClick={() =>
        start(async () => {
          setOptimistic(!optimistic);
          await toggleForwarding(!optimistic);
        })
      }
      className="flex items-center gap-2 text-sm font-semibold whitespace-nowrap"
    >
      <span className={optimistic ? "" : "muted"}>
        {optimistic ? (
          <>
            <span className="hidden sm:inline">Forwarding on</span>
            <span className="sm:hidden">On</span>
          </>
        ) : (
          <>
            <span className="hidden sm:inline">Forwarding off</span>
            <span className="sm:hidden">Off</span>
          </>
        )}
      </span>
      <span className={`switch ${optimistic ? "switch-on" : ""}`} aria-hidden />
    </button>
  );
}
