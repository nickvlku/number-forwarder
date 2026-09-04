import { vi } from "vitest";
import { createTestDb } from "./db";
import { TEST_ENV } from "./twilio";
import type { DB } from "@/db";

/**
 * Usage at the top of a handler test file:
 *
 *   vi.mock("@/db", () => dbMockFactory());
 *   vi.mock("@/lib/env", () => envMockFactory());
 *   vi.mock("next/server", () => nextServerMockFactory());
 *   const { db } = await handlerTestContext();
 */
export function dbMockFactory() {
  return { db: createTestDb() };
}

export async function envMockFactory() {
  const mod = await vi.importActual<typeof import("@/lib/env")>("@/lib/env");
  return { ...mod, getEnv: () => mod.loadEnv(TEST_ENV) };
}

/** `after()` runs its callback immediately in tests so background work is awaited by the test. */
export const afterCalls: Promise<unknown>[] = [];
export function nextServerMockFactory() {
  return {
    after: (fn: () => unknown) => {
      afterCalls.push(Promise.resolve().then(fn));
    },
  };
}

export async function flushAfter(): Promise<void> {
  await Promise.allSettled(afterCalls.splice(0));
}

export async function handlerTestContext(): Promise<{ db: DB }> {
  const mod = await import("@/db");
  const db = await (mod.db as unknown as Promise<DB>);
  return { db };
}
