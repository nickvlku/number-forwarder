"use client";

import { useEffect } from "react";

export function UnreadTitle({ count }: { count: number }) {
  useEffect(() => {
    document.title = count > 0 ? `(${count}) THE VLKU` : "THE VLKU";
  }, [count]);
  return null;
}
