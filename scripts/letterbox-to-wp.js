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

const RSS_URL = `https://letterboxd.com/${LETTERBOXD_USER}/rss/`;
const WP_BASE = `https://public-api.wordpress.com/rest/v1.1/sites/${WP_SITE}`;

const authHeader = 'Basic ' + Buffer.from(`${WP_USER}:${WP_APP_PASSWORD}`).toString('base64');

const lastRunKey = 'letterboxd_last_guids';

// utilities

const wpGet = path =>
  fetch(`${WP_BASE}${path}`, { headers: { Authorization: authHeader } }).then(r => r.json());

const wpPost = (path, body) =>
  fetch(`${WP_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  }).then(r => r.json());


const xml = await fetch(RSS_URL).then(r => r.text());
const rss = await parseStringPromise(xml, { explicitArray: false });
const items = [].concat(rss.rss.channel.item || []);

const processed = new Set(
  (await wpGet(`/options/${lastRunKey}`)).value?.split(',') || []
);
const newGuids = [];

for (const it of items) {
  const guid = it.guid._ || it.guid;
  if (processed.has(guid)) continue;

  const title = it['letterboxd:filmTitle'];
  const year = it['letterboxd:filmYear'];
  const rating = it['letterboxd:memberRating'] || 'Unrated';
  const watched = it['letterboxd:watchedDate'];
  const reviewHtml = (it.description || '').replace(/<p><img[^>]+><\/p>/, '').trim();

  const post = await wpPost('/posts/new', {
    title: `${title} (${year}) – ${rating}★`,
    content: `
      <p><strong>Rating:</strong> ${rating}★</p>
      <p><strong>Watched:</strong> ${watched}</p>
      ${reviewHtml}`,
    status: 'publish',
    categories: [Number(MOVIE_CATEGORY_ID)],
    slug: `lb-${guid}` // guarantees uniqueness
  });

  console.log('Posted:', post.URL);
  newGuids.push(guid);
}

// persist GUID set (max 1000 guids)
if (newGuids.length) {
  const updated = [...processed, ...newGuids].slice(-1000);
  //store the synced guis using the wp db
  await wpPost(`/options/${lastRunKey}`, { value: updated.join(',') });
}
