// Cloudinary -> Cloud808 database cutover tool.
//
// Dry-run by default. Nothing in the database is touched unless --execute
// is passed. Every planned update is guarded by an exact match on the
// CURRENT value of that exact cell (re-checked live, immediately before
// writing) -- if the cell has changed since the plan was built, that row
// is skipped rather than overwritten.
//
// Usage:
//   node scripts/cloud808-db-cutover.js                 # dry-run (default)
//   node scripts/cloud808-db-cutover.js --execute        # real update, transactional
//   node scripts/cloud808-db-cutover.js --rollback <backup.json>            # dry-run rollback
//   node scripts/cloud808-db-cutover.js --rollback <backup.json> --execute  # real rollback
//
// Never logs DATABASE_URL or any other secret -- only table/record/column/URLs.

import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLOUD808_MIGRATION_DIR = path.resolve(__dirname, '../../Cloud808/migration/generated');
const MANIFEST_PATH = path.join(CLOUD808_MIGRATION_DIR, 'manifest.csv');
const OLD_INVENTORY_PATH = path.join(CLOUD808_MIGRATION_DIR, 'db_media_refs.json');
const BACKUP_DIR = path.join(CLOUD808_MIGRATION_DIR, 'db-backups');

const args = process.argv.slice(2);
const EXECUTE = args.includes('--execute');
const BACKUP_ONLY = args.includes('--backup-only');
const rollbackIdx = args.indexOf('--rollback');
const ROLLBACK_FILE = rollbackIdx >= 0 ? args[rollbackIdx + 1] : null;

// Same table/column ownership map established during inventory (Phase 1-2).
// [table, primaryKeyColumn, mediaColumns]
const SOURCES = [
  ['articles', 'id', ['image_url', 'additional_image_1', 'additional_image_2', 'additional_image_3', 'thumbnail_url']],
  ['koveralls_articles', 'id', ['image_url', 'thumbnail_url']],
  ['overalls', 'id', ['image_url']],
  ['artists', 'id', ['profile_image_url', 'gallery_image_1', 'gallery_image_2', 'gallery_image_3']],
  ['music_submissions', 'id', ['image_url', 'document_url']],
  ['referral_ads', 'id', ['image_url']],
  ['newsletter_sends', 'id', ['image_url']],
  ['settings', 'id', ['beatport_banner_image_url']],
  ['spotify_embeds', 'id', ['cover_image_url']],
  ['amazon_products', 'id', ['image_url']],
];

function parseCsvLine(line) {
  const out = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

function loadManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(`Manifest not found at ${MANIFEST_PATH}. Copy the final production manifest first.`);
  }
  const raw = fs.readFileSync(MANIFEST_PATH, 'utf8').replace(/^﻿/, '');
  const lines = raw.split(/\r\n|\n/).filter(l => l.length > 0);
  const header = parseCsvLine(lines[0]);
  const expected = ['source_url', 'cloudinary_public_id', 'classification', 'target_bucket', 'target_key', 'target_public_url', 'source_bytes', 'status', 'verification_status', 'notes'];
  if (JSON.stringify(header) !== JSON.stringify(expected)) {
    throw new Error(`Manifest header does not match the expected schema.\nExpected: ${expected.join(',')}\nGot:      ${header.join(',')}`);
  }
  return lines.slice(1).map(line => {
    const fields = parseCsvLine(line);
    const obj = {};
    header.forEach((h, i) => { obj[h] = fields[i]; });
    return obj;
  });
}

function loadOldInventory() {
  if (!fs.existsSync(OLD_INVENTORY_PATH)) return null;
  const refs = JSON.parse(fs.readFileSync(OLD_INVENTORY_PATH, 'utf8'));
  const byCell = new Map();
  for (const r of refs) byCell.set(`${r.table}#${r.record_id}#${r.column}`, r.url);
  return byCell;
}

function isCloud808Url(url) {
  return url.includes('media.cry808.com') || url.includes('media.2koveralls.com');
}

async function buildPlan(pool) {
  const manifestRows = loadManifest();

  const badManifestRows = manifestRows.filter(r => r.status !== 'success' || r.verification_status !== 'verified');
  if (badManifestRows.length > 0) {
    throw new Error(`Manifest is not fully success+verified: ${badManifestRows.length} row(s) fail that check. Aborting -- refusing to build a plan from an incomplete manifest.`);
  }

  const byUrl = new Map();
  for (const r of manifestRows) {
    if (byUrl.has(r.source_url)) {
      throw new Error(`Manifest has a duplicate source_url, which should never happen (one row per physical asset): ${r.source_url}`);
    }
    byUrl.set(r.source_url, r);
  }

  const oldInventory = loadOldInventory();

  const cells = [];
  for (const [table, pk, cols] of SOURCES) {
    const selectCols = [pk, ...cols];
    const res = await pool.query(`SELECT ${selectCols.join(', ')} FROM ${table}`);
    for (const row of res.rows) {
      for (const col of cols) {
        cells.push({ table, record_id: String(row[pk]), column: col, current_value: row[col] });
      }
    }
  }

  const plan = [];
  const alreadyCloud808 = [];
  const nullEmpty = [];
  const unmatched = [];
  const missingTarget = [];
  let staleCount = 0;

  for (const cell of cells) {
    const v = cell.current_value;
    const cellKey = `${cell.table}#${cell.record_id}#${cell.column}`;
    const oldValue = oldInventory ? oldInventory.get(cellKey) : undefined;
    const isStale = oldValue !== undefined && oldValue !== v;
    if (isStale) staleCount++;

    if (!v || String(v).trim() === '') { nullEmpty.push(cell); continue; }
    if (isCloud808Url(v)) { alreadyCloud808.push(cell); continue; }

    const manifestRow = byUrl.get(v);
    if (!manifestRow) { unmatched.push({ ...cell, stale: isStale }); continue; }
    if (!manifestRow.target_public_url || manifestRow.target_public_url.trim() === '') {
      missingTarget.push({ ...cell, manifestRow });
      continue;
    }

    plan.push({
      table: cell.table,
      record_id: cell.record_id,
      column: cell.column,
      old_url: v,
      new_url: manifestRow.target_public_url,
      classification: manifestRow.classification,
      target_bucket: manifestRow.target_bucket,
      cloudinary_public_id: manifestRow.cloudinary_public_id,
      stale: isStale,
    });
  }

  return { plan, alreadyCloud808, nullEmpty, unmatched, missingTarget, staleCount, totalCellsScanned: cells.length, manifestRowCount: manifestRows.length };
}

function printDryRunReport({ plan, alreadyCloud808, nullEmpty, unmatched, missingTarget, staleCount, totalCellsScanned, manifestRowCount }) {
  console.log('=== CLOUD808 DB CUTOVER -- DRY-RUN REPORT ===');
  console.log('Manifest rows (all success+verified):', manifestRowCount);
  console.log('Total DB cells scanned (across all media columns):', totalCellsScanned);
  console.log('');
  console.log('PLANNED UPDATES:', plan.length);

  const byTable = {};
  const bySite = {};
  for (const p of plan) {
    byTable[p.table] = (byTable[p.table] || 0) + 1;
    const site = p.target_bucket === 'cry808' ? 'cry808' : '2koveralls';
    bySite[site] = (bySite[site] || 0) + 1;
  }
  console.log('  By table:', byTable);
  console.log('  By target bucket:', bySite);

  const sharedPlanned = plan.filter(p => p.classification === 'shared');
  console.log('  Shared (amazon_products) rows planned:', sharedPlanned.length);
  for (const s of sharedPlanned) console.log(`    - ${s.table}#${s.record_id}.${s.column} -> ${s.new_url}`);

  const distinctRecords = new Set(plan.map(p => `${p.table}#${p.record_id}`));
  console.log('  Distinct records affected:', distinctRecords.size);

  const staleInPlan = plan.filter(p => p.stale).length;
  console.log('');
  console.log('Already-Cloud808 (skipped, no change needed):', alreadyCloud808.length);
  console.log('Null/empty (skipped):', nullEmpty.length);
  console.log('Unmatched (non-null, not in manifest -- e.g. external hotlinks or truly unresolved):', unmatched.length);
  for (const u of unmatched.slice(0, 10)) {
    console.log(`    - ${u.table}#${u.record_id}.${u.column} = ${u.current_value}${u.stale ? '  [STALE vs original inventory]' : ''}`);
  }
  if (unmatched.length > 10) console.log(`    ... and ${unmatched.length - 10} more`);
  console.log('Manifest row matched but missing target_public_url (skipped, would need investigation):', missingTarget.length);
  console.log('');
  console.log('Stale cells overall (current DB value differs from original inventory snapshot):', staleCount);
  console.log('Stale cells that are still part of the plan (value changed but still matches a manifest URL):', staleInPlan);

  let totalDupSourceCheck = 0;
  const urlCounts = {};
  for (const p of plan) urlCounts[p.old_url] = (urlCounts[p.old_url] || 0) + 1;
  for (const c of Object.values(urlCounts)) if (c > 1) totalDupSourceCheck++;
  console.log('');
  console.log('Distinct old URLs in plan referenced by >1 DB cell (shared-reference handling):', totalDupSourceCheck);
  for (const [url, c] of Object.entries(urlCounts)) {
    if (c > 1) {
      const refs = plan.filter(p => p.old_url === url).map(p => `${p.table}#${p.record_id}.${p.column}`);
      console.log(`    - ${url} -> referenced by ${c} cells: ${refs.join(', ')}`);
    }
  }
}

async function writeBackup(plan) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(BACKUP_DIR, `backup-${ts}.json`);
  const backupData = plan.map(p => ({
    table: p.table,
    record_id: p.record_id,
    column: p.column,
    original_url: p.old_url,
    new_url: p.new_url,
  }));
  fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2));
  return backupPath;
}

async function runExecute(pool, plan) {
  const backupPath = await writeBackup(plan);
  console.log('Backup written before executing:', backupPath);

  const client = await pool.connect();
  const results = { updated: 0, skippedChanged: 0, failed: 0 };
  try {
    await client.query('BEGIN');
    for (const p of plan) {
      const res = await client.query(
        `UPDATE ${p.table} SET ${p.column} = $1 WHERE id = $2 AND ${p.column} = $3`,
        [p.new_url, p.record_id, p.old_url]
      );
      if (res.rowCount === 1) {
        results.updated++;
      } else {
        results.skippedChanged++;
        console.warn(`SKIPPED (value changed since plan was built): ${p.table}#${p.record_id}.${p.column}`);
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Transaction rolled back due to error:', err.message);
    throw err;
  } finally {
    client.release();
  }
  console.log('Execute complete:', results);
  console.log('Backup for rollback:', backupPath);
}

async function runRollback(pool, backupFile, execute) {
  if (!fs.existsSync(backupFile)) throw new Error(`Backup file not found: ${backupFile}`);
  const rows = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
  console.log(`=== ROLLBACK ${execute ? '(EXECUTE)' : '(DRY-RUN)'} -- ${rows.length} rows from ${backupFile} ===`);

  if (!execute) {
    for (const r of rows) {
      console.log(`  would restore ${r.table}#${r.record_id}.${r.column}: ${r.new_url} -> ${r.original_url}`);
    }
    return;
  }

  const client = await pool.connect();
  const results = { restored: 0, skippedChanged: 0 };
  try {
    await client.query('BEGIN');
    for (const r of rows) {
      const res = await client.query(
        `UPDATE ${r.table} SET ${r.column} = $1 WHERE id = $2 AND ${r.column} = $3`,
        [r.original_url, r.record_id, r.new_url]
      );
      if (res.rowCount === 1) results.restored++;
      else { results.skippedChanged++; console.warn(`SKIPPED (value no longer matches expected post-migration URL): ${r.table}#${r.record_id}.${r.column}`); }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Rollback transaction aborted:', err.message);
    throw err;
  } finally {
    client.release();
  }
  console.log('Rollback complete:', results);
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });
  try {
    if (ROLLBACK_FILE) {
      await runRollback(pool, ROLLBACK_FILE, EXECUTE);
      return;
    }

    const report = await buildPlan(pool);
    printDryRunReport(report);

    if (BACKUP_ONLY) {
      const backupPath = await writeBackup(report.plan);
      console.log('\nBackup-only mode: wrote pre-cutover backup (read-only, no DB changes):', backupPath);
      return;
    }

    if (!EXECUTE) {
      console.log('\nDry-run only -- no database changes made. Pass --execute to apply.');
      return;
    }

    await runExecute(pool, report.plan);
  } finally {
    await pool.end();
  }
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
