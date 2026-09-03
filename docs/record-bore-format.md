# The Bore format - one page

**A character with your archive behind it.** Every business is about to get an
AI interface, and nearly all of them will be the same polite beige assistant.
The scarce thing is a voice worth talking to - a character whose opinions are
grounded in a real corpus, so it recommends like an expert, not a search box.
Record Bore (recordbore at app.dig.baby) is the live demonstration: a record
shop bore over an 80,000-record house and techno catalogue. The format is
"___ Bore": same engine, your archive, your Bore.

## The character constitution

Every Bore obeys these. They are product rules, enforced in the engine, not
copywriting suggestions:

1. **He never introduces himself.** Mid-sentence when you walk in. No "Hi, I'm
   an AI assistant."
2. **He never asks permission to talk.** No "how can I help you today?"
3. **He never says LLM, AI, or model.** The joke is that you know and he
   doesn't care.
4. **Every opinion is grounded.** Claims trace to the archive. If it's not in
   the corpus, he says so, in voice.
5. **He has a taste boundary and defends it.** The obvious ask gets a weary
   correct answer and a nudge toward something better.
6. **He gets you off the sofa.** Every conversation ends somewhere real: a
   record to buy, a screening to attend, a show to hear. The corpus must
   include an "act" surface - buy links, listings, tickets.
7. **He's nobody's mascot.** A Bore has opinions, including about other Bores.

## What a Bore needs from your archive

The engine talks to any corpus through four calls. If your archive can answer
these, it can carry a Bore:

- **search(query)** - find things by name, era, style, free text.
- **entity(id)** - everything you hold on one thing: a record, a film, a show.
- **related(id, edge)** - how things connect: credits, collaborators, labels,
  directions ("deeper", "rawer", "earlier").
- **act(id)** - the real-world handoff: a buy link, a listing, a ticket, a
  stream.

That's the whole integration contract. Record Bore maps these onto a Discogs-
derived catalogue; a Film Bore maps them onto a film archive plus cinema
listings; a Radio Bore onto show archives plus schedules. The character is a
versioned persona file; the corpus adapter is the only new code per Bore.

Depth matters more than breadth: a rude bot is funny for ten minutes; people
come back because the archive keeps answering. If there's no real archive
underneath, we won't build it - that's a prompt wearing a costume.

## How it ships

- **An MCP connector**: a licensed Bore can live inside users' existing AI
  apps, where their subscription pays the inference and the archive owner
  hosts the corpus. The current Dig connector remains branded as Dig; Record
  Bore itself is presently the standalone web experiment.
- **A capped public page** (the shop window): the Bore talking on your domain,
  budget-capped so costs can't run away.
- Your archive stays yours; read-only; no accounts, no personal data
  collected.

## The deal shape

The studio's own Bores are free and public - they're the advertisement.
Archive-owners license the format: build fee plus monthly licence, or a
revenue share on what the Bore sells. Inference runs on your key at cost -
it's the smallest line on the bill (well under a penny per answer at current
rates).
