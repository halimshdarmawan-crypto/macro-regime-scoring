// Barbell Emas x Kripto DCA — Quotes Pages Function
// Satu endpoint: GET /quotes/all
// Mengembalikan harga (BTC/SOL/USDIDR/Gold) + 5 indikator makro overlay.
// Cadence yang cocok (bukan real-time): harga di-cache 15 menit di sisi klien,
// makro di-cache harian. Endpoint ini sendiri stateless — caching TTL diatur
// di frontend (localStorage), bukan di sini, supaya sederhana.

const FRED_BASE = "https://api.stlouisfed.org/fred/series/observations";

// Preset FRED terkunci per indikator — jangan diubah ad-hoc, ini yang bikin
// unit/frequency konsisten dengan asumsi rumus tanh di sheet 03_Makro.
const FRED_PRESETS = {
  yield_curve: { series_id: "T10Y2Y", units: "lin", frequency: "m", aggregation_method: "eop", limit: 3 },
  real_yield: { series_id: "DFII10", units: "lin", frequency: "m", aggregation_method: "eop", limit: 3 },
  dxy_proxy: { series_id: "DTWEXBGS", units: "lin", frequency: "m", aggregation_method: "eop", limit: 3 },
  cpi_yoy: { series_id: "CPIAUCSL", units: "pc1", frequency: "m", limit: 3 },
  wti_yoy: { series_id: "DCOILWTICO", units: "pc1", frequency: "m", aggregation_method: "eop", limit: 3 },
  // gold_usd sengaja TIDAK ADA di sini. FRED sudah mempensiunkan
  // GOLDAMGBD228NLBM (seri harga emas harian LBMA) — bukan salah kode,
  // sumbernya sendiri sudah mati (HTTP 400 dari FRED), dan tidak ada
  // pengganti FRED yang memberi level harga $/oz (cuma index).
  // XAU/USD sekarang diambil dari CoinGecko lewat fetchCrypto() di bawah
  // (proxy PAXG/XAUT — token emas fisik), bukan dari FRED.
};

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

async function fetchFredSeries(key, apiKey) {
  const preset = FRED_PRESETS[key];
  const url = new URL(FRED_BASE);
  url.searchParams.set("series_id", preset.series_id);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("file_type", "json");
  url.searchParams.set("units", preset.units);
  url.searchParams.set("frequency", preset.frequency);
  if (preset.aggregation_method) url.searchParams.set("aggregation_method", preset.aggregation_method);
  url.searchParams.set("sort_order", "desc");
  url.searchParams.set("limit", String(preset.limit));

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`FRED ${key} HTTP ${res.status}`);
  const data = await res.json();
  const valid = (data.observations || []).filter((o) => o.value !== ".");
  if (valid.length === 0) throw new Error(`FRED ${key}: tidak ada observasi valid`);
  return {
    latest: { date: valid[0].date, value: parseFloat(valid[0].value) },
    previous: valid[1] ? { date: valid[1].date, value: parseFloat(valid[1].value) } : null,
    series_id: preset.series_id,
  };
}

async function fetchCrypto(cgApiKey) {
  // pax-gold (PAXG) & tether-gold (XAUT): masing-masing token = 1 troy oz
  // emas fisik tersimpan di brankas, ditukar-rupiahkan lewat exchange —
  // proxy XAU/USD paling realistis yang ada di CoinGecko tanpa API gold
  // terpisah. PAXG dipakai utama (lebih likuid), XAUT fallback.
  const url =
    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,solana,pax-gold,tether-gold&vs_currencies=usd&include_last_updated_at=true";
  const headers = {
    accept: "application/json",
    "user-agent": "Mozilla/5.0 (compatible; BarbellDCA/1.0; +https://pages.dev)",
  };
  // Demo API key CoinGecko (gratis, daftar di coingecko.com/en/developers/dashboard)
  // memindahkan kuota dari pool anonim bersama ke kuota milik akun sendiri —
  // jauh lebih tahan dari 403/rate-limit. Opsional: kalau secret belum diset,
  // tetap jalan lewat endpoint publik seperti sebelumnya.
  if (cgApiKey) headers["x-cg-demo-api-key"] = cgApiKey;

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
  const data = await res.json();

  let goldUsd = null;
  let goldSource = null;
  if (data["pax-gold"]?.usd) {
    goldUsd = data["pax-gold"].usd;
    goldSource = "PAXG";
  } else if (data["tether-gold"]?.usd) {
    goldUsd = data["tether-gold"].usd;
    goldSource = "XAUT";
  }

  return {
    btc_usd: data.bitcoin?.usd ?? null,
    sol_usd: data.solana?.usd ?? null,
    gold_usd: goldUsd,
    gold_source: goldSource,
    fetched_unix: data.bitcoin?.last_updated_at ?? null,
  };
}

async function fetchUsdIdr() {
  const url = "https://api.frankfurter.app/latest?from=USD&to=IDR";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Frankfurter HTTP ${res.status}`);
  const data = await res.json();
  return { usdidr: data.rates?.IDR ?? null, date: data.date ?? null };
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, OPTIONS",
      },
    });
  }

  if (!url.pathname.endsWith("/all")) {
    return jsonResponse({ error: "Endpoint tidak dikenal. Pakai /quotes/all" }, 404);
  }

  if (!env.FRED_API_KEY) {
    return jsonResponse({ error: "FRED_API_KEY belum diset di Pages secrets" }, 500);
  }

  const out = { fetched_at: new Date().toISOString(), macro: {}, errors: [] };

  // Jalankan semua fetch paralel, tapi tiap sumber gagal sendiri-sendiri
  // (graceful degradation) — satu sumber mati tidak boleh menjatuhkan semua.
  // Gold sengaja tidak ada di sini — lihat catatan di FRED_PRESETS, isi manual di UI.
  const [crypto, usdidr, ...macroResults] = await Promise.allSettled([
    fetchCrypto(env.COINGECKO_API_KEY),
    fetchUsdIdr(),
    fetchFredSeries("yield_curve", env.FRED_API_KEY),
    fetchFredSeries("real_yield", env.FRED_API_KEY),
    fetchFredSeries("dxy_proxy", env.FRED_API_KEY),
    fetchFredSeries("cpi_yoy", env.FRED_API_KEY),
    fetchFredSeries("wti_yoy", env.FRED_API_KEY),
  ]);

  if (crypto.status === "fulfilled") out.crypto = crypto.value;
  else out.errors.push(`crypto: ${crypto.reason}`);

  if (usdidr.status === "fulfilled") out.usdidr = usdidr.value;
  else out.errors.push(`usdidr: ${usdidr.reason}`);

  const macroKeys = ["yield_curve", "real_yield", "dxy_proxy", "cpi_yoy", "wti_yoy"];
  macroKeys.forEach((key, i) => {
    const r = macroResults[i];
    if (r.status === "fulfilled") out.macro[key] = r.value;
    else out.errors.push(`${key}: ${r.reason}`);
  });

  return jsonResponse(out);
}
