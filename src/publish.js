// Publishes the report as one WordPress page on laurensborrey.com through the REST API.
// Needs LB_WP_URL, LB_WP_USER, LB_WP_APP_PASSWORD (an application password; never committed).
'use strict';

const SLUG = process.env.LB_PAGE_SLUG || 'coliving-supply-monitor';
const TITLE = process.env.LB_PAGE_TITLE || 'Coliving.com Supply Monitor';

// The theme caps every block at 645px and adds side padding; this reset (same as the other pages on the
// site) lets a full-width report render as one.
const RESET = '<style id="lb-wp-reset">.entry-content.is-layout-constrained > *, .wp-block-post-content > * { max-width: none !important; margin-left: 0 !important; margin-right: 0 !important; } .has-global-padding { padding-left: 0 !important; padding-right: 0 !important; } .wp-block-group.alignfull, .entry-content.alignfull { margin-left: 0 !important; margin-right: 0 !important; width: 100% !important; } html, body { overflow-x: clip; } .entry-content > *, .wp-site-blocks > * { margin-block-start: 0 !important; } .wp-block-group.alignfull.has-global-padding { padding-top: 0 !important; }</style>';

async function publish(html) {
  const { LB_WP_URL, LB_WP_USER, LB_WP_APP_PASSWORD } = process.env;
  const auth = 'Basic ' + Buffer.from(`${LB_WP_USER}:${LB_WP_APP_PASSWORD}`).toString('base64');
  const api = async (p, opts = {}) => {
    const r = await fetch(`${LB_WP_URL}/wp-json/wp/v2${p}`, { ...opts, headers: { Authorization: auth, 'Content-Type': 'application/json' } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${opts.method || 'GET'} ${p} -> ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
    return j;
  };
  if (html.includes('&&')) throw new Error('report contains && (WordPress mangles it)');
  const content = `<!-- wp:html -->\n${RESET}\n${html}\n<!-- /wp:html -->`;
  const found = await api(`/pages?slug=${encodeURIComponent(SLUG)}&status=publish,draft,private&_fields=id,link`);
  const page = found.length
    ? await api(`/pages/${found[0].id}`, { method: 'POST', body: JSON.stringify({ title: TITLE, content, status: 'publish' }) })
    : await api('/pages', { method: 'POST', body: JSON.stringify({ title: TITLE, slug: SLUG, content, status: 'publish' }) });
  return page.link;
}

module.exports = { publish };
