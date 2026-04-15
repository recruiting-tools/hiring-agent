/**
 * Playwright smoke test for hiring-agent UI.
 * XP style: run → report what broke → fix → repeat.
 *
 * Usage: node scripts/playwright-smoke.mjs
 */

import { chromium } from "playwright";

const BASE_URL = "https://hiring-chat.recruiter-assistant.com";
const EMAIL = "vladimir@skillset.ae";
const PASSWORD = "VovaRecruiter-2026";

const results = [];

function pass(name) {
  results.push({ name, status: "PASS" });
  console.log(`  ✓ ${name}`);
}

function fail(name, reason) {
  results.push({ name, status: "FAIL", reason });
  console.error(`  ✗ ${name}: ${reason}`);
}

async function run() {
  console.log("\n=== hiring-agent smoke test ===\n");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // collect console errors
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  try {
    // ── 1. Login page loads ───────────────────────────────────────────────────
    console.log("1. Login");
    await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded", timeout: 15000 });
    const loginTitle = await page.title();
    if (loginTitle) pass("login page loads");
    else fail("login page loads", "empty title");

    // ── 2. Fill credentials and submit ────────────────────────────────────────
    const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="mail" i]').first();
    const passwordInput = page.locator('input[type="password"]').first();
    const submitBtn = page.locator('button[type="submit"], button:has-text("Войти"), button:has-text("Login")').first();

    await emailInput.fill(EMAIL);
    await passwordInput.fill(PASSWORD);
    await Promise.all([
      submitBtn.click(),
      page.waitForResponse((response) => (
        response.url().includes("/auth/login")
        && response.request().method() === "POST"
      ), { timeout: 15000 }).catch(() => null)
    ]);

    // ── 3. Redirects to chat ──────────────────────────────────────────────────
    console.log("2. Redirect after login");
    await page.waitForURL((url) => !url.includes("/login"), { timeout: 10000 }).catch(() => {});
    const currentUrl = page.url();
    const vacancySelect = page.locator("#vacancy-select");
    const logoutBtn = page.locator('button:has-text("Выйти")').first();
    const hasVacancySelector = await vacancySelect.isVisible().catch(() => false);
    const hasLogoutButton = await logoutBtn.isVisible().catch(() => false);
    const loginSucceeded = !currentUrl.includes("/login") || hasVacancySelector || hasLogoutButton;
    let loginRedirectOk = loginSucceeded;
    if (loginSucceeded) {
      pass(`redirected to chat after login (${currentUrl})`);
    } else {
      console.warn(`  ! login url still ${currentUrl}, will verify by vacancy context`);
    }

    // ── 4. Vacancy selector loads ─────────────────────────────────────────────
    console.log("3. Vacancy selector");
    await vacancySelect.waitFor({ timeout: 8000 }).catch(() => {});

    let options = 0;
    for (let i = 0; i < 15; i += 1) {
      options = await vacancySelect.locator("option").count();
      if (options > 1) break;
      await page.waitForTimeout(1000);
    }

    if (options > 1) {
      pass(`vacancy selector loaded (${options} options)`);
      if (!loginRedirectOk) {
        pass(`redirected to chat after login (session active, url=${currentUrl})`);
        loginRedirectOk = true;
      }
    } else {
      fail("vacancy selector loaded", `only ${options} options`);
      if (!loginRedirectOk) {
        fail("redirected to chat after login", `still at ${currentUrl}`);
      }
    }

    // select first real vacancy
    const firstOption = await vacancySelect.locator("option").nth(1).getAttribute("value");
    if (firstOption) {
      await vacancySelect.selectOption(firstOption);
      pass(`selected vacancy: ${firstOption}`);
    } else {
      fail("select vacancy", "no options available");
    }

    await page.waitForTimeout(1000);

    // ── 5. "Настройте общение" button visible ─────────────────────────────────
    console.log('4. "Настройте общение" button');
    const commBtn = page.locator('button:has-text("Настройте общение"), button:has-text("Настрой общение")').first();
    const commBtnVisible = await commBtn.isVisible().catch(() => false);
    if (commBtnVisible) pass("button visible");
    else fail("button visible", "not found on page");

    // ── 6. Click and wait for response ────────────────────────────────────────
    console.log('5. Click "Настройте общение"');
    if (commBtnVisible) {
      await commBtn.click();

      // wait for response — either content or error
      const responseLocator = page.locator(".message, .chat-message, [data-role='assistant'], .assistant-message");
      await responseLocator.last().waitFor({ timeout: 30000 }).catch(() => {});

      const pageText = await page.innerText("body");

      if (pageText.includes("Вакансия не найдена")) {
        fail("communication plan response", "Вакансия не найдена");
      } else if (pageText.includes("LLM не настроен")) {
        fail("communication plan response", "LLM не настроен");
      } else if (pageText.includes("Ошибка")) {
        fail("communication plan response", "Ошибка в ответе");
      } else if (pageText.includes("План коммуникации") || pageText.includes("Вариант") || pageText.includes("сообщен")) {
        pass("communication plan generated successfully");
      } else {
        fail("communication plan response", "unexpected response (no plan content found)");
      }
    }

    // ── 7. Screenshot ─────────────────────────────────────────────────────────
    const screenshotPath = `/tmp/hiring-agent-smoke-${Date.now()}.png`;
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log(`\n  Screenshot: ${screenshotPath}`);

  } catch (err) {
    fail("unexpected error", err.message);
  } finally {
    await browser.close();
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n=== Results ===");
  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL");
  console.log(`Passed: ${passed}/${results.length}`);
  if (failed.length) {
    console.log("Failed:");
    failed.forEach((r) => console.log(`  ✗ ${r.name}: ${r.reason}`));
  }
  console.log("");

  process.exit(failed.length > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
