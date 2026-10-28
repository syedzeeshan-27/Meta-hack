# Deploying to Vercel

1. Push the repo to GitHub, then in Vercel: **Add New → Project → Import** it. Set **Root Directory** to `fixcam` if the repo root is the parent folder. Framework is detected as Next.js; no `vercel.json` needed.
2. Storage → **Create Blob store** (public access) and connect it to the project. That adds `BLOB_READ_WRITE_TOKEN`.
3. Settings → Environment Variables: add `MODEL_API_KEY` and `FIREWORKS_API_KEY` (same values as `.env.local`).
4. Deploy. Inspections, comparisons and photos then live in Vercel Blob (`inspections/`, `comparisons/`, `photos/`).
5. The local `.data/` folder is dev-only: it isn't uploaded (it's in `.gitignore`) and isn't read on Vercel. Data made locally stays local.
6. Local dev ignores Blob unless `BLOB_READ_WRITE_TOKEN` is set in `.env.local`, so leave it out there.
