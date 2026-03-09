import { NextRequest, NextResponse } from "next/server";

const FORM_ID = "1FAIpQLSePe6R5VBfqkR8HQ6Q0ctK0Iv-QOdxdLmUnAvJzyWC5cDmLqQ";
const FORM_URL = `https://docs.google.com/forms/d/e/${FORM_ID}/viewform`;
const FORM_ACTION = `https://docs.google.com/forms/d/e/${FORM_ID}/formResponse`;

const FIELD_TYPE        = "entry.475873863";
const FIELD_DESCRIPTION = "entry.800259623";
const FIELD_EMAIL       = "entry.1541120051";

// Map our internal values to the exact strings Google Forms expects
const TYPE_MAP: Record<string, string> = {
  bug:            "Bug",
  suggestion:     "Suggestion",
  "wrong-result": "Wrong result",
  "missing-data": "Missing data",
  other:          "Other",
};

export async function POST(req: NextRequest) {
  try {
    const { type, description, email } = await req.json() as {
      type: string;
      description: string;
      email?: string;
    };

    if (!description?.trim()) {
      return NextResponse.json({ error: "Description required" }, { status: 400 });
    }

    // Step 1: load the form to get session cookies + fbzx CSRF token
    const formPage = await fetch(FORM_URL, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    const cookies = formPage.headers.get("set-cookie") ?? "";
    const html = await formPage.text();

    const fbzxMatch = html.match(/name="fbzx"\s+value="([^"]+)"/);
    const fbzx = fbzxMatch?.[1] ?? String(Math.floor(Math.random() * 1e18));

    // Step 2: submit with the session cookies and fbzx token
    const body = new URLSearchParams();
    body.set(FIELD_TYPE, TYPE_MAP[type] ?? "Other");
    body.set(FIELD_DESCRIPTION, description.trim());
    if (email?.trim()) body.set(FIELD_EMAIL, email.trim());
    body.set("fbzx", fbzx);

    const res = await fetch(FORM_ACTION, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Referer": FORM_URL,
        "Cookie": cookies,
        "User-Agent": "Mozilla/5.0",
      },
      body: body.toString(),
      redirect: "manual",
    });

    // Google returns 200 or 302 on success, 400 on bad input
    if (res.status === 200 || res.status === 302) {
      return NextResponse.json({ ok: true });
    }

    console.error("Feedback submission failed:", res.status);
    return NextResponse.json({ error: "Submission rejected" }, { status: 502 });
  } catch (err) {
    console.error("Feedback proxy error:", err);
    return NextResponse.json({ error: "Failed to submit" }, { status: 500 });
  }
}
