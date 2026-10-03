import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";

const dir = "docs/evidence/phase-a-final";
const manifest = JSON.parse(readFileSync(`${dir}/manifest.json`, "utf8"));
const escape = (text) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const style = `<style>body{margin:0;padding:16px;background:#e8edf4;font:14px system-ui;color:#18202e}main{display:grid;gap:16px;align-items:start}figure{margin:0;background:white;border:1px solid #bac6d8}figcaption{padding:12px;min-height:24px;font-weight:700}img{display:block;width:100%;height:auto}a{color:inherit}h1{font-size:22px}p{max-width:75ch}</style>`;
const browser = await chromium.launch();
try {
  for (const [name, width, ids] of [
    [
      "contact-phone-states",
      390,
      ["01-390-active", "02-390-thinking", "03-390-tentative", "04-390-pause-request"],
    ],
    ["contact-phone-tools", 390, ["06-390-more-sheet", "07-390-more-bag", "28-390-practice"]],
    ["contact-desktop-layout", 1440, ["11-laptop-13", "15-short-1280x560"]],
    ["contact-desktop-workspace", 1440, ["16-desktop-notes", "17-desktop-last-exchange"]],
  ]) {
    const columns = width === 390 ? ids.length : 1;
    const page = await browser.newPage({
      viewport: { width: columns * width + (columns + 1) * 16, height: 900 },
      deviceScaleFactor: 1,
    });
    const cards = ids
      .map((id) => {
        const view = manifest.find((item) => item.id === id);
        const bytes = readFileSync(`${dir}/${id}.png`).toString("base64");
        return `<figure><figcaption>${escape(view.label)} · ${view.viewport} · ${view.state}</figcaption><img src="data:image/png;base64,${bytes}"></figure>`;
      })
      .join("");
    await page.setContent(
      `${style}<main style="grid-template-columns:repeat(${columns},${width}px)">${cards}</main>`,
    );
    await page
      .locator("img")
      .evaluateAll((images) => Promise.all(images.map((image) => image.decode())));
    await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
    await page.close();
  }
} finally {
  await browser.close();
}
const cards = manifest
  .map(
    (view) =>
      `<figure><figcaption><a href="${view.id}.png">${escape(view.label)} · ${view.viewport} · board ${view.board}px</a></figcaption><a href="${view.id}.png"><img loading="lazy" src="${view.id}.png"></a></figure>`,
  )
  .join("");
writeFileSync(
  `${dir}/index.html`,
  `<!doctype html><meta charset="utf-8"><title>Phase A final visual evidence</title>${style}<h1>Phase A · AFTER-only evidence</h1><p>Final local tree. Product visual approval: WAITING. Open any image for its full resolution. Fixtures validate layout and local interaction; the separate real-backend gate validates authority/security.</p><main style="grid-template-columns:repeat(auto-fit,minmax(360px,1fr))">${cards}</main>`,
);
console.log(`Created four readable contact sheets and ${dir}/index.html`);
