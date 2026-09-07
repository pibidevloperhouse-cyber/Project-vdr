import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const email = searchParams.get("email");
    const phone = searchParams.get("phone");

    if (!email && !phone) {
      return NextResponse.json({ error: "Email or phone is required" }, { status: 400 });
    }

    let query = supabase.from("users").select("id");
    if (email) {
      query = query.eq("email", email.trim().toLowerCase());
    }
    if (phone) {
      query = query.eq("phone_number", phone.trim());
    }

    const { data: user, error } = await query.single();

    if (error && error.code !== "PGRST116") {
      console.error("Check user error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ exists: !!user });
  } catch (err) {
    console.error("Check user server error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
