// Edits every editable element of every corpus page through the real UI in Chrome. Each edit must
// either reload exactly as the user saw it, or leave the file untouched and become a comment.
// Usage: npm run test:browser [page.html]   (CHROME_PATH overrides the Chrome binary)
import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';

const DIR = mkdtempSync(`${tmpdir()}/htmlpen-corpus-`);
cpSync(new URL('./corpus', import.meta.url), DIR, { recursive: true });
const PORT = 5301, BASE = `http://localhost:${PORT}/`;
const env = { ...process.env };
for (const k of ['CONDUCTOR_IS_LOCAL', 'CONDUCTOR_WORKSPACE_ID', 'CONDUCTOR_SESSION_ID']) delete env[k];
const server = spawn(process.execPath, [new URL('../../src/cli.js', import.meta.url).pathname, DIR, '--no-open', '--port', String(PORT)], { env, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const only = process.argv[2];
const pages = readdirSync(DIR).filter((f) => f.endsWith('.html') && (!only || f === only)).sort();
const originals = Object.fromEntries(pages.map((p) => [p, readFileSync(`${DIR}/${p}`, 'utf8')]));
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
await ctx.addInitScript(() => {
  window.__et = (el) => {
    if (el?.closest('svg')) return null;
    for (; el && el !== document.body; el = el.parentElement)
      if (getComputedStyle(el).display !== 'inline' && el.textContent.trim()) return el;
    return null;
  };
  window.__all = () => [...document.body.querySelectorAll('*')];
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const fresh = async (p) => {
  await page.goto(BASE + p, { waitUntil: 'load' }).catch(() => {});
  await page.evaluate(() => sessionStorage.clear());
  await page.goto(BASE + p, { waitUntil: 'load' });
  await page.waitForTimeout(250);
};
const tally = { ok: 0, refused: 0, CORRUPT: 0, mistarget: 0, notoast: 0 };
const problems = [];
for (const p of pages) {
  const orig = originals[p];
  await fresh(p);
  const targets = await page.evaluate(() => {
    const all = __all(), seen = new Map();
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode()); ) {
      if (!n.data.trim() || n.parentElement.closest('script,style,template,textarea,select,option')) continue;
      const t = __et(n.parentElement);
      if (!t || seen.has(t)) continue;
      const i = n.data.search(/\S/), r = document.createRange();
      r.setStart(n, i); r.setEnd(n, i + 1);
      if (r.getClientRects().length) seen.set(t, all.indexOf(t));
    }
    return [...seen.values()];
  });
  const line = { ok: 0, refused: 0 };
  for (const idx of targets) {
    await fresh(p);
    const pt = await page.evaluate((idx) => {
      const el = __all()[idx];
      el.scrollIntoView({ block: 'center' });
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n; (n = w.nextNode()); ) {
        if (!n.data.trim() || __et(n.parentElement) !== el) continue;
        const i = n.data.search(/\S/), r = document.createRange();
        r.setStart(n, i); r.setEnd(n, i + 1);
        const b = r.getBoundingClientRect();
        return { x: b.left + b.width / 2, y: b.top + b.height / 2, label: `<${el.localName}> ${el.textContent.trim().replace(/\s+/g, ' ').slice(0, 40)}` };
      }
    }, idx);
    if (!pt) continue;
    const rel = `${DIR}/${p}`;
    await page.keyboard.press('e');
    await page.mouse.click(pt.x, pt.y);
    const editing = await page.evaluate(() => __all().indexOf(document.querySelector('[contenteditable]')));
    if (editing !== idx) { tally.mistarget++; problems.push(`${p} ${pt.label}: clicked into #${editing} instead of #${idx}`); }
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type(' ZZ');
    await page.keyboard.press('Enter');
    let toast = '';
    for (let t = 0; t < 30 && !/Saved to|Couldn't write/.test(toast); t++) {
      await page.waitForTimeout(100);
      toast = await page.locator('htmlpen-ui').locator('#toast').textContent();
    }
    const A = await page.evaluate(() => document.body.innerHTML);
    const now = readFileSync(rel, 'utf8');
    const closes = (s) => (s.match(/<\/(body|html)/gi) ?? []).length;
    if (/Saved to/.test(toast)) {
      await fresh(p);
      const B = await page.evaluate(() => document.body.innerHTML);
      const bad = A !== B ? 'reloaded DOM differs from edited DOM' : now.split('ZZ').length !== 2 ? 'ZZ count != 1' : closes(now) !== closes(orig) ? 'lost </body>/</html>' : '';
      if (bad) { tally.CORRUPT++; problems.push(`CORRUPT ${p} ${pt.label}: ${bad}`); writeFileSync(`${tmpdir()}/htmlpen-corrupt-${p}-${idx}.html`, now); }
      else { tally.ok++; line.ok++; }
    } else if (/Couldn't write/.test(toast)) {
      if (now !== orig) { tally.CORRUPT++; problems.push(`CORRUPT ${p} ${pt.label}: refused but file changed`); }
      else { tally.refused++; line.refused++; problems.push(`refused ${p} ${pt.label}: ${toast.match(/\((.*)\)/)?.[1]}`); }
    } else { tally.notoast++; problems.push(`no-toast ${p} ${pt.label} (toast: ${toast})`); }
    writeFileSync(`${DIR}/${p}`, orig);
    rmSync(`${DIR}/${p}.comments.json`, { force: true });
    await page.waitForTimeout(150);
  }
  console.log(`${p.padEnd(18)} targets=${String(targets.length).padStart(2)} ok=${line.ok} refused=${line.refused}`);
}
console.log('\nTOTAL', JSON.stringify(tally));
console.log(problems.join('\n'));
if (errors.length) console.log('page errors:', [...new Set(errors)].join(' | '));
await browser.close();
server.kill();
rmSync(DIR, { recursive: true, force: true });
process.exit(tally.CORRUPT || tally.mistarget || tally.notoast ? 1 : 0);
