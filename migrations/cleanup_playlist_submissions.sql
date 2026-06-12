-- cleanup_playlist_submissions.sql
-- One-time cleanup for playlist_submissions rows imported before
-- the importer learned to strip embedded Spotify URLs.
--
-- What this fixes:
--   1. track  like "OHVA [https://open.spotify.com/track/...]"
--      → track  = "OHVA",  spotify_url = the extracted URL
--   2. artist like "RAAD [https://open.spotify.com/track/...]"
--      → artist = "RAAD",  spotify_url = the extracted URL
-- Existing spotify_url values are NOT overwritten (COALESCE keeps them).

-- ── Step 1: URLs embedded in track field ──────────────────────────────────────
UPDATE playlist_submissions
SET
  spotify_url = COALESCE(
    spotify_url,
    (regexp_match(track, 'https://open\.spotify\.com/track/[^\]\s]+'))[1]
  ),
  track = TRIM(regexp_replace(track, '\s*\[https://open\.spotify\.com/track/[^\]]*\]', '', 'g'))
WHERE track ~ 'https://open\.spotify\.com/track/';

-- ── Step 2: URLs embedded in artist field ─────────────────────────────────────
UPDATE playlist_submissions
SET
  spotify_url = COALESCE(
    spotify_url,
    (regexp_match(artist, 'https://open\.spotify\.com/track/[^\]\s]+'))[1]
  ),
  artist = TRIM(regexp_replace(artist, '\s*\[https://open\.spotify\.com/track/[^\]]*\]', '', 'g'))
WHERE artist ~ 'https://open\.spotify\.com/track/';

-- ── Verify ────────────────────────────────────────────────────────────────────
SELECT id, artist, track, spotify_url
FROM   playlist_submissions
WHERE  spotify_url IS NOT NULL
ORDER  BY id;
