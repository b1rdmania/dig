# Wine Bore V2 trial

6 October 2026. Owner: Andy. Branch: `codex/winebore-v2`.

## Scope

P3 web presentation; sample-only. A separate conversation experience at
`/winebore/v2` (mapped to `/v2` on winebore.app if deployed). The original
Wine Bore page, Record Bore, model, persona, API and database are unchanged.
No new dependencies. No production deployment.

The trial keeps the original character illustration and uses warm paper,
burgundy controls and sans-serif conversation text. A fixed composer stays
outside the scrollable transcript. New answers do not continually move the
reader; a latest-reply button provides explicit navigation. Recommendation
cards use the existing evidence filter and attribution, show two items first,
and disclose additional items and geography on demand.

## Interaction

- Existing streaming API, including status, delta, result and error events.
- Abort for stop and unmount; one request at a time; retry replaces the last
  exchange rather than duplicating its question in model history.
- Copy answer, new conversation, multiline composer and IME-safe Enter.
- Separate photo upload and confirmation; resize to 1600px; existing OCR API.
- Last 40 messages retained in browser localStorage, with photos omitted.
  This is one current conversation, not a history browser or account sync.
- Native About dialog, focus states, reduced-motion support and mobile layout.

## Verification

- Web tests: 66 passing, including the separate V2 host mapping.
- Production build and its typecheck passed. Changed-file lint and `git diff --check` passed (the existing ESLint pages-directory configuration notice remains).
- Browser checks at desktop and 390 x 844: real API response and recommendations,
  follow-up, stop, retry, copy, reload persistence, About dialog, image preparation,
  attachment removal, new conversation, recommendation disclosure, and no horizontal overflow at the mobile viewport.
- OCR submission and follow-up were verified with a synthetic three-wine list.
  The unchanged server still truncates transcriptions to 850 characters.
  Choosing a photo sends it to that service immediately.
- Existing model behaviour remains: the live sample volunteered relative price
  claims despite the persona's price restriction. This UI trial does not fix
  grounding or alter the persona.

Production-build smoke: `/winebore/v2`, original `/winebore` and `/recordbore` all returned HTTP 200.

## Local trial

From the repo, build with `pnpm --filter @dig/web build`, then:

```
pnpm --filter @dig/web exec next start --hostname 127.0.0.1 --port 3012
```

Open http://127.0.0.1:3012/winebore/v2. Uses the existing public API and its
normal quotas. Port 3012 avoids the existing service on 3002.

## Rollback

The trial is additive. Remove the V2 route and its explicit host/chrome
exceptions, or revert the branch changes. No migration, data reload or
production rollback is needed for this local trial.

## Direction corrected after review

The opening now follows V1: white background, original meme, small
“Wine Bore. Ask.”, underlined input, “Upload a wine list.” and
“How we built this”. Removed the added slogans, tasting-room branding,
introductory marketing copy and invented About text. The more developed
composer and conversation styling appear after the first message.

## Bottle presentation pass

The first wine in the existing filtered evidence gets a full-width typographic
card and a find link. It is labelled only “On the counter”; the UI does not
claim to know whether it is the model's preferred recommendation. Other wines
and producers are compact rows under “Also mentioned”. Producer-only answers
use rows directly. Geography remains a separate disclosure. The opening is
unchanged. Production build, typecheck and changed-file lint passed.

## Conversation typography

Both user messages and Wine Bore replies use the same sans-serif at 15px on
desktop and 16px on mobile, with 1.55 line spacing. The composer stays 16px.
The opening title retains its original serif.

## Separate wine-list upload

Choosing a photo now reads it immediately and adds a visible wine-list message
and “Wine list updated. What do you want to know?” confirmation. It does not
submit or clear the question draft. Send submits only the question. Upload
errors and cancellation leave the draft intact; failed uploads can be retried.
The latest successful list is included within the API's six-turn history window
and retained when saving long conversations. A replacement list supersedes it;
a failed replacement leaves the previous list available. Photos are not saved.

Verification: 69 tests passed, including list retention and replacement tests.
Production build and typecheck passed. Live OCR preserved a drafted question,
returned the exact confirmation, and answered the subsequent question using
the listed wines and prices. Desktop/mobile and reload persistence checked.
