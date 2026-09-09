import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1512, height: 982 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const base = process.env.TEST_BASE_URL || "http://localhost:3000";
await mkdir("test-results", { recursive: true });
try {
  await page.goto(base);
  await page
    .getByRole("button", { name: "Explorar TEGRAM", exact: true })
    .waitFor({ timeout: 45000 });
  await page
    .getByText("Preparando sua vista do porto")
    .waitFor({ state: "hidden" });
  const [weather, port, ais] = await Promise.all(
    ["/api/weather", "/api/port", "/api/vessels"].map(async (path) => {
      const r = await page.request.get(base + path);
      assert.equal(r.status(), 200, path);
      return r.json();
    }),
  );
  assert.equal(typeof weather.current.temperature_2m, "number");
  assert.ok(port.vessels.length > 0);
  assert.equal(typeof ais.configured, "boolean");
  assert.ok(
    ais.vessels.every(
      (v) => v.positionSource === "ais" && v.coordinates?.length === 2,
    ),
  );
  if (!ais.configured) assert.deepEqual(ais.vessels, []);
  console.log("PASS: live weather and EMAP endpoints; no fabricated AIS data");
  const canvas = page.locator(".maplibregl-canvas");
  await page.getByRole("button", { name: "Recolher painel" }).click();
  await page.waitForTimeout(300);
  const canvasBox = await canvas.boundingBox();
  const regionBox = await page.locator(".map-region").boundingBox();
  assert.ok(
    Math.abs(canvasBox.width - regionBox.width) < 2,
    "canvas resizes with sidebar",
  );
  const marker = page.getByRole("button", {
    name: "Explorar TEGRAM",
    exact: true,
  });
  const markerBefore = await marker.boundingBox();
  await page.mouse.move(
    canvasBox.x + canvasBox.width * 0.6,
    canvasBox.y + canvasBox.height * 0.5,
  );
  await page.mouse.down();
  await page.mouse.move(
    canvasBox.x + canvasBox.width * 0.6 + 100,
    canvasBox.y + canvasBox.height * 0.5 + 40,
    { steps: 12 },
  );
  await page.mouse.up();
  await page.waitForTimeout(500);
  const markerAfter = await marker.boundingBox();
  assert.ok(Math.abs(markerAfter.x - markerBefore.x) > 50, "drag pans the map");
  assert.equal(
    await page.getByRole("button", { name: "Alternar vista 2D e 3D" }).count(),
    0,
  );
  await page.getByRole("button", { name: "Abrir painel" }).click();
  await page.getByRole("button", { name: "Centralizar no porto" }).click();
  await page.waitForTimeout(1400);
  console.log("PASS: canvas resizes with sidebar and dragging pans the 2D map");

  await page.getByRole("button", { name: "Aumentar zoom" }).click();
  await page.getByRole("button", { name: "Diminuir zoom" }).click();
  await page.getByRole("button", { name: "Camadas", exact: true }).click();
  await page.getByLabel("Identificação dos berços").uncheck();
  assert.equal(
    await page
      .getByRole("button", { name: "Explorar Berço 103", exact: true })
      .isVisible(),
    false,
  );
  await page.getByLabel("Identificação dos berços").check();
  await page.getByRole("button", { name: "Fechar camadas" }).click();
  await page.getByRole("button", { name: "Mapa", exact: true }).click();
  await page.getByRole("button", { name: "Satélite", exact: true }).click();
  console.log("PASS: zoom, map styles, layer visibility");
  await page
    .getByRole("textbox", { name: "Buscar navio, edifício, via ou área" })
    .fill("TEGRAM");
  await page
    .getByRole("textbox", { name: "Buscar navio, edifício, via ou área" })
    .press("Enter");
  await page
    .getByRole("region", { name: "Detalhes de TEGRAM", exact: true })
    .waitFor();
  await page.waitForTimeout(1800);
  await page.screenshot({ path: "test-results/terminal-desktop.png" });
  await page.getByRole("button", { name: "Fechar detalhes" }).click();
  await page.getByRole("button", { name: "Navios", exact: true }).click();
  await page.getByRole("button", { name: "Esperados", exact: true }).click();
  await page.getByRole("button", { name: "Atracados", exact: true }).click();
  const first = page.locator(".vessel-row").first();
  await first.click();
  assert.match(
    await page.locator(".selection-card").innerText(),
    /Posição aproximada|Posição AIS recebida/,
  );
  await page.getByRole("button", { name: "Fechar detalhes" }).click();
  await page
    .getByRole("button", { name: "Fontes e dados", exact: true })
    .click();
  assert.ok(await page.getByRole("link", { name: "Tábua de Maré" }).count());
  await page.getByRole("button", { name: "Visão geral", exact: true }).click();
  await page
    .getByRole("button", { name: "Como navegar", exact: true })
    .first()
    .click();
  assert.ok(await page.locator("dialog").evaluate((el) => el.open));
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("dialog").evaluate((el) => el.open), false);
  await page.getByRole("button", { name: "Centralizar no porto" }).click();
  await page.waitForTimeout(1800);
  await page.screenshot({ path: "test-results/overview-desktop.png" });
  console.log(
    "PASS: search, vessel filters/details, official documents, keyboard dialog",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({ path: "test-results/mobile-panel.png" });
  await page.getByRole("button", { name: "Recolher painel" }).click();
  await page.getByRole("button", { name: "Abrir painel" }).waitFor();
  await page
    .getByRole("textbox", { name: "Buscar navio, edifício, via ou área" })
    .fill("tegram");
  await page
    .getByRole("textbox", { name: "Buscar navio, edifício, via ou área" })
    .press("Enter");
  await page.waitForTimeout(1800);
  assert.ok(
    await page.getByRole("button", { name: "Aproximar no mapa" }).isVisible(),
  );
  await page.screenshot({ path: "test-results/mobile-map.png" });
  console.log("PASS: mobile 390px, drawer, search and location details");
  assert.deepEqual(errors, []);
  console.log("PASS: no browser runtime errors");
  // Independently verify a weather failure is visible and recoverable.
  const offline = await context.newPage();
  await offline.route("**/api/weather", (r) =>
    r.fulfill({
      status: 503,
      contentType: "application/json",
      body: '{"error":"unavailable"}',
    }),
  );
  await offline.goto(base);
  await offline
    .getByText("Não foi possível consultar o clima.", { exact: true })
    .waitFor();
  assert.ok(
    await offline
      .getByRole("button", { name: "Tentar novamente", exact: true })
      .isVisible(),
  );
  await offline.close();
  console.log("PASS: visible weather outage and retry");
} finally {
  await browser.close();
}
