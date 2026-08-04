import pool from './config/db.js';

const APPLY = process.argv.includes('--apply');

// Word stems to censor. \w* after the stem catches suffixes (fucking, shitty,
// niggas, etc). Word-boundary anchoring means these will NOT match inside a
// larger token like "cuteniggasupreme" (no boundary between "cute" and "nigg").
const STEMS = [
  'motherfuck', 'fuck', 'bullshit', 'shit', 'bitch', 'pussy', 'nigg',
  'dick', 'cock', 'cunt', 'assh', 'whore', 'slut',
];

const WORD_RE = new RegExp(`\\b(${STEMS.join('|')})(\\w*)\\b`, 'gi');

// Innocent words that happen to start with one of the stems above.
const SAFE_WORDS = new Set([
  'cocktail', 'cocktails', 'cockpit', 'cockpits', 'cockroach', 'cockroaches',
  'cockney', 'shittake', // shiitake misspelling, just in case
]);

function censorWord(word) {
  if (word.length <= 2) return '*'.repeat(word.length);
  return word[0] + '*'.repeat(word.length - 2) + word[word.length - 1];
}

function censorText(text) {
  return text.replace(WORD_RE, (match) => {
    if (SAFE_WORDS.has(match.toLowerCase())) return match;
    return censorWord(match);
  });
}

const IDS = [84, 86, 110, 113, 130, 141, 187, 214, 236, 239, 256, 267, 273,
             277, 286, 294, 297, 304, 312, 314, 316];

const run = async () => {
  const result = await pool.query(
    'SELECT id, title, content FROM articles WHERE id = ANY($1::int[]) ORDER BY id',
    [IDS]
  );

  let changedCount = 0;

  for (const row of result.rows) {
    const newTitle = censorText(row.title);
    const newContent = censorText(row.content);

    if (newTitle === row.title && newContent === row.content) continue;
    changedCount++;

    console.log('='.repeat(70));
    console.log(`#${row.id}`);
    if (newTitle !== row.title) {
      console.log(`  title: "${row.title}"`);
      console.log(`      -> "${newTitle}"`);
    }
    if (newContent !== row.content) {
      // Show only the changed words in context, not the whole article
      const matches = [...row.content.matchAll(WORD_RE)];
      for (const m of matches) {
        const start = Math.max(0, m.index - 30);
        const end = Math.min(row.content.length, m.index + m[0].length + 30);
        const before = row.content.slice(start, end).replace(/\n/g, ' ');
        const after = censorText(row.content.slice(start, end)).replace(/\n/g, ' ');
        console.log(`  ...${before}...`);
        console.log(`   -> ...${after}...`);
      }
    }

    if (APPLY) {
      await pool.query(
        'UPDATE articles SET title = $1, content = $2, updated_at = NOW() WHERE id = $3',
        [newTitle, newContent, row.id]
      );
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log(APPLY
    ? `Applied censoring to ${changedCount} article(s).`
    : `DRY RUN — ${changedCount} article(s) would change. Re-run with --apply to write to the DB.`);

  process.exit(0);
};

run().catch(err => { console.error('Error:', err.message); process.exit(1); });
