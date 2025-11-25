# Deployment Guide

## Architecture

- **React App** (`app/`): Frontend UI (Home.tsx, Settings.tsx) - Served from Cloudflare Worker
- **Cloudflare Worker (Frontend)**: `saa-voyager-frontend` - Serves React app at `https://saa-voyager-frontend.tofmail2022.workers.dev`
- **Cloudflare Worker (Backend)**: `saa-voyager-app-prod` - API endpoints only (`/api/*`)

## Quick Deploy

### Deploy Frontend (React App):

```bash
npm run deploy:frontend
```

This will:

1. Build the React app (`npm run build:app`)
2. Deploy to Cloudflare Worker at `https://saa-voyager-frontend.tofmail2022.workers.dev`

### Deploy Backend (API):

```bash
npm run deploy:cloudflare:prod
```

### Deploy Everything:

```bash
npm run deploy:all
```

This deploys:

1. Frontend Worker (React app)
2. Backend Worker (API)
3. Shopify app

## Manual Deployment Steps

### 1. Build React App

```bash
cd app
npm install
npm run build
```

### 2. Deploy Frontend Worker

```bash
wrangler deploy --config wrangler-frontend.toml --assets ./app/dist
```

### 3. Deploy Backend Worker

```bash
wrangler deploy --env production
```

### 4. Deploy Shopify App

```bash
shopify app deploy
```

## Configuration Files

- **Frontend Worker**: `wrangler-frontend.toml` → `saa-voyager-frontend`
- **Backend Worker**: `wrangler.toml` → `saa-voyager-app-prod`
- **Shopify App**: `shopify.app.test-data.toml` → Points to frontend URL

## URLs

- **Frontend**: `https://saa-voyager-frontend.tofmail2022.workers.dev`
- **Backend API**: `https://saa-voyager-app-prod.tofmail2022.workers.dev/api/*`
- **Shopify App**: Configured in `shopify.app.test-data.toml`

## Environment Variables

### Frontend Worker:

No environment variables needed (serves static files)

### Backend Worker:

Set via `wrangler secret put`:

- `VOYAGER_USERNAME`
- `VOYAGER_PASSWORD`
- `VOYAGER_AUTH_URL`
- `VOYAGER_ACCOUNT_URL`
- `VOYAGER_MEMBER_PROFILE_URL`
- `VOYAGER_ISSUE_URL`
- `VOYAGER_MARK_URL`
- `VOYAGER_RECREDIT_URL`
- `VOYAGER_LOGOUT_URL`

### React App:

The React app uses hardcoded API URL pointing to the backend worker:

- `https://saa-voyager-app-prod.tofmail2022.workers.dev`

## Troubleshooting

### Frontend not loading:

1. Make sure `app/dist` folder exists (run `npm run build:app`)
2. Check that assets are being served correctly
3. Verify React Router routes are working (check browser console)

### API calls failing:

1. Verify backend worker is deployed
2. Check CORS headers in backend worker
3. Verify API URL in React app matches backend worker URL
