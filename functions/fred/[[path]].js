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
    .map((i) => `   * ${i.label}: ${i.scoreLabel}`)
    .join("\n");

  const alokasiLines = allocation
    .map((a) => {
      const gapSign = a.gap > 0 ? "+" : "";
      return `   * ${a.name}: Saat Ini [${a.current}%] -> Target [${a.target}%] (Gap: ${gapSign}${a.gap}%)`;
    })
    .join("\n");

  return `Saya menjalankan model Macro-Regime Tactical Asset Allocation bulanan untuk portofolio 5 aset (Saham, Kripto, Gold, Fixed Income, Cash/RDPU).

Berikut adalah ringkasan output model bulan ini:

* Growth Score: ${growthScore >= 0 ? "+" : ""}${growthScore.toFixed(2)}
${indikatorLines}

* Inflation Score: ${inflationScore >= 0 ? "+" : ""}${inflationScore.toFixed(2)}

* Kuadran Makro Aktif: ${quadrant}

* Alokasi Saat Ini vs Target Model:
${alokasiLines}

Tulis analisis dengan MENGIKUTI PERSIS kerangka berikut, tanpa menambah atau mengubah struktur:

## 1. Dinamika Makro
[2-3 kalimat ringkasan kenapa rezim "${quadrant}" ini terjadi]
- **Growth Score (${growthScore.toFixed(2)}):** [1-2 kalimat, sebut indikator growth yang relevan]
- **Inflation Score (${inflationScore.toFixed(2)}):** [1-2 kalimat, sebut indikator inflation yang relevan]

**Kesimpulan Rezim:** [1 kalimat penutup]

## 2. Rasional Rebalancing
Untuk SETIAP aset di atas (urutan sama seperti data), tulis PERSIS format ini, satu per aset:
**[Nama Aset] ([current]% → [target]% | Gap: [gap]%): [AKSI]**
Rasional: [2-3 kalimat, hubungkan ke indikator yang relevan]

## 3. Rencana Eksekusi Bertahap
Tulis 3-4 tahap mingguan berurutan (Minggu 1, Minggu 2, dst) sebagai bullet list biasa. Setiap tahap: satu aksi konkret + satu alasan singkat.

ATURAN FORMAT WAJIB (pelanggaran terhadap salah satu ini membuat jawaban tidak valid):
1. Hanya gunakan Markdown standar: heading (##), bold (**teks**), bullet (-). Tidak ada elemen lain.
2. DILARANG memakai notasi LaTeX/matematika apapun (seperti $\\rightarrow$, \\times, atau backslash lain). Untuk tanda panah pakai karakter → biasa.
3. DILARANG memakai blok kode (tanda tiga backtick), tabel, atau diagram ASCII dalam bentuk apapun.
4. WAJIB menyebut nama rezim PERSIS "${quadrant}" — jangan menciptakan nama rezim lain (misal jangan diganti jadi "Soft-Landing" atau istilah lain).
5. WAJIB pakai bahasa akumulasi (AKUMULASI KUAT / AKUMULASI / HOLD-NETRAL / KURANGI EXPOSURE / DISTRIBUSI) untuk aksi, JANGAN pakai BUY/SELL.
6. JANGAN tampilkan skor kepercayaan numerik tambahan di luar Growth Score dan Inflation Score yang sudah diberikan.`;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.GEMINI_API_KEY) {
    return new Response(
      JSON.stringify({ error: "GEMINI_API_KEY belum diset sebagai Cloudflare Pages secret" }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return new Response(JSON.stringify({ error: "Body request bukan JSON valid" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
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
        generationConfig: {
          temperature: 0.2,
        },
      }),
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Gagal menghubungi Gemini", detail: String(err) }),
      { status: 502, headers: { "content-type": "application/json" } }
    );
  }

  if (!geminiResponse.ok) {
    const detail = await geminiResponse.text();
    return new Response(
      JSON.stringify({ error: "Gemini mengembalikan error", status: geminiResponse.status, detail }),
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
