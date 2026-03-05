import { NextRequest, NextResponse } from "next/server";

const GOOGLE_FORM_ACTION =
  "https://docs.google.com/forms/d/e/1FAIpQLSePe6R5VBfqkR8HQ6Q0ctK0Iv-QOdxdLmUnAvJzyWC5cDmLqQ/formResponse";

const FIELD_TYPE        = "entry.1507367897";
const FIELD_DESCRIPTION = "entry.1135993400";
const FIELD_EMAIL       = "entry.998456675";

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

    const body = new URLSearchParams();
    body.set(FIELD_TYPE, type || "other");
    body.set(FIELD_DESCRIPTION, description.trim());
    if (email?.trim()) body.set(FIELD_EMAIL, email.trim());

    await fetch(GOOGLE_FORM_ACTION, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    // Google Forms always redirects — any response means it arrived.
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Feedback proxy error:", err);
    return NextResponse.json({ error: "Failed to submit" }, { status: 500 });
  }
}
