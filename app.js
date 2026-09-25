// ============================================================================
// SAGE — app.js  (the shell)
// ----------------------------------------------------------------------------
// Beat 1: frame — mode toggle, data layer.
// Beat 2/3: Capture (unified modal) + Desktop read.
// Beat 4: the swap. If supabase-config.js has real creds, SAGE runs on the
//   Supabase backend (with a sign-in gate) and data persists across reloads.
//   If not, it runs on the in-memory backend and opens straight from a file.
//   The choice is config-driven; data.js is never touched.
// ============================================================================

(function () {
  "use strict";

  if (typeof window.createSAGE !== "function") {
    var fault = byId("fault");
    if (fault) fault.setAttribute("data-shown", "");
    setChip('<span class="dot"></span>no data layer', true);
    return;
  }

  // ── elements ────────────────────────────────────────────────────────────────
  var el = {
    modeSwitch: byId("mode-switch"), modeSwitchLbl: byId("mode-switch-lbl"),
    surfaceField: byId("surface-field"), surfaceDesktop: byId("surface-desktop"),
    open: byId("open-capture"), seed: byId("seed-btn"), launchMeta: byId("launch-meta"),
    modal: byId("capture-modal"), close: byId("close-capture"), done: byId("done-capture"),
    logBtn: byId("log-btn"), subjects: byId("subjects"), sections: byId("obs-sections"),
    flag: byId("flag-input"), confirm: byId("confirm"), willLog: byId("will-log"),
    signout: byId("signout"),
    login: byId("login-modal"), loginEmail: byId("login-email"), loginPass: byId("login-pass"),
    loginBtn: byId("login-btn"), loginErr: byId("login-error"),

    // Field subnav (Briefing / Place / Capture)
    subBriefing: byId("sub-briefing"), subPlace: byId("sub-place"), subCapture: byId("sub-capture"),
    panelBriefing: byId("panel-briefing"), panelPlace: byId("panel-place"), panelCapture: byId("panel-capture"),

    // Place (the field map)
    placeStage: byId("place-stage"), placeEmpty: byId("place-empty"), placeMap: byId("place-map"),
    placeImportBtn: byId("place-import-btn"), placeImportFile: byId("place-import-file"),
    placeImportZonesBtn: byId("place-import-zones-btn"), placeImportZonesFile: byId("place-import-zones-file"),
    placeImportStatus: byId("place-import-status"),
    placeCompass: byId("place-compass"),
    placeZin: byId("place-zin"), placeZout: byId("place-zout"), placeReadout: byId("place-readout"),

    // Map data tools: gear icon + dropdown holding the (relocated, 2026-07-17c) import controls
    gearBtn: byId("place-gear-btn"), gearMenu: byId("place-gearmenu"), gearDot: byId("place-gear-dot"),
    importConfirm: byId("place-import-confirm"), importConfirmMsg: byId("place-import-confirm-msg"),
    importConfirmYes: byId("place-import-confirm-yes"), importConfirmNo: byId("place-import-confirm-no"),
    importZonesNote: byId("place-import-zones-note"), exportBtn: byId("place-export-btn"),

    // Add plant modal
    addModal: byId("add-modal"), closeAdd: byId("close-add"), cancelAdd: byId("cancel-add"),
    saveAdd: byId("save-add"), addZoneName: byId("add-zone-name"),
    addLabel: byId("add-label"), addOrigin: byId("add-origin"),

    // Log Mode (Beat 3): toolbar toggle, zone pill, 4 directional arrows
    logModeBtn: byId("place-logmode-btn"), logModeLbl: byId("place-logmode-lbl"),
    zonePill: byId("place-zonepill"), zonePillName: byId("place-zonepill-name"),
    zonePillClose: byId("place-zonepill-close"),

    // Pin drag-to-reposition: toolbar toggle (mutually exclusive with Log
    // Mode) + the pending-move confirm/cancel pill
    reposBtn: byId("place-repos-btn"), reposLbl: byId("place-repos-lbl"),
    movePill: byId("place-movepill"),
    moveConfirm: byId("place-move-confirm"), moveCancel: byId("place-move-cancel"),
    moveName: byId("place-move-name"), moveZone: byId("place-move-zone"), moveWarn: byId("place-move-warn"),
    zoneArrows: {
      up: byId("place-zone-up"), down: byId("place-zone-down"),
      left: byId("place-zone-left"), right: byId("place-zone-right"),
    },

    // Zone modal (Log Mode: action + condition)
    zoneModal: byId("zone-modal"), closeZone: byId("close-zone"), cancelZone: byId("cancel-zone"),
    saveZone: byId("save-zone"), zoneTitle: byId("zone-title"), zoneConfirm: byId("zone-confirm"),
    zoneAction: byId("zone-action"), zoneCondCategory: byId("zone-cond-category"),
    zoneCondSubject: byId("zone-cond-subject"), zoneCondAbundance: byId("zone-cond-abundance"),
    zoneCondNote: byId("zone-cond-note"),
  };

  var SECTIONS = [
    { kind: "bloom",  label: "Bloom",  input: "stage",  stages: ["budding", "first open", "peak", "fading", "spent"] },
    { kind: "size",   label: "Size",   input: "size",   units:  ["in", "cm", "ft"] },
    { kind: "status", label: "Status", input: "stage",  stages: ["emerging", "establishing", "established", "thriving", "struggling", "failed"] },
    { kind: "pest",   label: "Pest",   input: "text",   placeholder: "e.g. aphids, leaf spot, nibbling" },
    { kind: "note",   label: "Note",   input: "note",   placeholder: "Anything worth remembering…" },
  ];

  var state = {
    mode: "memory", names: { taxa: {}, zones: {} },
    subjectId: null, stage: {}, plantCount: 0, sessionCount: 0,
  };
  var sage = null;

  // Place: the field map. Geometry loads lazily the first time the Place tab
  // is opened (or immediately if it's already open when boot finishes).
  var place = {
    loading: false, snapshot: null, view: null,
    regionEls: {}, pointers: new Map(), panning: false, moved: 0,
    downXY: null, downTarget: null, downFeet: null, pinchDist: 0,
    pins: {}, selectedIndividualId: null, pendingZoneId: null, zoneLabelEls: {},
    // Log Mode (Beat 3): off by default; zoneZoomId tracks the "zoomed into
    // a zone" sub-state so the pill/arrows/highlight know what to show.
    // Exiting a zone deliberately does NOT restore a prior view — mid-log
    // you may want to stay right where you are and tap a nearby plant.
    logMode: false, zoneZoomId: null,
    // Pin drag-to-reposition: off by default, mutually exclusive with Log
    // Mode. dragCandidateId is set on pointerdown over a pin while reposMode
    // is on; dragging flips true once the move threshold is crossed (so a
    // plain tap on a pin opens its move pill instead). pendingMove
    // holds the dropped-but-unconfirmed position until the move pill's
    // confirm/cancel is tapped.
    reposMode: false, dragCandidateId: null, dragging: false, dragOrig: null,
    pendingMove: null,
    // pinched: set once a gesture has had two fingers down, so lifting the
    // last finger after a pinch-zoom never counts as a tap (2026-09-25 fix:
    // it used to open the add-plant modal). pinZone: each pin's zone_id, as
    // loaded — the reposition pill defaults to it.
    pinched: false, pinZone: {},
  };

  main().catch(function (err) {
    setChip('<span class="dot"></span>startup error', true);
    if (el.launchMeta) el.launchMeta.textContent = String(err && err.message || err);
  });

  // ── boot ────────────────────────────────────────────────────────────────────
  async function main() {
    wireModeToggle();
    wireCapture();
    wireSubnav();
    wirePlace();

    var cfg = window.SAGE_CONFIG || {};
    var configured = !!(cfg.url && cfg.anonKey &&
      cfg.url.indexOf("YOUR_") < 0 && cfg.anonKey.indexOf("YOUR_") < 0);

    if (!configured) return bootMemory();
    return bootCloud(cfg);
  }

  async function bootMemory() {
    state.mode = "memory";
    sage = window.createSAGE();
    window.sage = sage;
    setChip('<span class="dot"></span>memory backend · in-session only');
    await seedSample();            // auto-seed so pure-UI work has subjects
    await afterBoot();
  }

  async function bootCloud(cfg) {
    state.mode = "cloud";
    setChip('<span class="dot"></span>supabase · connecting…');
    var mod;
    try { mod = await import("./supabase.js"); }
    catch (e) { return setChip('<span class="dot"></span>couldn’t load supabase.js', true); }

    var client;
    try { client = await mod.makeClient(cfg.url, cfg.anonKey); }
    catch (e) { return setChip('<span class="dot"></span>couldn’t reach Supabase', true); }
    window.__sageClient = client;

    var session = (await client.auth.getSession()).data.session;
    if (!session) return showLogin(client, mod);
    return afterAuth(client, mod, session.user);
  }

  async function afterAuth(client, mod, user) {
    hideLogin();
    sage = window.createSAGE(mod.SupabaseBackend(client));
    window.sage = sage;
    setChip('<span class="dot"></span>supabase · ' + (user.email || "signed in"));
    el.signout.hidden = false;
    el.signout.onclick = async function () { await client.auth.signOut(); location.reload(); };
    await afterBoot();             // NB: no auto-seed against the real database
  }

  async function afterBoot() {
    await loadNames();
    var inds = await sage.listIndividuals();
    state.plantCount = inds.length;
    refreshLauncher();
    ensurePlaceLoaded();
  }

  // Display names come from the DB (not the seed), so pre-existing cloud data
  // shows real species/zone labels too.
  async function loadNames() {
    var zones = await sage.query({ entity: "zones" });
    var taxa  = await sage.query({ entity: "taxa" });
    state.names.zones = {}; zones.forEach(function (z) { state.names.zones[z.id] = z.name; });
    state.names.taxa  = {}; taxa.forEach(function (t) { state.names.taxa[t.id] = t.common_name; });
  }

  // Sample subjects for testing before Place exists. Auto-run in memory mode;
  // in cloud mode only via the Seed button (so we never litter the real DB).
  async function seedSample() {
    var neBed   = await sage.addZone({ name: "NE Bed", kind: "perennial" });
    var hilltop = await sage.addZone({ name: "Hilltop Garden", kind: "mixed" });
    var phlox = await sage.addTaxon({ commonName: "Garden Phlox", botanicalName: "Phlox paniculata", bloomMonths: [7, 8] });
    var hosta = await sage.addTaxon({ commonName: "Hosta", botanicalName: "Hosta 'Frances Williams'" });
    await sage.place({ zoneId: neBed.id,   taxonId: phlox.id, label: "front-corner phlox", origin: "purchased", plantedOn: "2026-06-14" });
    await sage.place({ zoneId: hilltop.id, taxonId: hosta.id, label: "shade hosta",        origin: "purchased", plantedOn: "2025-05-20" });
    await sage.place({ zoneId: neBed.id,   label: "spring surprise", origin: "volunteer" });
    await loadNames();
  }

  function refreshLauncher() {
    var none = state.plantCount === 0;
    el.open.disabled = none;
    el.open.style.opacity = none ? ".45" : "1";
    el.seed.hidden = !none;
    el.launchMeta.textContent =
      plural(state.plantCount, "plant") + " · " + plural(state.sessionCount, "visit") + " logged this session";
  }

  // ── login ────────────────────────────────────────────────────────────────────
  function showLogin(client, mod) {
    setChip('<span class="dot"></span>supabase · sign in');
    el.login.hidden = false;
    el.loginEmail.focus();
    var submit = async function () {
      el.loginErr.textContent = "";
      var email = el.loginEmail.value.trim(), password = el.loginPass.value;
      if (!email || !password) { el.loginErr.textContent = "Enter your email and password."; return; }
      el.loginBtn.disabled = true;
      var res = await client.auth.signInWithPassword({ email: email, password: password });
      el.loginBtn.disabled = false;
      if (res.error) { el.loginErr.textContent = res.error.message; return; }
      await afterAuth(client, mod, res.data.user);
    };
    el.loginBtn.onclick = submit;
    [el.loginEmail, el.loginPass].forEach(function (i) {
      i.addEventListener("keydown", function (e) { if (e.key === "Enter") submit(); });
    });
  }
  function hideLogin() { el.login.hidden = true; }

  // ── field subnav (Briefing / Place / Capture) ──────────────────────────────────
  function wireSubnav() {
    var tabs = {
      briefing: { btn: el.subBriefing, panel: el.panelBriefing },
      place:    { btn: el.subPlace,    panel: el.panelPlace },
      capture:  { btn: el.subCapture,  panel: el.panelCapture },
    };
    var order = ["briefing", "place", "capture"];
    function show(key) {
      Object.keys(tabs).forEach(function (k) {
        var on = k === key;
        tabs[k].btn.setAttribute("aria-current", on ? "true" : "false");
        if (on) tabs[k].panel.setAttribute("data-active", "");
        else    tabs[k].panel.removeAttribute("data-active");
      });
      if (key === "place") ensurePlaceLoaded();
    }
    Object.keys(tabs).forEach(function (key) {
      tabs[key].btn.addEventListener("click", function () { show(key); });
      tabs[key].btn.addEventListener("keydown", function (e) {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        var i = order.indexOf(key);
        var next = order[(i + (e.key === "ArrowRight" ? 1 : order.length - 1)) % order.length];
        show(next); tabs[next].btn.focus();
      });
    });
    show("capture"); // matches the markup's default aria-current
  }

  // ── mode switcher ─────────────────────────────────────────────────────────────
  // A single button showing the mode you'd switch TO (not a two-way segmented
  // tablist) — see Design Rules 2026-07-17c. window.__showMode is kept as the
  // public entry point since other code (afterBoot, etc.) doesn't call it
  // directly, but a couple of spots elsewhere in this file historically
  // reasoned about "the mode toggle" by that name.
  function wireModeToggle() {
    var mode = "field";
    window.__showMode = function (next) {
      mode = next;
      var onField = mode === "field";
      el.surfaceField.toggleAttribute("data-active", onField);
      el.surfaceDesktop.toggleAttribute("data-active", !onField);
      var target = onField ? "Desktop" : "Field";
      el.modeSwitchLbl.textContent = target;
      el.modeSwitch.setAttribute("aria-label", "Switch to " + target + " view");
      if (mode === "desktop" && sage) renderDesktop();
    };
    el.modeSwitch.addEventListener("click", function () {
      window.__showMode(mode === "field" ? "desktop" : "field");
    });
    window.__showMode("field");
  }

  // ── capture ────────────────────────────────────────────────────────────────────
  function wireCapture() {
    el.open.addEventListener("click", function () { openCapture(); });
    el.close.addEventListener("click", closeCapture);
    el.done.addEventListener("click", closeCapture);
    el.logBtn.addEventListener("click", onLog);
    el.seed.addEventListener("click", onSeedClick);
    el.modal.addEventListener("mousedown", function (e) { if (e.target === el.modal) closeCapture(); });
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if (!el.modal.hidden) closeCapture();
      if (!el.zoneModal.hidden) closeZoneModal();
    });
  }

  async function onSeedClick() {
    el.seed.disabled = true;
    await seedSample();
    state.plantCount = (await sage.listIndividuals()).length;
    el.seed.disabled = false;
    refreshLauncher();
  }

  // fixedInd, when passed (Log Mode pin-tap), pre-locks the subject to that
  // one individual instead of showing the full picker — the subject is
  // already resolved by the map tap, so re-picking it would be redundant.
  async function openCapture(fixedInd) {
    if (state.plantCount === 0) return;
    var list = fixedInd ? [fixedInd] : await sage.listIndividuals();
    renderSubjects(list);
    renderSections();
    resetForm();
    el.confirm.textContent = "";
    byId("capture-title").textContent = fixedInd
      ? "Log: " + (fixedInd.label || (fixedInd.taxon_id ? (state.names.taxa[fixedInd.taxon_id] || "plant") : "Mystery plant"))
      : "Log an observation";
    el.modal.hidden = false;
    var first = el.subjects.querySelector(".subject");
    if (first) first.focus();
  }
  function closeCapture() {
    el.modal.hidden = true;
    // Only steal focus back to the launcher button if it's actually visible
    // (Log Mode opens this modal from the Place tab, where el.open is hidden).
    if (el.panelCapture.hasAttribute("data-active")) el.open.focus();
  }

  function renderSubjects(individuals) {
    el.subjects.innerHTML = "";
    individuals.forEach(function (ind, i) {
      var species = ind.taxon_id ? (state.names.taxa[ind.taxon_id] || "species") : "mystery — no species yet";
      var zone    = ind.zone_id ? (state.names.zones[ind.zone_id] || "zone") : "unzoned";
      var name    = ind.label || (ind.taxon_id ? species : "Mystery plant");
      var btn = document.createElement("button");
      btn.type = "button"; btn.className = "subject";
      btn.setAttribute("data-id", ind.id); btn.setAttribute("aria-pressed", "false");
      btn.innerHTML = '<span class="sub-name"></span><span class="sub-meta"></span>';
      btn.querySelector(".sub-name").textContent = name;
      btn.querySelector(".sub-meta").textContent = species + "  ·  " + zone;
      btn.addEventListener("click", function () { selectSubject(ind.id); });
      el.subjects.appendChild(btn);
      if (i === 0) selectSubject(ind.id);
    });
  }
  function selectSubject(id) {
    state.subjectId = id;
    Array.prototype.forEach.call(el.subjects.querySelectorAll(".subject"), function (b) {
      b.setAttribute("aria-pressed", b.getAttribute("data-id") === id ? "true" : "false");
    });
  }

  function renderSections() {
    el.sections.innerHTML = "";
    state.stage = {};
    SECTIONS.forEach(function (cfg) {
      var sec = document.createElement("div");
      sec.className = "obs"; sec.setAttribute("data-kind", cfg.kind);
      var head = document.createElement("div");
      head.className = "obs-head";
      head.innerHTML = '<span class="kind-dot" data-k="' + cfg.kind + '"></span>' + cfg.label;
      sec.appendChild(head);

      var val = document.createElement("div");
      val.className = "value";
      if (cfg.input === "stage") {
        cfg.stages.forEach(function (s) {
          var chip = document.createElement("button");
          chip.type = "button"; chip.className = "opt-chip";
          chip.setAttribute("data-stage", s); chip.setAttribute("aria-pressed", "false");
          chip.textContent = s;
          chip.addEventListener("click", function () { selectStage(cfg.kind, s, val); });
          val.appendChild(chip);
        });
      } else if (cfg.input === "size") {
        val.appendChild(dimLabel("H")); val.appendChild(numInput("size-h", "Height"));
        val.appendChild(dimLabel("W")); val.appendChild(numInput("size-w", "Width"));
        var sel = document.createElement("select");
        sel.id = "unit-input"; sel.setAttribute("aria-label", "Unit");
        cfg.units.forEach(function (u) { var o = document.createElement("option"); o.value = u; o.textContent = u; sel.appendChild(o); });
        val.appendChild(sel);
      } else if (cfg.input === "text") {
        var txt = document.createElement("input");
        txt.type = "text"; txt.id = "pest-input"; txt.placeholder = cfg.placeholder;
        txt.setAttribute("aria-label", "What you saw");
        txt.addEventListener("input", updateWillLog);
        val.appendChild(txt);
      } else if (cfg.input === "note") {
        var ta = document.createElement("textarea");
        ta.id = "note-input"; ta.rows = 2; ta.placeholder = cfg.placeholder;
        ta.setAttribute("aria-label", "Note");
        ta.addEventListener("input", updateWillLog);
        val.appendChild(ta);
      }
      sec.appendChild(val);
      el.sections.appendChild(sec);
    });
  }
  function dimLabel(t) { var s = document.createElement("span"); s.className = "dim-label"; s.textContent = t; return s; }
  function numInput(id, label) {
    var n = document.createElement("input");
    n.type = "number"; n.id = id; n.min = "0"; n.step = "0.1"; n.placeholder = "0";
    n.setAttribute("aria-label", label);
    n.addEventListener("input", updateWillLog);
    return n;
  }
  function selectStage(kind, s, valEl) {
    state.stage[kind] = state.stage[kind] === s ? null : s;
    Array.prototype.forEach.call(valEl.querySelectorAll(".opt-chip"), function (c) {
      c.setAttribute("aria-pressed", c.getAttribute("data-stage") === state.stage[kind] ? "true" : "false");
    });
    updateWillLog();
  }

  function sizeVals() { return { h: valOf("size-h"), w: valOf("size-w"), unit: (byId("unit-input") || {}).value || null }; }
  function valOf(id) { var e = byId(id); return e ? String(e.value).trim() : ""; }
  function filledKinds() {
    var out = [];
    if (state.stage.bloom) out.push("bloom");
    var sz = sizeVals(); if (sz.h !== "" || sz.w !== "") out.push("size");
    if (state.stage.status) out.push("status");
    if (valOf("pest-input")) out.push("pest");
    if (valOf("note-input")) out.push("note");
    return out;
  }
  function updateWillLog() {
    var f = filledKinds();
    el.willLog.textContent = f.length ? "Will log: " + f.join(", ") : "Nothing filled in yet.";
  }

  function collectVisit() {
    if (!state.subjectId) return { error: "Pick a plant to log against." };
    var entries = [];
    if (state.stage.bloom) entries.push({ kind: "bloom", stage: state.stage.bloom });

    var sz = sizeVals();
    if (sz.h !== "" || sz.w !== "") {
      var bad = null;
      var push = function (raw, name) {
        if (raw === "") return;
        var n = Number(raw);
        if (!isFinite(n) || n <= 0) { bad = "Height and width must be greater than zero."; return; }
        entries.push({ kind: "size", subject: name, amount: n, unit: sz.unit });
      };
      push(sz.h, "height"); push(sz.w, "width");
      if (bad) return { error: bad };
    }
    if (state.stage.status) entries.push({ kind: "status", stage: state.stage.status });
    var pest = valOf("pest-input"); if (pest) entries.push({ kind: "pest", subject: pest });
    var note = valOf("note-input"); if (note) entries.push({ kind: "note", note: note });

    if (!entries.length) return { error: "Fill in at least one observation." };
    if (el.flag.checked) entries[0].flag = true;
    return { entries: entries };
  }

  async function onLog() {
    var result = collectVisit();
    if (result.error) { setConfirm(result.error, true); return; }
    var subjName = subjectName(state.subjectId);
    var visit = await sage.log(state.subjectId, result.entries, {});
    state.sessionCount += 1;
    refreshLauncher();
    setConfirm(describeVisit(result.entries, subjName, visit.actions.length > 0), false);
    resetForm();
  }
  function resetForm() { state.stage = {}; renderSections(); el.flag.checked = false; updateWillLog(); }

  // ── Place: the field map ────────────────────────────────────────────────────────
  // Beat 1 — render only. Geometry comes from sage.getMapData() (the gated
  // Supabase blob), never baked into this file. No tap-select yet; that's
  // Beat 2, once real zone/individual data exists to tap against.
  var SVGNS = "http://www.w3.org/2000/svg";

  function wirePlace() {
    el.placeImportBtn.addEventListener("click", function () { el.placeImportFile.click(); });
    el.placeImportFile.addEventListener("change", onImportFile);
    el.placeImportZonesBtn.addEventListener("click", function () { el.placeImportZonesFile.click(); });
    el.placeImportZonesFile.addEventListener("change", onSyncZonesFile);

    el.importConfirmYes.addEventListener("click", onConfirmMapImport);
    el.importConfirmNo.addEventListener("click", hideImportConfirm);
    el.exportBtn.addEventListener("click", onExportBackup);

    // Map data tools: the gear opens/closes a small panel (Map + Backup).
    // Never gated on state (standing admin-control rule).
    el.gearBtn.addEventListener("click", function () {
      if (el.gearMenu.hidden) openGear(); else closeGear(false);
    });
    // Outside-tap dismissal runs on pointerdown in the CAPTURE phase, so it
    // sees the tap before the map does. A tap on the map that closes the
    // panel is stopped here and never reaches the map's own pointer
    // handlers — otherwise "tap away to close" would also drop a plant (or
    // open the zone modal in Log Mode). Taps on other controls (toolbar,
    // nav, zoom) close the panel AND still do their own thing.
    document.addEventListener("pointerdown", function (e) {
      if (el.gearMenu.hidden) return;
      if (el.gearMenu.contains(e.target) || el.gearBtn.contains(e.target)) return;
      closeGear(false);
      if (el.placeMap.contains(e.target)) e.stopPropagation();
    }, true);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !el.gearMenu.hidden) closeGear(true);
    });

    el.placeZin.addEventListener("click", function () { placeZoomAt(placeCenterX(), placeCenterY(), 1 / 1.3); });
    el.placeZout.addEventListener("click", function () { placeZoomAt(placeCenterX(), placeCenterY(), 1.3); });
    el.placeMap.addEventListener("wheel", function (e) {
      e.preventDefault();
      placeZoomAt(e.clientX, e.clientY, e.deltaY > 0 ? 1.12 : 1 / 1.12);
    }, { passive: false });

    el.placeMap.addEventListener("pointerdown", function (e) {
      el.placeMap.setPointerCapture(e.pointerId);
      place.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (place.pointers.size === 1) {
        place.panning = false; place.moved = 0; place.downXY = { x: e.clientX, y: e.clientY };
        place.downTarget = (e.target.classList && (e.target.classList.contains("p-region") || e.target.classList.contains("p-pin")))
          ? e.target : null;
        place.downFeet = place.view ? placeFeetAt(e.clientX, e.clientY) : null;
        // Reposition Mode: pointerdown on a pin is a drag candidate, not a
        // pan candidate. Only actually becomes a drag once the same 12px
        // moved-threshold is crossed below, so a plain tap on a pin opens
        // its move pill (zone picker) rather than always "picking it up."
        place.dragCandidateId = (place.reposMode && place.downTarget && place.downTarget.classList.contains("p-pin"))
          ? place.downTarget.dataset.individualId : null;
      } else if (place.pointers.size === 2) {
        place.pinched = true;
        if (!place.dragging) place.dragCandidateId = null;
        var p2 = Array.from(place.pointers.values());
        place.pinchDist = Math.hypot(p2[0].x - p2[1].x, p2[0].y - p2[1].y);
      }
    });
    el.placeMap.addEventListener("pointermove", function (e) {
      if (!place.pointers.has(e.pointerId)) return;
      var prev = place.pointers.get(e.pointerId);
      place.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (place.pointers.size === 2) {
        var p2 = Array.from(place.pointers.values());
        var d = Math.hypot(p2[0].x - p2[1].x, p2[0].y - p2[1].y);
        if (place.pinchDist) {
          var midX = (p2[0].x + p2[1].x) / 2, midY = (p2[0].y + p2[1].y) / 2;
          placeZoomAt(midX, midY, place.pinchDist / d);
        }
        place.pinchDist = d; return;
      }
      if (place.downXY) place.moved = Math.max(place.moved, Math.hypot(e.clientX - place.downXY.x, e.clientY - place.downXY.y));

      // Reposition Mode: dragging a pin takes priority over panning the map.
      // Same 12px jitter threshold as the tap/pan split below, so a genuine
      // drag can't be swallowed by finger jitter either.
      if (place.dragCandidateId) {
        if (!place.dragging && place.moved > 12) beginPinDrag();
        if (place.dragging) {
          var feet = placeFeetAt(e.clientX, e.clientY);
          var pin = place.pins[place.dragCandidateId];
          if (pin) { pin.setAttribute("cx", feet.x); pin.setAttribute("cy", feet.y); }
          if (place.pendingMove && place.pendingMove.id === place.dragCandidateId) {
            place.pendingMove.newX = feet.x; place.pendingMove.newY = feet.y;
            refreshMovePill();
          }
          return;
        }
      }

      // 12px, not 6: a real finger has more jitter than a mouse, and at 6px a
      // genuine tap could get misread as a micro-pan, silently swallowing the
      // intended placement/selection (this was the "finicky" mystery-plant
      // placement — not a false pan, but a legit tap failing to register).
      if (place.moved > 12 && place.view) {
        place.panning = true; el.placeMap.classList.add("grabbing");
        var rect = el.placeMap.getBoundingClientRect();
        var scale = Math.min(rect.width / place.view.w, rect.height / place.view.h);
        place.view.x -= (e.clientX - prev.x) / scale;
        place.view.y -= (e.clientY - prev.y) / scale;
        applyPlaceView();
      }
    });
    function endPointer(e) {
      if (!place.pointers.has(e.pointerId)) return;
      place.pointers.delete(e.pointerId);
      el.placeMap.classList.remove("grabbing");
      if (place.pointers.size === 0) {
        if (place.dragging) finishPinDrag();
        else if (!place.panning && !place.pinched) onPlaceTap();
        place.downXY = null; place.panning = false; place.pinched = false;
        place.dragging = false; place.dragCandidateId = null;
      }
    }
    el.placeMap.addEventListener("pointerup", endPointer);
    el.placeMap.addEventListener("pointercancel", endPointer);

    // Add-plant modal
    el.closeAdd.addEventListener("click", closeAddModal);
    el.cancelAdd.addEventListener("click", closeAddModal);
    el.saveAdd.addEventListener("click", onSaveAdd);
    el.addModal.addEventListener("mousedown", function (e) { if (e.target === el.addModal) closeAddModal(); });

    // Log Mode toggle
    el.logModeBtn.addEventListener("click", toggleLogMode);

    // Reposition Mode toggle + move-pending pill
    el.reposBtn.addEventListener("click", toggleReposMode);
    el.moveConfirm.addEventListener("click", confirmPendingMove);
    el.moveCancel.addEventListener("click", cancelPendingMove);
    el.moveZone.addEventListener("change", onMoveZoneChange);

    // Zone pill (exits the zoomed-into-a-zone sub-state)
    el.zonePillClose.addEventListener("click", exitZoneZoom);

    // Zone arrows: jump to the nearest zone (by centroid) in that direction
    Object.keys(el.zoneArrows).forEach(function (dir) {
      el.zoneArrows[dir].addEventListener("click", function () {
        var target = el.zoneArrows[dir].dataset.targetZone;
        if (target) zoomToZone(target, { openModal: false });
      });
    });

    // Zone modal
    el.closeZone.addEventListener("click", closeZoneModal);
    el.cancelZone.addEventListener("click", closeZoneModal);
    el.saveZone.addEventListener("click", onSaveZone);
    el.zoneModal.addEventListener("mousedown", function (e) { if (e.target === el.zoneModal) closeZoneModal(); });

    window.addEventListener("resize", function () { if (place.view) applyPlaceView(); });
  }

  // A tap (not a drag) resolved against whatever was under the finger at
  // pointerdown. Zone-gated placement (2026-09-25): every plant lives in a
  // zone, so a tap on the map is navigation first —
  //   · a pin → selects it (as before)
  //   · a zone, when no zone (or a different one) is selected → zooms to it
  //     and selects it; nothing is placed
  //   · inside the selected zone → opens the add-plant modal, zone known
  //   · unzoned ground (house, drive, paths) → a quiet readout, nothing else
  // Which zone a tap is "in" comes from zoneAtPoint(), not just the topmost
  // shape, so a stone or boulder sitting inside a bed still counts as the bed.
  function onPlaceTap() {
    var target = place.downTarget, feet = place.downFeet;
    place.downTarget = null;
    if (!feet) return;
    var isPin = !!(target && target.classList.contains("p-pin"));

    // Reposition Mode: a plain tap on a pin opens its move pill (zone picker
    // + confirm/cancel). Taps anywhere else do nothing — this mode is only
    // about moving existing pins.
    if (place.reposMode) {
      if (isPin) openMoveFor(target.dataset.individualId);
      return;
    }

    if (place.logMode) {
      if (isPin) { openIndividualLog(target.dataset.individualId); return; }
      var logZone = zoneAtPoint(feet.x, feet.y, target);
      if (logZone) { zoomToZone(logZone, { openModal: true }); return; }
      showPlaceReadout("Nothing to log here yet.");
      return;
    }

    if (isPin) { selectIndividual(target.dataset.individualId); return; }
    var zoneId = zoneAtPoint(feet.x, feet.y, target);
    if (!zoneId) { showPlaceReadout("Not part of a zone."); return; }
    if (zoneId !== place.zoneZoomId) {
      zoomToZone(zoneId, { openModal: false });
      showPlaceReadout("Tap inside " + (state.names.zones[zoneId] || "the zone") + " to add a plant.");
      return;
    }
    openAddModal(feet, zoneId);
  }

  // The zone a map point belongs to: the topmost ZONED region whose fill
  // contains it, in draw order (small features draw on top, so e.g. the
  // Front Garden's brick bed wins over the lawn it sits inside). Unzoned
  // toppings (stepping stones, boulders) are looked through. If the browser
  // can't hit-test fills, falls back to whatever zoned shape was tapped.
  function zoneAtPoint(x, y, target) {
    if (!place.snapshot) return null;
    var probe = place.regionEls[place.snapshot.regions[0] && place.snapshot.regions[0].id];
    if (!probe || typeof probe.isPointInFill !== "function") {
      return (target && target.dataset && target.dataset.zoneId) || null;
    }
    var regs = place.snapshot.regions;
    for (var i = regs.length - 1; i >= 0; i--) {
      var r = regs[i];
      if (!r.zone_id) continue;
      var shape = place.regionEls[r.id];
      if (shape && pointInShape(shape, x, y)) return r.zone_id;
    }
    return null;
  }

  async function ensurePlaceLoaded() {
    if (!sage || place.loading) return;
    place.loading = true;
    try {
      var snapshot = await sage.getMapData();
      place.snapshot = (snapshot && Array.isArray(snapshot.regions) && snapshot.regions.length) ? snapshot : null;
      if (place.snapshot) { buildPlaceSVG(place.snapshot); await renderPins(); }
      else { el.placeMap.innerHTML = ""; place.view = null; }
      showPlaceEmpty(!place.snapshot);
      await refreshZoneImportVisibility();
    } finally {
      place.loading = false;
    }
  }

  // "Import zones" is always visible (admin-control rule). With no map it's
  // disabled and says why inline, rather than silently disappearing.
  async function refreshZoneImportVisibility() {
    el.placeImportZonesBtn.hidden = false;
    el.placeImportZonesBtn.disabled = !place.snapshot;
    el.importZonesNote.hidden = !!place.snapshot;
  }

  // The map stage itself is never hidden, so the toolbar + gear stay
  // reachable with no map (import and export must work from empty). With no
  // map, the empty note shows inside the stage and the map-dependent
  // controls are greyed out with a reason, not hidden.
  function showPlaceEmpty(isEmpty) {
    el.placeEmpty.hidden = !isEmpty;
    el.placeStage.hidden = false;
    if (isEmpty) {
      if (place.logMode) toggleLogMode();
      if (place.reposMode) toggleReposMode();
    }
    [el.logModeBtn, el.reposBtn, el.placeZin, el.placeZout].forEach(function (b) {
      b.disabled = isEmpty;
      if (isEmpty) b.title = "Needs a map"; else b.removeAttribute("title");
    });
  }

  function buildPlaceSVG(snapshot) {
    el.placeMap.innerHTML = "";
    place.regionEls = {};
    place.view = { ...snapshot.view };

    snapshot.regions.forEach(function (r) {
      var shape;
      if (r.d) {
        shape = document.createElementNS(SVGNS, "path");
        shape.setAttribute("d", r.d);
      } else {
        shape = document.createElementNS(SVGNS, "circle");
        shape.setAttribute("cx", r.cx); shape.setAttribute("cy", r.cy); shape.setAttribute("r", r.r);
      }
      shape.setAttribute("class", "p-region");
      shape.setAttribute("fill", "var(--mat-" + r.mat + ")");
      shape.dataset.id = r.id;
      if (r.zone_id) shape.dataset.zoneId = r.zone_id;
      el.placeMap.appendChild(shape);
      place.regionEls[r.id] = shape;
    });
    (snapshot.lines || []).forEach(function (l) {
      var line = document.createElementNS(SVGNS, "path");
      line.setAttribute("d", l.d);
      line.setAttribute("class", l.dash ? "p-contour" : "p-lotline");
      el.placeMap.appendChild(line);
    });

    var rose = el.placeCompass.querySelector(".rose");
    if (rose) rose.setAttribute("transform", "rotate(" + (snapshot.northOffset || 0) + " 32 32)");

    applyPlaceView();
  }

  // ── Place: individual pins ──────────────────────────────────────────────────────
  async function renderPins() {
    Object.values(place.pins).forEach(function (el2) { el2.remove(); });
    place.pins = {};
    var inds = await sage.listIndividuals();
    inds.forEach(function (ind) {
      placeIndCache[ind.id] = ind.label || (ind.taxon_id ? "plant" : "mystery plant");
      place.pinZone[ind.id] = ind.zone_id || null;
      if (ind.map_x == null || ind.map_y == null) return;
      var pin = document.createElementNS(SVGNS, "circle");
      pin.setAttribute("cx", ind.map_x); pin.setAttribute("cy", ind.map_y); pin.setAttribute("r", "1.1");
      pin.setAttribute("class", "p-pin" + (ind.taxon_id ? "" : " mystery"));
      pin.dataset.individualId = ind.id;
      el.placeMap.appendChild(pin);
      place.pins[ind.id] = pin;
    });
    if (place.selectedIndividualId && !place.pins[place.selectedIndividualId]) place.selectedIndividualId = null;
    markPinSelected();
    renderZoneLabels(); // must run last: labels are appended after pins so they paint on top
  }

  // Zone name labels — always on, one per zone, appended after pins so they
  // paint on top. Anchor point is picked per-zone (not a naive union-bbox
  // center): the largest member region is preferred, and its bbox-center is
  // verified with isPointInFill() so a concave/odd-shaped bed doesn't strand
  // the label in empty space between regions. Falls back to a small grid
  // search within that region if its exact center happens to miss the fill.
  var ZONE_LABEL_PX = 11; // adjust if this reads too big/small on the phone
  function renderZoneLabels() {
    Object.values(place.zoneLabelEls || {}).forEach(function (t) { t.remove(); });
    place.zoneLabelEls = {};
    place.zoneLabelPos = {};
    if (!place.snapshot) return;
    var zoneIds = {};
    place.snapshot.regions.forEach(function (r) { if (r.zone_id) zoneIds[r.zone_id] = true; });
    Object.keys(zoneIds).forEach(function (zid) {
      var name = state.names.zones[zid];
      if (!name) return;
      var anchor = zoneLabelAnchor(zid);
      if (!anchor) return;
      place.zoneLabelPos[zid] = anchor;
      var t = document.createElementNS(SVGNS, "text");
      t.setAttribute("font-size", ZONE_LABEL_PX);
      t.setAttribute("text-anchor", "middle");
      t.setAttribute("class", "p-zonelabel");
      t.textContent = name;
      el.placeMap.appendChild(t);
      place.zoneLabelEls[zid] = t;
    });
    repositionZoneLabels();
  }

  function zoneLabelAnchor(zoneId) {
    var candidates = place.snapshot.regions
      .filter(function (r) { return r.zone_id === zoneId; })
      .map(function (r) {
        var shape = place.regionEls[r.id];
        if (!shape) return null;
        var b = shape.getBBox();
        return { shape: shape, area: b.width * b.height, cx: b.x + b.width / 2, cy: b.y + b.height / 2, b: b };
      })
      .filter(Boolean)
      .sort(function (a, b2) { return b2.area - a.area; }); // largest region first
    if (!candidates.length) return null;

    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      if (pointInShape(c.shape, c.cx, c.cy)) return { x: c.cx, y: c.cy };
    }
    // Every region's own bbox-center missed its fill (concave shape) — grid-
    // search the largest region for any point that actually lands inside it.
    var big = candidates[0], b = big.b, steps = 7;
    for (var sy = 1; sy < steps; sy++) {
      for (var sx = 1; sx < steps; sx++) {
        var px = b.x + (b.width * sx) / steps, py = b.y + (b.height * sy) / steps;
        if (pointInShape(big.shape, px, py)) return { x: px, y: py };
      }
    }
    return { x: big.cx, y: big.cy }; // last resort: better than no label at all
  }

  function pointInShape(shape, x, y) {
    if (typeof shape.isPointInFill !== "function") return true; // test/older-env fallback
    try {
      var pt = el.placeMap.createSVGPoint();
      pt.x = x; pt.y = y;
      return shape.isPointInFill(pt);
    } catch (e) { return true; }
  }

  // Recomputes each label's counter-scale transform from the current view.
  // Cheap (no getBBox calls) so it's safe to run on every animation frame.
  function repositionZoneLabels() {
    if (!place.view) return;
    var rect = el.placeMap.getBoundingClientRect();
    if (!rect.width) return;
    var scale = Math.min(rect.width / place.view.w, rect.height / place.view.h);
    if (!scale) return;
    var inv = 1 / scale;
    Object.keys(place.zoneLabelEls || {}).forEach(function (zid) {
      var c = place.zoneLabelPos[zid], t = place.zoneLabelEls[zid];
      if (!c || !t) return;
      t.setAttribute("transform", "translate(" + c.x + "," + c.y + ") scale(" + inv + ")");
    });
  }
  function markPinSelected() {
    Object.keys(place.pins).forEach(function (id) {
      place.pins[id].classList.toggle("sel", id === place.selectedIndividualId);
    });
  }
  function selectIndividual(id) {
    place.selectedIndividualId = id;
    markPinSelected();
    showPlaceReadout(individualReadoutName(id));
  }
  var placeIndCache = {}; // display names, refreshed each time renderPins() runs
  function individualReadoutName(id) {
    return placeIndCache[id] || "plant";
  }
  var ro2;
  function showPlaceReadout(t) {
    el.placeReadout.textContent = t;
    el.placeReadout.classList.add("show");
    clearTimeout(ro2);
    ro2 = setTimeout(function () { el.placeReadout.classList.remove("show"); }, 2200);
  }

  // ── Place: Log Mode (Beat 3) ────────────────────────────────────────────────────
  function toggleLogMode() {
    place.logMode = !place.logMode;
    el.logModeBtn.setAttribute("aria-pressed", place.logMode ? "true" : "false");
    el.logModeLbl.textContent = place.logMode ? "Exit Log Mode" : "Log Mode";
    el.placeStage.toggleAttribute("data-logmode", place.logMode);
    // (2026-09-25: leaving Log Mode no longer drops the zoomed zone — zone
    // selection is the default map's navigation too, so it carries across.)
    // Mutually exclusive with Reposition Mode — both hijack pin taps/drags.
    if (place.logMode && place.reposMode) toggleReposMode();
  }

  // ── Place: Reposition Mode (pin drag-to-reposition) ─────────────────────────────
  // Mutually exclusive with Log Mode. While on, dragging a pin (press-hold +
  // move past the jitter threshold, handled in the pointermove listener
  // above) lifts it and follows the finger; releasing drops it as PENDING
  // (visually distinct, no write yet) until the move pill's confirm/cancel
  // is tapped. A plain tap on a pin (no drag) just selects it, same as
  // Beat 2 — see onPlaceTap. No data.js/schema change: map_x/map_y were
  // already writable fields, so this rides on the new moveIndividual().
  // 2026-09-25 — zone-aware moves. Tapping a pin opens the move pill:
  // "Move <name> → [zone ▾] ✓ ✕". The picker defaults to the pin's current
  // zone, so a nudge is just select + drag. Picking another zone frames it
  // and hops the pin to a spot inside it, then drag to refine. A pin dropped
  // outside the chosen zone can't be confirmed (the pill says why). Confirm
  // writes position + zone together, so a pin's zone always matches where it
  // sits. Dragging a pin directly (no tap first) works as before.
  function toggleReposMode() {
    if (place.pendingMove) cancelPendingMove();
    place.reposMode = !place.reposMode;
    el.reposBtn.setAttribute("aria-pressed", place.reposMode ? "true" : "false");
    el.reposLbl.textContent = place.reposMode ? "Exit Reposition" : "Reposition";
    el.placeStage.toggleAttribute("data-reposmode", place.reposMode);
    if (place.reposMode && place.logMode) toggleLogMode();
    // The move pill uses the zone pill's slot, so a zoomed zone lets go of
    // its pill/arrows here (the view itself stays put).
    if (place.reposMode && place.zoneZoomId) exitZoneZoom();
    if (place.reposMode) showPlaceReadout("Tap a pin to move it, or drag it.");
  }

  // Starts (or reuses) the pending move for a pin. One pending move at a
  // time: a different pin's unconfirmed move is reverted first.
  function ensurePendingMove(id) {
    var pm = place.pendingMove;
    if (pm && pm.id === id) return pm;
    if (pm) cancelPendingMove();
    var pin = place.pins[id];
    if (!pin) return null;
    var x = parseFloat(pin.getAttribute("cx")), y = parseFloat(pin.getAttribute("cy"));
    var cur = place.pinZone[id] || null;
    place.pendingMove = {
      id: id, pin: pin,
      origX: x, origY: y, origZone: cur,
      newX: x, newY: y,
      zoneId: (cur && zoneHasGeometry(cur)) ? cur : "",
    };
    place.selectedIndividualId = id;
    markPinSelected();
    fillMoveZoneOptions(place.pendingMove.zoneId);
    el.moveName.textContent = "Move " + individualReadoutName(id) + " →";
    el.movePill.hidden = false;
    return place.pendingMove;
  }

  function openMoveFor(id) {
    var pm = ensurePendingMove(id);
    if (pm) refreshMovePill();
  }

  function beginPinDrag() {
    var pm = ensurePendingMove(place.dragCandidateId);
    if (!pm) { place.dragCandidateId = null; return; }
    place.dragging = true;
    place.dragOrig = { x: pm.origX, y: pm.origY };
    pm.pin.classList.add("dragging");
    refreshMovePill();
  }

  function finishPinDrag() {
    var pm = place.pendingMove;
    if (!pm || pm.id !== place.dragCandidateId) return;
    pm.pin.classList.remove("dragging");
    pm.newX = parseFloat(pm.pin.getAttribute("cx"));
    pm.newY = parseFloat(pm.pin.getAttribute("cy"));
    refreshMovePill();
  }

  function onMoveZoneChange() {
    var pm = place.pendingMove;
    if (!pm) return;
    var zid = el.moveZone.value;
    pm.zoneId = zid;
    if (zid) {
      // Staying in (or returning to) the pin's own zone leaves the pin where
      // it is; a new zone hops it inside, unless it's already there.
      if (zoneAtPoint(pm.newX, pm.newY) !== zid) {
        var spot = zoneDropPoint(zid);
        if (spot) {
          pm.newX = spot.x; pm.newY = spot.y;
          pm.pin.setAttribute("cx", spot.x); pm.pin.setAttribute("cy", spot.y);
        }
      }
      var bbox = zoneBBox(zid);
      if (bbox) animatePlaceView(bbox);
      markZoneSelected(zid);
    } else {
      markZoneSelected(null);
    }
    refreshMovePill();
  }

  // Pill state: ✓ only when something changed AND the pin sits inside the
  // chosen zone. Pending styling whenever the pin is off its saved spot.
  function refreshMovePill() {
    var pm = place.pendingMove;
    if (!pm) return;
    var moved = pm.newX !== pm.origX || pm.newY !== pm.origY;
    var rezoned = (pm.zoneId || null) !== (pm.origZone || null);
    var warn = "";
    if (!pm.zoneId) warn = "Choose a zone";
    else if (zoneAtPoint(pm.newX, pm.newY) !== pm.zoneId) warn = "Outside " + (state.names.zones[pm.zoneId] || "that zone");
    el.moveWarn.textContent = warn;
    el.moveWarn.hidden = !warn;
    el.moveConfirm.disabled = !!warn || !(moved || rezoned);
    pm.pin.classList.toggle("pending", moved);
  }

  async function confirmPendingMove() {
    var pm = place.pendingMove;
    if (!pm || el.moveConfirm.disabled) return;
    el.moveConfirm.disabled = true;
    var rezoned = pm.zoneId !== (pm.origZone || null);
    try {
      await sage.moveIndividual(pm.id, { mapX: pm.newX, mapY: pm.newY, zoneId: pm.zoneId });
    } catch (err) {
      el.moveWarn.textContent = "Couldn’t save the move. Try again.";
      el.moveWarn.hidden = false;
      el.moveConfirm.disabled = false;
      return;
    }
    place.pinZone[pm.id] = pm.zoneId;
    pm.pin.classList.remove("pending");
    place.pendingMove = null;
    el.movePill.hidden = true;
    markZoneSelected(null);
    showPlaceReadout(rezoned ? "Moved to " + (state.names.zones[pm.zoneId] || "new zone") + "." : "Pin moved.");
  }

  // Reverts the pin to its saved spot. The view stays where it is (same
  // never-snap-back rule as leaving a zone).
  function cancelPendingMove() {
    var pm = place.pendingMove;
    if (!pm) return;
    pm.pin.setAttribute("cx", pm.origX);
    pm.pin.setAttribute("cy", pm.origY);
    pm.pin.classList.remove("pending", "dragging");
    place.pendingMove = null;
    el.movePill.hidden = true;
    el.moveConfirm.disabled = false;
    markZoneSelected(null);
  }

  // Zones that actually have shapes on the map, sorted by name the way a
  // person reads them ("Zone B" before "Zone B1" before "Zone C").
  function zonesWithGeometry() {
    var seen = {};
    (place.snapshot ? place.snapshot.regions : []).forEach(function (r) { if (r.zone_id) seen[r.zone_id] = true; });
    return Object.keys(seen)
      .map(function (id) { return { id: id, name: state.names.zones[id] || "Unnamed zone" }; })
      .sort(function (a, b) { return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }); });
  }
  function zoneHasGeometry(zid) {
    return !!(place.snapshot && place.snapshot.regions.some(function (r) { return r.zone_id === zid; }));
  }
  function fillMoveZoneOptions(selected) {
    el.moveZone.innerHTML = "";
    if (!selected) {
      var ph = document.createElement("option");
      ph.value = ""; ph.textContent = "Choose zone…";
      el.moveZone.appendChild(ph);
    }
    zonesWithGeometry().forEach(function (z) {
      var o = document.createElement("option");
      o.value = z.id; o.textContent = z.name;
      el.moveZone.appendChild(o);
    });
    el.moveZone.value = selected || "";
  }

  // A spot guaranteed to count as inside zid (per zoneAtPoint): the zone's
  // label anchor if that works, else the grid point nearest the middle of
  // each member region (largest first) that does.
  function zoneDropPoint(zid) {
    var a = zoneLabelAnchor(zid);
    if (a && zoneAtPoint(a.x, a.y) === zid) return a;
    var regs = place.snapshot.regions
      .filter(function (r) { return r.zone_id === zid && place.regionEls[r.id]; })
      .map(function (r) { var b = place.regionEls[r.id].getBBox(); return { b: b, area: b.width * b.height }; })
      .sort(function (p, q) { return q.area - p.area; });
    for (var i = 0; i < regs.length; i++) {
      var b = regs[i].b, cx = b.x + b.width / 2, cy = b.y + b.height / 2, best = null, bestD = Infinity, n = 12;
      for (var sy = 1; sy < n; sy++) for (var sx = 1; sx < n; sx++) {
        var px = b.x + (b.width * sx) / n, py = b.y + (b.height * sy) / n;
        if (zoneAtPoint(px, py) !== zid) continue;
        var dd = Math.hypot(px - cx, py - cy);
        if (dd < bestD) { bestD = dd; best = { x: px, y: py }; }
      }
      if (best) return best;
    }
    return a;
  }

  async function openIndividualLog(id) {
    var ind = await sage.getIndividual(id);
    if (!ind) return;
    await openCapture(ind);
  }

  // Tapping a zone region zooms to its bounding box and (for a direct tap)
  // opens the Zone modal. Arrow-jumps reuse the same zoom, but leave the
  // modal closed so browsing between zones doesn't force a popup each step.
  function zoomToZone(zoneId, opts) {
    var openModal = !opts || opts.openModal !== false;
    var bbox = zoneBBox(zoneId);
    if (!bbox) { showPlaceReadout("Zone geometry not found."); return; }
    place.zoneZoomId = zoneId;
    var zoneName = state.names.zones[zoneId] || "zone";
    showZonePill(zoneName);
    markZoneSelected(zoneId);
    animatePlaceView(bbox);
    updateZoneArrows();
    if (openModal) openZoneModal(zoneId, zoneName);
  }

  // Deliberately does NOT snap the view back — if you're mid-way through
  // logging and spot a mystery plant nearby, you shouldn't have to pan back
  // across the yard just because you closed the zone pill.
  function exitZoneZoom() {
    place.zoneZoomId = null;
    markZoneSelected(null);
    hideZonePill();
    hideZoneArrows();
  }

  function markZoneSelected(zoneId) {
    if (!place.snapshot) return;
    place.snapshot.regions.forEach(function (r) {
      var shape = place.regionEls[r.id];
      if (!shape) return;
      shape.classList.toggle("zone-sel", !!zoneId && r.zone_id === zoneId);
    });
  }

  function showZonePill(name) {
    el.zonePillName.textContent = name;
    el.zonePill.hidden = false;
  }
  function hideZonePill() { el.zonePill.hidden = true; }

  // Union bounding box (in map feet) of every region belonging to zoneId,
  // read straight off the already-rendered SVG shapes via getBBox() — no
  // separate polygon-math needed since the regions are already on-screen.
  function zoneBBox(zoneId) {
    if (!place.snapshot) return null;
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, any = false;
    place.snapshot.regions.forEach(function (r) {
      if (r.zone_id !== zoneId) return;
      var shape = place.regionEls[r.id];
      if (!shape) return;
      var b = shape.getBBox();
      any = true;
      minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.width); maxY = Math.max(maxY, b.y + b.height);
    });
    if (!any) return null;
    var padX = Math.max(2, (maxX - minX) * 0.18), padY = Math.max(2, (maxY - minY) * 0.18);
    return { x: minX - padX, y: minY - padY, w: (maxX - minX) + padX * 2, h: (maxY - minY) + padY * 2 };
  }

  // Centroid (bbox center) per zone — good enough for directional stepping;
  // flagged in the thread starter as something to refine after phone testing.
  function zoneCentroids() {
    var bounds = {};
    (place.snapshot ? place.snapshot.regions : []).forEach(function (r) {
      if (!r.zone_id) return;
      var shape = place.regionEls[r.id];
      if (!shape) return;
      var b = shape.getBBox();
      var m = bounds[r.zone_id];
      if (!m) { bounds[r.zone_id] = { minX: b.x, minY: b.y, maxX: b.x + b.width, maxY: b.y + b.height }; return; }
      m.minX = Math.min(m.minX, b.x); m.minY = Math.min(m.minY, b.y);
      m.maxX = Math.max(m.maxX, b.x + b.width); m.maxY = Math.max(m.maxY, b.y + b.height);
    });
    var out = {};
    Object.keys(bounds).forEach(function (zid) {
      var m = bounds[zid];
      out[zid] = { x: (m.minX + m.maxX) / 2, y: (m.minY + m.maxY) / 2 };
    });
    return out;
  }

  // Nearest zone centroid whose displacement is dominantly in `dir` (up/down
  // in feet-space, matching the already Y-flipped map JSON — down is +y).
  function nearestInDirection(zoneId, dir) {
    var centroids = zoneCentroids();
    var cur = centroids[zoneId];
    if (!cur) return null;
    var best = null, bestDist = Infinity;
    Object.keys(centroids).forEach(function (zid) {
      if (zid === zoneId) return;
      var c = centroids[zid], dx = c.x - cur.x, dy = c.y - cur.y;
      var inDir =
        dir === "right" ? (dx > 0.5 && Math.abs(dx) >= Math.abs(dy)) :
        dir === "left"  ? (dx < -0.5 && Math.abs(dx) >= Math.abs(dy)) :
        dir === "down"  ? (dy > 0.5 && Math.abs(dy) >= Math.abs(dx)) :
                           (dy < -0.5 && Math.abs(dy) >= Math.abs(dx)); // "up"
      if (!inDir) return;
      var dist = Math.hypot(dx, dy);
      if (dist < bestDist) { bestDist = dist; best = zid; }
    });
    return best;
  }

  function updateZoneArrows() {
    if (!place.zoneZoomId) { hideZoneArrows(); return; }
    Object.keys(el.zoneArrows).forEach(function (dir) {
      var target = nearestInDirection(place.zoneZoomId, dir);
      var btn = el.zoneArrows[dir];
      btn.hidden = false;
      btn.disabled = !target;
      btn.dataset.targetZone = target || "";
    });
  }
  function hideZoneArrows() {
    Object.keys(el.zoneArrows).forEach(function (dir) { el.zoneArrows[dir].hidden = true; });
  }

  // ── Place: Zone modal (Log Mode) ────────────────────────────────────────────────
  var pendingZone = null; // { zoneId, zoneName }
  function openZoneModal(zoneId, zoneName) {
    pendingZone = { zoneId: zoneId, zoneName: zoneName };
    el.zoneTitle.textContent = "Log: " + zoneName;
    resetZoneForm();
    setZoneConfirm("", false);
    el.zoneModal.hidden = false;
    el.zoneAction.focus();
  }
  function closeZoneModal() { el.zoneModal.hidden = true; pendingZone = null; }
  // Clears the input fields only — the confirm message is set separately by
  // the caller (openZoneModal blanks it; onSaveZone leaves its result showing
  // so a rapid-entry save doesn't erase its own confirmation).
  function resetZoneForm() {
    el.zoneAction.value = "";
    el.zoneCondCategory.value = "";
    el.zoneCondSubject.value = "";
    el.zoneCondAbundance.value = "";
    el.zoneCondNote.value = "";
  }
  function setZoneConfirm(text, isWarn) {
    el.zoneConfirm.textContent = text;
    el.zoneConfirm.classList.toggle("warn", !!isWarn);
  }
  async function onSaveZone() {
    if (!pendingZone) return;
    var action = el.zoneAction.value.trim();
    var category = el.zoneCondCategory.value;
    var subject = el.zoneCondSubject.value.trim();
    var abundance = el.zoneCondAbundance.value;
    var note = el.zoneCondNote.value.trim();
    var hasCondition = !!(category || subject || abundance || note);

    if (!action && !hasCondition) {
      setZoneConfirm("Fill in an action or a condition first.", true);
      return;
    }
    el.saveZone.disabled = true;
    var wrote = [];
    if (action) {
      await sage.action({ title: action, zoneId: pendingZone.zoneId });
      wrote.push("action");
    }
    if (hasCondition) {
      await sage.condition({
        category: category || "general", subject: subject || null,
        abundance: abundance || null, zoneId: pendingZone.zoneId, note: note || null,
      });
      wrote.push("condition");
    }
    el.saveZone.disabled = false;
    resetZoneForm();
    setZoneConfirm("Logged " + wrote.join(" + ") + " for " + pendingZone.zoneName + ".", false);
  }

  // ── Place: add-plant modal (tap bare ground to drop a mystery pin) ─────────────
  var pendingPlacement = null; // { mapX, mapY, zoneId }
  function openAddModal(feet, zoneId) {
    pendingPlacement = { mapX: feet.x, mapY: feet.y, zoneId: zoneId };
    var zoneName = zoneId ? (state.names.zones[zoneId] || "zone") : "Unzoned";
    el.addZoneName.textContent = zoneName;
    el.addLabel.value = ""; el.addOrigin.value = "";
    el.addModal.hidden = false;
    el.addLabel.focus();
  }
  function closeAddModal() { el.addModal.hidden = true; pendingPlacement = null; }
  async function onSaveAdd() {
    if (!pendingPlacement) return;
    el.saveAdd.disabled = true;
    var ind = await sage.place({
      mapX: pendingPlacement.mapX, mapY: pendingPlacement.mapY, zoneId: pendingPlacement.zoneId,
      label: el.addLabel.value.trim() || null, origin: el.addOrigin.value || null,
    });
    placeIndCache[ind.id] = ind.label || "mystery plant";
    state.plantCount += 1;
    refreshLauncher();
    el.saveAdd.disabled = false;
    closeAddModal();
    await renderPins();
    selectIndividual(ind.id);
  }

  function applyPlaceView() {
    el.placeMap.setAttribute("viewBox", place.view.x + " " + place.view.y + " " + place.view.w + " " + place.view.h);
    repositionZoneLabels();
  }

  function placeFeetAt(px, py) {
    var rect = el.placeMap.getBoundingClientRect();
    var scale = Math.min(rect.width / place.view.w, rect.height / place.view.h);
    var offx = (rect.width - place.view.w * scale) / 2, offy = (rect.height - place.view.h * scale) / 2;
    return { x: place.view.x + (px - rect.left - offx) / scale, y: place.view.y + (py - rect.top - offy) / scale };
  }
  function placeZoomAt(px, py, factor) {
    if (!place.view || !place.snapshot) return;
    var f = placeFeetAt(px, py);
    var lotW = place.snapshot.lotW;
    var nw = clampNum(place.view.w * factor, lotW * 0.12, lotW * 1.8);
    var k = nw / place.view.w;
    place.view.w = nw; place.view.h *= k;
    place.view.x = f.x - (f.x - place.view.x) * k;
    place.view.y = f.y - (f.y - place.view.y) * k;
    applyPlaceView();
  }
  function clampNum(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function placeCenterX() { var r = el.placeMap.getBoundingClientRect(); return r.left + r.width / 2; }
  function placeCenterY() { var r = el.placeMap.getBoundingClientRect(); return r.top + r.height / 2; }

  function animatePlaceView(target) {
    var from = { ...place.view }, t0 = performance.now(), dur = 520;
    function step(t) {
      var k = Math.min(1, (t - t0) / dur);
      var e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      place.view.x = from.x + (target.x - from.x) * e;
      place.view.y = from.y + (target.y - from.y) * e;
      place.view.w = from.w + (target.w - from.w) * e;
      place.view.h = from.h + (target.h - from.h) * e;
      applyPlaceView();
      if (k < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  // ── Place: map data tools (gear panel) ─────────────────────────────────────
  // Panel open/close, the shared status line, and the three operations it
  // holds: map import, zone sync, backup export.

  function openGear() {
    el.gearMenu.hidden = false;
    el.gearBtn.setAttribute("aria-expanded", "true");
    el.gearDot.hidden = true;               // any unseen result is now seen
    var first = el.gearMenu.querySelector("button:not([disabled])");
    if (first) first.focus();
  }
  function closeGear(returnFocus) {
    if (el.gearMenu.hidden) return;
    el.gearMenu.hidden = true;
    el.gearBtn.setAttribute("aria-expanded", "false");
    hideImportConfirm();                    // a half-armed replace never survives a close
    if (returnFocus) el.gearBtn.focus();
  }

  // One status line for every operation. Final results carry the time they
  // happened so an old message can't pass for a new one; everything clears on
  // reload (it's plain DOM). If a result lands while the panel is closed, the
  // gear shows a dot until it's reopened.
  function setGearStatus(msg, opts) {
    opts = opts || {};
    var box = el.placeImportStatus;
    box.textContent = "";
    box.hidden = false;
    box.classList.toggle("err", !!opts.error);
    box.appendChild(document.createTextNode(msg));
    if (!opts.busy) {
      var when = document.createElement("span");
      when.className = "when";
      when.textContent = (opts.error ? "Failed at " : "Done at ") +
        new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      box.appendChild(when);
      if (el.gearMenu.hidden) el.gearDot.hidden = false;
    }
  }
  function errText(err) { return String((err && err.message) || err || "unknown error"); }

  function setGearBusy(busy) {
    el.placeImportBtn.disabled = busy;
    el.placeImportZonesBtn.disabled = busy || !place.snapshot;
    el.exportBtn.disabled = busy;
    el.importConfirmYes.disabled = busy;
  }

  // Backups carry a top-level `sage_export` marker (see data.js exportJSON),
  // so either import can recognise one and refuse it by name.
  function isBackupFile(parsed) { return !!(parsed && !Array.isArray(parsed) && parsed.sage_export); }

  function readJSONFile(file, cb) {
    var reader = new FileReader();
    reader.onload = function () {
      var parsed;
      try { parsed = JSON.parse(reader.result); }
      catch (err) { setGearStatus("Couldn't read that file. It isn't valid JSON.", { error: true }); return; }
      cb(parsed);
    };
    reader.onerror = function () { setGearStatus("Couldn't open that file.", { error: true }); };
    reader.readAsText(file);
  }

  // ── Map import ──
  // Replacing an existing map is destructive: it swaps the whole map_data
  // snapshot, which clears every region's zone link unless the new file
  // carries its own. So with a map already loaded, a validated file is held
  // as pending and only written after an inline "Replace map" confirm that
  // states the consequence. First-ever import (no map yet) needs no confirm.
  var pendingMapImport = null;

  function onImportFile(e) {
    var file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    hideImportConfirm();
    readJSONFile(file, function (parsed) {
      if (isBackupFile(parsed)) {
        setGearStatus("That's a SAGE backup, not a map export. Nothing was imported.", { error: true });
        return;
      }
      var snapshot = (parsed && parsed.snapshot) || parsed; // wrapped export or bare snapshot
      if (!snapshot || !Array.isArray(snapshot.regions) || !snapshot.regions.length) {
        setGearStatus("That file doesn't look like a map export. Nothing was imported.", { error: true });
        return;
      }
      if (!place.snapshot) { applyMapImport(snapshot); return; }

      pendingMapImport = snapshot;
      var fileLinks = snapshot.regions.filter(function (r) { return r.zone_id; }).length;
      el.importConfirmMsg.textContent =
        "This replaces the current map (" + plural(place.snapshot.regions.length, "region") + ") with " +
        plural(snapshot.regions.length, "region") + " from " + file.name + ". " +
        (fileLinks
          ? "Zone links will be replaced by the " + fileLinks + " in the file."
          : "Every zone link will be cleared. Run Import zones afterwards to relink them.");
      el.importConfirm.hidden = false;
      el.importConfirmYes.focus();
    });
  }
  function hideImportConfirm() {
    pendingMapImport = null;
    el.importConfirm.hidden = true;
  }
  function onConfirmMapImport() {
    var snapshot = pendingMapImport;
    hideImportConfirm();
    if (snapshot) applyMapImport(snapshot);
  }

  async function applyMapImport(snapshot) {
    setGearBusy(true);
    setGearStatus("Importing map…", { busy: true });
    try {
      try { await sage.saveMapData(snapshot); }
      catch (err) {
        setGearStatus("Map import failed: " + errText(err) + ". The previous map is unchanged.", { error: true });
        return;
      }
      try { await ensurePlaceLoaded(); }
      catch (err) {
        setGearStatus("Map saved, but it couldn't be redrawn: " + errText(err) + ". Reload SAGE to see it.", { error: true });
        return;
      }
      var fileLinks = snapshot.regions.filter(function (r) { return r.zone_id; }).length;
      var haveZones = Object.keys(state.names.zones || {}).length > 0;
      setGearStatus(plural(snapshot.regions.length, "region") + " imported." +
        (!fileLinks && haveZones ? " Zone links were cleared. Run Import zones to relink them." : ""));
    } finally {
      setGearBusy(false);
    }
  }

  // ── Zone sync ──
  // Repeatable sync (replaced the old one-time bootstrap): reconciles a
  // zones export — either the raw array the old bootstrap used, or a full
  // "SAGE Garden Map" file (has a top-level .zones array with .members lists
  // of region ids) — against what's really in Supabase and whatever map
  // geometry is currently loaded.
  //
  // Zones are matched by NAME, never re-inserted for a name that already
  // exists — so this is safe to run again after every DXF re-bake or zone
  // edit. Region → zone_id links are always fully re-derived from the file
  // (clean slate first), since that's the only way a region dropped from
  // every zone in the file ends up correctly unzoned.
  //
  // 2026-09: the relink now works on a COPY of the snapshot, so a failed save
  // can't leave the on-screen map showing links the database doesn't have;
  // each phase reports its own failure so a partial run is never silent.
  function onSyncZonesFile(e) {
    var file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (!place.snapshot) {
      setGearStatus("Zones need a map first. Import map data, then sync zones.", { error: true });
      return;
    }
    readJSONFile(file, function (parsed) {
      if (isBackupFile(parsed)) {
        setGearStatus("That's a SAGE backup, not a zones export. Nothing was synced.", { error: true });
        return;
      }
      var zonesIn = Array.isArray(parsed) ? parsed : (parsed && parsed.zones);
      if (!Array.isArray(zonesIn) || !zonesIn.length) {
        setGearStatus("That file doesn't look like a zones export. Nothing was synced.", { error: true });
        return;
      }
      runZoneSync(zonesIn);
    });
  }

  async function runZoneSync(zonesIn) {
    setGearBusy(true);
    setGearStatus("Syncing " + plural(zonesIn.length, "zone") + "…", { busy: true });
    var phase = "read", created = 0, updated = 0, unchanged = 0;
    try {
      var existing = await sage.query({ entity: "zones" });
      var byName = {};
      existing.forEach(function (z) { byName[z.name] = z; });
      var nameToRealId = {};

      phase = "zones";
      for (var i = 0; i < zonesIn.length; i++) {
        var z = zonesIn[i];
        var have = byName[z.name];
        if (!have) {
          var row = await sage.addZone({ name: z.name, kind: z.kind, color: z.color, notes: z.notes || null });
          nameToRealId[z.name] = row.id;
          created++;
        } else {
          nameToRealId[z.name] = have.id;
          var changed = (have.kind ?? null) !== (z.kind ?? null) ||
            (have.color ?? null) !== (z.color ?? null) ||
            (have.notes ?? null) !== (z.notes || null);
          if (changed) {
            await sage.updateZone(have.id, { kind: z.kind, color: z.color, notes: z.notes || null });
            updated++;
          } else {
            unchanged++;
          }
        }
      }

      var snap = JSON.parse(JSON.stringify(place.snapshot));
      snap.regions.forEach(function (r) { r.zone_id = null; });
      var linked = 0, missingRegions = [];
      zonesIn.forEach(function (z) {
        var realId = nameToRealId[z.name];
        (z.members || []).forEach(function (regionId) {
          var region = snap.regions.find(function (rr) { return rr.id === regionId; });
          if (region) { region.zone_id = realId; linked++; }
          else missingRegions.push(regionId);
        });
      });

      phase = "links";
      await sage.saveMapData(snap);

      phase = "redraw";
      await loadNames();       // so zone names resolve in the add-plant modal
      await ensurePlaceLoaded();

      var msg = plural(linked, "region") + " linked across " + plural(zonesIn.length, "zone") +
        " (" + created + " new, " + updated + " updated, " + unchanged + " unchanged).";
      if (missingRegions.length) {
        msg += " " + plural(missingRegions.length, "region") +
          " in the file weren't found on the current map, worth a spot check: " +
          missingRegions.slice(0, 6).join(", ") + (missingRegions.length > 6 ? "…" : "") + ".";
      }
      setGearStatus(msg);
    } catch (err) {
      var why = errText(err);
      var msgs = {
        read: "Zone sync failed before changing anything: " + why + ".",
        zones: "Zone sync stopped partway: " + why + ". " + (created + updated) +
          " zone row(s) were already created or updated, but region links weren't saved. It's safe to run Import zones again.",
        links: "Zone rows were synced, but region links couldn't be saved: " + why + ". It's safe to run Import zones again.",
        redraw: "Zones synced and saved, but the map couldn't be redrawn: " + why + ". Reload SAGE to see them.",
      };
      setGearStatus(msgs[phase], { error: true });
    } finally {
      setGearBusy(false);
    }
  }

  // ── Backup export ──
  // Downloads data.js exportJSON() as sage-backup-YYYY-MM-DD.json (local
  // date). Refuses to download anything if a known table is missing from the
  // dump — a partial backup that looks complete is worse than none. Keep
  // BACKUP_TABLES in step with the schema when a table is added.
  var BACKUP_TABLES = ["taxa", "zones", "individuals", "observations", "sightings", "weather",
    "conditions", "actions", "photos", "absences", "map_data",
    "taxon_colours", "taxon_pairings"]; // 2026-09-25: species colours + pairings

  function localDateStamp(d) {
    d = d || new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  async function onExportBackup() {
    if (!sage) { setGearStatus("SAGE is still starting up. Try again in a moment.", { error: true }); return; }
    setGearBusy(true);
    setGearStatus("Preparing backup…", { busy: true });
    try {
      var payload = await sage.exportJSON();
      var data = payload && payload.data;
      var missing = BACKUP_TABLES.filter(function (t) { return !data || !Array.isArray(data[t]); });
      if (missing.length) throw new Error("the export came back without " + missing.join(", "));
      var rows = BACKUP_TABLES.reduce(function (n, t) { return n + data[t].length; }, 0);

      var name = "sage-backup-" + localDateStamp() + ".json";
      var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url; a.download = name; a.hidden = true;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);

      setGearStatus("Backup downloaded: " + name + " (" + plural(rows, "row") + " across " +
        BACKUP_TABLES.length + " tables).");
    } catch (err) {
      setGearStatus("Backup failed: " + errText(err) + ". Nothing was downloaded.", { error: true });
    } finally {
      setGearBusy(false);
    }
  }

  // ── Desktop read ──────────────────────────────────────────────────────────────
  var desk = { selectedId: null, flaggedObs: {} };
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  async function renderDesktop() {
    var inds = await sage.listIndividuals();
    var rows = [], totalObs = 0;
    for (var i = 0; i < inds.length; i++) {
      var tl = await sage.timeline(inds[i].id);
      var count = tl.reduce(function (n, v) { return n + v.entries.length; }, 0);
      totalObs += count;
      rows.push({ ind: inds[i], tl: tl, count: count });
    }
    var openActions = await sage.query({ entity: "actions", status: "open" });
    desk.flaggedObs = {};
    var followByPlant = {};
    openActions.forEach(function (a) {
      if (a.observation_id) desk.flaggedObs[a.observation_id] = true;
      if (a.individual_id) followByPlant[a.individual_id] = (followByPlant[a.individual_id] || 0) + 1;
    });

    var plantsWith = rows.filter(function (r) { return r.count > 0; }).length;
    byId("desk-summary").textContent = totalObs
      ? plural(totalObs, "observation") + " across " + plural(plantsWith, "plant") + "."
      : "Nothing logged yet — switch to Field and log an observation.";

    renderPlantList(rows, followByPlant);
    if (!rows.some(function (r) { return r.ind.id === desk.selectedId; })) desk.selectedId = null;
    if (!desk.selectedId) {
      var firstWith = rows.find(function (r) { return r.count > 0; });
      var pick = firstWith || rows[0];
      desk.selectedId = pick ? pick.ind.id : null;
    }
    markPlantSelected();
    await renderTimeline(desk.selectedId);
  }

  function renderPlantList(rows, followByPlant) {
    var box = byId("plant-list");
    box.innerHTML = "";
    rows.forEach(function (r) {
      var ind = r.ind;
      var species = ind.taxon_id ? (state.names.taxa[ind.taxon_id] || "species") : "mystery";
      var zone = ind.zone_id ? (state.names.zones[ind.zone_id] || "zone") : "unzoned";
      var name = ind.label || (ind.taxon_id ? species : "Mystery plant");
      var follow = followByPlant[ind.id] || 0;
      var btn = document.createElement("button");
      btn.type = "button"; btn.className = "plant";
      btn.setAttribute("data-id", ind.id); btn.setAttribute("aria-pressed", "false");
      var countHtml = r.count ? plural(r.count, "observation") : '<span class="zero">no observations</span>';
      if (follow) countHtml += ' · <span class="flag">' + plural(follow, "follow-up") + "</span>";
      btn.innerHTML = '<span class="p-name"></span><span class="p-meta"></span><span class="p-count">' + countHtml + "</span>";
      btn.querySelector(".p-name").textContent = name;
      btn.querySelector(".p-meta").textContent = species + "  ·  " + zone;
      btn.addEventListener("click", function () { desk.selectedId = ind.id; markPlantSelected(); renderTimeline(ind.id); });
      box.appendChild(btn);
    });
  }
  function markPlantSelected() {
    Array.prototype.forEach.call(document.querySelectorAll("#plant-list .plant"), function (b) {
      b.setAttribute("aria-pressed", b.getAttribute("data-id") === desk.selectedId ? "true" : "false");
    });
  }

  async function renderTimeline(id) {
    var pane = byId("timeline-pane");
    if (!id) { pane.innerHTML = '<div class="tl-empty">No plants yet.</div>'; return; }
    var ind = await sage.getIndividual(id);
    var visits = await sage.timeline(id);
    var species = ind.taxon ? ind.taxon.common_name : "Mystery plant";
    var botanical = ind.taxon && ind.taxon.botanical_name ? ind.taxon.botanical_name : null;
    var zone = ind.zone_id ? (state.names.zones[ind.zone_id] || "zone") : "unzoned";
    var metaBits = [botanical || species, zone];
    if (ind.planted_on) metaBits.push("planted " + ind.planted_on);
    if (ind.status) metaBits.push(ind.status);

    var head = document.createElement("div");
    head.className = "tl-head";
    head.innerHTML = "<h3></h3><div class='tl-meta'></div>";
    head.querySelector("h3").textContent = ind.label || species;
    head.querySelector(".tl-meta").textContent = metaBits.join("  ·  ");
    pane.innerHTML = ""; pane.appendChild(head);

    if (!visits.length) {
      var e = document.createElement("div");
      e.className = "tl-empty"; e.textContent = "No observations yet for this plant. Log one in Field.";
      pane.appendChild(e); return;
    }
    visits.forEach(function (v) {
      var block = document.createElement("div"); block.className = "visit";
      var when = document.createElement("div"); when.className = "visit-when"; when.textContent = formatWhen(v.observedAt);
      block.appendChild(when);
      v.entries.forEach(function (obs) {
        var row = document.createElement("div"); row.className = "entry";
        var tag = document.createElement("span"); tag.className = "kind-tag"; tag.setAttribute("data-k", obs.kind); tag.textContent = obs.kind;
        var val = document.createElement("span"); val.className = "entry-val"; val.textContent = displayValue(obs);
        if (desk.flaggedObs[obs.id]) { var f = document.createElement("span"); f.className = "followup"; f.textContent = "· follow-up"; val.appendChild(f); }
        row.appendChild(tag); row.appendChild(val);
        if (obs.kind !== "note" && obs.note) { var sub = document.createElement("div"); sub.className = "entry-note"; sub.textContent = obs.note; row.appendChild(sub); }
        block.appendChild(row);
      });
      pane.appendChild(block);
    });
  }

  // ── helpers ────────────────────────────────────────────────────────────────────
  function describeVisit(entries, subjName, actionAdded) {
    var kinds = [];
    entries.forEach(function (e) { if (kinds.indexOf(e.kind) === -1) kinds.push(e.kind); });
    var msg = "Logged " + plural(entries.length, "observation") + " on " + subjName + ": " + kinds.join(", ");
    if (actionAdded) msg += " · follow-up task added";
    return msg;
  }
  function displayValue(e) {
    if (e.kind === "bloom" || e.kind === "status") return e.stage || "";
    if (e.kind === "size")  return (e.subject ? e.subject + " " : "") + (e.amount != null ? e.amount : "") + (e.unit ? " " + e.unit : "");
    if (e.kind === "fruit") return e.amount != null ? e.amount + (e.unit ? " " + e.unit : "") : (e.stage || "");
    if (e.kind === "pest")  return e.subject || "";
    if (e.kind === "note")  return e.note || "";
    return e.note || e.subject || e.stage || "";
  }
  function subjectName(id) {
    var n = el.subjects.querySelector('.subject[data-id="' + id + '"] .sub-name');
    return n ? n.textContent : "plant";
  }
  function setConfirm(text, isWarn) { el.confirm.textContent = text; el.confirm.classList.toggle("warn", !!isWarn); }
  function setChip(html, warn) {
    var c = byId("backend-chip");
    if (!c) return;
    c.classList.toggle("warn", !!warn);
    c.innerHTML = html;
  }
  function formatWhen(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    var hh = String(d.getHours()).padStart(2, "0"), mm = String(d.getMinutes()).padStart(2, "0");
    return MON[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear() + " · " + hh + ":" + mm;
  }
  function plural(n, word) { return n + " " + word + (n === 1 ? "" : "s"); }
  function byId(id) { return document.getElementById(id); }
})();
