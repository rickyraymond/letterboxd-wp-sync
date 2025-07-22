# 🎬 Sync Letterboxd → WordPress

Automatically posts your latest Letterboxd movie diary entries to a WordPress.com blog as new posts in a "Movie Reviews & Ratings" category. This runs hourly using GitHub Actions.

---

## How it works

- Fetches your public Letterboxd RSS feed
- Extracts movie title, rating, date watched, and any review text
- Skips already-synced movies using the post GUID
- Publishes new posts to WordPress via the REST API with an application password
- Categorizes them under a specific category like "Movie Reviews & Ratings"

The job is scheduled to run every hour using GitHub Actions:

```yaml
on:
  schedule:
    - cron: '15 * * * *'  # every hour at :15
  workflow_dispatch:       # also supports manual run

 Secret Name          Description                                       
 -------------------  ------------------------------------------------- 
 `LETTERBOXD_USER`    Your Letterboxd username (e.g. `rickyraymond05`) 
 `WP_SITE`            Your WordPress site (e.g. `myblog.wordpress.com`)
 `WP_USER`            Your WordPress.com username                       
 `WP_APP_PASSWORD`    24-character application password from WP profile 
 `MOVIE_CATEGORY_ID`  Numeric ID of the blog category for movie posts   

