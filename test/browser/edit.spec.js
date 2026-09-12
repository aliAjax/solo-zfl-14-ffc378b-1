import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdirSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";
import { expect as expectBrowser } from "playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PORT = 5114;
const BASE = `http://127.0.0.1:${PORT}`;

function resolveChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(process.env.HOME || "~", ".cache/ms-playwright")
  ].filter(Boolean);
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const dir = readdirSync(root).find((name) => name.startsWith("chromium_headless_shell"));
    if (!dir) continue;
    const candidate = path.join(
      root,
      dir,
      process.platform === "darwin"
        ? "chrome-headless-shell-mac/headless_shell"
        : process.platform === "linux"
          ? "chrome-headless-shell-linux-arm64/chrome-headless-shell"
          : "chrome-headless-shell-win/chrome-headless-shell.exe"
    );
    if (existsSync(candidate)) return candidate;
    // 非 arm64 机器上目录名后缀不同，做一次 glob 兜底
    const sub = path.join(root, dir);
    if (existsSync(sub)) {
      const found = readdirSync(sub).find((name) => name.startsWith("chrome-headless-shell"));
      if (found) {
        const inner = path.join(sub, found);
        const bin = path.join(inner, process.platform === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell");
        if (existsSync(bin)) return bin;
      }
    }
  }
  return undefined;
}

function waitForServer(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.destroy();
        if (res.statusCode === 200) resolve();
        else retry();
      });
      req.on("error", retry);
      req.setTimeout(2000, () => req.destroy());
    };
    function retry() {
      if (Date.now() > deadline) reject(new Error(`dev server 未在 ${timeoutMs}ms 内就绪：${url}`));
      else setTimeout(tick, 300);
    }
    tick();
  });
}

const executablePath = resolveChromium();
// 没有可用 Chromium（未执行 npx playwright install chromium）时跳过浏览器回归
const describeWithBrowser = executablePath ? describe : describe.skip;

function launchOptions() {
  const options = { executablePath };
  // CI/容器内可能缺少 Chromium 的系统库；仓库内置了 linux/arm64 的运行时库
  if (process.platform === "linux" && process.arch === "arm64") {
    const vendorLibs = path.resolve(process.cwd(), "vendor/browser-libs");
    if (existsSync(vendorLibs)) {
      options.env = {
        ...process.env,
        LD_LIBRARY_PATH: [vendorLibs, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":")
      };
    }
  }
  return options;
}

async function freshPage(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.goto(BASE);
  await page.waitForSelector(".repair");
  return { context, page, errors };
}

async function startEditing(page, title = "水槽下方渗水") {
  const card = page.locator(".repair", { hasText: title });
  await card.locator('[data-action="edit"]').click();
  await page.waitForFunction(() =>
    document.querySelector(".panel h2")?.textContent.includes("编辑")
  );
}

async function saveForm(page) {
  await page.locator('#repair-form button[type="submit"]').click();
}

describeWithBrowser("真实浏览器回归：编辑表单", () => {
  let server;
  let browser;

  beforeAll(async () => {
    // 直接 spawn vite 二进制（避免 npx 包装留下孤儿子进程），独立进程组便于整体回收
    const viteBin = path.resolve(process.cwd(), "node_modules/.bin/vite");
    server = spawn(
      viteBin,
      ["--host", "127.0.0.1", "--port", String(PORT), "--strictPort"],
      {
        cwd: process.cwd(),
        stdio: "ignore",
        detached: true
      }
    );
    await waitForServer(BASE);
    browser = await chromium.launch(launchOptions());
  }, 60000);

  afterAll(async () => {
    await browser?.close();
    if (server) {
      try {
        process.kill(-server.pid, "SIGTERM");
      } catch {
        server.kill("SIGTERM");
      }
    }
  });

  it("编辑保存留在当前页并更新同一条记录", async () => {
    const { context, page, errors } = await freshPage(browser);
    expect(await page.locator(".repair").count()).toBe(1);

    await startEditing(page);
    // 隐藏 id 控件存在；这是曾经遮蔽 form.id 导致原生提交的字段
    const hiddenId = page.locator('#repair-form input[type="hidden"][name="id"]');
    await expectBrowser(hiddenId).toHaveCount(1);

    await page.fill('#repair-form [name="title"]', "浏览器改后的标题");
    await page.fill('#repair-form [name="cost"]', "388.5");
    await saveForm(page);
    await page.waitForFunction(() =>
      document.querySelector(".panel h2")?.textContent.includes("新增")
    );

    // 没有发生原生表单跳转：URL 不含查询串
    expect(new URL(page.url()).search).toBe("");
    // 仍是同一条记录（不是新增一条）
    expect(await page.locator(".repair").count()).toBe(1);
    const card = page.locator(".repair");
    await expectBrowser(card.locator("p")).toHaveText("浏览器改后的标题");
    await expectBrowser(card).toContainText("¥388.5");
    expect(errors).toEqual([]);
    await context.close();
  });

  it("取消编辑回到新增表单且记录不变", async () => {
    const { context, page } = await freshPage(browser);
    await startEditing(page);
    await page.fill('#repair-form [name="title"]', "改了但取消");
    await page.locator('[data-action="cancel-edit"]').click();

    await expectBrowser(page.locator(".panel h2")).toHaveText("新增维修事项");
    await expectBrowser(page.locator('#repair-form input[name="id"]')).toHaveCount(0);
    await expectBrowser(page.locator(".repair p")).toHaveText("水槽下方渗水");
    expect(new URL(page.url()).search).toBe("");
    await context.close();
  });

  it("编辑时无效输入阻止提交并显示错误，记录保持原值", async () => {
    const { context, page } = await freshPage(browser);
    await startEditing(page);
    await page.fill('#repair-form [name="title"]', "   ");
    await saveForm(page);
    await page.waitForTimeout(200);

    // 仍停留在编辑态，没有跳转
    await expectBrowser(page.locator(".panel h2")).toHaveText("编辑维修事项");
    expect(new URL(page.url()).search).toBe("");
    await expectBrowser(page.locator('[data-error="title"]')).toContainText("问题描述");
    await expectBrowser(page.locator(".repair p")).toHaveText("水槽下方渗水");
    await context.close();
  });

  it("编辑保存后刷新页面，修改仍然存在", async () => {
    const { context, page } = await freshPage(browser);
    await startEditing(page);
    await page.fill('#repair-form [name="title"]', "刷新后仍在的标题");
    await page.fill('#repair-form [name="location"]', "阳台");
    await saveForm(page);
    await page.waitForFunction(() =>
      document.querySelector(".panel h2")?.textContent.includes("新增")
    );

    await page.reload();
    await page.waitForSelector(".repair");
    await expectBrowser(page.locator(".repair p")).toHaveText("刷新后仍在的标题");
    await expectBrowser(page.locator(".repair h3")).toHaveText("阳台");
    expect(await page.locator(".repair").count()).toBe(1);
    await context.close();
  });

  it("（守护既有行为）新增、状态流转、统计与删除在浏览器中仍正常", async () => {
    const { context, page } = await freshPage(browser);
    // 新增第二条
    await page.fill('#repair-form [name="location"]', "客厅");
    await page.fill('#repair-form [name="title"]', "灯具损坏");
    await page.fill('#repair-form [name="cost"]', "200");
    await saveForm(page);
    await page.waitForTimeout(200);
    expect(await page.locator(".repair").count()).toBe(2);

    // 示例事项流转：待处理 -> 处理中 -> 已完成
    const sample = page.locator(".repair", { hasText: "水槽下方渗水" });
    await sample.locator('[data-action="flow"]').click();
    await expectBrowser(sample.locator(".status")).toHaveText("处理中");
    await sample.locator('[data-action="flow"]').click();
    await expectBrowser(sample.locator(".status")).toHaveText("已完成");

    await expectBrowser(page.locator('[data-stat="unfinishedCount"]')).toHaveText("1");
    await expectBrowser(page.locator('[data-stat="doingCount"]')).toHaveText("0");
    await expectBrowser(page.locator('[data-stat="unfinishedCost"]')).toHaveText("¥200");
    await expectBrowser(page.locator('[data-stat="doneSpent"]')).toHaveText("¥260");

    // 按费用降序：示例 ¥260 在新事项 ¥200 之前
    await page.selectOption('[data-control="sort"]', "cost");
    await expectBrowser(page.locator(".repair").first().locator("p")).toHaveText("水槽下方渗水");

    // 删除
    await sample.locator('[data-action="delete"]').click();
    expect(await page.locator(".repair").count()).toBe(1);
    await context.close();
  });
});
