# The Yard Concierge — Website

Single-page landing site for The Yard Concierge, a premium pet waste removal service in Palm Beach County.

## Preview locally

Just double-click `index.html` to open it in your browser. No build step, no install — pure HTML/CSS/JS.

If you want a local server (better for testing some animations):
```
cd website
python3 -m http.server 8000
```
Then open http://localhost:8000

## Deploy to Vercel (recommended)

### Option A — Drag & drop (fastest)
1. Go to [vercel.com/new](https://vercel.com/new)
2. Drag the entire `website` folder onto the page
3. Click Deploy. You're live in ~30 seconds at a `*.vercel.app` URL.

### Option B — GitHub → Vercel (best for ongoing updates)
1. Create a new GitHub repo (e.g. `the-yard-concierge`)
2. From this folder:
   ```
   cd website
   git init
   git add .
   git commit -m "Launch landing page"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/the-yard-concierge.git
   git push -u origin main
   ```
3. Go to [vercel.com/new](https://vercel.com/new), click "Import Git Repository," pick this repo, click Deploy.
4. Every future `git push` auto-deploys.

## Connect your custom domain (theyardconcierge.com)

1. Buy the domain on Namecheap or Porkbun (~$10/yr)
2. In Vercel → Project Settings → Domains → add `theyardconcierge.com`
3. Vercel will give you DNS records to copy into your domain registrar. Paste them in. SSL auto-provisions in a few minutes.

## File structure

```
website/
├── index.html       ← the entire landing page (HTML + CSS + JS inline)
├── assets/
│   └── logo.jpeg    ← your logo, used in nav / hero / footer / favicon
└── README.md        ← this file
```

## What to update before launch

- **Phone number** in footer (`(561) 555-0000` placeholder)
- **Email** in footer (`hello@theyardconcierge.com`)
- **Social links** in footer (Instagram, TikTok, Facebook)
- **Testimonials** — currently placeholder names (Megan, David, Linda). Replace with real ones once you have customers.
- **"Get my free quote" CTA** — currently links to `#book`. Hook it up to a real booking form (Tally, Typeform, or a custom form) when ready.
- **Favicon** — currently the JPEG logo. Convert to PNG/ICO for sharper browser tab icon.

## Color palette (extracted from logo)

| Token        | Hex       | Use                          |
|--------------|-----------|------------------------------|
| Green deep   | `#2D6A3E` | Primary brand, accents       |
| Gold         | `#E5B048` | Highlights, Island tier      |
| Navy         | `#1B2B4D` | Body text, primary buttons   |
| Cream        | `#FAF6EE` | Page background              |
| Paper        | `#FBF8F1` | Section backgrounds          |

## Typography

- **Display / Headlines:** Fraunces (Google Fonts) — warm friendly serif, matches the logo
- **Body:** Inter (Google Fonts) — clean modern sans

Both loaded from Google Fonts CDN — no install needed.
