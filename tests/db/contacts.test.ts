import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/db";
import type { DB } from "@/db";
import { getContact, upsertContact, listContacts } from "@/db/repo/contacts";

let db: DB;
beforeEach(async () => {
  db = await createTestDb();
});

describe("contacts repo", () => {
  it("returns null for unknown number", async () => {
    expect(await getContact(db, "+14155550199")).toBeNull();
  });

  it("creates then updates a contact, keeping fields not passed", async () => {
    await upsertContact(db, { phone: "+14155550199", name: "Jane" });
    await upsertContact(db, { phone: "+14155550199", notes: "Dentist" });
    const c = await getContact(db, "+14155550199");
    expect(c?.name).toBe("Jane");
    expect(c?.notes).toBe("Dentist");
  });

  it("lists contacts alphabetically by name, unnamed last", async () => {
    await upsertContact(db, { phone: "+14155550001", name: "Zed" });
    await upsertContact(db, { phone: "+14155550002", notes: "no name" });
    await upsertContact(db, { phone: "+14155550003", name: "Amy" });
    const names = (await listContacts(db)).map((c) => c.name);
    expect(names).toEqual(["Amy", "Zed", null]);
  });
});
