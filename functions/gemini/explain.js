// Barbell Emas x Kripto DCA — Gemini Explain Pages Function
// Gemini di sini adalah JURU BAHASA, bukan wasit: dia menerima angka yang
// SUDAH dihitung di browser (rumus overlay tetap dari workbook, tidak
// disentuh model bahasa) dan cuma merangkai penjelasan + mengingatkan
// aturan barbell. Dipanggil on-demand (tombol), bukan tiap refresh.

const GEMINI_MODEL = "gemini-3.6-flash";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
    },
  });
}

function buildPrompt(payload) {
  const {
    regimeRaw,
    regimeUsed,
    lockActive,
    lockDaysLeft,
    growthScore,
    fcScore,
    inflationScore,
    tiltEmas,
    tiltKripto,
    splitStrategis,
    pecahan, // { emas, btc, sol } as fractions of this month's DCA
    dcaAmountIdr,
    nominal, // { emas, btc, sol } in IDR
    stok, // optional: { emasWeight, kryptoWeight, gapVsStrategis } or null
    dataStale, // array of indicator keys currently stale/fallback
  } = payload;

  return `Kamu adalah juru bahasa untuk sebuah alat barbell DCA pribadi (Emas x Kripto), BUKAN penasihat keuangan dan BUKAN wasit keputusan. Semua angka di bawah SUDAH dihitung oleh rumus tetap (TANH overlay + split strategis dari workbook Excel) — tugasmu HANYA menjelaskan angka ini dalam Bahasa Indonesia, bukan menghitung ulang atau mengusulkan angka baru.

DATA (JSON, jangan diubah, jangan dibulatkan ulang):
${JSON.stringify(
  {
    regimeRaw,
    regimeUsed,
    lockActive,
    lockDaysLeft,
    growthScore,
    fcScore,
    inflationScore,
    tiltEmas,
    tiltKripto,
    splitStrategis,
    pecahan,
    dcaAmountIdr,
    nominal,
    stok,
    dataStale,
  },
  null,
  2
)}

ATURAN KERAS ALAT INI (kutip kalau relevan, jangan dilanggar dalam penjelasanmu):
1. Split strategis 55/45 (Emas/Kripto) jarang diubah — overlay taktis cuma menggeser ±10 poin (±15 khusus stagflation ke emas), dan HANYA memengaruhi uang DCA baru, bukan stok yang sudah ada.
2. Lantai keras: emas tidak boleh di bawah 25%, kripto tidak boleh di bawah 20% dari DCA bulan ini.
3. SOL maksimum 30% dari porsi kripto.
4. Kunci rezim 60 hari — kalau lockActive true, rezim yang dipakai TETAP rezim lama meski sinyal mentah (regimeRaw) sudah berbeda; jelaskan ini secara eksplisit supaya user tidak bingung kenapa rezim tidak berubah.
5. Ini BUKAN sinyal jual. Kalau ada data sinyal lunak (stok), tekankan itu cuma memengaruhi ke mana DCA BERIKUTNYA diarahkan, bukan perintah menjual emas fisik atau kripto yang sudah dipegang.
6. Jangan pernah menyarankan all-in ke satu aset, opsi, leverage, atau timing harian.

FORMAT WAJIB (Markdown murni, TIDAK BOLEH menyimpang):
- Judul section pakai heading level 2 (##), tidak lebih dalam.
- Hanya boleh: heading ##, teks tebal **, dan bullet list -. DILARANG: tabel Markdown, blok kode, notasi LaTeX ($...$ atau \\(...\\)), diagram ASCII, nomor urut manual.
- Sebutkan persis nama rezim yang dipakai (regimeUsed) dan rezim mentah (regimeRaw) jika berbeda — jangan diparafrase jadi istilah lain.
- Kalau dataStale tidak kosong, sebutkan secara singkat di bagian pertama bahwa sebagian data memakai nilai terakhir yang tersimpan (bukan data hari ini), tanpa membuat ini terdengar seperti krisis.
- Jangan tambahkan skor keyakinan/confidence numerik apa pun di luar angka yang sudah diberikan.

STRUKTUR JAWABAN (3 bagian, masing-masing 2-4 kalimat atau 3-5 bullet):
## Dinamika Overlay Bulan Ini
Jelaskan growth/FC/inflasi score, rezim mentah vs rezim dipakai, dan status kunci 60 hari.

## Rasional Tilt
Jelaskan kenapa tilt emas/kripto sebesar itu untuk rezim yang dipakai, dan bagaimana itu dibatasi lantai 25%/20% serta kap SOL 30%.

## Ringkasan Eksekusi DCA Bulan Ini
Sebutkan nominal Rupiah per aset (emas/BTC/SOL) dan ingatkan sekali lagi ini pecahan untuk DCA baru, bukan instruksi terhadap stok lama.

Tulis dengan nada tenang, ringkas, tidak menjual mimpi, dan selalu memakai bahasa akumulasi (bukan BUY/SELL).`;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.GEMINI_API_KEY) {
    return jsonResponse({ error: "GEMINI_API_KEY belum diset di Pages secrets" }, 500);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "Body harus JSON valid" }, 400);
  }

  const prompt = buildPrompt(payload);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2 },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return jsonResponse({ error: `Gemini API gagal (HTTP ${res.status})`, detail: errText }, 502);
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      return jsonResponse({ error: "Gemini tidak mengembalikan teks (kemungkinan diblok safety filter atau token habis)" }, 502);
    }

    return jsonResponse({ narrative: text });
  } catch (err) {
    return jsonResponse({ error: `Gagal memanggil Gemini: ${err.message}` }, 502);
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
    },
  });
}
