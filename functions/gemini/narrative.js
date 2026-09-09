// Proxy Gemini API untuk generate narasi analisis dari ringkasan skor.
// API key disimpan sebagai Cloudflare Pages secret (GEMINI_API_KEY).
// Catatan: nama model Gemini bisa berubah — cek console.cloud.google.com atau
// dokumentasi Gemini kalau endpoint ini mulai gagal, ganti GEMINI_MODEL di bawah.

const GEMINI_MODEL = "gemini-3.6-flash";

function buildPrompt(body) {
  const {
    growthScore,
    inflationScore,
    quadrant,
    indicators = [],
    allocation = [],
  } = body;

  const indikatorLines = indicators
    .map((i) => ` * ${i.label}: ${i.scoreLabel}`)
    .join("\n");

  const alokasiLines = allocation
    .map((a) => {
      const gapSign = a.gap > 0 ? "+" : "";
      return ` * ${a.name}: Saat Ini [${a.current}%] -> Target [${a.target}%] (Gap: ${gapSign}${a.gap}%)`;
    })
    .join("\n");

  return `Saya menjalankan model Macro-Regime Tactical Asset Allocation bulanan untuk portofolio 5 aset (Saham, Kripto, Gold, Fixed Income, Cash). Berikut adalah ringkasan output model bulan ini: * Growth Score: ${growthScore >= 0 ? "+" : ""}${growthScore.toFixed(2)} ${indikatorLines} * Inflation Score: ${inflationScore >= 0 ? "+" : ""}${inflationScore.toFixed(2)} * Kuadran Makro Aktif: ${quadrant} * Alokasi Saat Ini vs Target Model: ${alokasiLines} Tolong buatkan analisis naratif komprehensif yang menjelaskan: 1. Dinamika Makro: Mengapa kondisi ekonomi saat ini memicu status rezim tersebut? 2. Rasional Rebalancing: Mengapa model menyarankan perubahan alokasi ini dari sudut pandang siklus makro 3-6 bulan ke depan? 3. Rencana Eksekusi Bertahap: Bagaimana strategi rebalancing terbaik agar tidak mengalami slippage atau salah momen di pasar? Gunakan bahasa akumulasi (bukan sinyal BUY/SELL ala trader), dan jangan berikan skor kepercayaan numerik karena model ini sengaja menghindari kesan presisi palsu.`;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.GEMINI_API_KEY) {
    return new Response(
      JSON.stringify({
        error: "GEMINI_API_KEY belum diset sebagai Cloudflare Pages secret",
      }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Body request bukan JSON valid" }),
      {
        status: 400,
        headers: { "content-type": "application/json" },
      }
    );
  }

  const prompt = buildPrompt(body);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`;

  let geminiResponse;
  try {
    geminiResponse = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: "Gagal menghubungi Gemini",
        detail: String(err),
      }),
      { status: 502, headers: { "content-type": "application/json" } }
    );
  }

  if (!geminiResponse.ok) {
    const detail = await geminiResponse.text();
    return new Response(
      JSON.stringify({
        error: "Gemini mengembalikan error",
        status: geminiResponse.status,
        detail,
      }),
      { status: 502, headers: { "content-type": "application/json" } }
    );
  }

  const data = await geminiResponse.json();
  const narrative =
    data?.candidates?.[0]?.content?.parts?.[0]?.text ||
    "Gemini tidak mengembalikan teks. Coba lagi sebentar lagi.";

  return new Response(JSON.stringify({ narrative }), {
    headers: { "content-type": "application/json" },
  });
}
