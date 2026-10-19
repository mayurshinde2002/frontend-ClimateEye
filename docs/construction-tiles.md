# India construction tiles

Construction sites (`landuse=construction`) and buildings under construction (`building=construction`,
`building:construction=*`, `construction=*` on buildings) for the whole of India are built weekly from
OpenStreetMap by `.github/workflows/construction-tiles.yml`:

1. Download `india-latest.osm.pbf` from Geofabrik.
2. `osmium tags-filter` keeps only construction features, `osmium export` turns them into GeoJSON.
3. `scripts/normalize-construction.mjs` drops non-buildings (e.g. roads under construction) and keeps
   `kind` (`site` / `building`), `type`, `height`, `levels`, `name`, `osm_id`, `updated`.
4. `tippecanoe` builds `india-construction.pmtiles` (layer `construction`, zoom 10-14).
5. The file and a summary `india-construction.json` are uploaded to Cloudflare R2.

Finished buildings come from Overture Maps (updated monthly), so they are not part of this file.

## One-time setup

1. **Cloudflare R2**: create a bucket (default name `climateye-tiles`) and enable public access
   (Settings → Public access → R2.dev subdomain, or a custom domain).
2. **CORS** on the bucket (Settings → CORS policy):

   ```json
   [
     {
       "AllowedOrigins": ["*"],
       "AllowedMethods": ["GET", "HEAD"],
       "AllowedHeaders": ["range", "if-match"],
       "ExposeHeaders": ["etag", "content-length", "content-range"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

3. **R2 API token** (R2 → Manage API tokens → Object Read & Write for the bucket), then add these
   GitHub repository secrets (Settings → Secrets and variables → Actions):
   `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.
   For a different bucket name, add a repository variable `R2_BUCKET`.
4. Run the workflow once (Actions → India construction tiles → Run workflow). It takes ~15-25 minutes.
5. Set the frontend environment variable (Render → Environment, or `.env.local` for development):

   ```
   VITE_CONSTRUCTION_TILES_URL=https://<your-public-r2-domain>/india-construction.pmtiles
   ```

   and redeploy. Vite reads it at build time.

## Local testing without R2

Download the `india-construction` artifact from a workflow run and put `india-construction.pmtiles`
and `india-construction.json` in `public/data/`. Without `VITE_CONSTRUCTION_TILES_URL`, the app loads
`/data/india-construction.pmtiles`. These files are git-ignored.

If no tiles are available, the map falls back to the construction buildings in
`public/data/latest-buildings.geojson` (`npm run fetch-buildings`, selected areas only).
