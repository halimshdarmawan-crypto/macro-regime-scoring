// Proxy FRED API. Mengunci units/frequency/aggregation_method per indikator
// supaya tidak ada lagi salah pilih transform seperti yang terjadi saat input manual.
// API key disimpan sebagai Cloudflare Pages secret (FRED_API_KEY), tidak pernah
// dikirim ke browser.

const PRESETS = {
  "yield-curve": {
    series_id: "T10Y2Y",
    units: "lin",
    frequency: "m",
    aggregation_method: "eop",
  },
  nfp: {
    series_id: "PAYEMS",
    units: "chg",
    frequency: "m",
  },
  "retail-sales": {
    series_id: "RSXFS",
    units: "pch",
    frequency: "m",
  },
  cpi: {
    series_id: "CPIAUCSL",
    units: "pc1",
    frequency: "m",
  },
  "fed-funds": {
    series_id: "FEDFUNDS",
    units: "lin",
    frequency: "m",
  },
  "crude-oil": {
    series_id: "DCOILWTICO",
    units: "pc1",
    frequency: "m",
    aggregation_method: "eop",
  },
};

export async function onRequestGet(context) {
  const { params, env } = context;
  const path = Array.isArray(params.path)
    ? params.path.join("/")
    : String(params.path || "");
  const preset = PRESETS[path];

  if (!preset) {
    return new Response(
      JSON.stringify({
        error: `Indikator tidak dikenal: ${path}`,
        available: Object.keys(PRESETS),
      }),
      { status: 404, headers: { "content-type": "application/json" } }
    );
  }

  if (!env.FRED_API_KEY) {
    return new Response(
      JSON.stringify({
        error: "FRED_API_KEY belum diset sebagai Cloudflare Pages secret",
      }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }

  const url = new URL("https://api.stlouisfed.org/fred/series/observations");
  url.searchParams.set("series_id", preset.series_id);
  url.searchParams.set("units", preset.units);
  url.searchParams.set("frequency", preset.frequency);
  if (preset.aggregation_method) {
    url.searchParams.set("aggregation_method", preset.aggregation_method);
  }
  url.searchParams.set("sort_order", "desc");
  url.searchParams.set("limit", "3");
  url.searchParams.set("file_type", "json");
  url.searchParams.set("api_key", env.FRED_API_KEY);

  let fredResponse;
  try {
    fredResponse = await fetch(url.toString());
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Gagal menghubungi FRED", detail: String(err) }),
      { status: 502, headers: { "content-type": "application/json" } }
    );
  }

  if (!fredResponse.ok) {
    const detail = await fredResponse.text();
    return new Response(
      JSON.stringify({
        error: "FRED mengembalikan error",
        status: fredResponse.status,
        detail,
      }),
      { status: 502, headers: { "content-type": "application/json" } }
    );
  }

  const data = await fredResponse.json();
  const observations = (data.observations || [])
    .filter((o) => o.value !== ".")
    .map((o) => ({ date: o.date, value: parseFloat(o.value) }));

  return new Response(
    JSON.stringify({
      indicator: path,
      series_id: preset.series_id,
      latest: observations[0] || null,
      previous: observations[1] || null,
    }),
    {
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    }
  );
}
