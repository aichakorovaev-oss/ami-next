// app/api/recommend/route.js
// Full Ami pipeline: safety → psychologist → librarian → AI Studio (Gemma 4)

import { NextResponse } from "next/server";
import catalogue  from "../../../data/ami_catalogue.json";
import anecdotes  from "../../../data/ami_anecdotes.json";

const MODEL = "gemma-4-31b-it";
const AI_STUDIO_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

// ── AI Studio call ────────────────────────────────────────────────────
async function gemmaCall(prompt, { maxTokens = 400, temperature = 0.75 } = {}) {
  const key = process.env.GOOGLE_AI_STUDIO_KEY;
  if (!key) throw new Error("GOOGLE_AI_STUDIO_KEY is not set");

  const res = await fetch(`${AI_STUDIO_URL}?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: maxTokens, temperature, topP: 0.92 },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`AI Studio ${res.status}: ${err.slice(0, 300)}`);
  }

  const data = await res.json();
  let text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  text = text.replace(/^```json\s*/m, "").replace(/```\s*$/m, "").trim();
  return text;
}

async function gemmaVisionCall(imageB64, prompt, { maxTokens = 300, temperature = 0.6 } = {}) {
  const key = process.env.GOOGLE_AI_STUDIO_KEY;
  if (!key) throw new Error("GOOGLE_AI_STUDIO_KEY is not set");

  // Strip data URL prefix and detect MIME
  let mime = "image/jpeg";
  let rawB64 = imageB64;
  if (imageB64.includes(",") && imageB64.startsWith("data:")) {
    const [header, data] = imageB64.split(",", 2);
    rawB64 = data;
    if (header.includes("image/png"))  mime = "image/png";
    if (header.includes("image/webp")) mime = "image/webp";
    if (header.includes("image/gif"))  mime = "image/gif";
  }

  const res = await fetch(`${AI_STUDIO_URL}?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [
          { inlineData: { mimeType: mime, data: rawB64 } },
          { text: prompt },
        ],
      }],
      generationConfig: { maxOutputTokens: maxTokens, temperature, topP: 0.9 },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`AI Studio vision ${res.status}: ${err.slice(0, 300)}`);
  }

  const data = await res.json();
  let text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  text = text.replace(/^```json\s*/m, "").replace(/```\s*$/m, "").trim();
  return text;
}

function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

// ── Catalogue loader (cached in module scope) ─────────────────────────
let _catalogue = null;

function getCatalogue() {
  if (_catalogue) return _catalogue;

  const seenIds = new Set();
  const allItems = [];

  for (const key of ["films", "series", "novels"]) {
    for (const item of catalogue[key] || []) {
      if (item.id && !seenIds.has(item.id)) {
        seenIds.add(item.id);
        allItems.push(item);
      }
    }
  }
  for (const item of anecdotes.anecdotes || []) {
    if (item.id && !seenIds.has(item.id)) {
      seenIds.add(item.id);
      allItems.push(item);
    }
  }

  const itemsById = Object.fromEntries(allItems.map(i => [i.id, i]));
  const papers    = catalogue?.meta?.papers || [];

  const counts = {};
  for (const i of allItems) if (i.mechanism) counts[i.mechanism] = (counts[i.mechanism] || 0) + 1;

  const tag = (n) =>
    n >= 50 ? "RICH catalogue" :
    n >= 20 ? "good catalogue" :
    n >= 10 ? "limited catalogue" :
    n >= 3  ? "VERY LIMITED — avoid unless perfect fit" :
    "almost no items — DO NOT choose unless absolutely necessary";

  const mechanismBlock = papers.map(p =>
    `- "${p.id}": ${p.mechanism} (${tag(counts[p.id] || 0)}) — ${(p.description || "").slice(0, 150)}`
  ).join("\n");

  const moods = catalogue?.meta?.moods?.map(m => m.key) || [
    "overwhelmed","anxious","sad","angry","exhausted","lonely","empty","lost",
    "guilty","ashamed","discouraged","bored","nostalgic","grieving","melancholic",
    "cynical","doubtful","confused","restless","self_angry","envious",
    "embarrassed","self_disgust","meaningless",
  ];

  _catalogue = { allItems, itemsById, papers, mechanismBlock, moodListStr: moods.join(", ") };
  return _catalogue;
}
// ── Safety ────────────────────────────────────────────────────────────
const CRISIS_RE = [
  /\b(kill|killing)\s+myself\b/i,
  /\bend(ing)?\s+(my|it)\s+(life|all)\b/i,
  /\bi\s+want\s+to\s+die\b/i,
  /\bsuicid(e|al)\b/i,
  /\btake\s+my\s+(own\s+)?life\b/i,
  /\bbetter\s+off\s+(dead|without\s+me|gone)\b/i,
  /\bno\s+(point|reason)\s+(to\s+)?(live|going\s+on)\b/i,
  /\b(cut|cutting|hurt(ing)?|harm(ing)?)\s+myself\b/i,
  /\bself[\s-]?harm\b/i,
  /\bplan\s+to\s+(die|kill|end)\b/i,
  /\b(want\s+to|wanna|wish\s+i\s+could)\s+disappear\b/i,
  /\bnever\s+wake\s+up\b/i,
];

const DISTRESS_RE = [
  /\bcan'?t\s+(go\s+on|do\s+this|take\s+(it|this))\b/i,
  /\bhopeless\b/i,
  /\bworthless\b/i,
  /\bi\s+hate\s+(myself|my\s+life|being\s+alive)\b/i,
  /\bdeep(ly)?\s+depress(ed|ion)\b/i,
  /\bjust\s+lost\s+(my|him|her|them)\b/i,
  /\bcan'?t\s+stop\s+crying\b/i,
];

const CRISIS_RESPONSE = {
  crisis: true,
  blocked: true,
  message: "What you're carrying sounds incredibly heavy. Before anything else, please reach out to someone trained for moments like this.",
  resources: [
    { region: "France",        name: "3114",              detail: "Numéro national de prévention du suicide — 24/7, gratuit" },
    { region: "United States", name: "988",               detail: "Suicide & Crisis Lifeline — call or text" },
    { region: "United Kingdom",name: "116 123",           detail: "Samaritans — free, 24/7" },
    { region: "International", name: "findahelpline.com", detail: "Find a crisis line in your country" },
  ],
  items: [], thesis: "", thematic_data: [], psych_profile: null,
};

async function classifySafety(text, moods) {
  if (CRISIS_RE.some(re => re.test(text))) return { level: "crisis", method: "regex" };

  const severeModsHit = ["grieving","self_disgust","self_angry","ashamed","guilty","meaningless"]
    .filter(m => moods.includes(m)).length;

  if (!text && severeModsHit >= 2) return { level: "high_distress", method: "mood-rule" };
  if (!text) return { level: "normal", method: "mood-rule" };
  if (!DISTRESS_RE.some(re => re.test(text)) && !severeModsHit && text.length < 15)
    return { level: "normal", method: "regex" };

  try {
    const prompt = `You are a safety classifier for a mental wellness app.
User input: "${text.slice(0, 600)}"
Classify into ONE of: "crisis", "high_distress", "normal".
Be CONSERVATIVE — prefer false positives on "crisis".
Respond ONLY with JSON: {"level":"crisis|high_distress|normal","reason":"3-8 words"}`;
    const raw  = await gemmaCall(prompt, { maxTokens: 80, temperature: 0.2 });
    const data = extractJson(raw);
    if (data?.level && ["crisis","high_distress","normal"].includes(data.level))
      return { level: data.level, method: "gemma-judge" };
  } catch (e) {
    console.warn("Safety judge failed:", e.message);
  }

  if (DISTRESS_RE.some(re => re.test(text))) return { level: "high_distress", method: "regex-fallback" };
  return { level: "normal", method: "fallback" };
}

// ── Psychologist ──────────────────────────────────────────────────────
async function runPsychologist(freeText, moods, birthYear, mechanismBlock, moodListStr) {
  const nostalgia = birthYear ? `born ${birthYear}, nostalgia window ${birthYear+8}–${birthYear+16}` : "(not provided)";
  const prompt = `You are the psychological engine of Ami, a science-backed well-being app.

=== USER INPUT ===
Free text: ${freeText || "(no free text provided)"}
Selected moods: ${moods.join(", ") || "(none)"}
Birth year: ${nostalgia}

=== PSYCHOLOGICAL MECHANISMS ===
${mechanismBlock}

=== AVAILABLE MOODS ===
${moodListStr}

Return JSON only, no backticks:
{"emotion_core":"...","primary_mechanism":"...","secondary_mechanism":"...","active_moods":[...],"intensity":"low|medium|high","nostalgia_relevant":false,"nostalgia_decade":null,"humour_relevant":false,"humour_word":null,"surprise_ok":false,"include_anecdote":true,"decoder_note":"..."}`;

  const raw  = await gemmaCall(prompt, { maxTokens: 300, temperature: 0.70 });
  return extractJson(raw) || {
    emotion_core: moods.slice(0,2).join(" / ") || "undefined",
    primary_mechanism: "transport", secondary_mechanism: "elevation",
    active_moods: moods.slice(0,3), intensity: "medium",
    nostalgia_relevant: false, nostalgia_decade: null,
    surprise_ok: false, include_anecdote: true,
    decoder_note: "I sensed something difficult. Here are works that may help.",
  };
}

async function runPsychologistMultimodal(freeText, moods, birthYear, imageB64, mechanismBlock, moodListStr) {
  const nostalgia = birthYear ? `born ${birthYear}, nostalgia window ${birthYear+8}–${birthYear+16}` : "(not provided)";
  const prompt = `You are the psychological engine of Ami.
The user shared an image AND optionally some text. Read both together.

=== USER INPUT ===
Free text: ${freeText || "(image only)"}
Selected moods: ${moods.join(", ") || "(none)"}
Birth year: ${nostalgia}

=== PSYCHOLOGICAL MECHANISMS ===
${mechanismBlock}

=== AVAILABLE MOODS ===
${moodListStr}

Return JSON only, no backticks:
{"image_read":"...","is_meme":false,"is_quote":false,"quote_author":null,"emotion_core":"...","primary_mechanism":"...","secondary_mechanism":"...","active_moods":[...],"intensity":"medium","nostalgia_relevant":false,"nostalgia_decade":null,"humour_relevant":false,"humour_word":null,"surprise_ok":false,"include_anecdote":true,"decoder_note":"..."}`;

  const raw  = await gemmaVisionCall(imageB64, prompt, { maxTokens: 380, temperature: 0.65 });
  const data = extractJson(raw);
  if (!data) return {
    image_read: "(image received, could not decode)", is_meme: false,
    emotion_core: moods.slice(0,2).join(" / ") || "undefined",
    primary_mechanism: "transport", secondary_mechanism: "elevation",
    active_moods: moods.slice(0,3), intensity: "medium",
    nostalgia_relevant: false, nostalgia_decade: null,
    surprise_ok: false, include_anecdote: true,
    decoder_note: "I sensed something in your image.",
  };
  return data;
}

// ── Librarian ─────────────────────────────────────────────────────────
function filterCatalogue(profile, allItems, nonce) {
  const primary   = profile.primary_mechanism || "";
  const secondary = profile.secondary_mechanism || "";
  const moods     = new Set(profile.active_moods || []);
  const decade    = profile.nostalgia_decade;
  const tender    = profile.tone === "tender";
  const requireAnecdote = !!profile.include_anecdote;

  const seed = nonce ? nonce.split("").reduce((a,c) => a + c.charCodeAt(0), 0) : Date.now();
  const rand = (max) => Math.abs(Math.sin(seed * max)) % 1;

  const score = (item) => {
    let s = 0;
    if (item.mechanism === primary)                       s += 10;
    if (item.mechanism === secondary)                     s += 5;
    if ([...moods].some(m => (item.moods||[]).includes(m))) s += 3;
    if (decade && (item.nostalgia_decades||[]).includes(decade)) s += 4;
    if (tender && (item.surprise_factor||1) >= 2)         s -= 3;
    return s;
  };

  const pool = [...allItems]
    .map(i => ({ i, s: score(i) + (rand(i.id?.length||1) - 0.5) * 3 }))
    .sort((a,b) => b.s - a.s)
    .slice(0, 45)
    .map(x => x.i);

  const limits = { film:5, series:4, novel:3, anecdote:3 };
  const counts = {};
  const result = [];
  const used   = new Set();

  // Guarantee at least one anecdote in pool if required
  if (requireAnecdote && !pool.some(i => i.type === "anecdote")) {
    const best = allItems.filter(i => i.type === "anecdote")
      .sort((a,b) => score(b) - score(a))[0];
    if (best) pool.unshift(best);
  }

  for (const item of pool) {
    if (result.length >= 15) break;
    if (used.has(item.id)) continue;
    const t = item.type || "film";
    if ((counts[t]||0) >= (limits[t]||4)) continue;
    result.push(item);
    used.add(item.id);
    counts[t] = (counts[t]||0) + 1;
  }

  return result;
}

async function runLibrarian(profile, allItems, itemsById, papers) {
  const filtered = filterCatalogue(profile, allItems, profile._nonce);

  const compact = filtered.map(i =>
    `${i.id} | ${(i.type||"").padEnd(8)} | ${(i.title||"").slice(0,32)} (${i.year||""}) | ${(i.mechanism||"").slice(0,18)} | ${(i.moods||[]).slice(0,3).join(",")}`
  ).join("\n");

  const primary     = profile.primary_mechanism || "transport";
  const primaryDesc = (papers.find(p => p.id === primary)?.description || "").slice(0,100);
  const anecdoteRule = profile.include_anecdote
    ? "1 anecdote (REQUIRED — already present in the catalogue above)"
    : "no anecdote needed (focus on films/series/novels)";

  const prompt = `You are the recommendation engine of Ami, a science-backed well-being app.

=== PSYCHOLOGICAL PROFILE ===
Emotion: ${profile.emotion_core}
Primary mechanism: ${primary} — ${primaryDesc}
Secondary mechanism: ${profile.secondary_mechanism}
Moods: ${(profile.active_moods||[]).join(", ")}
Intensity: ${profile.intensity}
Nostalgia decade: ${profile.nostalgia_decade || "n/a"}
Tone: ${profile.tone || "warm"}
Open to surprise: ${profile.surprise_ok}
Note: ${profile.decoder_note}

=== CATALOGUE (id | type | title | mechanism | moods) ===
${compact}

=== TASK ===
Pick exactly 4 items. Rules:
- 2+ items matching primary mechanism
- 1 item matching secondary mechanism
- Vary types: pick ${anecdoteRule}, then balance films/series/novels
- Always start with a movie
- If tone is "tender": no humor, no irony, soft and quiet only

For each item write "personal_intro": SHORT HOOK max 12 words addressing "you".
Write a "thesis": 2-3 poetic sentences grounded in the primary mechanism's science.
Fill thematic_data values 0-100.

JSON only, no backticks:
{"items":[{"id":"...","personal_intro":"..."},...],\
"thesis":"...",\
"thematic_data":[{"name":"Nostalgia","value":0},{"name":"Comfort","value":0},{"name":"Wonder","value":0},{"name":"Connection","value":0},{"name":"Surprise","value":0}]}`;

  const raw  = await gemmaCall(prompt, { maxTokens: 400, temperature: 0.78 });
  const data = extractJson(raw);

  if (!data?.items?.length) return {
    items: [], thesis: "Ami has chosen these works with care.", thematic_data: [],
  };

  const enriched = data.items.slice(0,4).map(chosen => {
    const meta = itemsById[chosen.id] || {};
    const isAnecdote = meta.type === "anecdote";
    return {
      ...meta,
      personal_intro: chosen.personal_intro || "",
      description:    isAnecdote ? (meta.anecdote || meta.overview || "") : (meta.overview || ""),
      why:            isAnecdote ? "" : (meta.why || ""),
      paper:          meta.paper || "",
    };
  });

  return { items: enriched, thesis: data.thesis || "", thematic_data: data.thematic_data || [] };
}

// ── Main handler ──────────────────────────────────────────────────────
export async function POST(request) {
  try {
    const body          = await request.json().catch(() => ({}));
    const freeText      = (body.free_text || "").trim();
    const selectedMoods = body.selected_moods || [];
    const birthYear     = body.birth_year;
    const bypassSafety  = !!body.continue_anyway;
    const nonce         = body.nonce;
    const imageB64      = body.image_b64 || null;

    if (!freeText && !selectedMoods.length && !imageB64) {
      return NextResponse.json({ error: "Provide free_text, selected_moods, or image_b64" }, { status: 400 });
    }

    const { allItems, itemsById, papers, mechanismBlock, moodListStr } = await getCatalogue();

    // ── Vision + Psychologist ────────────────────────────────────────
    let psychProfile, visionInsight, enrichedText = freeText;

    if (imageB64) {
      psychProfile = await runPsychologistMultimodal(freeText, selectedMoods, birthYear, imageB64, mechanismBlock, moodListStr);
      enrichedText = (freeText ? freeText + " " : "") + `[image: ${psychProfile.image_read || ""}]`;
      visionInsight = {
        input_type:   freeText ? "image+text" : "image",
        understanding: psychProfile.image_read || psychProfile.decoder_note || "",
        emotion_core:  psychProfile.emotion_core || "",
        is_meme:       psychProfile.is_meme || false,
        is_quote:      psychProfile.is_quote || false,
        quote_author:  psychProfile.quote_author || null,
        active_moods:  psychProfile.active_moods || [],
        decoder_note:  psychProfile.decoder_note || "",
      };
    }

    // ── Safety ───────────────────────────────────────────────────────
    const safety = await classifySafety(enrichedText, selectedMoods);
    if (safety.level === "crisis" && !bypassSafety) {
      return NextResponse.json({ ...CRISIS_RESPONSE, safety });
    }

    // ── Text psychologist ────────────────────────────────────────────
    if (!psychProfile) {
      psychProfile = await runPsychologist(enrichedText, selectedMoods, birthYear, mechanismBlock, moodListStr);
      visionInsight = {
        input_type:   "text",
        understanding: psychProfile.decoder_note || freeText.slice(0,120),
        emotion_core:  psychProfile.emotion_core || "",
        is_meme: false, is_quote: false, quote_author: null,
        active_moods:  psychProfile.active_moods || [],
        decoder_note:  psychProfile.decoder_note || "",
      };
    }

    if (["high_distress","crisis"].includes(safety.level)) {
      psychProfile.surprise_ok = false;
      psychProfile.tone = "tender";
    } else {
      psychProfile.tone = psychProfile.tone || "warm";
    }
    psychProfile._nonce = nonce;

    // ── Librarian ────────────────────────────────────────────────────
    const result = await runLibrarian(psychProfile, allItems, itemsById, papers);

    return NextResponse.json({
      crisis:        false,
      thesis:        result.thesis,
      items:         result.items,
      thematic_data: result.thematic_data,
      psych_profile: {
        emotion_core:      psychProfile.emotion_core,
        primary_mechanism: psychProfile.primary_mechanism,
        decoder_note:      psychProfile.decoder_note,
        intensity:         psychProfile.intensity,
        tone:              psychProfile.tone,
      },
      vision_insight: visionInsight,
      safety,
    });

  } catch (err) {
    console.error("recommend error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin":  "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
