# Northern Belle Edinburgh Fringe Day-Planner Map

An interactive map and day-planner for guests on the **Edinburgh Fringe at Leisure** journey (Saturday 29 August 2026, arrive Waverley 12:10, depart 17:20).

## What makes it different

Every other Fringe map shows all 300 venues for the full three-week festival. This one is built for the 5 hours 10 minutes a Northern Belle guest actually has on the ground.

- **Anchored at Waverley**, with 5 / 10 / 15 / 20 minute walking rings overlaid
- **Curated venue dataset**: every Fringe space within walking range, hand-graded into Big Four, Flagship, Specialist and Free
- **Curated eats & drinks**: cocktail and light-bite anchors only (a six-course dinner is waiting on the train home)
- **Pre-built day plans**: four worked itineraries that all make the 17:20 departure
- **"My day" shortlist**: star venues and the planner totals up your walking time, warns if you're over the window, persists locally between visits
- **Live deep-links to edfringe.com** per venue, so guests jump straight from the map to live ticketing
- **Vercel serverless proxy** ready to receive an Edinburgh Festivals Listings API key when approval is granted

## Stack

| Layer | Choice | Why |
|---|---|---|
| Map library | Leaflet 1.9 | No API key required, fast, well-supported |
| Tiles | CARTO Positron via OpenStreetMap | Subtle base, warmed with a CSS filter into NB cream |
| Frontend | Vanilla HTML / CSS / JS, no build step | Easy handoff to the NB web team |
| Hosting | Vercel static + serverless function | Same setup as the charter quote generator |
| Persistence | `localStorage` for shortlist | No backend, no PII |

## Local development

```sh
cd edinburgh-fringe-map
npx serve@latest .
# open http://localhost:3000
```

## Wiring up the live Fringe API

The Edinburgh Festivals Listings API requires HMAC-SHA1 request signing. The keys live on the server only.

1. Register at https://api.edinburghfestivalcity.com.
2. Apply for Fringe approval at https://api.edinburghfestivalcity.com/documentation/fringe_approval.
3. In Vercel, set environment variables:
   - `FRINGE_API_KEY`
   - `FRINGE_API_SECRET`
4. Until approval is granted, the demo dataset is available via `?festival=demofringe`.
5. The `/api/fringe` function will proxy signed requests to `/events` and `/venues`. Per licence terms, only edfringe.com links may be presented to end users.

## Deploy

```sh
vercel --prod
```

## Files

```
edinburgh-fringe-map/
├── index.html              # main page
├── styles.css              # NB brand styling
├── app.js                  # Leaflet + planner logic
├── data/
│   ├── venues.json         # curated venue dataset
│   ├── eats.json           # food & drink anchors
│   └── itineraries.json    # 4 worked day plans
├── api/
│   └── fringe.js           # signed proxy for live data
├── vercel.json
├── package.json
└── README.md
```

## Notes

- Walking minutes are estimated at 80 m / minute (a relaxed tourist pace). The Haversine formula gives straight-line distance, so on-the-ground times will be a touch longer for steeper Old Town routes.
- The shortlist sequence assumes guests walk Waverley → first stop → next stop → ... → Waverley in the order they starred. It's a guide, not satnav.
- Updating the venue / eats list: edit the JSON files and redeploy. No code changes needed.
