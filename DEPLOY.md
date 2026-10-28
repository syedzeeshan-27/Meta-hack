# Deploying to Vercel

1. Push the repo to GitHub, then in Vercel: **Add New → Project → Import** it. Set **Root Directory** to `fixcam` if the repo root is the parent folder. Framework is detected as Next.js; no `vercel.json` needed.
2. Storage → **Create Blob store** (public access) and connect it to the project. That adds `BLOB_READ_WRITE_TOKEN`.
3. Settings → Environment Variables: add `MODEL_API_KEY` and `FIREWORKS_API_KEY` (same values as `.env.local`).
   Optional: `ACCESS_CODE` so only people with the code can use the app (open any page once with `?code=<it>`;
   repair cards at `/r/...` stay public for sharing).
4. Deploy. Repair cards and their photos then live in Vercel Blob (`repairs/`, `photos/`). Nothing else is stored:
   the repair in progress lives in the browser and is sent with each turn, so many people can use it at once.
5. The local `.data/` folder is dev-only: it isn't uploaded (it's in `.gitignore`) and isn't read on Vercel. Data made locally stays local.
6. Local dev ignores Blob unless `BLOB_READ_WRITE_TOKEN` is set in `.env.local`, so leave it out there.
