import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const articleContent = `# How To Mix Rap Vocals Like A Pro (2025)

The difference between an amateur recording and a professional-sounding track often comes down to one thing: **vocal mixing**. You can have the best lyrics, tightest flow, and hardest beat—but if your vocals aren't mixed properly, your track won't compete with professional releases.

This comprehensive guide teaches you exactly **how to mix rap vocals like a pro**, using techniques employed by top mixing engineers in hip hop. Whether you're mixing your own vocals at home or learning to engineer for others, these strategies will transform your sound.

## Understanding Vocal Mixing Fundamentals

### What Is Vocal Mixing?

Vocal mixing is the process of:

- **Balancing levels**: Making vocals sit perfectly with the beat
- **Cleaning up recordings**: Removing unwanted noise and frequencies
- **Adding effects**: Compression, EQ, reverb, and more
- **Creating space**: Using panning, depth, and stereo width
- **Achieving clarity**: Ensuring every word is intelligible
- **Capturing vibe**: Maintaining the emotional impact of the performance

The goal isn't just technical perfection—it's creating a polished sound that enhances the artistic vision.

### The Mixing Mindset

Before touching a single plugin, understand:

**You can't fix a bad recording**: Mixing enhances quality recordings, but can't save terrible performances. If the vocals sound bad raw, re-record them.

**Reference constantly**: Compare your mix to professional tracks in the same genre. Your ears adapt to your own mix—references keep you objective.

**Less is more**: Beginner mixers over-process. Professionals use fewer plugins with more precision.

**Context matters**: Vocals should sound great with the beat, not necessarily in solo. Always mix with the instrumental playing.

### The Pro Vocal Chain Order

Signal flow matters. Here's the standard order:

1. **Gain staging** (setting proper input levels)
2. **Subtractive EQ** (removing problem frequencies)
3. **De-essing** (taming harsh sibilance)
4. **Compression** (controlling dynamics)
5. **Additive EQ** (enhancing good frequencies)
6. **Saturation** (adding warmth and character)
7. **Spatial effects** (reverb, delay on sends)
8. **Final limiting** (catching peaks)

This order isn't absolute, but it's a proven starting point.

## Step 1: Preparation and Gain Staging

### Clean Up Your Recordings First

Before any processing:

**Remove unwanted noise:**
- **Strip silence**: Delete audio between vocal phrases
- **Fade in/out**: Add short fades to prevent clicks
- **Remove mouth clicks**: Zoom in and cut out lip smacks
- **Eliminate breaths** (or reduce volume): Loud breathing distracts listeners
- **Check for pops and clicks**: Fix or cut out digital artifacts

Most DAWs have noise reduction tools, but prevention (good recording technique) beats correction.

### Organize Your Vocal Tracks

Professional organization:

**Track naming:**
- Lead Vocal
- Lead Vocal Double
- Ad-libs Left
- Ad-libs Right
- Backing Vocals
- Hook Lead
- Hook Double

**Color coding:** Assign different colors to different vocal types for visual clarity.

**Group tracks:** Route similar vocals (all ad-libs, all doubles) to group buses for easier processing.

### Proper Gain Staging

Set levels correctly before adding plugins:

**Target levels:**
- **Input level**: Peaks around -10dB to -6dB (leave headroom)
- **Post-processing**: Vocals peak around -6dB to -3dB
- **Final output**: Use a limiter to prevent clipping above -0.3dB

**Why this matters:** Proper gain staging prevents distortion and gives plugins the signal level they're designed to process.

**How to gain stage:**
1. Turn down the fader or use a trim plugin at the start of your chain
2. Aim for peaks around -10dB on the raw vocal
3. Check levels after each plugin—don't let them get too hot

## Step 2: Subtractive EQ (Cleaning)

### Remove Problem Frequencies First

Before adding anything, remove what doesn't belong:

**High-pass filter (essential):**
- **Frequency**: 80-100Hz for male voices, 100-120Hz for female voices
- **Slope**: 12dB/octave or 18dB/octave
- **Purpose**: Removes low-end rumble, mic handling noise, room tone

**Cut muddy frequencies:**
- **Range**: 200-400Hz
- **How much**: 2-4dB reduction (narrow Q)
- **Listen for**: Boxiness, muddiness, lack of clarity

**Reduce harshness:**
- **Range**: 2kHz-4kHz (if vocals sound harsh)
- **How much**: 1-3dB reduction (medium Q)
- **Be careful**: This range also provides presence—don't over-cut

**Tame sibilance (if needed):**
- **Range**: 6kHz-8kHz
- **How much**: 2-3dB reduction (or use de-esser instead)
- **Purpose**: Softens harsh "S" and "T" sounds

### EQ Technique: Sweep and Destroy

**How to find problem frequencies:**
1. Boost an EQ band by 10-15dB (narrow Q)
2. Sweep through the frequency spectrum while listening
3. When you hear something unpleasant, you've found a problem frequency
4. Switch to a cut (reduce by 2-5dB)
5. Widen the Q slightly and adjust to taste

This technique helps you identify exactly what needs fixing.

### Common Frequency Issues

**Problem frequency guide:**
- **50-100Hz**: Rumble, low-end mud
- **200-400Hz**: Muddiness, boxiness
- **500-800Hz**: Honkiness, nasality
- **2-4kHz**: Harshness, ear fatigue
- **6-10kHz**: Sibilance, brittleness

Not every vocal needs every cut—use your ears, not just these numbers.

## Step 3: De-essing

### Controlling Sibilance

Sibilance (harsh "S," "SH," "T," "CH" sounds) can be piercing and distracting:

**What is a de-esser?**
A specialized compressor that only reduces volume when harsh frequencies exceed a threshold.

**De-esser settings:**
- **Frequency range**: 5kHz-8kHz (adjust to your voice)
- **Threshold**: Set so it catches "S" sounds without affecting everything
- **Reduction**: 3-6dB (don't over-process or vocals sound lispy)

**Listen carefully:** De-essing should be transparent. If you can hear it working, you've gone too far.

**Alternative method:** Use manual automation to turn down individual "S" sounds if de-esser sounds unnatural.

### Popular De-esser Plugins

**Free:**
- TDR Nova (dynamic EQ with de-essing capability)
- Lisp by Sleepy-Time DSP

**Paid:**
- FabFilter Pro-DS ($129)
- Waves Renaissance DeEsser ($29+)
- iZotope Nectar De-esser (part of suite)

## Step 4: Compression (Dynamics Control)

### Why Compress Rap Vocals?

Compression evens out the dynamic range:

- Makes quiet words louder (audibility)
- Tames loud peaks (prevents distortion)
- Adds punch and presence
- Glues the vocal to the beat

**Rap vocals need more compression** than singing because the dynamic range (whispers to shouts) is often extreme.

### Compression Settings for Rap Vocals

**Standard starting point:**
- **Ratio**: 4:1 to 8:1 (medium to heavy compression)
- **Attack**: 10-30ms (fast enough to catch transients)
- **Release**: 50-100ms (auto release works great)
- **Threshold**: Adjust until you see 4-8dB of gain reduction
- **Makeup gain**: Compensate for volume reduction

**Compression technique:** Aim for 5-10dB of gain reduction on the loudest parts. This might seem like a lot, but rap vocals can handle it.

### Parallel Compression (New York Style)

Advanced technique for aggressive, punchy vocals:

**How to set up:**
1. Duplicate your vocal track (or use a send)
2. Compress the duplicate HEAVILY (10:1 ratio, 10-15dB reduction)
3. Mix this compressed signal underneath the original (20-40% wet)

**Why it works:** You get the punch and power of heavy compression while maintaining the natural dynamics of the original.

### Serial Compression (Stacking Compressors)

Many pro engineers use 2-3 gentle compressors instead of one heavy one:

**Chain example:**
1. **First compressor**: 3:1 ratio, 3-4dB reduction (tames peaks)
2. **Second compressor**: 2:1 ratio, 2-3dB reduction (adds glue)

**Result:** More transparent, natural-sounding compression than one plugin doing all the work.

### Recommended Compressor Plugins

**Free:**
- TDR Kotelnikov (incredibly transparent)
- Rough Rider 3 (great for character)

**Paid:**
- Waves CLA-76 ($29+) - aggressive, colored
- FabFilter Pro-C 2 ($179) - versatile, transparent
- Universal Audio 1176 (UAD) - classic sound
- iZotope Nectar Compressor - vocal-specific

## Step 5: Additive EQ (Enhancement)

### Boosting the Good Frequencies

After cleaning up problems, enhance what sounds good:

**Presence boost (intelligibility):**
- **Range**: 3kHz-5kHz
- **How much**: 2-4dB (wide Q)
- **Purpose**: Makes vocals sit forward in the mix, improves clarity

**Air/brightness (optional):**
- **Range**: 10kHz-15kHz
- **How much**: 1-3dB (shelf or wide bell)
- **Purpose**: Adds sheen and polish (not always needed, especially for darker vocals)

**Warmth (optional):**
- **Range**: 200-500Hz
- **How much**: 1-2dB
- **Purpose**: Adds body to thin-sounding vocals

### EQ Philosophy

**Boost sparingly:** Cutting is usually more effective than boosting. If something sounds wrong, cut the problem rather than boosting everything else.

**A/B constantly:** Toggle your EQ on and off to ensure you're improving the sound, not just making it different.

**Use your ears, not your eyes:** Don't EQ visually—close your eyes and listen.

### The Telephone Test

Here's a mixing secret: Check your mix on terrible speakers (or phone speakers).

If you can still understand every word clearly, your EQ is working. Vocals should translate across all playback systems.

## Step 6: Saturation and Harmonic Excitement

### Adding Character and Warmth

Saturation subtly distorts the signal, adding harmonics and warmth:

**What it does:**
- Makes vocals sound fuller and richer
- Helps vocals cut through dense beats
- Adds analog warmth to digital recordings
- Creates cohesion and glue

**How much:** Very subtle—5-20% mix usually. You should barely notice it, but miss it when it's gone.

### Types of Saturation

**Tape saturation:** Warm, smooth, vintage (Waves J37, Slate VTM)
**Tube saturation:** Warm, harmonically rich (FabFilter Saturn, UAD Pultec)
**Transformer saturation:** Punchy, aggressive (Decapitator, Soundtoys Devil-Loc)

**Recommendation for rap:** Transformer or tape saturation for punch and presence.

### Free Saturation Plugins

- Softube Saturation Knob (free, simple)
- Klanghelm IVGI (free, great character)
- Camel Crusher (free, aggressive)

## Step 7: Reverb and Depth

### Creating Space Without Muddiness

Reverb adds dimension and polish:

**Reverb philosophy for rap:**
- Less is more (rap vocals should be upfront and dry)
- Use reverb on sends, not inserts (better control)
- Short reverbs work better than long (0.5-1.5 second decay)
- Filter reverb (cut lows below 200Hz to prevent muddiness)

### Reverb Settings for Rap Vocals

**Short plate reverb (most common):**
- **Type**: Plate
- **Decay time**: 0.8-1.2 seconds
- **Pre-delay**: 20-40ms (gives vocals space before reverb hits)
- **Mix**: 10-25% (use send for better control)
- **High-pass filter**: Cut below 200Hz
- **Low-pass filter**: Cut above 8kHz (optional, for darker reverb)

**Alternative:** Small room reverb for tighter, more intimate sound.

### Reverb on Different Vocal Elements

**Lead vocals**: Moderate reverb (15-20% wet)
**Doubles**: Less reverb than lead (10-15%)
**Ad-libs**: More reverb and delay (30-50% for creative effect)
**Hooks**: Sometimes more reverb for bigger sound (20-30%)

### Recommended Reverb Plugins

**Free:**
- Valhalla Supermassive (huge, creative)
- Dragonfly Room Reverb (natural)

**Paid:**
- Valhalla Room ($50 - best value)
- FabFilter Pro-R ($179 - most flexible)
- Waves H-Reverb ($29+)

## Step 8: Delay for Width and Interest

### Strategic Delay Usage

Delay creates rhythm, width, and interest:

**Types of delay for rap:**

**Slap delay (short):**
- **Time**: 60-120ms
- **Feedback**: 0-20% (just one or two repeats)
- **Purpose**: Adds thickness and perceived width
- **Mix**: 15-25% on send

**Eighth-note delay:**
- **Time**: Synced to tempo (1/8 note)
- **Feedback**: 30-50% (multiple repeats)
- **Purpose**: Creates rhythmic effect, common on ad-libs
- **Mix**: 20-40% on ad-libs, 10-20% on leads

**Ping-pong delay:**
- **Time**: 1/4 or 1/8 note
- **Panning**: Alternates left/right
- **Purpose**: Wide, spacious effect
- **Mix**: Works great on ad-libs and hooks

### Filtering Your Delays

Always filter delay returns:

- **High-pass filter**: Cut below 200-400Hz (prevents low-end buildup)
- **Low-pass filter**: Cut above 6-8kHz (creates darker, more subtle delay)

This keeps delays from cluttering your mix.

### Combining Reverb and Delay

Pro technique: Use both on sends

**Setup:**
1. Send vocal to delay (slap or eighth-note)
2. Send delay return to reverb
3. Result: Delay repeats have reverb tail, creating huge depth

Adjust send amounts to taste (start subtle).

## Step 9: Vocal Layering and Doubles

### Creating Thickness with Doubles

Doubling makes vocals sound fuller and more professional:

**Types of doubles:**

**Tight doubles:** Record the same verse twice, pan hard left/right
- Creates thick, powerful sound
- Both takes should be nearly identical in timing and pitch
- Mix 3-6dB quieter than lead vocal

**Loose doubles:** Slightly different delivery or timing
- Creates wider, more natural sound
- Can be panned or mixed low in the center
- Mix 6-10dB quieter than lead

**Octave doubles:** Record an octave higher or lower
- Adds harmonic interest
- Works great on hooks
- Mix very quietly (10-15dB below lead)

### Ad-lib Processing

Ad-libs require different treatment than leads:

**Ad-lib chain:**
1. More compression (heavier than lead)
2. Brighter EQ (boost 4-6kHz more aggressively)
3. More effects (delay and reverb)
4. Creative panning (spread across stereo field)
5. Lower volume (sit behind the lead)

**Ad-lib philosophy:** They should add energy and fill space without competing with the lead vocal.

### Backing Vocal Arrangement

**Effective backing vocal techniques:**
- Pan doubles hard left/right for width
- Use stereo widener on backing vocals (not lead)
- Filter backing vocals (cut lows below 200Hz)
- Add more reverb to push them back in the mix

## Step 10: Automation and Final Touches

### Volume Automation (Critical)

Manual volume adjustments make the biggest difference:

**What to automate:**
- Lower volume of loud words that stick out
- Raise volume of quiet words that get buried
- Duck vocals during instrumental breaks
- Adjust different song sections (verse vs. hook)

**How to automate:**
Use clip gain or volume automation in your DAW to make these adjustments before your processing chain.

### Dynamic De-essing and Automation

Sometimes de-essers aren't enough:

- Manually turn down harsh "S" sounds using automation
- Reduce volume of plosives ("P," "B" sounds) that hit too hard
- Tame overly aggressive consonants

Takes time, but results in polished, professional vocals.

### Final Limiting

At the end of your vocal chain:

**Purpose:** Catch any stray peaks and add final loudness

**Settings:**
- **Threshold**: Set to catch occasional peaks
- **Output ceiling**: -0.3dB (prevents clipping)
- **Release**: Fast (50-100ms)

**Don't overdo it:** 1-3dB of limiting is usually enough.

## Vocal Mixing in Context: With the Beat

### Balancing Vocals and Instrumental

The mix isn't complete until vocals sit perfectly with the beat:

**Level setting:**
1. Start with the beat at -6dB headroom
2. Bring in vocals and find the sweet spot
3. Vocals should be intelligible but not overpowering
4. Check on multiple playback systems

**General rule:** Rap vocals sit slightly louder than singing vocals (clarity is critical).

### Creating Space with Beat EQ

Sometimes you need to carve space in the beat:

**Technique: Ducking beat frequencies**
- Use dynamic EQ or multiband compression on the beat
- Duck 2-5kHz range when vocals are present (1-2dB)
- Creates automatic space for vocal clarity

**Alternative:** Use sidechain compression to subtly duck the entire beat when vocals play.

### Reference Mixing

Compare your mix to professional tracks:

**How to reference:**
1. Import a professionally mixed song in your genre
2. Match the loudness (use a gain plugin)
3. A/B between the reference and your mix
4. Note differences in vocal level, brightness, depth

**What to listen for:**
- How loud are the vocals relative to the beat?
- How bright or dark are the vocals?
- How much reverb and delay?
- How wide is the stereo field?

Referencing keeps you objective and prevents ear fatigue mistakes.

## Common Vocal Mixing Mistakes

### 1. Over-Processing

**Signs of over-processing:**
- Vocals sound unnatural or robotic
- Harsh, fatiguing sound
- Loss of emotion and character

**Solution:** Use plugins subtly. If you can obviously hear an effect, you've probably gone too far.

### 2. Not Gain Staging

**Problem:** Plugins receive signals too hot or too quiet, leading to distortion or noise.

**Solution:** Check and adjust levels at every stage of your chain.

### 3. Mixing in Solo

**Problem:** Vocals sound great alone but disappear in the full mix.

**Solution:** Always mix with the beat playing. Context is everything.

### 4. Ignoring Room Acoustics

**Problem:** Untreated room causes bad mixing decisions (especially bass and high frequencies).

**Solution:**
- Use reference headphones (not cheap earbuds)
- Check mix on multiple systems (car, phone, earbuds, monitors)
- Invest in basic acoustic treatment (bass traps, diffusers)

### 5. Not Using References

**Problem:** Your ears adapt to your own mix, losing objectivity.

**Solution:** Constantly A/B against professional tracks you admire.

### 6. Trying to Fix Everything with Plugins

**Problem:** Bad recording, bad performance, or bad timing can't be fully fixed in mixing.

**Solution:** Re-record if the raw vocal sounds bad. Good mixing enhances good recordings.

## Recommended Vocal Mixing Plugins

### Complete Free Vocal Chain

You can mix professional vocals with free plugins:

**Chain:**
1. **TDR Nova** (EQ and de-essing)
2. **TDR Kotelnikov** (compression)
3. **Klanghelm IVGI** (saturation)
4. **Valhalla Supermassive** (reverb - on send)
5. **Valhalla Freq Echo** (delay - on send)

Total cost: $0. Results: Professional.

### Budget Paid Plugin Bundle

If you have $100-200 to spend:

**Best value:**
- **FabFilter Pro-Q 3** ($179): Best EQ available
- **Valhalla Room** ($50): Best reverb under $200
- **Waves CLA Vocals** ($29): One-knob vocal processing

### Premium Professional Tools

Industry-standard tools:

- **Antares Auto-Tune Pro** ($399): Pitch correction and vocal effects
- **Melodyne** ($99-$449): Best pitch correction
- **iZotope Nectar 4** ($249): Complete vocal suite
- **Slate Digital All Access** ($14.99/month): Hundreds of plugins
- **Universal Audio plugins** (via UAD hardware): Analog modeling

## Vocal Mixing Workflow Summary

### The Complete Process

**Phase 1: Preparation (10 minutes)**
1. Clean up recordings (strip silence, remove clicks)
2. Organize and name tracks
3. Gain stage properly

**Phase 2: Corrective Processing (15 minutes)**
4. Subtractive EQ (remove problems)
5. De-essing (tame sibilance)
6. Compression (even out dynamics)

**Phase 3: Enhancement (15 minutes)**
7. Additive EQ (enhance good frequencies)
8. Saturation (add warmth and character)
9. Reverb and delay (create space - on sends)

**Phase 4: Finalization (20 minutes)**
10. Volume automation (fine-tune dynamics)
11. Mix with the beat (balance and context)
12. Reference against pro tracks
13. Export and test on multiple systems

**Total time:** 60 minutes for a well-mixed vocal

## Advanced Techniques

### Vocal Rider Plugins

Automatically adjust vocal levels:

- **Waves Vocal Rider** ($29+): Sets optimal vocal levels
- **iZotope Nectar Vocal Assistant**: AI-powered starting point

These save hours of manual automation.

### Melodyne for Pitch Correction

Subtle pitch correction keeps vocals in tune without the obvious Auto-Tune sound:

**When to use:**
- Slightly off-pitch notes that distract
- Tightening up doubles so they match the lead
- Creating harmonies from single takes

**How much:** Correct 50-80% (not 100%—keep some natural variation)

### Multiband Compression

Advanced dynamic control:

**What it does:** Compresses different frequency ranges independently

**When to use:**
- Controlling low-end inconsistencies
- Taming harsh midrange only when it spikes
- Maintaining vocal balance across the spectrum

**Recommended:** FabFilter Pro-MB ($179)

### Creative Vocal Effects

**Telephone/lofi effect:**
- Aggressive high-pass and low-pass filtering (200Hz-3kHz)
- Add distortion
- Reduce bitrate for digital artifacts

**Reverse reverb:**
- Reverse the vocal clip
- Add heavy reverb
- Reverse again
- Creates pre-reverb swell effect

**Vocal chops:**
- Slice short vocal phrases
- Rearrange rhythmically
- Process heavily with effects
- Common in modern trap and hip hop

## Mixing for Different Platforms

### Streaming Platforms (Spotify, Apple Music)

**Loudness target:** -14 LUFS integrated (Spotify standard)

**What this means:** Don't over-compress. Streaming platforms normalize loudness, so focus on dynamics and clarity.

### YouTube and Social Media

**Loudness target:** -13 to -11 LUFS (slightly louder for social media)

**Considerations:**
- Phone speakers emphasize midrange—ensure vocal clarity in that range
- Compressed audio formats—avoid overly bright or harsh processing

### Live Performance

Different approach than studio mixing:

- Less reverb (live rooms have natural reverb)
- More compression (consistent levels in varying room acoustics)
- Brighter EQ (compensates for room absorption)

## Final Thoughts

Mixing rap vocals is both technical skill and creative art. The techniques in this guide provide the foundation, but your ears and experience will teach you what works for specific tracks and styles.

**Remember:**
1. **Start with a good recording**: Garbage in, garbage out
2. **Reference constantly**: Your ears deceive you
3. **Less is more**: Subtle processing sounds professional
4. **Mix in context**: Vocals must work with the beat
5. **Practice consistently**: Each mix teaches you something

The best mixing engineers didn't learn overnight. They spent years training their ears, experimenting with plugins, and developing their taste.

**Action steps:**
1. Mix a vocal using this guide start to finish
2. Compare your result to a professional track
3. Note the differences
4. Try again on a new track, focusing on your weaknesses
5. Repeat this process 50-100 times

By your 50th mix, you'll sound professional. By your 100th, you'll have your own signature sound.

Now stop reading and start mixing. Your best vocal mix is waiting to be created.`;

async function insertArticle() {
  try {
    console.log('📝 Publishing evergreen article: How To Mix Rap Vocals Like A Pro...');

    const result = await pool.query(
      `INSERT INTO articles (title, author, content, tags, image_url, category, is_original, is_evergreen)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, title, category, is_evergreen, created_at`,
      [
        'How To Mix Rap Vocals Like A Pro (2025)',
        'Cry808 Editorial Team',
        articleContent,
        ['guides', 'mixing', 'vocals', 'music-production', 'audio-engineering'],
        'https://images.unsplash.com/photo-1598653222000-6b7b7a552625?w=1200',
        'guides',
        true,
        true
      ]
    );

    console.log('✅ Successfully published article!');
    console.log(`📊 Article ID: ${result.rows[0].id}`);
    console.log(`📰 Title: ${result.rows[0].title}`);
    console.log(`🌲 Evergreen: ${result.rows[0].is_evergreen}`);
    console.log(`📅 Published: ${result.rows[0].created_at}`);

    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('❌ Error publishing article:', err.message);
    await pool.end();
    process.exit(1);
  }
}

insertArticle();
