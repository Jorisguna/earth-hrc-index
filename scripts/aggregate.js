// aggregate.js — Phase 4 H3 res-10 aggregation for the 30 m OpenET tier.
// HRC 30 m US test sites (docs/HRC_30m_test_sites_usa_implementation_plan_v1_0.md
// §4 Phase 4, docs/HRC_30m_test_sites_usa_d2_decision_v1_0.md).
//
// WHY THIS STEP EXISTS
// ---------------------------------------------------------------------------
// src/App.jsx snaps every fetched tile to an H3 cell client-side and keeps
// only the first row seen per cell (dedup, not aggregation) — see the
// `seen`/`hexTiles` logic around the fetchTilesForViewport callback. For the
// 500 m/9 km tiers that's a near no-op: one raw tile ≈ one H3 cell at the
// resolution used for that tier. It is NOT a no-op for the 30 m tier: an H3
// res-10 cell (~15,000 m²) covers roughly 16 of our 900 m² (30 m) pixels, and
// the 100 m-radius footprint clusters around US-Ne1/US-Ne2 are dense enough
// that multiple raw pixels really do land in the same cell. Left to the
// client, that means silently discarding most of the imported rows with no
// averaging and no disclosure — exactly the kind of silent data loss this
// project's whole D-G/Q1/Track-B history exists to prevent.
//
// This script replaces the raw 30 m pixel rows for region_code='mead_ne'
// with one true hex-level row per H3 res-10 cell: numeric fields are
// arithmetic-meaned (pixels are equal-area, so this is also the area-
// weighted mean); months_masked/months_capped take the MAX across the
// group, never averaged away — the same worst-case-discloses-first
// principle migration 009's quality_state priority (capped > month_masked
// > ok) already uses per-tile, applied here per-hex.
//
// PROVENANCE: before touching the database, this script also writes
// public/mead_ne_pixel_provenance.json — the 93 raw pixel rows, tagged with
// the H3 cell they fed. Same pattern as public/idf_reference_centroids.json
// (script 38): when a computed value collapses raw samples together, the
// raw samples stay inspectable. This file is written every run regardless
// of --apply, so it's always available for the P5 provenance overlay even
// before that UI work starts.
//
// SAFETY: dry-run by default — fetches, groups, prints a summary, writes the
// provenance JSON, but makes NO database changes. Pass --apply to actually
// DELETE the raw rows for region_code='mead_ne' and INSERT the aggregated
// hex rows, mirroring the DELETE-then-reimport pattern already documented
// in import.py and used elsewhere in this project (assam_full_reimport.sql,
// sfbay_full_reimport.sql, etc.) rather than inventing a new one.
//
// Usage:
//   node scripts/aggregate.js            # dry run — prints summary only
//   node scripts/aggregate.js --apply    # writes to Supabase for real
//
// Verify afterward with the queries at the bottom of
// scripts/migrations/009_openet_30m_tier.sql (region_code='mead_ne').

import { createClient } from '@supabase/supabase-js'
import { latLngToCell, cellToLatLng } from 'h3-js'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

process.loadEnvFile(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env'))

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY in .env')
  process.exit(1)
}
const sb = createClient(url, key)

const REGION_CODE = 'mead_ne'
const H3_RES = 10
const AGG_BATCH_ID = '2026-Q3-30m-mead-ne1-ne2-h3res10-agg'
const APPLY = process.argv.includes('--apply')

// Fields carried through unchanged from the raw rows — must be identical
// across every row in a hex's group (same import batch); asserted, not
// assumed. batch_id is deliberately NOT in this list — the aggregated rows
// get their own AGG_BATCH_ID so the raw-import batch and the aggregation
// batch stay distinguishable in the data.
const PASSTHROUGH_FIELDS = [
  'net_rad_denominator', 'openet_member_spread', 'temporal_qualifier',
  'region_code', 'data_source', 'data_resolution_m', 'source_window',
  'lst_source', 'methodology_version', 'hrc_formula', 'computation_window',
  'hrc_window_start', 'hrc_window_end',
]

function mean(nums) {
  const vals = nums.filter(n => n !== null && n !== undefined)
  if (!vals.length) return null
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

function maxOrNull(nums) {
  const vals = nums.filter(n => n !== null && n !== undefined)
  if (!vals.length) return null
  return Math.max(...vals)
}

function qualityStateFor(monthsCapped, monthsMasked) {
  if (monthsCapped && monthsCapped > 0) return 'capped'
  if (monthsMasked && monthsMasked > 0) return 'month_masked'
  return 'ok'
}

function aggregateGroup(h3Index, rows) {
  const [lat, lon] = cellToLatLng(h3Index)

  for (const field of PASSTHROUGH_FIELDS) {
    const distinct = new Set(rows.map(r => r[field]))
    if (distinct.size > 1) {
      throw new Error(
        `H3 cell ${h3Index}: rows disagree on '${field}' (${[...distinct]}) — ` +
        `refusing to silently pick one. Check the source data.`
      )
    }
  }

  const monthsMasked = maxOrNull(rows.map(r => r.months_masked))
  const monthsCapped = maxOrNull(rows.map(r => r.months_capped))

  return {
    longitude: lon,
    latitude: lat,
    hrc_score: round(mean(rows.map(r => r.hrc_score)), 4),
    hrc_raw_ratio: round(mean(rows.map(r => r.hrc_raw_ratio)), 4),
    ef_annual: round(mean(rows.map(r => r.ef_annual)), 6),
    annual_mean_le_wm2: round(mean(rows.map(r => r.annual_mean_le_wm2)), 4),
    months_masked: monthsMasked,
    months_capped: monthsCapped,
    quality_state: qualityStateFor(monthsCapped, monthsMasked),
    batch_id: AGG_BATCH_ID,
    ...Object.fromEntries(PASSTHROUGH_FIELDS.map(f => [f, rows[0][f]])),
    _pixel_count: rows.length,      // dropped before insert — summary/provenance use only
    _h3Index: h3Index,              // dropped before insert
  }
}

function round(n, dp) {
  if (n === null || n === undefined) return null
  const f = 10 ** dp
  return Math.round(n * f) / f
}

async function main() {
  console.log(`Fetching region_code='${REGION_CODE}' rows from hrc_tiles...`)
  const { data: rows, error } = await sb.from('hrc_tiles').select('*').eq('region_code', REGION_CODE)
  if (error) {
    console.error('Fetch failed:', error)
    process.exit(1)
  }
  console.log(`Loaded ${rows.length} raw rows.\n`)

  if (rows.length === 0) {
    console.log('Nothing to aggregate — has import.py been run yet?')
    return
  }

  // Group by H3 res-10 cell.
  const groups = new Map()
  for (const row of rows) {
    const h3Index = latLngToCell(row.latitude, row.longitude, H3_RES)
    if (!groups.has(h3Index)) groups.set(h3Index, [])
    groups.get(h3Index).push(row)
  }

  const aggregated = [...groups.entries()].map(([h3Index, group]) => aggregateGroup(h3Index, group))

  // ── Summary ──────────────────────────────────────────────────────────
  const counts = aggregated.map(a => a._pixel_count).sort((a, b) => a - b)
  console.log(`Grouped into ${aggregated.length} H3 res-${H3_RES} cells from ${rows.length} pixels.`)
  console.log(`Pixels per cell: min=${counts[0]}, median=${counts[Math.floor(counts.length / 2)]}, max=${counts[counts.length - 1]}`)
  console.log(`Cells with only 1 contributing pixel: ${counts.filter(c => c === 1).length} of ${aggregated.length}`)
  const qualityCounts = aggregated.reduce((acc, a) => {
    acc[a.quality_state] = (acc[a.quality_state] || 0) + 1
    return acc
  }, {})
  console.log(`quality_state across hexes: ${JSON.stringify(qualityCounts)}`)
  const outOfRange = aggregated.filter(a => a.hrc_score !== null && (a.hrc_score < 0 || a.hrc_score > 10))
  if (outOfRange.length) {
    console.log(`WARNING: ${outOfRange.length} aggregated hrc_score values out of [0,10] — investigate before applying.`)
  } else {
    console.log('hrc_score bounds: all aggregated cells within [0, 10].')
  }
  console.log()

  // ── Provenance export (always written, dry run or not) ────────────────
  const provenance = rows.map(r => {
    const h3Index = latLngToCell(r.latitude, r.longitude, H3_RES)
    return {
      longitude: r.longitude,
      latitude: r.latitude,
      h3_cell: h3Index,
      hrc_score: r.hrc_score,
      hrc_raw_ratio: r.hrc_raw_ratio,
      ef_annual: r.ef_annual,
      annual_mean_le_wm2: r.annual_mean_le_wm2,
      months_masked: r.months_masked,
      months_capped: r.months_capped,
      quality_state: r.quality_state,
    }
  })
  const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public')
  const provenancePath = path.join(publicDir, 'mead_ne_pixel_provenance.json')
  await writeFile(provenancePath, JSON.stringify(provenance, null, 2))
  console.log(`Wrote ${provenance.length} raw pixel rows to public/mead_ne_pixel_provenance.json`)
  console.log('(source data for a future P5 provenance overlay — same pattern as idf_reference_centroids.json)\n')

  if (!APPLY) {
    console.log('Dry run only — no database changes made. Re-run with --apply to write the aggregated hexes.')
    return
  }

  // ── Apply: replace raw pixel rows with aggregated hex rows ─────────────
  console.log(`Deleting ${rows.length} raw rows for region_code='${REGION_CODE}'...`)
  const { error: delError } = await sb.from('hrc_tiles').delete().eq('region_code', REGION_CODE)
  if (delError) {
    console.error('Delete failed — aborting before insert:', delError)
    process.exit(1)
  }

  const insertRows = aggregated.map(({ _pixel_count, _h3Index, ...row }) => row)
  console.log(`Inserting ${insertRows.length} aggregated hex rows...`)
  const { data: inserted, error: insError } = await sb.from('hrc_tiles').insert(insertRows).select()
  if (insError) {
    console.error('Insert failed:', insError)
    console.error(`hrc_tiles now has ZERO '${REGION_CODE}' rows — re-run import.py then this script to recover.`)
    process.exit(1)
  }
  console.log(`Inserted ${inserted.length} rows.\n`)
  console.log('Next step: run the verification queries at the bottom of')
  console.log('scripts/migrations/009_openet_30m_tier.sql in Supabase (region_code=\'mead_ne\').')
}

main()
