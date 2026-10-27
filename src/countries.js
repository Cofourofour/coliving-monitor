// Country discovery. The MCP has no "list locations" tool and listing cards carry country: null, so the
// countries that hold listings are found once by resolving a static list of country names through
// search_locations and keeping the ones with listings. Cached in data/countries.json; refreshed when
// older than a week or when run with --refresh-countries.
'use strict';

const fs = require('fs');
const path = require('path');
const { call } = require('./mcp');

const NAMES = ['Afghanistan', 'Albania', 'Algeria', 'Andorra', 'Angola', 'Argentina', 'Armenia', 'Australia', 'Austria', 'Azerbaijan', 'Bahamas', 'Bahrain', 'Bangladesh', 'Barbados', 'Belarus', 'Belgium', 'Belize', 'Benin', 'Bhutan', 'Bolivia', 'Bosnia and Herzegovina', 'Botswana', 'Brazil', 'Brunei', 'Bulgaria', 'Burkina Faso', 'Cambodia', 'Cameroon', 'Canada', 'Cape Verde', 'Chile', 'China', 'Colombia', 'Costa Rica', 'Croatia', 'Cuba', 'Cyprus', 'Czech Republic', 'Denmark', 'Dominican Republic', 'Ecuador', 'Egypt', 'El Salvador', 'Estonia', 'Ethiopia', 'Fiji', 'Finland', 'France', 'Georgia', 'Germany', 'Ghana', 'Greece', 'Guatemala', 'Honduras', 'Hong Kong', 'Hungary', 'Iceland', 'India', 'Indonesia', 'Iran', 'Iraq', 'Ireland', 'Israel', 'Italy', 'Jamaica', 'Japan', 'Jordan', 'Kazakhstan', 'Kenya', 'Kosovo', 'Kuwait', 'Kyrgyzstan', 'Laos', 'Latvia', 'Lebanon', 'Lithuania', 'Luxembourg', 'Macau', 'Madagascar', 'Malaysia', 'Maldives', 'Malta', 'Mauritius', 'Mexico', 'Moldova', 'Monaco', 'Mongolia', 'Montenegro', 'Morocco', 'Mozambique', 'Myanmar', 'Namibia', 'Nepal', 'Netherlands', 'New Zealand', 'Nicaragua', 'Nigeria', 'North Macedonia', 'Norway', 'Oman', 'Pakistan', 'Panama', 'Paraguay', 'Peru', 'Philippines', 'Poland', 'Portugal', 'Puerto Rico', 'Qatar', 'Romania', 'Russia', 'Rwanda', 'Saudi Arabia', 'Senegal', 'Serbia', 'Seychelles', 'Singapore', 'Slovakia', 'Slovenia', 'South Africa', 'South Korea', 'Spain', 'Sri Lanka', 'Sweden', 'Switzerland', 'Taiwan', 'Tanzania', 'Thailand', 'Trinidad and Tobago', 'Tunisia', 'Turkey', 'Uganda', 'Ukraine', 'United Arab Emirates', 'United Kingdom', 'United States', 'Uruguay', 'Uzbekistan', 'Venezuela', 'Vietnam', 'Zambia', 'Zimbabwe',
  // Island regions that are not children of their country in the location tree (found 27 Oct 2026:
  // Bali listings are not under Indonesia, Tenerife not under Spain, Madeira not under Portugal).
  'Bali', 'Lombok', 'Tenerife', 'Gran Canaria', 'Lanzarote', 'Fuerteventura', 'Canary Islands', 'Ibiza', 'Mallorca', 'Menorca', 'Balearic Islands', 'Madeira', 'Azores', 'Sicily', 'Sardinia', 'Corsica', 'Crete', 'Curaçao', 'Aruba', 'Réunion', 'Mauritius', 'Zanzibar', 'Phuket', 'Koh Samui', 'Koh Phangan', 'Hawaii', 'Guadeloupe', 'Martinique', 'French Polynesia', 'Canary'];

const FILE = () => path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'countries.json');

async function discover(log = () => {}) {
  const found = [];
  for (const name of NAMES) {
    try {
      const r = await call('search_locations', { query: name });
      // City-states (Singapore, Hong Kong) come back as type city; an exact name match of any type counts.
      const locs = r.locations || [];
      const c = locs.find((l) => l.type === 'country' && l.name.toLowerCase() === name.toLowerCase())
        || locs.find((l) => l.name.toLowerCase() === name.toLowerCase() && l.listings_count > 0)
        || locs.find((l) => l.name.toLowerCase().startsWith(name.toLowerCase() + ',') && l.listings_count > 0)
        || locs.find((l) => l.type === 'country' && l.listings_count > 0);
      if (c && c.listings_count > 0) found.push({ name: c.name, location_id: c.location_id, listings_count: c.listings_count });
    } catch (e) { log(`country ${name}: ${e.message.slice(0, 80)}`); }
  }
  // One entry per location_id (two names can resolve to the same place).
  const seen = new Set();
  const unique = found.filter((c) => { if (seen.has(c.location_id)) return false; seen.add(c.location_id); return true; });
  found.length = 0; found.push(...unique);
  found.sort((a, b) => b.listings_count - a.listings_count);
  fs.mkdirSync(path.dirname(FILE()), { recursive: true });
  fs.writeFileSync(FILE(), JSON.stringify({ discovered_at: new Date().toISOString(), countries: found }, null, 1));
  return found;
}

async function countries({ refresh = false, maxAgeDays = 7, log } = {}) {
  if (!refresh && fs.existsSync(FILE())) {
    const c = JSON.parse(fs.readFileSync(FILE(), 'utf8'));
    if (Date.now() - new Date(c.discovered_at).getTime() < maxAgeDays * 86400e3) return c.countries;
  }
  return discover(log);
}

module.exports = { countries, discover, NAMES };
