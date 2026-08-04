import pool from './config/db.js';

// Common explicit-language terms to flag for AdSense review purposes.
// Deliberately broad — false positives (e.g. a song genuinely titled with
// one of these words) get manually triaged below, not auto-removed.
const TERMS = [
  'fuck', 'f\\*\\*\\*', 'f\\*\\*king', 'shit', 'pussy', 'bitch', 'nigga', 'nigger',
  'dick', 'cock', 'cunt', 'motherfuck', 'asshole', 'whore', 'slut',
];

const pattern = TERMS.map(t => `content ~* '${t}'`).join(' OR ');

const run = async () => {
  const result = await pool.query(
    `SELECT id, title, author, category, tags, created_at, content
     FROM articles
     WHERE ${pattern}
     ORDER BY id`
  );

  console.log(`Found ${result.rows.length} article(s) with flagged language:\n`);

  for (const row of result.rows) {
    console.log('='.repeat(70));
    console.log(`#${row.id} [${row.category}] "${row.title}" — ${row.author} — ${row.created_at.toISOString().slice(0,10)}`);
    if (row.tags?.length) console.log(`tags: ${row.tags.join(', ')}`);

    // Print each flagged term with surrounding context
    for (const term of TERMS) {
      const re = new RegExp(term.replace(/\\\*/g, '\\*'), 'gi');
      let m;
      while ((m = re.exec(row.content)) !== null) {
        const start = Math.max(0, m.index - 60);
        const end = Math.min(row.content.length, m.index + m[0].length + 60);
        console.log(`  ...${row.content.slice(start, end).replace(/\n/g, ' ')}...`);
      }
    }
    console.log('');
  }

  process.exit(0);
};

run().catch(err => { console.error('Error:', err.message); process.exit(1); });
