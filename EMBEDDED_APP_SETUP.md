# Embedded App Setup Guide

## Why the App Isn't Showing

For an embedded Shopify app to appear in the admin, you need:

1. **App Installation & OAuth** - The app must be installed and authenticated
2. **App URL Configuration** - The `application_url` in `shopify.app.toml` must point to your backend
3. **App Bridge Setup** - The app UI must use App Bridge to embed properly
4. **Backend Serving** - Your backend must serve the app UI

## Current Setup

✅ **Worker serves app UI** at `/app` route  
✅ **Settings API** is available at `/api/settings/points-rate`  
✅ **App Bridge** is included in the HTML

## Next Steps

### 1. Update `shopify.app.toml`

Update the `application_url` to your Cloudflare Worker URL:

```toml
application_url = "https://saa-voyager-app-prod.tofmail2022.workers.dev"
```

### 2. Install the App

The app needs to be installed on your Shopify store:

1. Go to your Shopify Partners Dashboard
2. Find your app
3. Install it on your development store
4. Complete the OAuth flow

### 3. Access the App

Once installed, the app should appear in:

- **Shopify Admin → Apps** (as shown in your screenshot)
- Click on your app to open it

### 4. Test the App UI

Visit directly:

```
https://saa-voyager-app-prod.tofmail2022.workers.dev/app
```

This should show the settings page.

## Troubleshooting

### App Not in Apps List

- Check that the app is installed: Partners Dashboard → Your App → Test on development store
- Verify `application_url` matches your Worker URL
- Check that OAuth is working

### App Shows Blank Page

- Check browser console for errors
- Verify App Bridge is loading (check Network tab)
- Ensure the `/app` route is accessible

### Settings API Not Working

- Verify the worker is deployed: `npm run deploy:cloudflare:prod`
- Test the API directly: `GET https://saa-voyager-app-prod.tofmail2022.workers.dev/api/settings/points-rate`

## Development

For local development with `shopify app dev`:

1. The CLI will tunnel your local server
2. Update `application_url` to the tunneled URL
3. The app will be accessible in your dev store

## Production

For production:

1. Deploy worker: `npm run deploy:cloudflare:prod`
2. Update `application_url` in `shopify.app.toml` to production URL
3. Deploy extensions: `shopify app deploy`
4. Install app on production store
