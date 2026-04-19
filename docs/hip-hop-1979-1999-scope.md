# Hip-Hop Scope: 1979–1999

Companion to [`credit-and-remix-extraction-plan.md`](./credit-and-remix-extraction-plan.md). This is the second scope built off the manifest pattern after `v2-house-techno`. It is the "pipeline-proof" scope per Decision #6 in that doc — the second scope must build cleanly before we retire `dig-db`.

- Manifest: [`packages/db/scope-manifests/hip-hop-1979-1999.json`](../packages/db/scope-manifests/hip-hop-1979-1999.json)
- Tier-1 label seed: [`packages/db/seeds/scope-manifests/hip-hop-1979-1999/tier1.csv`](../packages/db/seeds/scope-manifests/hip-hop-1979-1999/tier1.csv)
- Target Fly app: `dig-db-hiphop` (not yet provisioned)

## 1. Scope window — why 1979–1999

- **1979** — "Rapper's Delight" (Sugar Hill, Sep 1979) is the conventional commercial start. Anything earlier is live-tape territory (Herc, Bambaataa block parties) and not on Discogs as released catalogue.
- **1999** — close of the "golden era" / start of the bling/jiggy/Bad Boy-Roc-A-Fella consolidation. By 1999 we have the Wu-Tang second wave, the Roc-A-Fella ascendancy, the rise of Cash Money + No Limit as Southern majors, and the launch of Def Jux (Cannibal Ox, El-P). It's a clean editorial cut. Anything after 1999 (early Aftermath/G-Unit, Dipset, Atlanta trap, etc.) belongs in a separate `hip-hop-2000-2010` scope.
- **20 years** vs the 18-year v2 window — comparable shape, similar size budget (~30k masters projected before any cuts).

## 2. Style allowlist & rationale

The manifest filters on Discogs `styles` (not `genres`). Final list mirrors the user-requested set with two practical notes:

| Style                | Notes                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------- |
| `Hip Hop`            | Coarse style + genre — many old-school + indie 12"s only have this one tag. Must include.   |
| `Boom Bap`           | Core — '92–'99 NY underground. Disambiguates from "Hip Hop" for Premo / Pete Rock-era cuts. |
| `Conscious`          | Native Tongues + Roots + Common + Mos Def axis.                                             |
| `East Coast Hip Hop` | Discogs canonical name (note "Hip Hop", no hyphen). Wu-Tang, Nas, Jay-Z, Rawkus.            |
| `West Coast Hip Hop` | Death Row, Aftermath, Dogg Pound, Ruthless.                                                 |
| `Hardcore Hip-Hop`   | Discogs spelling has hyphen. M.O.P., Onyx, Mobb Deep, Cypress Hill.                         |
| `Gangsta`            | NWA, Ice-T, late-Cube, Compton's Most Wanted.                                               |
| `G-Funk`             | Dre, Snoop, Warren G, Above the Law.                                                        |
| `Jazzy Hip-Hop`      | Tribe, Gang Starr, Pete Rock & CL, Digable Planets, Mo' Wax artists.                        |
| `Pop Rap`            | Salt-N-Pepa, MC Hammer, Kris Kross, Will Smith, Naughty by Nature crossovers.               |
| `Cut-up/DJ`          | DJ Shadow, Cut Chemist, Beat Junkies, X-Ecutioners, Bomb Hip-Hop.                           |
| `Bay Area`           | Hieroglyphics, Souls of Mischief, E-40, Too $hort, Quannum.                                 |
| `Southern Hip Hop`   | Outkast, Goodie Mob, UGK, Geto Boys, 8Ball & MJG.                                           |
| `Memphis Rap`        | Three 6 Mafia, Tommy Wright III, Project Pat, DJ Squeeky.                                   |
| `Crunk`              | Late-90s emergence (Lil Jon BME, early Three 6) — bounded by year_max=1999.                 |
| `Trap`               | Almost no Discogs releases tagged Trap before 2000 — included for completeness, expect ~0.  |
| `Old School Hip Hop` | Pre-87 catalogue retag — Sugar Hill, Tommy Boy electro-rap, Cold Crush.                     |
| `Electro`            | Heavy overlap with early hip-hop (Bambaataa "Planet Rock", Mantronix, Soulsonic Force).     |

**Excluded** (not in allowlist; will be denylisted on the next pass after histogram review):

- `Drum n Bass`, `Jungle`, `2-step`, `UK Garage`, `Trip Hop` (last one has dense overlap with hip-hop — needs a year-gate or explicit denylist; will tune after histogram).

**Year gates** — `breakbeat_year_gate` is set to `9999` (disabled) because the v2 Breakbeat/Hardcore drop rule doesn't apply here. We may add a `style_gate` for `Trap` (drop if year > 1999, redundant with year_max but defensive) once the histogram lands.

## 3. Tier-1 label rationale

**Tier-1 = anchor labels** that get a +10 `scene_weight` boost in the build pipeline so their releases cannot be pruned by the `scene_weight_min` threshold even if they have weak Discogs metadata. Tier-1 is also the editorial/UI badge layer (label colour, accent ink, blurb) — see CSV columns.

**Tier-2 (not yet curated)** = broader catalogue: major-label rap subsidiaries (Atlantic, Columbia, MCA, Capitol, Geffen, Mercury, Polygram, Arista, Sony) and mid-tier indies that aren't culturally anchor-shaped but supply volume. We do not need a tier-2 list to ship the first build — the style + year filter pulls them in regardless.

The current tier-1 CSV at `packages/db/seeds/scope-manifests/hip-hop-1979-1999/tier1.csv` carries **82 labels** with a richer schema than the v2 list (`discogs_id, name, tier, accent, accent_ink, founded_year, closed_year, is_active, location, blurb`). Audit notes are in §6.

## 4. Key artists / groups expected in the scope

A scope-completeness eyeball: the artist page for each of these should render as primary artist on ≥1 master AND show meaningful credit traffic from `master_track_credits` once the credit phases run.

**East Coast** — Run-DMC, Public Enemy, LL Cool J, Beastie Boys, EPMD, Eric B. & Rakim, Big Daddy Kane, Kool G Rap, Biz Markie, MC Lyte, Slick Rick, KRS-One / Boogie Down Productions, Brand Nubian, Main Source, Lord Finesse, Showbiz & A.G., Diamond D, O.C., A Tribe Called Quest, De La Soul, Jungle Brothers, Black Sheep, Gang Starr, Nas, Mobb Deep, Wu-Tang Clan + solo (RZA, GZA, Method Man, Raekwon, Ghostface, ODB, Inspectah Deck, U-God, Masta Killa), Cappadonna, Killah Priest, Sunz of Man, Killarmy, Notorious B.I.G., Jay-Z, Mase, Foxy Brown, Lil' Kim, Junior M.A.F.I.A., Cam'ron, Memphis Bleek, Jeru the Damaja, Group Home, Smif-N-Wessun, Black Moon, Heltah Skeltah, O.G.C., Boot Camp Clik, M.O.P., Onyx, Das EFX, Pete Rock & CL Smooth, Capone-N-Noreaga, Mos Def, Talib Kweli, Black Star, Pharoahe Monch, Organized Konfusion, Company Flow, Cannibal Ox, Aesop Rock, MF DOOM (Zev Love X / KMD era), Kool Keith / Ultramagnetic MCs, Cella Dwellas, Cage, High & Mighty.

**West Coast** — N.W.A., Ice Cube, Dr. Dre, Snoop Dogg, MC Ren, Eazy-E, Above the Law, DJ Quik, Compton's Most Wanted, MC Eiht, Tha Dogg Pound, Warren G, Nate Dogg, 2Pac, Cypress Hill, Pharcyde, Souls of Mischief, Hieroglyphics (Del, Casual, Pep Love), J5 / Jurassic 5, Dilated Peoples, Defari, King Tee, Tha Alkaholiks, DJ Shadow, Lyrics Born, Blackalicious, Lateef, Living Legends, Aceyalone / Freestyle Fellowship, Ras Kass, Xzibit, Saafir, Mystik Journeymen, Anticon roster.

**Bay Area** — Too $hort, E-40 / The Click, Mac Dre, RBL Posse, 3X Krazy, Spice 1, Mac Mall, Ant Banks, Andre Nickatina, Dru Down, Souls of Mischief / Hieroglyphics (also Bay), DJ Shadow.

**South** — Outkast, Goodie Mob, Cool Breeze, Witchdoctor, Big Boi/Andre solo, UGK (Pimp C, Bun B), Scarface / Geto Boys, Devin the Dude, Bushwick Bill, Willie D, 8Ball & MJG, Three 6 Mafia (DJ Paul, Juicy J, Lord Infamous, Crunchy Black, Gangsta Boo, Koopsta Knicca), Project Pat, Tela, Master P / TRU / Mia X / Silkk / C-Murder / Mystikal, Cash Money (Juvenile, B.G., Lil Wayne, Turk, Birdman, Mannie Fresh), 2 Live Crew / Luther Campbell (Miami bass), Trick Daddy, Trina, Pastor Troy, Field Mob, JT Money, Quad City DJs.

**Midwest / other** — Common, No I.D., Twista, Do Or Die, Crucial Conflict, Bone Thugs-N-Harmony, Hi-Tek, Mood, MHz / Camu Tao / Copywrite, Atmosphere (Slug + Ant), Brother Ali, Eyedea & Abilities (1999 boundary), Rhymesayers roster.

**UK** — Roots Manuva, Skinnyman, London Posse, Hijack, Cookie Crew, MC Buzz B, Stereo MC's, Gunshot, Demon Boyz, Silver Bullet, Killa Instinct, Black Twang, Rodney P, Ty, MC Mell'O', Reksta, the Mo Wax / Big Dada / Lex axis.

**Producers / DJs** (frequently uncredited as primary artists; the credit layer is what surfaces them) — DJ Premier, Pete Rock, Large Professor, Q-Tip, Diamond D, Showbiz, Lord Finesse, Marley Marl, Da Beatminerz, Easy Mo Bee, Ski Beatz, DJ Muggs, RZA, 4th Disciple, True Master, Mathematics, J Dilla / Jay Dee (Slum Village + Ummah), Madlib, Dr. Dre, DJ Quik, Battlecat, Erick Sermon, Diamond D, Beatnuts, Buckwild, Alchemist (early), DJ Shadow, Cut Chemist, Z-Trip, Bobbito, Stretch Armstrong, DJ Clue, DJ Premier, Funkmaster Flex, Mannie Fresh, Organized Noize, Mr. Mixx (2 Live Crew), DJ Toomp (early), DJ Paul + Juicy J, No I.D., Hi-Tek, Babu, Babu of Beat Junkies, Mix Master Mike, Q-Bert, X-Ecutioners (Roc Raida, Total Eclipse, Mista Sinista, Rob Swift). **Credit-layer surfacing is the whole point of Rule B for this scope** — most of these names produce far more catalogue than they front.

## 5. Cross-scope concerns — what's hip-hop-specific

Hip-hop's data model on Discogs has a denser, messier credit/sample structure than house/techno. Things to watch:

1. **Producer credit is the spine.** In house/techno the "Remix" credit dominates traffic; in hip-hop it's "Produced By" / "Producer". The manifest correctly puts both in the role allowlists, but UI-side the producer tab will be much heavier than the remix tab. Plan UI accordingly.
2. **Featuring / "Feat." artists are not in `track_credits`** — they're in `release_artists` / `master_artists` joins, often with `role = "Featuring"` or no role at all. We may need a follow-up phase to surface "X feat. Y" relationships properly. Out of scope for this doc; flag for v2 of the credit layer.
3. **Sample credits are catastrophically incomplete.** Discogs has a `Samples Material From` / `Contains Sample From` notes field but it's free-text and only ~10–15% populated for hip-hop. The credit layer surfaces what's there but cannot reconstruct what isn't. WhoSampled is the canonical source for samples and is **not** CC0. We do not mirror it. UI should be honest: "samples shown here are Discogs-noted; many are uncredited."
4. **Interpolations vs samples vs replays.** Discogs doesn't distinguish. Treat as a single "borrowed material" surface in v1.
5. **DJ credits.** "DJ" / "Scratches" / "Cuts" / "Turntables" are in `track_credits` but won't pass our role normaliser by default — they'll fall through to `Other`. Worth a follow-up to add a `DJ` canonical role bucket if we want to surface scratching credits on the master page. Not needed for v1.
6. **Group → member edges are dense and matter more than in house/techno.** Wu-Tang (9 members + ~30 affiliates), Native Tongues (loose collective), Hieroglyphics (8), Boot Camp Clik, D.I.T.C., Juice Crew. `artist_group_members.enabled = true` in the manifest handles this. Recommend post-build review of the top 20 collectives to confirm edges resolved.
7. **Regional indie label aliases.** Many Southern + Bay Area labels switched names mid-life (Suave House → Suave House II; In-A-Minute → IAM; Rap-A-Lot reissue spree under different imprint codes). Tier-1 CSV resolves to `discogs_id` when present, which dodges most of this — but the histogram pass should call out any tier-1 row that fails to match.

## 6. Audit of the existing tier-1 CSV

**File** — `packages/db/seeds/scope-manifests/hip-hop-1979-1999/tier1.csv` (the prompt referenced `packages/db/scope-manifests/tier1-hip-hop-1979-1999.csv`, but the file lives in the seeds tree alongside the v2 layout).

**Header** — `discogs_id, name, tier, accent, accent_ink, founded_year, closed_year, is_active, location, blurb`. Richer than the v2 `name, tier, notes` schema. Accent colours + blurbs are scene-page editorial assets; harmless surplus for the build pipeline.

**Count** — **82 labels**, all `tier1`. Coverage by region:

- NYC / Tri-State: ~50 (Sugar Hill, Enjoy, Tommy Boy, Profile, Sleeping Bag, Idlers, Def Jam, 4th & Broadway, B-Boy, Zakia, Cold Chillin', First Priority, Wild Pitch, Select, Next Plateau, Tuff City, Beat Street, Jive, Uptown, Rush Associated, Pendulum, EastWest, Payday, Nervous, Wreck, Big Beat, Loud, Wu-Tang, Roc-A-Fella, Bad Boy, Grand Royal, Rawkus, Fondle 'Em, Penalty, Tommy Boy Black Label, Strong City, Cutting, Quark, Hollywood BASIC, Dolo, Ill Boogie, NIA, JMJ, Tape Kingz, Game, Ill Will, Big Beat — etc.)
- Philly: 2 (Pop Art, Ruffhouse)
- LA / SoCal: ~9 (Ruthless, Death Row, Aftermath, Delicious Vinyl, Priority, Solar, Atomic Pop, plus Bay/SF spillover)
- Bay Area: 8 (Stones Throw, Solesides, Quannum, Hieroglyphics Imperium, Anticon, Bomb Hip-Hop, ABB, ill-will-as-NY)
- South: 9 (Rap-A-Lot, No Limit, Cash Money, Hypnotize Minds, Suave House, Ichiban, So So Def, Cheetah, Slip-N-Slide)
- Other US: 3 (Rhymesayers MN, Mush Cincinnati, Brick Boston)
- UK: 8 (4th & Broadway, Streetwave, Gee Street, Mo Wax, Big Dada, Lex, Big Cat, plus 4th & Broadway)

**Coverage of the user's "essential" list** — all present:
Def Jam, Loud, Tommy Boy, Cold Chillin', Stones Throw, Rawkus, Ruffhouse, Solar, Profile, Priority, Death Row, Roc-A-Fella, Rap-A-Lot, Bad Boy, Aftermath, No Limit, Cash Money, Sleeping Bag, Wild Pitch, Pendulum, Payday, Fondle 'Em, Mo Wax, Quark. Cold Chillin' appears once (the user's list duplicated it); Rawkus also single-row. Good.

**Notable additions to consider** (post-histogram, before locking the seed):

| Label                                   | Why                                                                                               |
| --------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Luke Records / Luke Skyywalker**      | 2 Live Crew, Miami bass canon, the obscenity-trial moment. Major omission for a 79–99 cut.        |
| **Pandisc Records**                     | Miami bass anchor (MC Shy D, Afro-Rican).                                                         |
| **Sick Wid It**                         | E-40's imprint — Bay Area essential.                                                              |
| **In-A-Minute Records**                 | Mac Dre early, RBL Posse, 3X Krazy. Bay Area mid-90s.                                             |
| **Lench Mob Records**                   | Ice Cube, Mack 10, WC, Westside Connection.                                                       |
| **Music of Life**                       | UK's first hip-hop indie of consequence (Hijack, Cookie Crew, MC Duke).                           |
| **Low Life Records**                    | London Posse, Skinnyman, Task Force — UK underground 90s.                                         |
| **Eastern Conference Records**          | Cage, High & Mighty, Smut Peddlers, Copywrite — late-90s NY underground.                          |
| **Goodvibe Recordings**                 | Jurassic 5, Bahamadia, Lootpack — late-90s underground.                                           |
| **75 Ark**                              | Deltron 3030, Latyrx — Bay Area underground.                                                      |
| **Nasty Mix Records / Rhyme Cartel**    | Sir Mix-a-Lot — Seattle (otherwise unrepresented).                                                |
| **Murder Inc. / The Inc.**              | Ja Rule, DMX-orbit late 90s — Def Jam-distributed but its own universe.                           |
| **Battery Records**                     | Chino XL, late-90s NY underground.                                                                |
| **Up Above Records**                    | Living Legends collective, LA underground.                                                        |
| **D.I.T.C. Records**                    | Diggin' in the Crates collective imprint (Showbiz, Lord Finesse, Diamond D — 1992 onwards).       |
| **Black Market Records**                | Brotha Lynch Hung, Sacramento underground.                                                        |
| **Prophet Entertainment**               | Three 6 Mafia's earliest tapes pre-Hypnotize Minds.                                               |
| **Macola Record Co.**                   | Distributed early NWA, World Class Wreckin' Cru, JJ Fad — pre-Ruthless distro.                    |
| **Skanless Records / Awol / Kemit**     | Mac Mall, Bay Area indie distribution layer.                                                      |
| **Loose Cannon Records**                | Mad Lion, Smoothe da Hustler — sub-Mercury 90s indie.                                             |
| **Outpost Recordings**                  | Mystik Journeymen / Tha Liks distribution moment.                                                 |
| **Sub Verse Music**                     | Aesop Rock pre-Def Jux ("Float").                                                                 |

**Borderline / out-of-window flags in the existing CSV**:

- **Lex Records** — listed `founded 2001`, technically outside the 1979–1999 window. Either drop, demote to tier-2, or reframe scope as 1979–2003 (cleaner cut from a UK-underground angle). My call: drop from this scope's tier-1 and add it to a future `hip-hop-2000-2010` manifest.
- **Definitive Jux** — `founded 1999`. Cannibal Ox + Aesop Rock canon is 2001–2003. Keep in tier-1 as a "tip-of-the-window" anchor; releases will be sparse but symbolically right.
- **Anticon (1998), Quannum (1997), Hieroglyphics Imperium (1997), Mush (1999)** — all real tail-of-window labels with legitimate '98–'99 catalogue. Keep.
- **NIA Records** — Bambaataa-adjacent, sparse Discogs catalogue. Verify resolves to a real `discogs_id` (currently set to 3692) before locking.
- **Streetwave (1981–86) and Quark (1984–90)** — closed before the prime hip-hop catalogue era — they sit in the proto/electro pocket. Keep; they're foundational.

**Recommendation**: take the existing 82-label seed as-is for the smoke build, then after the histogram pass add the ~22 missing labels above (target ~100–105 tier-1 rows for the full build). This avoids re-resolving `discogs_id` lookups twice.

## 7. Data quality notes

- **Discogs hip-hop coverage skews NY-major-label-heavy.** Independent Southern / regional labels (especially Memphis tape-only, Houston pre-Rap-A-Lot, early Cash Money street tapes, Bay Area cassette-only releases) are under-catalogued. Expect tier-1 like Hypnotize Minds and Suave House to have 50–70% catalogue coverage at best vs. their actual run.
- **Sample/interpolation credits** are sparse — see §5(3).
- **Producer credits** are present and reliable for major-label releases, patchy for indie 12"s. Marley Marl's full Cold Chillin' production is well-credited; Mannie Fresh's Cash Money production is patchier on indie-era releases.
- **DJ + scratch credits** fall outside our default role allowlist and won't surface in v1 — see §5(5).
- **Aliases** — Wu-Tang has the most denormalisation work to do (RZA = Prince Rakeem = Bobby Steels, etc.). The `aliases_text` denorm in `026` already handles search; the credit layer joins on canonical `artist_discogs_id` so aliases are transparently resolved.
- **Group→member edges**: enable `credits.group_members` (already true in manifest) and validate Wu-Tang, Hieroglyphics, Native Tongues, Boot Camp Clik, D.I.T.C., Juice Crew, NWA after the build.

## 8. Operational next steps

1. **Tier-1 seed sync**. Run `seed-label-editorial.ts` against `dig-db` (so the build script's tier-1 boost CTE has data) — it currently only seeds from `label_editorial_v2.csv` + `label_editorial_tier1.csv`. We may need a second pass or a CLI flag (`--seed-csv path/to/hip-hop-tier1.csv`) before running the histogram. Track separately.
2. **Histogram against `dig-db`** with the new manifest:

   ```bash
   SOURCE_DATABASE_URL=postgresql://postgres:<pass>@localhost:15432/dig \
     pnpm exec tsx scripts/build-scoped-db.ts \
       --manifest packages/db/scope-manifests/hip-hop-1979-1999.json \
       --histogram
   ```

   Reads style distribution + 20 sample masters per scene_weight bucket. NO writes. Picks the right `scene_weight_min` cutoff for the smoke build.

3. **Smoke build** — top tier-1 labels only, ~5k masters, target `dig-db-hiphop` (provision first). Per Decision #6 in the credit-and-remix doc.
4. **Full build** — once smoke build passes, run unbounded against `dig-db` with `scene_weight_min` set from histogram findings.
5. **Post-build verification** — Pete Rock, DJ Premier, Marley Marl, RZA, Dr. Dre, Mannie Fresh, J Dilla artist pages should each show ≥10 production credits beyond their primary-artist masters.

## 9. Open questions / TODO

- Should `Trip Hop` be in the allowlist or the denylist? Major UK overlap (DJ Shadow, Mo Wax catalogue) but it'll pull in Portishead etc. Decide post-histogram.
- Fold `Old School Hip Hop` + `Hip Hop` together for the pre-1985 catalogue, or keep separate? Build doesn't care; UI does.
- Tier-2 list — needed for v1, or punt to v2? Punt.
- Scenes seed (curated walls — South Bronx 79–82, Marley Marl Crew, Native Tongues, Wu-Tang Affiliated, Death Row Era, Rawkus 99, etc.) — separate editorial task, not blocking the build.
- DJ / scratch credits as a normalised role bucket — defer to post-launch.
