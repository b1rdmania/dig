// The one place the beta key-request email is defined. Linked from the
// beta key screen and the FAQ.
export const KEY_REQUEST_MAILTO =
  "mailto:andy@cherrygalore.com" +
  `?subject=${encodeURIComponent("Dig: test the Dig LLM")}` +
  `&body=${encodeURIComponent(
    [
      "Hi, I'm requesting access to the Dig beta to test it out.",
      "",
      "I'm not going to use this to rebuild my entire record collection, spam the API and burn all your credits. I know this is a demo release, the aim is getting Discogs to commission something properly, and you're paying for my API credits, so I'll use them respectfully.",
      "",
      "I'll send over feedback on what I like and dislike.",
    ].join("\n"),
  )}`;
