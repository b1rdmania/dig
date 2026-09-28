import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { oauthHeader, toCrateRow } from "../users/discogs.js";
import { bearer, seal, unseal } from "../users/store.js";
import { safeReturnPath } from "../routes/v1/me.js";
import { customerNote, RECORD_BORE } from "../routes/v1/ask/record-bore.js";

const key = randomBytes(32);

describe("token sealing", () => {
  it("round-trips and never stores the plain text", () => {
    const sealed = seal("secret-token-abc", key);
    expect(sealed).not.toContain("secret-token-abc");
    expect(unseal(sealed, key)).toBe("secret-token-abc");
  });

  it("uses a fresh IV every time", () => {
    expect(seal("same", key)).not.toBe(seal("same", key));
  });

  it("refuses a tampered or wrong-key ciphertext", () => {
    const sealed = seal("secret", key);
    const [iv, tag, ct] = sealed.split(".");
    const flipped = Buffer.from(ct, "base64url");
    flipped[0] ^= 1;
    expect(() => unseal([iv, tag, flipped.toString("base64url")].join("."), key)).toThrow();
    expect(() => unseal(sealed, randomBytes(32))).toThrow();
  });
});

describe("safeReturnPath", () => {
  it("keeps a plain path on the web origin", () => {
    expect(safeReturnPath("/recordbore")).toBe("/recordbore");
  });

  it.each(["//evil.com", "https://evil.com", "/x?y=1", "javascript:alert(1)", "", undefined, "/a b"])(
    "falls back for %s",
    (raw) => expect(safeReturnPath(raw)).toBe("/recordbore"),
  );
});

describe("bearer", () => {
  it("reads a dig session and ignores anything else", () => {
    const t = "a".repeat(43);
    expect(bearer({ authorization: `Bearer ${t}` })).toBe(t);
    expect(bearer({ authorization: "Basic abc" })).toBeNull();
    expect(bearer({ authorization: "Bearer short" })).toBeNull();
    expect(bearer({})).toBeNull();
  });
});

describe("oauthHeader", () => {
  it("signs PLAINTEXT as consumer_secret&token_secret, percent-encoded", () => {
    const h = oauthHeader({ key: "ck", secret: "cs" }, { oauth_token: "t" }, "ts");
    expect(h.startsWith("OAuth ")).toBe(true);
    expect(h).toContain('oauth_signature="cs%26ts"');
    expect(h).toContain('oauth_signature_method="PLAINTEXT"');
    expect(h).toContain('oauth_token="t"');
  });
});

describe("toCrateRow", () => {
  it("maps a Discogs wantlist item and drops the (2) suffix", () => {
    const row = toCrateRow({
      id: 123,
      date_added: "2024-03-01T10:00:00-08:00",
      basic_information: {
        id: 123, master_id: 456, title: "Strings Of Life", year: 1987,
        artists: [{ name: "Rhythim Is Rhythim" }, { name: "Derrick May (2)" }],
        labels: [{ name: "Transmat" }], styles: ["Techno", "Detroit Techno"],
      },
    });
    expect(row).toMatchObject({
      release_discogs_id: 123, master_discogs_id: 456, title: "Strings Of Life", year: 1987,
      artist: "Rhythim Is Rhythim, Derrick May", label: "Transmat", styles: ["Techno", "Detroit Techno"],
    });
    expect(row?.added_at).toBeInstanceOf(Date);
  });

  it("keeps a release with no master and no year", () => {
    expect(toCrateRow({ basic_information: { id: 9, master_id: 0, year: 0, title: "White label" } }))
      .toMatchObject({ master_discogs_id: null, year: null, artist: null, label: null });
  });

  it("skips junk", () => {
    expect(toCrateRow({})).toBeNull();
    expect(toCrateRow({ basic_information: { id: -1 } })).toBeNull();
  });
});

describe("Record Bore for a signed-in customer", () => {
  const customer = { accountId: "1", username: "kasra", wants: 212, collection: 40, syncedAt: new Date(), syncError: null };

  it("adds the crates tool and a note naming the customer", () => {
    const extra = RECORD_BORE.forCustomer!(customer);
    expect(extra.tools.map((t) => t.name)).toEqual(["get_customer_crates"]);
    expect(extra.note).toContain("kasra");
    expect(extra.note).toContain("212 records on their wantlist");
  });

  it("says so when the lists failed or are still coming", () => {
    expect(customerNote({ ...customer, syncedAt: null, syncError: "discogs 500" })).toContain("didn't come through");
    expect(customerNote({ ...customer, syncedAt: null })).toContain("still coming through");
  });

  it("the signed-out shop has no crates tool", () => {
    expect(RECORD_BORE.tools.map((t) => t.name)).not.toContain("get_customer_crates");
  });
});
