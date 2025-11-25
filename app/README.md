# SAA Voyager App - Frontend

React Router app for Shopify embedded app UI.

## Structure

- `src/pages/Home.tsx` - Dashboard/Home page
- `src/pages/Settings.tsx` - Settings page
- `src/components/Layout.tsx` - App layout with navigation
- `src/App.tsx` - Main app component with routing

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

Output: `dist/` folder

## Deploy to Cloudflare Pages

### Via Dashboard:

1. Go to Cloudflare Dashboard → Workers & Pages
2. Create application → Pages → Connect to Git
3. Build settings:
   - Build command: `npm install && npm run build`
   - Build output directory: `dist`
   - Root directory: (leave empty)

### Via CLI:

```bash
npm run build
wrangler pages deploy dist --project-name=saa-voyager-app-frontend
```

## Environment Variables

Create `.env.production`:

```env
VITE_SHOPIFY_API_KEY=your_api_key
VITE_API_URL=https://saa-voyager-app-prod.tofmail2022.workers.dev
```

## API Endpoints

The app connects to Cloudflare Worker API:

- Base URL: `https://saa-voyager-app-prod.tofmail2022.workers.dev`
- Settings API: `/api/settings/points-rate`
- Voyager API: `/api/voyager/*`
