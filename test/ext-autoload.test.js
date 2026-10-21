// Extension AUTO-LOAD across tabs — behavior tests (run the REAL background.js logic). Node.
//   node test/ext-autoload.test.js
//
// Feature: opening a Data Cloud page in a NEW tab (e.g. via the ⧉ open-in-new-tab) should show
// the tool automatically when the user's auto-load preference is ON (default), with no re-click;
// turning it OFF (toolbar click on an active tab) keeps it off across tabs/reloads until re-on.
//
// The correctness-critical bits (and the footguns this locks):
//   • toolbar click toggles THIS tab AND sets the global preference to the RESULT, so new tabs
//     follow the user's explicit choice.
//   • auto-inject must NOT re-inject a tab that already has the tool — inject.js self-guards
//     (2nd run on same url = toggle OFF), so a double auto-inject would turn it off.
//   • when the preference is OFF, a new tab must NOT get the tool.
//   • a tab reload clears the per-tab injected state (fresh page = not injected).
//
// We extract the REAL listeners/functions from chrome-extension/background.js and run them under
// a fake `chrome` API, asserting what actually gets injected. Behavior, not source-presence.

let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); } }
function eq(name, got, want) { ok(name, got === want, "got " + JSON.stringify(got) + " want " + JSON.stringify(want)); }

const fs = require("fs"), path = require("path"), vm = require("vm");
const bg = fs.readFileSync(path.join(__dirname, "..", "chrome-extension", "background.js"), "utf8");

// ── Fake chrome/browser API + a sandbox that records injects ──────────────────────────
function makeEnv(initialPref) {
  var store = {};
  if (initialPref !== undefined) store["dc_autoload_enabled"] = initialPref;
  var injects = [];                      // tab ids injected with inject.js, in order
  var clickCb = null, msgCb = null, removedCb = null, updatedCb = null;
  var api = {
    storage: { local: {
      get: function (keys, cb) { var out = {}; (Array.isArray(keys) ? keys : [keys]).forEach(function (k) { if (k in store) out[k] = store[k]; }); cb(out); },
      set: function (obj, cb) { for (var k in obj) store[k] = obj[k]; if (cb) cb(); }
    } },
    scripting: { executeScript: function (opts) { injects.push(opts.target.tabId); return Promise.resolve([]); } },
    action: { onClicked: { addListener: function (cb) { clickCb = cb; } } },
    runtime: { id: "self", lastError: null, onMessage: { addListener: function (cb) { msgCb = cb; } } },
    tabs: {
      onRemoved: { addListener: function (cb) { removedCb = cb; } },
      onUpdated: { addListener: function (cb) { updatedCb = cb; } }
    }
  };
  // stub out everything background.js references that we don't exercise (fetch etc.)
  var sandbox = { chrome: api, browser: undefined, console: { log: function () {}, warn: function () {}, error: function () {} },
    fetch: function () { return Promise.resolve({ status: 200, text: function () { return Promise.resolve("{}"); } }); },
    URL: URL, Promise: Promise, setTimeout: setTimeout };
  vm.runInNewContext(bg, sandbox);
  return {
    click: function (tabId) { return clickCb && clickCb({ id: tabId }); },
    msg: function (m, sender) { return msgCb && msgCb(m, sender, function () {}); },
    reload: function (tabId) { updatedCb && updatedCb(tabId, { status: "loading" }); },
    close: function (tabId) { removedCb && removedCb(tabId); },
    injects: injects,
    pref: function () { return store["dc_autoload_enabled"]; }
  };
}
function tick() { return new Promise(function (r) { setTimeout(r, 5); }); }

(async function () {
  console.log("\n1. default preference is ON (auto-load a new tab when unset)");
  {
    var e = makeEnv(undefined);
    e.msg({ type: "dcAutoInject" }, { id: "self", tab: { id: 10 }, url: "https://x.lightning.force.com/lightning/o/DataStream/home" });
    await tick();
    eq("fresh tab with no stored pref → tool injected", e.injects.filter(function (t) { return t === 10; }).length, 1);
  }

  console.log("\n2. preference OFF → a new tab does NOT get the tool");
  {
    var e = makeEnv(false);
    e.msg({ type: "dcAutoInject" }, { id: "self", tab: { id: 11 }, url: "https://x.lightning.force.com/lightning/o/Segment/home" });
    await tick();
    eq("pref OFF → no inject on a new tab", e.injects.indexOf(11), -1);
  }

  console.log("\n3. auto-inject does NOT double-inject the same tab (would toggle OFF)");
  {
    var e = makeEnv(true);
    e.msg({ type: "dcAutoInject" }, { id: "self", tab: { id: 12 }, url: "u" }); await tick();
    e.msg({ type: "dcAutoInject" }, { id: "self", tab: { id: 12 }, url: "u" }); await tick();   // 2nd ping same tab
    eq("only ONE inject for a tab that pinged twice", e.injects.filter(function (t) { return t === 12; }).length, 1);
  }

  console.log("\n4. toolbar click toggles the tab AND syncs the global preference");
  {
    var e = makeEnv(true);
    // tab 20 was auto-injected (pref ON)
    e.msg({ type: "dcAutoInject" }, { id: "self", tab: { id: 20 }, url: "u" }); await tick();
    eq("auto-injected once", e.injects.filter(function (t) { return t === 20; }).length, 1);
    // user clicks the toolbar on this active tab → should toggle OFF + pref now false
    await e.click(20); await tick();
    eq("click re-injects (self-guard toggles OFF)", e.injects.filter(function (t) { return t === 20; }).length, 2);
    eq("global preference now OFF (follows the click)", e.pref(), false);
    // a DIFFERENT new tab now must NOT auto-load (pref off)
    e.msg({ type: "dcAutoInject" }, { id: "self", tab: { id: 21 }, url: "v" }); await tick();
    eq("new tab after turning off → not injected", e.injects.indexOf(21), -1);
  }

  console.log("\n5. click on a fresh (never-injected) tab turns it ON + pref ON");
  {
    var e = makeEnv(false);                       // globally off
    await e.click(30); await tick();              // user explicitly clicks to turn on here
    eq("click injects the tool", e.injects.filter(function (t) { return t === 30; }).length, 1);
    eq("global preference now ON", e.pref(), true);
    e.msg({ type: "dcAutoInject" }, { id: "self", tab: { id: 31 }, url: "w" }); await tick();
    eq("subsequent new tab now auto-loads", e.injects.filter(function (t) { return t === 31; }).length, 1);
  }

  console.log("\n6. a tab RELOAD clears its injected state (fresh page = not injected)");
  {
    var e = makeEnv(true);
    e.msg({ type: "dcAutoInject" }, { id: "self", tab: { id: 40 }, url: "u" }); await tick();   // injected
    e.reload(40);                                                                   // user reloads tab 40
    e.msg({ type: "dcAutoInject" }, { id: "self", tab: { id: 40 }, url: "u" }); await tick();   // fresh page pings again
    eq("reloaded tab is injected again (state cleared, not treated as already-on)", e.injects.filter(function (t) { return t === 40; }).length, 2);
  }

  console.log("\n7. security: dcAutoInject with no sender tab id does nothing");
  {
    var e = makeEnv(true);
    e.msg({ type: "dcAutoInject" }, { id: "self", tab: null });        // valid sender, but no tab
    e.msg({ type: "dcAutoInject" }, { id: "self" });                   // valid sender, no tab at all
    await tick();
    eq("valid sender but no tab id → no inject", e.injects.length, 0);
  }

  console.log("\n8. source presence — bridge pings, manifest has storage, public build untouched");
  {
    var bridge = fs.readFileSync(path.join(__dirname, "..", "chrome-extension", "bridge.js"), "utf8");
    ok("bridge.js pings dcAutoInject after load", /type: "dcAutoInject"/.test(bridge) && /addEventListener\("load", ping/.test(bridge));
    var mf = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "chrome-extension", "manifest.json"), "utf8"));
    ok("dev manifest has storage permission", (mf.permissions || []).indexOf("storage") >= 0);
    // public build stays click-only: build.js deletes content_scripts for the public manifest.
    var build = fs.readFileSync(path.join(__dirname, "..", "build.js"), "utf8");
    ok("PUBLIC build stays click-only (content_scripts dropped) — autoload is dev-only for now", /delete pubChromeManifest\.content_scripts;/.test(build));
  }

  console.log("\n" + (fail === 0 ? "✅ ALL PASS" : "❌ FAILURES") + ": " + pass + " passed, " + fail + " failed\n");
  process.exit(fail === 0 ? 0 : 1);
})();
