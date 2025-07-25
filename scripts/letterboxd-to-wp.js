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

let accessToken = process.env.WP_APP_PASSWORD;

const slugExists = async slug => {
  const url = `${WP_BASE}/posts/slug:${encodeURIComponent(slug)}?_fields=ID`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`Slug lookup failed ${res.status}`);

  return true;
};

const wpPost = async (path, body) => {

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
const newGuids = [];

for (const [index, it] of Object.entries(items)) {
  if (newGuids.length >= MAX_POSTS_PER_RUN) break;

  // if (index != 0) continue; // Uncomment to test with only the first item

  const guid = it.guid._ || it.guid;
  const slug = `lb-${guid}`;

  console.log(`Processing item ${index + 1}: ${guid}, ${slug}`);

  if (await slugExists(slug)) continue;

  const title = it['letterboxd:filmTitle'];
  const year = it['letterboxd:filmYear'];
  const rating = it['letterboxd:memberRating'] || 'Unrated';
  const watched = it['letterboxd:watchedDate'];
  const reviewHtml = (it.description || '').replace(/<p><img[^>]+><\/p>/, '').trim();

  let postDate = undefined;
  if (watched) {
    postDate = `${watched}T12:00:00Z`;
  }

  const post = await wpPost('/posts/new', {
    title: `${title} (${year}) - ${rating}★`,
    content: `
      <p><strong>Rating:</strong> ${rating}★</p>
      <p><strong>Watched:</strong> ${watched}</p>
      ${reviewHtml}`,
    status: 'publish',
    categories: [Number(MOVIE_CATEGORY_ID)],
    slug: `lb-${guid}`,
    ...(postDate && { date: postDate })
  });

  console.log('Posted:', post.URL);
  newGuids.push(guid);

  await sleep(POST_DELAY_MS);  // throttle between calls
}