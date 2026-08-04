import pool from './config/db.js';

const HANDLE = 'cuteniggasupreme';
const CENSORED_HANDLE = 'cute*****supreme'; // censor just the slur portion

const run = async () => {
  const { rows } = await pool.query('SELECT title, content FROM articles WHERE id = 214');
  const row = rows[0];

  const newTitle = row.title.replaceAll(`@${HANDLE}`, `@${CENSORED_HANDLE}`);

  let newContent = row.content
    .replaceAll(`## Artist to Watch: Pink Molli (@${HANDLE})`, `## Artist to Watch: Pink Molli (@${CENSORED_HANDLE})`)
    .replaceAll(`aka @${HANDLE},`, `aka @${CENSORED_HANDLE},`)
    .replaceAll(
      `Follow @${HANDLE}: https://www.instagram.com/${HANDLE}/`,
      `Follow [@${CENSORED_HANDLE}](https://www.instagram.com/${HANDLE}/)`
    );

  console.log('--- TITLE ---');
  console.log('before:', row.title);
  console.log('after: ', newTitle);
  console.log('\n--- CONTENT ---');
  console.log('before:\n' + row.content);
  console.log('\nafter:\n' + newContent);

  if (newContent === row.content && newTitle === row.title) {
    console.log('\nNo changes matched — aborting, nothing written.');
    process.exit(1);
  }

  await pool.query('UPDATE articles SET title = $1, content = $2, updated_at = NOW() WHERE id = 214', [newTitle, newContent]);
  console.log('\nApplied.');
  process.exit(0);
};

run().catch(err => { console.error('Error:', err.message); process.exit(1); });
