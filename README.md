# FixCam

Point your phone at something you're assembling or fixing. FixCam reads the product's manual, tells you each step
out loud, and outlines the exact part to touch on the live camera.

Built for the Meta Global AI Developer Hackathon (Oct 26 – Nov 4, 2026). Everything in this repo was written during
the hackathon.

## Meta models used
- **Muse Spark 1.3**: plans the steps from the manual and checks each step from the camera
- **SAM 3.1**: outlines the part for the current step
- **Muse Voice Transcribe**: hands-free voice commands
- **Muse Image**: shows what the finished step should look like

## Run it
```bash
npm install
cp .env.example .env.local   # paste your MODEL_API_KEY
npm run dev
```
Without a key the app runs on demo data.

Speed test against the real models:
```bash
npx tsx --env-file=.env.local scripts/speedtest.ts photo.jpg "gas lift cylinder" clip.wav
```

## Credits
API usage patterns follow [meta-model-cookbook](https://github.com/meta-models/meta-model-cookbook) (MIT).
SAM output is parsed with [`@meta-sam/parser`](https://www.npmjs.com/package/@meta-sam/parser).
