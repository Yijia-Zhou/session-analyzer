'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');

const defaultOutputRoot = path.join(__dirname, '..', 'output', 'playwright', 'browser-failures');

function installNavigationRecorder() {
  const events = [];
  let focusedAction = null;
  const describe = (node) => node?.nodeType === 1 ? {
    tag: node.tagName, id: node.id, eventId: node.closest('[data-event-id]')?.dataset.eventId,
    sessionId: node.dataset.openCollaborationSession,
    action: node.dataset.collaborationAction,
    readingBack: node.hasAttribute('data-reading-back'),
    connected: node.isConnected,
    rect: node.getBoundingClientRect().toJSON(),
  } : null;
  const snapshot = () => ({
    active: describe(document.activeElement),
    selectedSessionId: document.querySelector('.sessionItem.active')?.dataset.sessionId,
    presentation: document.body?.dataset.mainPresentation,
    mobileView: document.body?.dataset.mobileView,
    documentScroll: { x: window.scrollX, y: window.scrollY },
    timelineScrollTop: document.querySelector('.timelinePane')?.scrollTop,
    detailScrollTop: document.querySelector('.detailPane')?.scrollTop,
    documentHeight: document.documentElement.scrollHeight,
    stateLine: document.querySelector('#stateLine')?.textContent.slice(0, 500),
    timelineAction: describe(document.querySelector('#timeline [data-open-collaboration-session]')),
    inspectorAction: describe(document.querySelector('#detail [data-open-collaboration-session]')),
  });
  const record = (type, extra = {}) => {
    events.push({ time: performance.now(), epochTime: Date.now(), type, ...snapshot(), ...extra });
    if (events.length > 200) events.shift();
  };
  window.__navigationDiagnostics = { snapshot, events, record };
  for (const type of ['focusin', 'focusout', 'keydown', 'keyup', 'click']) {
    document.addEventListener(type, (event) => {
      if (type === 'focusin') focusedAction = event.target.closest?.('[data-open-collaboration-session]') || null;
      record(type, { key: event.key, target: describe(event.target) });
    }, true);
  }
  document.addEventListener('scroll', (event) => record('scroll', { target: describe(event.target) }), true);
  document.addEventListener('DOMContentLoaded', () => {
    new MutationObserver((changes) => {
      for (const change of changes) for (const node of change.removedNodes) {
        if (node.nodeType !== 1) continue;
        const removedFocusedAction = Boolean(focusedAction && (node === focusedAction || node.contains(focusedAction)));
        if (removedFocusedAction || node.matches('[data-open-collaboration-session]')
            || node.querySelector('[data-open-collaboration-session]')) {
          record('action-subtree-removed', { removed: describe(node), removedFocusedAction });
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  }, { once: true });
}

// Capture before node:test runs openApp's context cleanup. Preserve the original
// error even if the page or browser has already closed during a failing action.
function withNavigationDiagnostics(run, { outputRoot = defaultOutputRoot } = {}) {
  return async (t) => {
    let page;
    let tracing = false;
    const checkpoints = [];
    const requests = [];
    const diagnostics = {
      async attach(target) {
        page = target;
        await page.context().tracing.start({ screenshots: true, snapshots: true, sources: false });
        tracing = true;
        await page.addInitScript(installNavigationRecorder);
        const recordRequest = (type, request, extra = {}) => {
          const url = new URL(request.url());
          if (!url.pathname.startsWith('/api/')) return;
          requests.push({ time: Date.now(), type, method: request.method(), path: url.pathname + url.search, ...extra });
          if (requests.length > 100) requests.shift();
        };
        page.on('request', (request) => recordRequest('request', request));
        page.on('requestfinished', (request) => recordRequest('finished', request));
        page.on('requestfailed', (request) => recordRequest('failed', request, { error: request.failure()?.errorText }));
      },
      async checkpoint(label, expected = {}) {
        const snapshot = await page.evaluate((label) => {
          window.__navigationDiagnostics.record('checkpoint', { label });
          return window.__navigationDiagnostics.snapshot();
        }, label);
        checkpoints.push({ label, expected, snapshot });
        if (checkpoints.length > 20) checkpoints.shift();
      },
    };
    try {
      return await run(t, diagnostics);
    } catch (error) {
      if (page) {
        const directory = path.join(outputRoot, `${t.name.replace(/[^a-z0-9-]+/gi, '-').slice(0, 100)}-${process.pid}`);
        const captureErrors = [];
        const attempt = async (label, action) => {
          let timer;
          try {
            return await Promise.race([
              Promise.resolve().then(action),
              new Promise((_resolve, reject) => {
                timer = setTimeout(() => reject(new Error(`Capture ${label} exceeded 6000ms`)), 6000);
              }),
            ]);
          }
          catch (captureError) { captureErrors.push({ label, error: captureError.message }); return null; }
          finally { clearTimeout(timer); }
        };
        await attempt('directory', () => fsp.mkdir(directory, { recursive: true }));
        const state = await attempt('state', () => page.evaluate(() => ({
          snapshot: window.__navigationDiagnostics?.snapshot(),
          events: window.__navigationDiagnostics?.events,
        })));
        await attempt('screenshot', () => page.screenshot({ path: path.join(directory, 'screenshot.png'), timeout: 5000 }));
        if (tracing) {
          tracing = false;
          await attempt('trace', () => page.context().tracing.stop({ path: path.join(directory, 'trace.zip') }));
        }
        await attempt('json', () => fsp.writeFile(path.join(directory, 'diagnostics.json'), JSON.stringify({
          test: t.name, error: { name: error.name, message: error.message, stack: error.stack },
          checkpoints, requests, state, captureErrors,
        }, null, 2), 'utf8'));
        t.diagnostic(`Navigation failure artifacts: ${directory}`);
        t.diagnostic(JSON.stringify({ checkpoints, snapshot: state?.snapshot, recentEvents: state?.events?.slice(-12), captureErrors }));
      }
      throw error;
    } finally {
      if (tracing) {
        await page.context().tracing.stop().catch((error) => t.diagnostic(`Navigation trace cleanup: ${error.message}`));
      }
    }
  };
}

module.exports = { withNavigationDiagnostics };
