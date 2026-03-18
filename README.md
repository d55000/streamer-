# StreamPro — Universal Media Player

A high-fidelity universal web media player built with **Next.js**, **Tailwind CSS**, **hls.js**, and **dash.js**. Supports MP4, WebM, HLS (`.m3u8`), DASH (`.mpd`), and MKV playback with custom controls, audio track switching, and subtitle management.

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Build for Production

```bash
npm run build
npm run start
```

---

## Deployment

StreamPro includes ready-to-use configuration files for multiple cloud platforms.

### Heroku

Uses the Node.js buildpack with a `Procfile`.

```bash
heroku create streampro
git push heroku main
```

One-click deploy is supported via `app.json` — add a **Deploy to Heroku** button in your fork if desired.

### Railway

Uses [Nixpacks](https://nixpacks.com) auto-detection with `railway.json`.

1. Connect your GitHub repository at [railway.app](https://railway.app).
2. Railway auto-detects the config and deploys.

Or via the CLI:

```bash
npm i -g @railway/cli
railway login
railway init
railway up
```

### Render

Uses the `render.yaml` blueprint for automatic service creation.

1. Go to [render.com](https://render.com) → **New** → **Blueprint**.
2. Connect this repository — Render reads `render.yaml` automatically.

Or create a **Web Service** manually with:
- **Build command:** `npm install && npm run build`
- **Start command:** `npm run start -- -p $PORT`

### Koyeb

Uses a Docker-based deployment with `koyeb.yaml` and the included `Dockerfile`.

1. Go to [koyeb.com](https://app.koyeb.com) → **Create App** → **Docker**.
2. Point to this repository — Koyeb builds the `Dockerfile` automatically.

Or via the CLI:

```bash
koyeb app create streampro --docker "github.com/d55000/streamer-" --branch main --port 3000
```

### Docker (any platform)

```bash
docker build -t streampro .
docker run -p 3000:3000 streampro
```

---

## Tech Stack

| Layer        | Technology                          |
| ------------ | ----------------------------------- |
| Framework    | Next.js 16 (App Router, Turbopack)  |
| Styling      | Tailwind CSS v4                     |
| HLS          | hls.js                              |
| DASH         | dash.js                             |
| Icons        | Lucide React                        |
| FFmpeg (MKV) | @ffmpeg/ffmpeg (WASM, architecture) |
