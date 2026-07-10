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
    modeField: byId("mode-field"), modeDesktop: byId("mode-desktop"),
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
    placeImportStatus: byId("place-import-status"),
    placeFocusBtn: byId("place-focus-btn"), placeFocusLbl: byId("place-focus-lbl"),
    placeCompass: byId("place-compass"),
    placeScaleBar: byId("place-scale-bar"), placeScaleLbl: byId("place-scale-lbl"),
    placeZin: byId("place-zin"), placeZout: byId("place-zout"), placeReadout: byId("place-readout"),
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
    loaded: false, loading: false, snapshot: null, view: null,
    regionEls: {}, pointers: new Map(), panning: false, moved: 0,
    downXY: null, pinchDist: 0, focused: false,
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

  // ── mode toggle ───────────────────────────────────────────────────────────────
  function wireModeToggle() {
    var tabs = {
      field:   { btn: el.modeField,   panel: el.surfaceField },
      desktop: { btn: el.modeDesktop, panel: el.surfaceDesktop },
    };
    window.__showMode = function (mode) {
      Object.keys(tabs).forEach(function (key) {
        var on = key === mode;
        tabs[key].btn.setAttribute("aria-selected", on ? "true" : "false");
        if (on) tabs[key].panel.setAttribute("data-active", "");
        else    tabs[key].panel.removeAttribute("data-active");
      });
      if (mode === "desktop" && sage) renderDesktop();
    };
    var order = ["field", "desktop"];
    Object.keys(tabs).forEach(function (key) {
      tabs[key].btn.addEventListener("click", function () { window.__showMode(key); });
      tabs[key].btn.addEventListener("keydown", function (e) {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        var i = order.indexOf(key);
        var next = order[(i + (e.key === "ArrowRight" ? 1 : order.length - 1)) % order.length];
        window.__showMode(next); tabs[next].btn.focus();
      });
    });
    window.__showMode("field");
  }

  // ── capture ────────────────────────────────────────────────────────────────────
  function wireCapture() {
    el.open.addEventListener("click", openCapture);
    el.close.addEventListener("click", closeCapture);
    el.done.addEventListener("click", closeCapture);
    el.logBtn.addEventListener("click", onLog);
    el.seed.addEventListener("click", onSeedClick);
    el.modal.addEventListener("mousedown", function (e) { if (e.target === el.modal) closeCapture(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !el.modal.hidden) closeCapture(); });
  }

  async function onSeedClick() {
    el.seed.disabled = true;
    await seedSample();
    state.plantCount = (await sage.listIndividuals()).length;
    el.seed.disabled = false;
    refreshLauncher();
  }

  async function openCapture() {
    if (state.plantCount === 0) return;
    renderSubjects(await sage.listIndividuals());
    renderSections();
    resetForm();
    el.confirm.textContent = "";
    el.modal.hidden = false;
    var first = el.subjects.querySelector(".subject");
    if (first) first.focus();
  }
  function closeCapture() { el.modal.hidden = true; el.open.focus(); }

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

    el.placeFocusBtn.addEventListener("click", function () {
      if (!place.snapshot) return;
      place.focused = !place.focused;
      el.placeFocusLbl.textContent = place.focused ? "Whole yard" : "Focus garden";
      animatePlaceView(place.focused ? place.snapshot.focus : place.snapshot.view);
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
      } else if (place.pointers.size === 2) {
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
      if (place.moved > 6 && place.view) {
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
      if (place.pointers.size === 0) { place.downXY = null; place.panning = false; }
    }
    el.placeMap.addEventListener("pointerup", endPointer);
    el.placeMap.addEventListener("pointercancel", endPointer);

    window.addEventListener("resize", function () { if (place.view) applyPlaceView(); });
  }

  async function ensurePlaceLoaded() {
    if (!sage || place.loaded || place.loading) return;
    place.loading = true;
    try {
      var snapshot = await sage.getMapData();
      place.snapshot = (snapshot && Array.isArray(snapshot.regions) && snapshot.regions.length) ? snapshot : null;
      if (place.snapshot) buildPlaceSVG(place.snapshot);
      showPlaceEmpty(!place.snapshot);
      place.loaded = true;
    } finally {
      place.loading = false;
    }
  }

  function showPlaceEmpty(isEmpty) {
    el.placeEmpty.hidden = !isEmpty;
    el.placeStage.hidden = isEmpty;
  }

  function buildPlaceSVG(snapshot) {
    el.placeMap.innerHTML = "";
    place.regionEls = {};
    place.view = { ...snapshot.view };
    place.focused = false;
    el.placeFocusLbl.textContent = "Focus garden";

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

  function applyPlaceView() {
    el.placeMap.setAttribute("viewBox", place.view.x + " " + place.view.y + " " + place.view.w + " " + place.view.h);
    updatePlaceScale();
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

  function updatePlaceScale() {
    var rect = el.placeMap.getBoundingClientRect();
    if (!rect.width) return;
    var scale = Math.min(rect.width / place.view.w, rect.height / place.view.h);
    var targetPx = 78, raw = targetPx / scale;
    var nices = [1, 2, 5, 10, 20, 25, 50, 100], ft = nices[0];
    nices.forEach(function (n) { if (n <= raw) ft = n; });
    var segPx = (ft / 4) * scale;
    el.placeScaleBar.innerHTML = "";
    for (var i = 0; i < 4; i++) {
      var seg = document.createElement("div");
      seg.className = "seg" + (i % 2 ? " on" : "");
      seg.style.width = segPx + "px";
      el.placeScaleBar.appendChild(seg);
    }
    el.placeScaleLbl.textContent = ft + " ft";
  }

  // ── Place: import ────────────────────────────────────────────────────────────
  // One-time (and re-runnable) bootstrap: read a map export, save it into the
  // gated map_data row via data.js, then redraw from what's now in Supabase —
  // proving the whole load path works, not just the file parse.
  function onImportFile(e) {
    var file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    var reader = new FileReader();
    reader.onload = async function () {
      var parsed;
      try { parsed = JSON.parse(reader.result); }
      catch (err) { el.placeImportStatus.textContent = "Couldn't read that file — not valid JSON."; return; }
      var snapshot = parsed.snapshot || parsed; // accept either the wrapped export or a bare snapshot
      if (!snapshot || !Array.isArray(snapshot.regions) || !snapshot.regions.length) {
        el.placeImportStatus.textContent = "That file doesn't look like a map export.";
        return;
      }
      el.placeImportBtn.disabled = true;
      await sage.saveMapData(snapshot);
      place.loaded = false; // force a reload from what we just saved
      await ensurePlaceLoaded();
      el.placeImportBtn.disabled = false;
      el.placeImportStatus.textContent = plural(snapshot.regions.length, "region") + " imported.";
    };
    reader.readAsText(file);
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
