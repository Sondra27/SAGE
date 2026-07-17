// ============================================================================
// SAGE — data.js  (the keystone layer)
// ----------------------------------------------------------------------------
// This is the ONE place in the app that knows how data is stored. Every view
// (Briefing, Place, Capture, Desktop) calls these methods and nothing else.
// Views never see Supabase, never see IndexedDB — only this contract.
//
// Why it's built this way: the app is stubbed today against an in-memory
// backend so both UI shells can be built and pressure-tested with ZERO cloud
// setup. Later, "wire up Supabase" means writing ONE new backend object with
// the same three methods (insert / update / select) and swapping it in on the
// last line of this file. No view changes. That swap seam is the whole point.
//
// This file runs as-is: `node data.js` executes the demo at the bottom and
// prints real output, so you can see visit_id grouping and flag→action work
// before any UI or database exists.
// ============================================================================


// ── Client-minted IDs ───────────────────────────────────────────────────────
// PKs are minted here on the client (not by the database). This is what lets
// the phone create a row AND its photo offline and sync both later with no
// round-trip — and it's what makes the JSON export perfectly restorable.
const newId = () =>
  (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : "id-" + Math.random().toString(16).slice(2) + Date.now().toString(16);

const nowISO = () => new Date().toISOString();


// ============================================================================
// THE SWAP SEAM  —  a backend is anything with these five methods.
// Today: MemoryBackend (arrays in RAM). Later: SupabaseBackend (same methods,
// real cloud). data.js below never cares which one it's holding.
// ============================================================================

function MemoryBackend(seed = {}) {
  // One array per table — mirrors the SQL schema exactly.
  const tables = {
    taxa: [], zones: [], individuals: [], observations: [],
    sightings: [], weather: [], conditions: [], actions: [],
    photos: [], absences: [],
    // Singleton row — mirrors the seeded row-1 from the map_data migration so
    // Memory mode and Supabase behave identically from a fresh boot.
    map_data: [{ id: 1, snapshot: {}, updated_at: nowISO() }],
    ...seed,
  };
  const clone = (o) => JSON.parse(JSON.stringify(o));

  return {
    // insert a row, return the stored copy. weather's PK is its `date`, so an
    // insert on an existing date replaces it (an upsert) — keeps this in step
    // with SupabaseBackend and makes putWeather idempotent on both backends.
    async insert(table, row) {
      const stored = clone(row);
      if (table === "weather") {
        const i = tables.weather.findIndex((w) => w.date === stored.date);
        if (i >= 0) { tables.weather[i] = stored; return clone(stored); }
      }
      tables[table].push(stored);
      return clone(stored);
    },
    // patch a row by id, return the updated copy (or null if not found)
    async update(table, id, patch) {
      const r = tables[table].find((x) => x.id === id);
      if (!r) return null;
      Object.assign(r, patch);
      return clone(r);
    },
    // return all rows in a table optionally filtered by a predicate fn
    async select(table, predicate) {
      const rows = predicate ? tables[table].filter(predicate) : tables[table];
      return rows.map(clone);
    },
    // whole-database dump (used by exportJSON) — Supabase backend selects all
    async dump() {
      return clone(tables);
    },
    // whole-database load (used by importJSON)
    async load(data) {
      for (const k of Object.keys(tables)) tables[k] = clone(data[k] || []);
    },
  };
}


// ============================================================================
// THE DOMAIN API  —  everything a view is allowed to call.
// createSAGE(backend) returns the object of methods documented below.
// ============================================================================

function createSAGE(backend = MemoryBackend()) {
  const db = backend;

  return {

    // ── SEEDING (admin / one-time real-data load) ──────────────────────────

    /** Add a reusable Species record. → the stored taxon. */
    async addTaxon({ commonName, botanicalName, category, bloomMonths, matureHFt, matureWFt, notes } = {}) {
      return db.insert("taxa", {
        id: newId(), common_name: commonName, botanical_name: botanicalName ?? null,
        category: category ?? null, bloom_months: bloomMonths ?? null,
        mature_h_ft: matureHFt ?? null, mature_w_ft: matureWFt ?? null,
        notes: notes ?? null, created_at: nowISO(),
      });
    },

    /** Add a Zone (bed/area). Normally seeded from the DXF map. → the zone. */
    async addZone({ name, kind, color, focus, notes } = {}) {
      return db.insert("zones", {
        id: newId(), name, kind: kind ?? null, color: color ?? null,
        focus: focus ?? null, notes: notes ?? null, created_at: nowISO(),
      });
    },

    /**
     * Patch an existing Zone's metadata (kind/color/notes/name/focus) without
     * touching its id or its regions' zone_id links. The zone-sync tool uses
     * this so re-running a sync updates rows in place instead of inserting
     * duplicates. → the updated zone, or null if the id doesn't exist.
     */
    async updateZone(id, { name, kind, color, focus, notes } = {}) {
      const patch = {};
      if (name !== undefined) patch.name = name;
      if (kind !== undefined) patch.kind = kind ?? null;
      if (color !== undefined) patch.color = color ?? null;
      if (focus !== undefined) patch.focus = focus ?? null;
      if (notes !== undefined) patch.notes = notes ?? null;
      return db.update("zones", id, patch);
    },


    // ── PLACE  (field map: tap-to-drop a new Individual) ───────────────────

    /**
     * Create an Individual at a map location. taxonId may be omitted → a
     * MYSTERY PLANT (a valid, trackable record; identity backfilled later via
     * identify()). zoneId is passed IN by the Place view, which owns the map
     * geometry and does the point-in-polygon detect; data.js stays geometry-free.
     * An optional photo is attached in the same call.
     * → { ...individual, photo? }
     */
    async place({ mapX, mapY, zoneId, taxonId, label, origin, plantedOn, status, notes, photo } = {}) {
      const ind = await db.insert("individuals", {
        id: newId(), taxon_id: taxonId ?? null, zone_id: zoneId ?? null,
        label: label ?? null, origin: origin ?? null,
        map_x: mapX ?? null, map_y: mapY ?? null,
        planted_on: plantedOn ?? null, status: status ?? "alive",
        notes: notes ?? null, created_at: nowISO(), updated_at: nowISO(),
      });
      let photoRow = null;
      if (photo) photoRow = await this.photo({ ...photo, individualId: ind.id });
      return { ...ind, photo: photoRow };
    },

    /** Backfill a mystery plant's identity once you know what came up. */
    async identify(individualId, taxonId) {
      return db.update("individuals", individualId, { taxon_id: taxonId, updated_at: nowISO() });
    },

    /**
     * Reposition an existing Individual's pin (Place — drag-to-reposition).
     * Place owns the drag gesture and the pending/confirm UI; this just
     * persists the final map_x/map_y once the person confirms the move.
     * No schema change — map_x/map_y were already writable fields.
     * → the updated individual, or null if the id doesn't exist.
     */
    async moveIndividual(id, { mapX, mapY } = {}) {
      return db.update("individuals", id, { map_x: mapX, map_y: mapY, updated_at: nowISO() });
    },

    /**
     * The yard's painted geometry (regions + materials) — the blob Place
     * draws. Lives in the single-row map_data table (id always 1). Both
     * backends seed that row on setup, so this normally always finds one.
     * → the snapshot object ({} if somehow nothing's been saved yet).
     */
    async getMapData() {
      const row = (await db.select("map_data", () => true))[0];
      return row ? row.snapshot : {};
    },

    /**
     * Save the yard's geometry — the Place/Material Studio write path.
     * Upserts the singleton row rather than inserting a second one.
     * → the stored row { id, snapshot, updated_at }.
     */
    async saveMapData(snapshot) {
      const existing = (await db.select("map_data", () => true))[0];
      if (existing) {
        return db.update("map_data", existing.id, { snapshot, updated_at: nowISO() });
      }
      // Shouldn't normally happen — both backends seed row 1 — but stay safe.
      return db.insert("map_data", { id: 1, snapshot, updated_at: nowISO() });
    },


    // ── LOG  (Capture: the unified observation write) ──────────────────────

    /**
     * THE keystone method. One field save records as MANY kinds as you like for
     * one plant (bloom + size + pest…). Each becomes its own clean row, but they
     * all share one client-minted visit_id so the timeline can cluster them
     * while a size chart still sees only the clean number.
     *
     * Any entry may carry `flag` (true, or { title }) → spawns a linked action
     * (source:'field-flag', observation_id set) so the task list shows WHY it
     * exists. An optional single photo attaches to the whole visit.
     *
     * entries: [{ kind, stage?, amount?, unit?, subject?, note?, extra?, flag? }]
     * opts:    { observedAt?, photo? }
     * → { visitId, observations:[...], actions:[...], photo? }
     */
    async log(individualId, entries = [], { observedAt, photo } = {}) {
      const visit_id = newId();
      const observed_at = observedAt ?? nowISO();
      const observations = [];
      const actions = [];

      for (const e of entries) {
        const obs = await db.insert("observations", {
          id: newId(), individual_id: individualId, visit_id, observed_at,
          kind: e.kind, stage: e.stage ?? null, amount: e.amount ?? null,
          unit: e.unit ?? null, subject: e.subject ?? null,
          note: e.note ?? null, extra: e.extra ?? null, created_at: nowISO(),
        });
        observations.push(obs);

        if (e.flag) {
          const title = (typeof e.flag === "object" && e.flag.title)
            ? e.flag.title
            : `Follow up: ${e.subject || e.kind}`;
          actions.push(await db.insert("actions", {
            id: newId(), title, status: "open", due_on: null,
            individual_id: individualId, zone_id: null, observation_id: obs.id,
            source: "field-flag", note: null, done_at: null, created_at: nowISO(),
          }));
        }
      }

      let photoRow = null;
      if (photo) photoRow = await this.photo({ ...photo, individualId });
      return { visitId: visit_id, observations, actions, photo: photoRow };
    },


    // ── WILDLIFE / CONDITIONS / ACTIONS / PHOTOS / ABSENCES ────────────────

    /** Log a wildlife sighting (garden-wide, not plant-bound). */
    async sighting({ category, species, zoneId, observedAt, count, behavior, note } = {}) {
      return db.insert("sightings", {
        id: newId(), category, species: species ?? null, zone_id: zoneId ?? null,
        observed_at: observedAt ?? nowISO(), count: count ?? null,
        behavior: behavior ?? null, note: note ?? null, created_at: nowISO(),
      });
    },

    /** Log an area-level condition (weed / frost / soil…). Feeds the phenology loop. */
    async condition({ category, subject, abundance, zoneId, observedAt, note, extra } = {}) {
      return db.insert("conditions", {
        id: newId(), observed_at: observedAt ?? nowISO(), category,
        subject: subject ?? null, abundance: abundance ?? null,
        zone_id: zoneId ?? null, note: note ?? null, extra: extra ?? null,
        created_at: nowISO(),
      });
    },

    /** Create a standalone task. (Field-flag tasks are spawned inside log().) */
    async action({ title, dueOn, individualId, zoneId, note } = {}) {
      return db.insert("actions", {
        id: newId(), title, status: "open", due_on: dueOn ?? null,
        individual_id: individualId ?? null, zone_id: zoneId ?? null,
        observation_id: null, source: "manual", note: note ?? null,
        done_at: null, created_at: nowISO(),
      });
    },

    /** Mark a task done — never touches the observation that spawned it. */
    async completeAction(id) {
      return db.update("actions", id, { status: "done", done_at: nowISO() });
    },

    /**
     * Attach a photo. In the stub this just records metadata; in the real
     * backend the file uploads to Supabase Storage first and storagePath is its
     * key. Exactly one link target (individual/observation/sighting/condition).
     */
    async photo({ storagePath, takenAt, caption, individualId, observationId, sightingId, conditionId } = {}) {
      return db.insert("photos", {
        id: newId(), storage_path: storagePath ?? `pending/${newId()}.jpg`,
        taken_at: takenAt ?? nowISO(), caption: caption ?? null,
        individual_id: individualId ?? null, observation_id: observationId ?? null,
        sighting_id: sightingId ?? null, condition_id: conditionId ?? null,
        created_at: nowISO(),
      });
    },

    /** Record an away-period (date range). The app's most sensitive record. */
    async absence({ startDate, endDate, note } = {}) {
      return db.insert("absences", {
        id: newId(), start_date: startDate, end_date: endDate ?? null,
        note: note ?? null, created_at: nowISO(),
      });
    },

    /** Upsert one day of weather (Open-Meteo). PK is the date. */
    async putWeather({ date, tempMinC, tempMaxC, precipMm, extra } = {}) {
      // weather's PK is `date`; both backends upsert on it, so a plain insert
      // is the idempotent write. (Was a broken update()??insert() — update()
      // returns a Promise, which is never null, so insert never ran.)
      const row = {
        date, temp_min_c: tempMinC ?? null, temp_max_c: tempMaxC ?? null,
        precip_mm: precipMm ?? null, frost: (tempMinC ?? 99) <= 0,
        source: "open-meteo", fetched_at: nowISO(), extra: extra ?? null,
      };
      return db.insert("weather", row);
    },


    // ── READS ──────────────────────────────────────────────────────────────

    /** One plant with its Species joined in. → { ...individual, taxon } */
    async getIndividual(id) {
      const ind = (await db.select("individuals", (i) => i.id === id))[0];
      if (!ind) return null;
      const taxon = ind.taxon_id
        ? (await db.select("taxa", (t) => t.id === ind.taxon_id))[0] : null;
      return { ...ind, taxon };
    },

    /** List individuals, optional filter { zoneId?, status?, mysteryOnly? }. */
    async listIndividuals({ zoneId, status, mysteryOnly } = {}) {
      return db.select("individuals", (i) =>
        (zoneId ? i.zone_id === zoneId : true) &&
        (status ? i.status === status : true) &&
        (mysteryOnly ? i.taxon_id === null : true));
    },

    /**
     * A plant's full history, clustered by visit — the shape the per-plant page
     * and desktop timeline render directly.
     * → [{ visitId, observedAt, entries:[obs...] }] newest first
     */
    async timeline(individualId) {
      const obs = await db.select("observations", (o) => o.individual_id === individualId);
      const byVisit = new Map();
      for (const o of obs) {
        const key = o.visit_id || o.id;
        if (!byVisit.has(key)) byVisit.set(key, { visitId: key, observedAt: o.observed_at, entries: [] });
        byVisit.get(key).entries.push(o);
      }
      return [...byVisit.values()].sort((a, b) => (a.observedAt < b.observedAt ? 1 : -1));
    },

    /**
     * Cross-record query — the flexible read behind "what's blooming in June",
     * wildlife lists, open tasks, etc.
     * spec: { entity, since?, until?, kind?, category?, status?, bloomMonth? }
     */
    async query(spec = {}) {
      const { entity } = spec;
      if (entity === "bloomingInMonth") {
        // Species whose reference window includes the month, + their individuals.
        const taxa = await db.select("taxa", (t) => (t.bloom_months || []).includes(spec.month));
        const ids = new Set(taxa.map((t) => t.id));
        const inds = await db.select("individuals", (i) => ids.has(i.taxon_id) && i.status === "alive");
        return { taxa, individuals: inds };
      }
      const inRange = (ts) =>
        (spec.since ? ts >= spec.since : true) && (spec.until ? ts <= spec.until : true);
      return db.select(entity, (r) => {
        const ts = r.observed_at || r.created_at || r.date;
        return inRange(ts) &&
          (spec.kind ? r.kind === spec.kind : true) &&
          (spec.category ? r.category === spec.category : true) &&
          (spec.status ? r.status === spec.status : true);
      });
    },

    /**
     * The Briefing digest — purely DERIVED, no new tables. Composed from the
     * reads above so the field-landing screen is one call.
     * → { date, weather, inBloomNow, watchFor, recentFlags }
     */
    async briefing(date = nowISO().slice(0, 10)) {
      const month = Number(date.slice(5, 7));
      const weather = (await db.select("weather", (w) => w.date === date))[0] ?? null;
      const inBloomNow = (await this.query({ entity: "bloomingInMonth", month })).individuals;

      // "Watch for": conditions flagged in this month in PRIOR years (the
      // fall→spring loop) — e.g. last October's heavy creeping charlie.
      const watchFor = await db.select("conditions", (c) =>
        Number(c.observed_at.slice(5, 7)) === month &&
        c.observed_at.slice(0, 4) < date.slice(0, 4));

      // Recent flags: still-open field-flag tasks.
      const recentFlags = await db.select("actions", (a) =>
        a.status === "open" && a.source === "field-flag");

      return { date, weather, inBloomNow, watchFor, recentFlags };
    },


    // ── BACKUP / EXPORT (Decision 3) ───────────────────────────────────────

    /** The restorable master. Every table in one object; UUIDs carry all links. */
    async exportJSON() {
      return { sage_export: 1, exported_at: nowISO(), data: await db.dump() };
    },

    /** Restore into a blank backend — relationships reconnect with no ID remap. */
    async importJSON(payload) {
      await db.load(payload.data || payload);
      return true;
    },

    // exportXLSX() is a thin wrapper built at packaging time (xlsx skill) over
    // the same dump() — omitted from the stub; same data, readable workbook.
  };
}


// ============================================================================
// DEMO  —  proves the contract. Run: `node data.js`
// ============================================================================

async function demo() {
  const sage = createSAGE();                 // in-memory backend, no cloud

  const bed = await sage.addZone({ name: "NE Bed", kind: "perennial" });
  const phlox = await sage.addTaxon({ commonName: "Garden Phlox", bloomMonths: [7, 8] });

  const plant = await sage.place({
    mapX: 12.5, mapY: 40, zoneId: bed.id, taxonId: phlox.id,
    label: "front-corner phlox", origin: "purchased", plantedOn: "2026-06-14",
  });

  // ONE save, THREE kinds, one flagged for follow-up:
  const visit = await sage.log(plant.id, [
    { kind: "bloom", stage: "peak" },
    { kind: "size",  amount: 18, unit: "in" },
    { kind: "pest",  subject: "leaf nibbling", amount: 2, flag: true },
  ], { observedAt: "2026-07-14T10:00:00Z" });

  const line = await sage.timeline(plant.id);

  console.log("visit_id shared by all 3 rows:",
    visit.observations.every((o) => o.visit_id === visit.visitId));
  console.log("rows written:", visit.observations.map((o) => o.kind).join(", "));
  console.log("flag spawned a linked action:",
    visit.actions.length === 1 && visit.actions[0].observation_id === visit.observations[2].id);
  console.log("timeline clusters into", line.length, "visit(s), newest first");
  console.log("size chart sees clean number:",
    line[0].entries.find((e) => e.kind === "size").amount);

  const brief = await sage.briefing("2026-07-15");
  console.log("briefing → in-bloom-now count:", brief.inBloomNow.length,
    "| open flags:", brief.recentFlags.length);

  const dump = await sage.exportJSON();
  console.log("exportJSON tables:", Object.keys(dump.data).length,
    "| observations exported:", dump.data.observations.length);

  const emptyMap = await sage.getMapData();
  console.log("map_data starts empty:", JSON.stringify(emptyMap) === "{}");

  const saved = await sage.saveMapData({ regions: [{ id: "LAWN#1", mat: "lawn" }] });
  const reloaded = await sage.getMapData();
  console.log("map_data round-trips:", reloaded.regions?.[0]?.id === "LAWN#1");
  console.log("map_data stays a singleton row:", saved.id === 1);
}


// UMD-ish footer: runs the demo under Node, exposes the API to the browser.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { createSAGE, MemoryBackend, newId };
  if (require.main === module) demo();
} else if (typeof window !== "undefined") {
  window.createSAGE = createSAGE;
  window.MemoryBackend = MemoryBackend;
}
