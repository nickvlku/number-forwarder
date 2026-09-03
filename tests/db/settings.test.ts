import { describe, it, expect } from "vitest";
import { createTestDb } from "../helpers/db";
import { getForwardingEnabled, setForwardingEnabled } from "@/db/repo/settings";

describe("settings repo", () => {
  it("defaults to forwarding enabled when no row exists", async () => {
    const db = await createTestDb();
    expect(await getForwardingEnabled(db)).toBe(true);
  });

  it("persists a toggle", async () => {
    const db = await createTestDb();
    await setForwardingEnabled(db, false);
    expect(await getForwardingEnabled(db)).toBe(false);
    await setForwardingEnabled(db, true);
    expect(await getForwardingEnabled(db)).toBe(true);
  });
});
