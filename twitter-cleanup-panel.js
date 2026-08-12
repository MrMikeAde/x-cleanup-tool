/**
 * X / Twitter Account Cleanup — Control Panel
 * -------------------------------------------------
 * Built by Michael Adedapo
 * GitHub: https://github.com/mrmikeade
 * License: MIT — free to use, modify, and share. No warranty of any kind.
 *
 * DISCLAIMER
 *  This is an UNOFFICIAL tool. It is not affiliated with, endorsed by, or
 *  supported by X Corp. It works by simulating clicks in your own logged-in
 *  browser session on your OWN account — it does not use X's private APIs
 *  or bypass authentication. Bulk automated actions like this may run
 *  against X's automation rules and could trigger rate-limiting or a
 *  temporary account restriction. Deleting tweets is PERMANENT and cannot
 *  be undone. Use entirely at your own risk.
 *
 * WHAT IT DOES
 *  Injects a floating panel with buttons to:
 *    - Get Stats        — best-effort read of your profile's post count
 *    - Delete Tweets     — deletes tweets on your Posts tab (skips pinned)
 *    - Unlike All        — unlikes tweets on your Likes tab
 *    - Undo Reposts      — undoes reposts on your Posts tab
 *    - Stop              — halts whatever loop is currently running
 *  Includes:
 *    - A confirmation step before Delete Tweets actually starts.
 *    - Dry Run mode — scans and reports what WOULD happen, without
 *      clicking anything destructive.
 *    - Editable delay range (default random 2-4s between actions).
 *    - Auto-stop after repeated consecutive failures (likely sign of
 *      rate-limiting or X having changed its page layout).
 *
 * HOW TO USE
 *  1. Go to https://x.com/<your_handle>, open DevTools (F12) > Console.
 *  2. Paste this whole script and press Enter. A panel appears bottom-right.
 *  3. (Recommended) Tick "Dry run" first and try an action to preview it.
 *  4. Navigate to the right tab (Posts for delete/undo-repost, Likes for
 *     unlike), then click the matching button.
 *  5. Click "Stop" any time to halt the current loop.
 *
 * IF SOMETHING BREAKS
 *  X frequently changes its DOM. All element selectors used by this script
 *  live in the SELECTORS object below — if a button stops working, inspect
 *  the relevant element on the page (right-click > Inspect) and update the
 *  matching entry there first.
 *
 * RUNNING WITH THE TAB IN THE BACKGROUND
 *  Delay timing runs on a Web Worker specifically so it keeps working
 *  accurately when you switch away from the tab (browsers heavily throttle
 *  normal setTimeout on backgrounded pages, which used to stall this tool).
 *  One edge case this can't fix: if your browser's battery/memory saver
 *  fully discards an inactive tab after a long idle period, the whole page
 *  (including workers) gets suspended. If that happens on your browser,
 *  add x.com as an exception in your browser's "Memory Saver" / "Efficiency
 *  Mode" settings, or simply keep the window visible on screen (it doesn't
 *  need to be focused — just not minimized or fully covered).
 */

(function () {
  // ---------- GUARD AGAINST DOUBLE INJECTION ----------
  // If the script is pasted twice, stop any previous run and remove the old panel.
  if (window.__xCleanupPanelInstance) {
    try {
      window.__xCleanupPanelInstance.stop();
    } catch (e) {
      /* ignore */
    }
    const existing = document.getElementById("x-cleanup-panel");
    if (existing) existing.remove();
    if (window.__xCleanupTimerWorker) {
      try {
        window.__xCleanupTimerWorker.terminate();
      } catch (e) {
        /* ignore */
      }
    }
  }

  // ---------- SELECTORS (edit here first if X changes its DOM) ----------
  const SELECTORS = {
    tweetArticle: 'article[data-testid="tweet"]',
    moreMenuButton: '[data-testid="caret"]',
    menuItem: '[role="menuitem"]',
    confirmDeleteButton: '[data-testid="confirmationSheetConfirm"]',
    unlikeButton: '[data-testid="unlike"]',
    unretweetButton: '[data-testid="unretweet"]',
    socialContext: '[data-testid="socialContext"]',
    statusLink: 'a[href*="/status/"]',
  };
  const TEXT_PATTERNS = {
    deleteMenuItem: /delete/i,
    undoRepostMenuItem: /undo repost|unretweet/i,
    pinnedContext: /pinned/i,
  };

  // ---------- DEFAULTS ----------
  const DEFAULTS = {
    minDelayMs: 2000,
    maxDelayMs: 4000,
    maxEmptyScans: 6,
    scrollWaitMs: 1500,
    maxConsecutiveFailures: 5,
  };

  // ---------- STATE ----------
  const state = {
    stopFlag: false,
    running: false,
    dryRun: false,
    consecutiveFailures: 0,
    minDelayMs: DEFAULTS.minDelayMs,
    maxDelayMs: DEFAULTS.maxDelayMs,
    report: {
      scanned: 0,
      deleted: 0,
      unliked: 0,
      unreposted: 0,
      wouldDelete: 0,
      wouldUnlike: 0,
      wouldUnrepost: 0,
      pinnedSkipped: 0,
      failed: 0,
      skipped: 0,
      startedAt: null,
    },
  };

  // ---------- BACKGROUND-TAB-SAFE TIMER ----------
  // Browsers throttle setTimeout on the main thread once a tab is backgrounded
  // or minimized, which is why actions used to stall when you switched tabs.
  // Dedicated Web Workers are not subject to that same throttling, so we run
  // all delay timing there and just resolve back on the main thread when it's
  // time to act. Falls back to plain setTimeout if Workers are unavailable.
  let sleep;
  if (typeof Worker !== "undefined") {
    const workerCode = `
      self.onmessage = function (e) {
        const { id, ms } = e.data;
        setTimeout(function () { self.postMessage({ id: id }); }, ms);
      };
    `;
    const workerBlob = new Blob([workerCode], { type: "application/javascript" });
    const timerWorker = new Worker(URL.createObjectURL(workerBlob));
    const pendingTimers = new Map();
    let timerIdCounter = 0;

    timerWorker.onmessage = (e) => {
      const { id } = e.data;
      const resolve = pendingTimers.get(id);
      if (resolve) {
        pendingTimers.delete(id);
        resolve();
      }
    };

    sleep = function (ms) {
      return new Promise((resolve) => {
        const id = ++timerIdCounter;
        pendingTimers.set(id, resolve);
        timerWorker.postMessage({ id, ms });
      });
    };

    window.__xCleanupTimerWorker = timerWorker; // exposed so a re-paste can clean it up
  } else {
    sleep = function (ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    };
  }

  // ---------- HELPERS ----------
  function randomDelay() {
    const ms =
      Math.floor(Math.random() * (state.maxDelayMs - state.minDelayMs + 1)) +
      state.minDelayMs;
    return sleep(ms);
  }
  async function clickAndWait(el, waitMs = 500) {
    el.scrollIntoView({ block: "center" });
    await sleep(200);
    el.click();
    await sleep(waitMs);
  }
  async function scrollToLoadMore() {
    window.scrollBy(0, window.innerHeight * 1.5);
    await sleep(DEFAULTS.scrollWaitMs);
  }
  function getTweetArticles() {
    return Array.from(document.querySelectorAll(SELECTORS.tweetArticle));
  }
  function getStatusKey(article) {
    const link = article.querySelector(SELECTORS.statusLink);
    return link ? link.getAttribute("href") : null;
  }
  function isPinned(article) {
    const ctx = article.querySelector(SELECTORS.socialContext);
    return !!ctx && TEXT_PATTERNS.pinnedContext.test(ctx.textContent || "");
  }
  function resetReport() {
    Object.assign(state.report, {
      scanned: 0,
      deleted: 0,
      unliked: 0,
      unreposted: 0,
      wouldDelete: 0,
      wouldUnlike: 0,
      wouldUnrepost: 0,
      pinnedSkipped: 0,
      failed: 0,
      skipped: 0,
      startedAt: Date.now(),
    });
    state.consecutiveFailures = 0;
  }
  function recordSuccess() {
    state.consecutiveFailures = 0;
  }
  function recordFailure() {
    state.report.failed++;
    state.consecutiveFailures++;
    if (state.consecutiveFailures >= DEFAULTS.maxConsecutiveFailures) {
      state.stopFlag = true;
      state.autoStopped = true;
    }
  }

  // ---------- PANEL UI ----------
  const panel = document.createElement("div");
  panel.id = "x-cleanup-panel";
  panel.style.cssText = `
    position: fixed; bottom: 20px; right: 20px; width: 280px;
    background: #15181c; color: #e7e9ea; border: 1px solid #2f3336;
    border-radius: 12px; font-family: -apple-system, sans-serif;
    font-size: 13px; z-index: 999999; box-shadow: 0 4px 20px rgba(0,0,0,0.5);
    overflow: hidden;
  `;

  panel.innerHTML = `
    <div id="cleanup-header" style="background:#1d9bf0;color:#fff;padding:8px 12px;font-weight:bold;cursor:move;display:flex;justify-content:space-between;align-items:center;">
      <span>X Cleanup Tool</span>
      <span id="cleanup-minimize" style="cursor:pointer;padding:0 4px;">—</span>
    </div>
    <div id="cleanup-body" style="padding:10px;">
      <div style="background:#3d2b06;color:#ffd399;border-radius:8px;padding:6px 8px;font-size:11px;line-height:1.4;margin-bottom:10px;">
        ⚠️ Unofficial tool, not affiliated with X. Actions (especially delete) are irreversible. Use at your own risk.
      </div>

      <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
        <input type="checkbox" id="cleanup-dryrun" style="cursor:pointer;">
        <label for="cleanup-dryrun" style="cursor:pointer;">Dry run (preview only, no changes)</label>
      </div>

      <div style="display:flex;gap:6px;align-items:center;margin-bottom:10px;font-size:12px;">
        <label>Delay:</label>
        <input type="number" id="cleanup-min-delay" value="2" min="0.5" step="0.5" style="width:44px;background:#000;color:#e7e9ea;border:1px solid #2f3336;border-radius:4px;padding:2px 4px;">
        <span>–</span>
        <input type="number" id="cleanup-max-delay" value="4" min="0.5" step="0.5" style="width:44px;background:#000;color:#e7e9ea;border:1px solid #2f3336;border-radius:4px;padding:2px 4px;">
        <span>sec</span>
      </div>

      <div style="display:flex;flex-direction:column;gap:6px;">
        <button id="btn-stats" class="cleanup-btn">Get Stats</button>
        <button id="btn-delete" class="cleanup-btn">Delete Tweets</button>
        <button id="btn-unlike" class="cleanup-btn">Unlike All</button>
        <button id="btn-unrepost" class="cleanup-btn">Undo Reposts</button>
        <button id="btn-stop" class="cleanup-btn" style="background:#f4212e;">Stop</button>
      </div>

      <div id="cleanup-status" style="margin-top:10px;padding:8px;background:#000;border-radius:8px;white-space:pre-wrap;line-height:1.5;min-height:60px;">
        Ready. Navigate to the right tab, then pick an action.
      </div>

      <div style="margin-top:8px;text-align:center;font-size:11px;color:#71767b;">
        Built by Michael Adedapo · <a href="https://github.com/mrmikeade" target="_blank" style="color:#1d9bf0;text-decoration:none;">github.com/mrmikeade</a>
      </div>
    </div>

    <div id="cleanup-confirm-overlay" style="display:none;position:absolute;inset:0;background:rgba(0,0,0,0.85);padding:16px;flex-direction:column;justify-content:center;gap:10px;">
      <div id="cleanup-confirm-message" style="font-size:13px;line-height:1.5;"></div>
      <div style="display:flex;gap:8px;">
        <button id="cleanup-confirm-yes" class="cleanup-btn" style="background:#f4212e;flex:1;">Yes, continue</button>
        <button id="cleanup-confirm-no" class="cleanup-btn" style="flex:1;">Cancel</button>
      </div>
    </div>
  `;

  const style = document.createElement("style");
  style.textContent = `
    .cleanup-btn {
      background: #2f3336; color: #e7e9ea; border: none; border-radius: 8px;
      padding: 8px; cursor: pointer; font-size: 13px; font-weight: 600;
    }
    .cleanup-btn:hover { background: #3e4144; }
    .cleanup-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  `;
  document.head.appendChild(style);
  document.body.appendChild(panel);
  panel.style.position = "fixed"; // ensure overlay positions relative to panel

  const statusEl = panel.querySelector("#cleanup-status");
  const dryRunCheckbox = panel.querySelector("#cleanup-dryrun");
  const minDelayInput = panel.querySelector("#cleanup-min-delay");
  const maxDelayInput = panel.querySelector("#cleanup-max-delay");
  const confirmOverlay = panel.querySelector("#cleanup-confirm-overlay");
  const confirmMessage = panel.querySelector("#cleanup-confirm-message");
  const confirmYesBtn = panel.querySelector("#cleanup-confirm-yes");
  const confirmNoBtn = panel.querySelector("#cleanup-confirm-no");

  const buttons = {
    stats: panel.querySelector("#btn-stats"),
    delete: panel.querySelector("#btn-delete"),
    unlike: panel.querySelector("#btn-unlike"),
    unrepost: panel.querySelector("#btn-unrepost"),
    stop: panel.querySelector("#btn-stop"),
  };

  dryRunCheckbox.addEventListener("change", () => {
    state.dryRun = dryRunCheckbox.checked;
  });
  minDelayInput.addEventListener("change", () => {
    const v = parseFloat(minDelayInput.value);
    if (!isNaN(v) && v > 0) state.minDelayMs = Math.round(v * 1000);
    if (state.minDelayMs > state.maxDelayMs) {
      state.maxDelayMs = state.minDelayMs;
      maxDelayInput.value = (state.maxDelayMs / 1000).toString();
    }
  });
  maxDelayInput.addEventListener("change", () => {
    const v = parseFloat(maxDelayInput.value);
    if (!isNaN(v) && v > 0) state.maxDelayMs = Math.round(v * 1000);
    if (state.maxDelayMs < state.minDelayMs) {
      state.minDelayMs = state.maxDelayMs;
      minDelayInput.value = (state.minDelayMs / 1000).toString();
    }
  });

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function reportLine(label) {
    const r = state.report;
    const elapsed = r.startedAt
      ? ((Date.now() - r.startedAt) / 1000).toFixed(1) + "s"
      : "0s";
    const prefix = state.dryRun ? `${label} (DRY RUN)` : label;
    const autoStopNote = state.autoStopped
      ? "\n⚠️ Auto-stopped after repeated failures (possible rate limit or layout change)."
      : "";
    if (state.dryRun) {
      return (
        `${prefix}\nelapsed: ${elapsed}\n` +
        `scanned: ${r.scanned}  failed: ${r.failed}  skipped: ${r.skipped}  pinned skipped: ${r.pinnedSkipped}\n` +
        `would delete: ${r.wouldDelete}  would unlike: ${r.wouldUnlike}  would undo repost: ${r.wouldUnrepost}` +
        autoStopNote
      );
    }
    return (
      `${prefix}\nelapsed: ${elapsed}\n` +
      `scanned: ${r.scanned}  failed: ${r.failed}  skipped: ${r.skipped}  pinned skipped: ${r.pinnedSkipped}\n` +
      `deleted: ${r.deleted}  unliked: ${r.unliked}  unreposted: ${r.unreposted}` +
      autoStopNote
    );
  }

  function setRunningState(isRunning) {
    state.running = isRunning;
    buttons.delete.disabled = isRunning;
    buttons.unlike.disabled = isRunning;
    buttons.unrepost.disabled = isRunning;
    buttons.stats.disabled = isRunning;
  }

  function showConfirm(message) {
    return new Promise((resolve) => {
      confirmMessage.textContent = message;
      confirmOverlay.style.display = "flex";
      const cleanup = (result) => {
        confirmOverlay.style.display = "none";
        confirmYesBtn.removeEventListener("click", onYes);
        confirmNoBtn.removeEventListener("click", onNo);
        resolve(result);
      };
      const onYes = () => cleanup(true);
      const onNo = () => cleanup(false);
      confirmYesBtn.addEventListener("click", onYes);
      confirmNoBtn.addEventListener("click", onNo);
    });
  }

  // Draggable header
  (function makeDraggable() {
    const header = panel.querySelector("#cleanup-header");
    let isDown = false,
      offsetX = 0,
      offsetY = 0;
    header.addEventListener("mousedown", (e) => {
      isDown = true;
      const rect = panel.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
    });
    document.addEventListener("mousemove", (e) => {
      if (!isDown) return;
      panel.style.left = e.clientX - offsetX + "px";
      panel.style.top = e.clientY - offsetY + "px";
      panel.style.right = "auto";
      panel.style.bottom = "auto";
      panel.style.position = "fixed";
    });
    document.addEventListener("mouseup", () => (isDown = false));
  })();

  // Minimize toggle
  const bodyEl = panel.querySelector("#cleanup-body");
  panel.querySelector("#cleanup-minimize").addEventListener("click", () => {
    bodyEl.style.display = bodyEl.style.display === "none" ? "block" : "none";
  });

  // ---------- ACTIONS ----------
  buttons.stats.addEventListener("click", () => {
    const bodyText = document.body.innerText;
    const match = bodyText.match(/([\d,]+)\s+(Posts|Tweets)\b/i);
    const postCount = match ? match[1] : "unknown (not visible on this page)";
    setStatus(
      `Reported post count: ${postCount}\n(Scraped from screen — make sure you're on your profile page.)`
    );
  });

  buttons.stop.addEventListener("click", () => {
    state.stopFlag = true;
    setStatus("Stopping after current step...");
  });

  buttons.delete.addEventListener("click", async () => {
    if (!state.dryRun) {
      const proceed = await showConfirm(
        "This will permanently delete tweets from your Posts tab, one at a time, starting now. This cannot be undone. Continue?"
      );
      if (!proceed) {
        setStatus("Delete cancelled. No changes made.");
        return;
      }
    }

    state.stopFlag = false;
    state.autoStopped = false;
    resetReport();
    setRunningState(true);
    setStatus(
      `Starting: Delete Tweets${state.dryRun ? " (dry run)" : ""}\nMake sure you're on your Posts tab.`
    );
    let emptyScans = 0;
    const dryRunProcessed = new Set();

    while (!state.stopFlag && emptyScans < DEFAULTS.maxEmptyScans) {
      const articles = getTweetArticles();
      const candidate = articles.find((a) => {
        const key = getStatusKey(a);
        if (state.dryRun && key && dryRunProcessed.has(key)) return false;
        return true;
      });

      if (!candidate) {
        emptyScans++;
        await scrollToLoadMore();
        continue;
      }
      emptyScans = 0;

      if (isPinned(candidate)) {
        state.report.pinnedSkipped++;
        const key = getStatusKey(candidate);
        if (state.dryRun && key) dryRunProcessed.add(key);
        else candidate.style.opacity = "0.3"; // visually deprioritize; will scroll past
        setStatus(reportLine("Delete Tweets"));
        if (!state.dryRun) await scrollToLoadMore();
        continue;
      }

      state.report.scanned++;

      if (state.dryRun) {
        const key = getStatusKey(candidate);
        if (key) dryRunProcessed.add(key);
        state.report.wouldDelete++;
        recordSuccess();
        setStatus(reportLine("Delete Tweets"));
        await randomDelay();
        continue;
      }

      try {
        const moreBtn = candidate.querySelector(SELECTORS.moreMenuButton);
        if (!moreBtn) {
          state.report.skipped++;
          candidate.style.opacity = "0.3";
          await scrollToLoadMore();
          setStatus(reportLine("Delete Tweets"));
          continue;
        }
        await clickAndWait(moreBtn, 400);

        const menuItems = Array.from(document.querySelectorAll(SELECTORS.menuItem));
        const deleteItem = menuItems.find((el) =>
          TEXT_PATTERNS.deleteMenuItem.test(el.textContent || "")
        );

        if (!deleteItem) {
          state.report.skipped++;
          document.body.click();
          setStatus(reportLine("Delete Tweets"));
          await randomDelay();
          continue;
        }

        await clickAndWait(deleteItem, 500);
        const confirmBtn = document.querySelector(SELECTORS.confirmDeleteButton);
        if (confirmBtn) {
          await clickAndWait(confirmBtn, 500);
          state.report.deleted++;
          recordSuccess();
        } else {
          recordFailure();
        }
      } catch (err) {
        console.error("Error deleting tweet:", err);
        recordFailure();
      }

      setStatus(reportLine("Delete Tweets"));
      await randomDelay();
    }

    setRunningState(false);
    setStatus(reportLine(state.stopFlag ? "Stopped: Delete Tweets" : "Finished: Delete Tweets"));
  });

  buttons.unlike.addEventListener("click", async () => {
    state.stopFlag = false;
    state.autoStopped = false;
    resetReport();
    setRunningState(true);
    setStatus(
      `Starting: Unlike All${state.dryRun ? " (dry run)" : ""}\nMake sure you're on your Likes tab.`
    );
    let emptyScans = 0;
    const dryRunProcessed = new Set();

    while (!state.stopFlag && emptyScans < DEFAULTS.maxEmptyScans) {
      let target = null;
      let targetKey = null;

      if (state.dryRun) {
        const articles = getTweetArticles();
        for (const a of articles) {
          const key = getStatusKey(a);
          if (key && !dryRunProcessed.has(key) && a.querySelector(SELECTORS.unlikeButton)) {
            target = a;
            targetKey = key;
            break;
          }
        }
      } else {
        target = document.querySelector(SELECTORS.unlikeButton);
      }

      if (!target) {
        emptyScans++;
        await scrollToLoadMore();
        continue;
      }
      emptyScans = 0;
      state.report.scanned++;

      if (state.dryRun) {
        if (targetKey) dryRunProcessed.add(targetKey);
        state.report.wouldUnlike++;
        recordSuccess();
        setStatus(reportLine("Unlike All"));
        await randomDelay();
        continue;
      }

      try {
        await clickAndWait(target, 400);
        state.report.unliked++;
        recordSuccess();
      } catch (err) {
        console.error("Error unliking tweet:", err);
        recordFailure();
      }

      setStatus(reportLine("Unlike All"));
      await randomDelay();
    }

    setRunningState(false);
    setStatus(reportLine(state.stopFlag ? "Stopped: Unlike All" : "Finished: Unlike All"));
  });

  buttons.unrepost.addEventListener("click", async () => {
    state.stopFlag = false;
    state.autoStopped = false;
    resetReport();
    setRunningState(true);
    setStatus(
      `Starting: Undo Reposts${state.dryRun ? " (dry run)" : ""}\nMake sure you're on your Posts tab.`
    );
    let emptyScans = 0;
    const dryRunProcessed = new Set();

    while (!state.stopFlag && emptyScans < DEFAULTS.maxEmptyScans) {
      let target = null;
      let targetKey = null;

      if (state.dryRun) {
        const articles = getTweetArticles();
        for (const a of articles) {
          const key = getStatusKey(a);
          if (key && !dryRunProcessed.has(key) && a.querySelector(SELECTORS.unretweetButton)) {
            target = a;
            targetKey = key;
            break;
          }
        }
      } else {
        target = document.querySelector(SELECTORS.unretweetButton);
      }

      if (!target) {
        emptyScans++;
        await scrollToLoadMore();
        continue;
      }
      emptyScans = 0;
      state.report.scanned++;

      if (state.dryRun) {
        if (targetKey) dryRunProcessed.add(targetKey);
        state.report.wouldUnrepost++;
        recordSuccess();
        setStatus(reportLine("Undo Reposts"));
        await randomDelay();
        continue;
      }

      try {
        const unretweetBtn = target.querySelector
          ? target.querySelector(SELECTORS.unretweetButton) || target
          : target;
        await clickAndWait(unretweetBtn, 400);
        const menuItems = Array.from(document.querySelectorAll(SELECTORS.menuItem));
        const undoItem = menuItems.find((el) =>
          TEXT_PATTERNS.undoRepostMenuItem.test(el.textContent || "")
        );
        if (undoItem) {
          await clickAndWait(undoItem, 400);
          state.report.unreposted++;
          recordSuccess();
        } else {
          recordFailure();
        }
      } catch (err) {
        console.error("Error undoing repost:", err);
        recordFailure();
      }

      setStatus(reportLine("Undo Reposts"));
      await randomDelay();
    }

    setRunningState(false);
    setStatus(reportLine(state.stopFlag ? "Stopped: Undo Reposts" : "Finished: Undo Reposts"));
  });

  // Expose a minimal control API so a re-pasted script can stop this instance.
  window.__xCleanupPanelInstance = {
    stop: () => {
      state.stopFlag = true;
    },
  };

  console.log(
    "%cX Cleanup Tool loaded — by Michael Adedapo (github.com/mrmikeade). Panel is bottom-right.",
    "color:#1d9bf0;font-weight:bold;"
  );
})();
