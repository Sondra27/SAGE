// ============================================================================
// SAGE — supabase.js  (the cloud backend + client)
// ----------------------------------------------------------------------------
// Loaded ONLY when supabase-config.js has real creds — imported dynamically by
// app.js, which is why opening index.html on the in-memory backend still needs
// no server.
//
// SupabaseBackend implements the SAME five methods as MemoryBackend in data.js
// (insert / update / select / dump / load). That's the swap seam: data.js and
// every view are unchanged; they never know which backend they're holding.
//
// select() honours the contract literally — MemoryBackend's `select` takes a JS
// predicate, so here we read the whole table and filter in JS. At one-yard scale
// that's correct and simple; RLS still gates every read. (If a table ever grew
// huge, that single method is the place to push a filter down to Postgres.)
// ============================================================================

// Every table keys on `id` except weather (natural key `date`) and
// taxon_pairings (primary key is the pair taxon_a + taxon_b).
const KEY_COLUMN = { weather: "date", taxon_pairings: "taxon_a" };

export function SupabaseBackend(client) {
  const TABLES = [
    "taxa", "zones", "individuals", "observations", "sightings",
    "weather", "conditions", "actions", "photos", "absences", "map_data",
    "taxon_colours", "taxon_pairings",   // 2026-09-25: species colours + pairings
  ];
  const keyOf = (t) => KEY_COLUMN[t] || "id";

  async function selectAll(table) {
    const { data, error } = await client.from(table).select("*");
    if (error) throw new Error("select " + table + ": " + error.message);
    return data || [];
  }

  return {
    async insert(table, row) {
      // weather's natural PK is `date`, so its insert is really an upsert. This
      // is the fix for putWeather's update-by-undefined-id path — no data.js
      // change needed; the backend makes weather idempotent on date.
      const q = (table === "weather")
        ? client.from(table).upsert(row, { onConflict: "date" }).select()
        : client.from(table).insert(row).select();
      const { data, error } = await q;
      if (error) throw new Error("insert " + table + ": " + error.message);
      return Array.isArray(data) ? data[0] : data;
    },

    async update(table, id, patch) {
      if (id == null) return null; // guards putWeather's update(undefined) branch
      const { data, error } = await client.from(table).update(patch).eq("id", id).select();
      if (error) throw new Error("update " + table + ": " + error.message);
      return data && data.length ? data[0] : null;
    },

    async select(table, predicate) {
      const rows = await selectAll(table);        // whole-table read…
      return predicate ? rows.filter(predicate) : rows;  // …predicate applied in JS
    },

    async dump() {
      const out = {};
      for (const t of TABLES) out[t] = await selectAll(t);
      return out;
    },

    async load(data) {
      // Restore: clear every table (children first for FK safety), then insert
      // (parents first). UUIDs carry all links, so nothing is remapped.
      // taxon_colours / taxon_pairings point at taxa, so they clear before it and
      // restore after it. Parent links WITHIN taxa (parent_id) are a deferred FK,
      // so taxa clears and restores in one statement each, in any row order.
      // A backup made before a table existed simply has no key for it: `|| []`
      // below restores it as empty.
      const childFirst = [
        "taxon_colours", "taxon_pairings",
        "photos", "actions", "observations", "sightings", "conditions",
        "absences", "weather", "individuals", "zones", "taxa",
      ];
      for (const t of childFirst) {
        // "delete every row": the key column is a primary key, so never null.
        // (Was .neq(key, "__sage_never__"), which Postgres rejects on uuid/date
        // columns: the literal isn't a valid uuid or date.)
        const { error } = await client.from(t).delete().not(keyOf(t), "is", null);
        if (error) throw new Error("clear " + t + ": " + error.message);
      }
      for (const t of [...childFirst].reverse()) {
        const rows = data[t] || [];
        if (!rows.length) continue;
        const { error } = await client.from(t).insert(rows);
        if (error) throw new Error("restore " + t + ": " + error.message);
      }

      // map_data is a singleton (int id, always 1) — restore it as an upsert
      // rather than folding it into the delete-all/reinsert loop above, which
      // is built around uuid PKs and a child->parent FK chain map_data has no
      // part in.
      const mapRows = data.map_data || [];
      if (mapRows.length) {
        const { error } = await client.from("map_data").upsert(mapRows, { onConflict: "id" });
        if (error) throw new Error("restore map_data: " + error.message);
      }
    },
  };
}

// Create a real Supabase client. The supabase-js import is DYNAMIC so it only
// loads when creds exist (and you're serving over http, not file://).
export async function makeClient(url, anonKey) {
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
  return createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
}
