import 'dotenv/config';
import fetch from 'node-fetch';
import { parseStringPromise } from 'xml2js';

const {
  LETTERBOXD_USER,
  WP_SITE,
  WP_USER,
  WP_APP_PASSWORD,
  MOVIE_CATEGORY_ID
} = process.env;

const MAX_POSTS_PER_RUN = Number(process.env.MAX_POSTS_PER_RUN || 5);
const POST_DELAY_MS = Number(process.env.POST_DELAY_MS || 1500);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const RSS_URL = `https://letterboxd.com/${LETTERBOXD_USER}/rss/`;
const WP_BASE = `https://public-api.wordpress.com/rest/v1.1/sites/${WP_SITE}`;

const authHeader = 'Basic ' + Buffer.from(`${WP_USER}:${WP_APP_PASSWORD}`).toString('base64');

const lastRunKey = 'letterboxd_last_guids';

// utilities

let accessToken = process.env.WP_APP_PASSWORD; // TODO: obtain Access Token from refresh func
const clientId = process.env.WP_CLIENT_ID;
const clientSec = process.env.WP_CLIENT_SECRET;

const bearer = () => ({ Authorization: `Bearer ${accessToken}` });

async function refreshTokenIfNeeded(res) {
  if (res.status !== 401) return res;        // still valid
  console.log('🔄  Access token expired – refreshing…');

  const form = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSec,
    grant_type: 'refresh_token',
    refresh_token: refreshTok
  });
  const r = await fetch('https://public-api.wordpress.com/oauth2/token', {
    method: 'POST',
    body: form
  }).then(r => r.json());

  if (!r.access_token) throw new Error('Failed to refresh token');
  accessToken = r.access_token;              // update token in memory
  return null;                               // caller will retry
}


const wpGet = async path => {
  console.log(`GET ${path}`);
  const res = await fetch(`${WP_BASE}${path}`, {
    headers: { Authorization: authHeader }
  });

  if (res.status === 404) return null;         // option not created yet
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`WP GET ${path} → ${res.status}\n${txt}`);
  }
  return res.json();
};

const wpPost = async (path, body) => {

  console.log(`POST ${path}`, JSON.stringify(body, null, 2));

  const res = await fetch(`${WP_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const text = await res.text();
  try {
    const json = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error(json?.message || `HTTP ${res.status}`);
    return json;
  } catch (err) {
    console.error(`Failed to parse response: ${text}`);
    throw err;
  }
};


const xml = await fetch(RSS_URL).then(r => r.text());
const rss = await parseStringPromise(xml, { explicitArray: false });
const items = [].concat(rss.rss.channel.item || []);
const processed = await getProcessed();
const newGuids = [];

for (const it of items) {
  if (newGuids.length >= MAX_POSTS_PER_RUN) break;

  const guid = it.guid._ || it.guid;
  if (processed.has(guid)) continue;

  const title = it['letterboxd:filmTitle'];
  const year = it['letterboxd:filmYear'];
  const rating = it['letterboxd:memberRating'] || 'Unrated';
  const watched = it['letterboxd:watchedDate'];
  const reviewHtml = (it.description || '').replace(/<p><img[^>]+><\/p>/, '').trim();

  const post = await wpPost('/posts/new', {
    title: `${title} (${year}) - ${rating}★`,
    content: `
      <p><strong>Rating:</strong> ${rating}★</p>
      <p><strong>Watched:</strong> ${watched}</p>
      ${reviewHtml}`,
    status: 'publish',
    categories: [Number(MOVIE_CATEGORY_ID)],
    slug: `lb-${guid}`
  });

  console.log('Posted:', post.URL);
  newGuids.push(guid);

  await sleep(POST_DELAY_MS);  // throttle between calls
}

async function getProcessed() {
  const seen = new Set();
  let page = 1;
  const per = 100;              // WordPress cap

  while (true) {
    const url = `${WP_BASE}/posts?number=${per}&page=${page}&fields=slug`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!res.ok) throw new Error(`Post scan failed ${res.status}`);
    const { posts } = await res.json();      // unpack array
    if (!posts.length) break;                // no more pages

    posts
      .filter(p => p.slug.startsWith('lb-'))
      .forEach(p => seen.add(p.slug.replace(/^lb-/, '')));

    if (posts.length < per) break;           // hit last page
    page++;
  }
  return seen;
}
