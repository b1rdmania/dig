# Record Bore: Discogs sign-in

Status: built 2026-09-28. Off in production until three `dig-api` secrets are set.

## What it does

A visitor signs in with Discogs on `/recordbore`. dig reads their wantlist and
collection, and Record Bore can use them: "you've wanted this for a while", or
"you own the original, the thread to pull is...". Signed-out asks are unchanged.

## How it works

1. `GET /v1/me/discogs/login` gets an OAuth 1.0a request token and redirects to Discogs.
2. Discogs redirects to `GET /v1/me/discogs/callback`. dig exchanges the token,
   reads `/oauth/identity`, stores the account and makes a dig session.
3. The API redirects to `app.dig.baby/recordbore#dig_session=<token>`. The page
   stores the token in localStorage and sends it as `Authorization: Bearer`.
   A cookie cannot work here: dig-api and app.dig.baby are different sites.
4. Both lists sync in the background (100 per page, up to 2,000 per list), and
   again when `/v1/me` sees a sync older than 24 hours.
5. On an ask with a valid session, Record Bore gets one more prompt note and one
   more tool, `get_customer_crates`. The records the shop stocks come back with a
   dig link, so the normal link rules apply to them.

## Data

Schema `users` (migration 038). Nothing else references it; `DROP SCHEMA users
CASCADE` removes every customer. The Discogs token and secret are AES-256-GCM
ciphertext (key `USER_TOKEN_KEY`, not in the DB). Sessions store only a SHA-256
hash. "Forget me" on the page deletes the account, sessions and lists.

## Switch on

1. Register an app at https://www.discogs.com/settings/developers.
   Callback URL: `https://dig-api.fly.dev/v1/me/discogs/callback`.
2. `fly secrets set -a dig-api DISCOGS_CONSUMER_KEY=... DISCOGS_CONSUMER_SECRET=... USER_TOKEN_KEY=$(openssl rand -base64 32)`

Until all three are set, every `/v1/me` route answers 404 and the page hides the line.
Do not change `USER_TOKEN_KEY` after launch: stored tokens cannot be read with a new key,
and each customer has to sign in again.

## Loop change

`BoreConfig.forCustomer` (bore.ts) is the one change the ask loop took: when a
customer is signed in, the loop appends the bore's note to the system prompt and
its tools to the tool list.
