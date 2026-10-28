/**
 * E2E: click Obs Concat in the Model I/O pipeline panel to open the
 * stacking view, and check the frame/tensor breakdown it renders.
 *
 * Usage:
 *   VITE_URL=http://127.0.0.1:3000/ node scripts/verify-obs-stack-view.mjs
 */
import puppeteer from 'puppeteer-core';

const BASE = process.env.VITE_URL ?? 'http://127.0.0.1:5173/';
const CHROME = process.env.CHROME_PATH ?? '/usr/local/bin/google-chrome';
const MAX_LOAD_MS = Number(process.env.SCREENSHOT_MAX_LOAD_MS ?? 240000);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForSimulationReady(page) {
  await page.waitForFunction(
    () => {
      const dialogText = document.querySelector('.v-dialog')?.textContent ?? '';
      const loadingVisible = /Loading Simulation|正在加载仿真环境/.test(dialogText);
      const errorDialog = /Unexpected runtime error|发生意外运行时错误/.test(dialogText);
      const knockdown = document.querySelector('[data-test="knockdown-test"]');
      const policySelect = document.querySelector('.controls-card .v-select input');
      const policyReady = policySelect
        && !policySelect.closest('.v-input')?.classList?.contains?.('v-input--disabled');
      const modelToggle = document.querySelector('.model-io-toggle');
      const bodyHasError = /Unexpected runtime error|发生意外运行时错误/.test(document.body.innerText ?? '');
      return !loadingVisible && !errorDialog && !bodyHasError && policyReady
        && knockdown && !knockdown.disabled && modelToggle;
    },
    { timeout: MAX_LOAD_MS, polling: 500 }
  );
}

async function openStackView(page, nodeId) {
  await page.evaluate((id) => {
    const tab = [...document.querySelectorAll('.model-io-tabs .v-btn')]
      .find((el) => el.getAttribute('value') === 'graph');
    tab?.click();
    const node = document.querySelector(`[data-node-id="${id}"]`);
    node?.querySelector('.pipeline-node-card')?.click();
  }, nodeId);
  await sleep(600);
  return page.evaluate(() => (
    [...document.querySelectorAll('.model-io-tabs .v-btn')]
      .find((el) => el.classList.contains('v-btn--active'))
      ?.getAttribute('value')
  ));
}

async function readScopeState(page, blockName) {
  const state = await page.evaluate(() => ({
    tab: [...document.querySelectorAll('.model-io-tabs .v-btn')]
      .find((el) => el.classList.contains('v-btn--active'))
      ?.getAttribute('value'),
    channels: document.querySelectorAll('.scope-legend-item').length,
    hiddenChannels: document.querySelectorAll('.scope-legend-item-hidden').length,
    source: document.querySelector('.scope-source-name')?.textContent.trim() ?? '',
    legend: [...document.querySelectorAll('.scope-legend-label')]
      .map((el) => el.textContent.trim())
  }));
  return { ...state, block: blockName };
}

async function openStackTab(page) {
  await page.evaluate(() => {
    [...document.querySelectorAll('.model-io-tabs .v-btn')]
      .find((el) => el.getAttribute('value') === 'stack')
      ?.click();
  });
  await sleep(300);
}

/** Click the n-th probeable row of the frame-composition table. */
async function clickStackBlock(page, index) {
  const name = await page.evaluate((i) => {
    const row = document.querySelectorAll('.stack-row-clickable')[i];
    const label = row?.querySelector('.stack-name-text')?.textContent.trim();
    row?.querySelector('.stack-name-btn')?.click();
    return label;
  }, index);
  await sleep(600);
  return readScopeState(page, name);
}

/** Click the n-th module sub-row, i.e. one node inside a multi-node block. */
async function clickStackSubrow(page, index) {
  await openStackTab(page);
  const name = await page.evaluate((i) => {
    const row = document.querySelectorAll('.stack-subrow')[i];
    const label = row?.querySelector('.stack-name-text')?.textContent.trim();
    row?.querySelector('.stack-name-btn')?.click();
    return label;
  }, index);
  await sleep(600);
  return readScopeState(page, name);
}

/** Click the n-th legend row, which hides / shows that curve. */
async function toggleLegendSeries(page, index) {
  await page.evaluate((i) => {
    document.querySelectorAll('.scope-legend-toggle')[i]?.click();
  }, index);
  await sleep(400);
  return readScopeState(page, '');
}

/** Click the n-th probeable segment of the newest frame strip. */
async function clickStackSegment(page, index) {
  await openStackTab(page);
  const name = await page.evaluate((i) => {
    const strip = document.querySelector('.stack-frame:last-child .stack-strip');
    const seg = strip?.querySelectorAll('.stack-seg-clickable')[i];
    seg?.click();
    return seg?.textContent.trim() ?? `segment ${i}`;
  }, index);
  await sleep(600);
  return readScopeState(page, name);
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    protocolTimeout: MAX_LOAD_MS + 60000,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--window-size=1400,900',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--use-gl=angle',
      '--enable-unsafe-swiftshader'
    ]
  });
  const page = await browser.newPage();
  await page.setBypassCSP(true);
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('rl-sim2sim-demo-theme', 'dark');
    localStorage.setItem('rl-sim2sim-demo-language', 'zh');
  });
  await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 1 });

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await waitForSimulationReady(page);
  await sleep(5000);

  await page.click('.model-io-toggle');
  await page.waitForSelector('.model-io-panel', { visible: true, timeout: 15000 });
  await page.waitForFunction(
    () => /实时|Live/.test(document.querySelector('.model-io-panel .v-chip')?.textContent ?? ''),
    { timeout: 30000 }
  );
  await page.waitForSelector('[data-node-id="warehouse"]', { visible: true, timeout: 15000 });

  const clickable = await page.$eval('[data-node-id="warehouse"]', (el) => (
    el.classList.contains('pipeline-node-clickable')
  ));
  if (!clickable) {
    throw new Error('Obs Concat node is not marked clickable');
  }

  const activeTab = await openStackView(page, 'warehouse');
  if (activeTab !== 'stack') {
    throw new Error(`Stacking tab did not open from Obs Concat (active: ${activeTab})`);
  }
  await page.waitForSelector('.stack-shell', { visible: true, timeout: 10000 });

  const view = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.stack-row')].map((row) => ({
      name: row.querySelector('.stack-cell-name')?.textContent.trim(),
      size: Number(row.querySelector('.stack-bar-value')?.textContent.replace('D', ''))
    }));
    const strip = document.querySelector('.stack-frame:last-child .stack-strip');
    const segments = [...(strip?.querySelectorAll('.stack-seg') ?? [])];
    const inner = strip
      ? strip.clientWidth - 4 - Math.max(0, segments.length - 1) * 2
      : 0;
    const total = rows.reduce((sum, row) => sum + row.size, 0);
    return {
      frames: document.querySelectorAll('.stack-frame').length,
      rows,
      total,
      widths: segments.map((seg, i) => ({
        actual: seg.getBoundingClientRect().width / inner,
        expected: total ? rows[i].size / total : 0
      }))
    };
  });

  if (view.rows.length === 0) {
    throw new Error('Stacking view rendered no observation blocks');
  }
  if (view.frames < 1) {
    throw new Error('Stacking view rendered no frame strips');
  }
  for (const { actual, expected } of view.widths) {
    // Small blocks are floored to a visible minimum, so only check the rest.
    if (expected > 0.02 && Math.abs(actual - expected) > 0.02) {
      throw new Error(
        `Segment width ${(actual * 100).toFixed(1)}% does not match block share ${(expected * 100).toFixed(1)}%`
      );
    }
  }

  const clickableRows = await page.$$eval('.stack-row-clickable', (rows) => rows.length);
  if (clickableRows === 0) {
    throw new Error('No observation block is marked clickable in the stacking view');
  }

  const scope = await clickStackBlock(page, 0);
  if (scope.tab !== 'scope') {
    throw new Error(`Clicking an observation block did not open the scope (active: ${scope.tab})`);
  }
  if (scope.channels === 0) {
    throw new Error(`Block "${scope.block}" opened the scope with no channels`);
  }
  if (!scope.source) {
    throw new Error('The oscilloscope toolbar does not name the plotted source');
  }

  // Clicking a frame segment plots the same block from the stacking strip.
  const fromSegment = await clickStackSegment(page, 0);
  if (fromSegment.tab !== 'scope' || fromSegment.channels === 0) {
    throw new Error(
      `Clicking a frame segment did not plot the block (tab: ${fromSegment.tab}, channels: ${fromSegment.channels})`
    );
  }

  // A block split into several modules exposes each one as its own sub-row.
  await openStackTab(page);
  const subrows = await page.$$eval('.stack-subrow', (rows) => rows.length);
  let module = null;
  if (subrows > 0) {
    module = await clickStackSubrow(page, 0);
    if (module.tab !== 'scope' || module.channels === 0) {
      throw new Error(
        `Clicking a module sub-row did not plot it (tab: ${module.tab}, channels: ${module.channels})`
      );
    }
  }

  // Clicking a legend row mutes the curve instead of dropping the channel.
  const before = module ?? fromSegment;
  const muted = await toggleLegendSeries(page, 0);
  if (muted.hiddenChannels !== 1 || muted.channels !== before.channels) {
    throw new Error(
      `Legend click should hide one curve without removing it (hidden: ${muted.hiddenChannels}, channels: ${muted.channels})`
    );
  }
  const unmuted = await toggleLegendSeries(page, 0);
  if (unmuted.hiddenChannels !== 0) {
    throw new Error(`Clicking a hidden legend row again should restore the curve (hidden: ${unmuted.hiddenChannels})`);
  }

  const historyTab = await openStackView(page, 'history');
  if (historyTab && historyTab !== 'stack' && await page.$('[data-node-id="history"]')) {
    throw new Error(`History buffer node did not open the stacking tab (active: ${historyTab})`);
  }

  console.log(
    `OK: Obs Concat opened the stacking view (${view.rows.length} blocks, ${view.frames} frame(s), ${view.total}D per frame).`
  );
  console.log(
    `OK: clicking block "${scope.block}" plotted ${scope.channels} scope channel(s) from "${scope.source}": ${scope.legend.slice(0, 3).join(', ')}…`
  );
  if (module) {
    console.log(
      `OK: module sub-row "${module.block}" plotted ${module.channels} channel(s) from "${module.source}".`
    );
  }
  console.log('OK: a legend click hides the curve and keeps the channel.');
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
