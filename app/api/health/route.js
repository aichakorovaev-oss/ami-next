import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    model:  "gemma-4-31b-it",
    runtime: "next.js",
  });
}
