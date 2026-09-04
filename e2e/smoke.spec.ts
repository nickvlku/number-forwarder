import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Password").fill("e2e-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/");
});

test("feed lists seeded calls and texts with pills", async ({ page }) => {
  await expect(page.getByRole("link", { name: /Dr\. Patel's office/ }).first()).toBeVisible();
  await expect(page.getByText("Sarah Kim")).toBeVisible();
  await expect(page.locator(".pill-voicemail").first()).toBeVisible();
  await expect(page.locator(".pill-text").first()).toBeVisible();
});

test("selecting a voicemail shows transcript and player", async ({ page }) => {
  await page.getByRole("link", { name: /Dr\. Patel's office/ }).first().click();
  await expect(page).toHaveURL(/item=CAseed0001/);
  await expect(page.locator(".quote")).toContainText("confirm your appointment Thursday");
  await expect(page.locator("audio")).toHaveAttribute("src", "/api/recordings/REseed0001");
});

test("naming a number persists and appears in the list and contacts", async ({ page }) => {
  await page.getByRole("link", { name: /\+1 \(415\) 555-0199/ }).first().click();
  await page.getByPlaceholder("Add a name").fill("Unknown Caller Test");
  await page.getByPlaceholder("Anything worth remembering").click(); // blur triggers save
  await expect(page.getByText("Saved")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("link", { name: /Unknown Caller Test/ }).first()).toBeVisible();
  await page.goto("/contacts");
  await expect(page.getByText("Unknown Caller Test")).toBeVisible();
});

test("filter chips narrow the list", async ({ page }) => {
  await page.getByRole("link", { name: "Texts" }).click();
  await expect(page).toHaveURL(/filter=text/);
  await expect(page.locator(".pill-voicemail")).toHaveCount(0);
  await expect(page.locator(".pill-text").first()).toBeVisible();
});
