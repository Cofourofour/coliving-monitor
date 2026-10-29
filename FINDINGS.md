# Findings on mcp.coliving.com, verified 27 October 2026

Everything below was read through the public discovery tools of the Coliving.com MCP server
(`https://mcp.coliving.com/mcp`, no token) and checked by hand against the public website. Listing IDs
are the public `unique_id` values; every link is a public listing page.

## 1. Non-USD listings return USD amounts under the local currency label

`search_listings`, `get_listing` and `check_availability` all return `monthly_price_from` /
"Monthly price" as a USD amount, while `source_currency`, `display_currency` and the display string
carry the listing's own currency. The website shows the same number in USD.

| Listing | City | MCP says | Website shows |
|---|---|---|---|
| [rgxjdwme](https://coliving.com/spaces/rgxjdwme) | Medellín | From COP 1,081.62/mo | From $1,082 /month |
| [dzusso03](https://coliving.com/spaces/dzusso03) | Mexico City | From MXN 925.08/mo | From $926 /month |
| [vl12fuqj](https://coliving.com/spaces/vl12fuqj) | Hong Kong | From HKD 1,337.87/mo | From $1,338 /month |
| [yfkkibzf](https://coliving.com/spaces/yfkkibzf) | Lisbon | From €1,789.79/mo | $1,790 |
| [xvq6okpb](https://coliving.com/spaces/xvq6okpb) | Paris | From €949.77/mo | $950 |
| [tcjizodk](https://coliving.com/spaces/tcjizodk) | London | From £6,960.06/mo | $6,961 |
| [yqttezmi](https://coliving.com/spaces/yqttezmi) | Toronto | From C$1,160.54/mo | $1,161 |
| [iplmnxt6](https://coliving.com/spaces/iplmnxt6) | Singapore | From SGD 2,266.25/mo | $2,267 |

Re-verified 28 October with the website's own currency switcher, which removes any doubt about
which side is wrong: listing rgxjdwme shows "From $1,266 /month" in USD and "From COP 3,969,014 /month"
in COP on coliving.com, while the MCP's `get_listing` says "from COP 1,052.48/month" and the search
card says "From COP 1,265.16/mo" with `source_currency: COP`. Listing dzusso03 shows "From $926 /month"
in USD and "From MX$17,290 /month" in MXN; the MCP says "from MXN 881.55/month".

`currency_conversion_applied` is `false` on every card. On the 27 October snapshot 672 of the 1,000
reachable listings have a non-USD `source_currency`, so every assistant answer about one of them quotes
a wrong price: absurd for COP/MXN/JPY/HKD, quietly 5–30% off for EUR/GBP/CAD/SGD.

Effect on this monitor: all prices are treated as USD, which makes cities comparable. If the label is
fixed upstream the numbers will change currency and `health.js` will need a real FX step.

## 2. The unfiltered search stops at 1,000 items; the server reports 1,142

`search_listings` with no place filter: `pagination.total = 1142`, `total_pages = 58` at 20 per page.
Pages 1–50 return 20 items each; pages 51–58 return `items: []` with `has_next_page: true`. At 50 per
page the server reports 23 pages and pages 21–23 are empty. Changing `sort_by` (date, price, popular)
moves the cut but keeps it at 1,000. So an assistant that searches without a place, or sorts the whole
catalogue by price, never sees 142 published listings (12%), and which ones depends on the sort.

A place filter is not capped: `location_id` 339 (Paris) reports 52 and pages out all 52, of which 28
are absent from the unfiltered 1,000. The monitor therefore pulls the catalogue country by country
(`src/countries.js`, `pullByCountries` in `src/mcp.js`) and reports the difference every day.

## 3. Location data

- `country` is `null` on 999 of 1,000 cards (one card says "Portugal").
- 4 cards have no `location` at all.
- The same place appears as two location strings: "Peniche" and "Peniche, Portugal".
- `search_locations("Bali")` returns the Bali location with `listings_count: 0`; `search_locations("Lisbon")`
  reports 1 listing while the Portugal country location reports 45.
- `search_listings` with a free-text `query` ("Lisbon") does not filter by place: it returns the whole
  catalogue (`total_results` 1142, `location_display` null). Only `location` / `location_id` filter.
- Island places are not children of their country in the location tree. Pulling the 65 countries that
  resolve gave 1,103 of 1,142 listings on 27 October; the rest sit under places no country search
  reaches, plus 4 listings with no location at all. Verified live on 28 October with `search_locations`
  and `search_listings(location_id=…)`:
  - "Bali, Indonesia" (id 250) returns 0 listings; "Ubud, Bali" (id 3001) alone holds 2; "Indonesia"
    (id 102) returns 4 (Badung, Denpasar, Maluk), none of them Ubud.
  - "Santa Cruz de Tenerife" (id 334) holds 3; the 151 listings under "Spain" (id 205) include no
    Tenerife place (43 distinct cities, none on Tenerife).
  - "Funchal, Madeira" (id 2925) holds 4; the 45 under "Portugal" (id 174) include no Funchal.
  - "Catania, Sicily" (id 513) holds 2; the 36 under "Italy" (id 107) include Palermo but not Catania.
  Not claimed: Ibiza and Mallorca resolve to locations with 0 listings; Palma is under Spain.

## 4. Smaller things seen on the way

- `get_host` returns "Response Rate: 0%, Average Response Time: 0 hours" for a host with a 58-review
  listing (Baixa Residence, yfkkibzf): either unpopulated or wrong, but shown as a trust signal.
- `get_listing` and `check_availability` disagree on room prices for the same listing and date
  (rgxjdwme, Essential Room: 1,052.48 vs 1,208.10): probably seasonal pricing, but a reader cannot tell.
- 27 listings show a 5.0 rating on fewer than 3 reviews; 5 listings have reviews but a null rating.
- `summary` is empty on 84% of cards, `download_speed` on 19%, `trust_signals` on 61%.
- Rate limit is 60 requests a minute (`x-ratelimit-limit`); the monitor stays at one a second.
