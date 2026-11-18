import { test, expect } from "@playwright/test";

test("branded login loads its local imagery, fits desktop/mobile and reveals passwords accessibly", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/login");
  expect(
    (
      await page.request.get(
        "/_next/image?url=https://untrusted.example/image.png&w=640&q=75",
      )
    ).status(),
  ).toBe(404);
  await expect(page).toHaveTitle("Sign in | Pandian Stores");
  await expect(
    page.getByText("Murukku / Product illustration", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  const image = page.getByRole("img", {
    name: "Illustrative golden murukku snacks on a black plate",
  });
  await expect
    .poll(() =>
      image.evaluate(
        (el: HTMLImageElement) => el.complete && el.naturalWidth > 0,
      ),
    )
    .toBe(true);
  await page.screenshot({
    path: "test-results/pandian-login-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 360, height: 800 });
  const password = page.getByLabel("Password", { exact: true });
  await password.fill("local-preview-only");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(password).toHaveAttribute("type", "text");
  await expect(
    page.getByRole("button", { name: "Hide password" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Hide password" }).click();
  await expect(password).toHaveAttribute("type", "password");
  await password.clear();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const button = await page
    .getByRole("button", { name: "Sign in", exact: true })
    .boundingBox();
  expect(button!.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({
    path: "test-results/pandian-login-mobile.png",
    fullPage: true,
  });
});
