/**
 * Cloudflare Worker for serving React App Frontend
 * Serves static files from app/dist directory
 * Handles React Router client-side routing
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Try to get asset from ASSETS binding (created by --assets flag)
    if (env.ASSETS) {
      try {
        const asset = await env.ASSETS.fetch(request);
        
        // If asset found, return it
        if (asset && asset.status !== 404) {
          return asset;
        }
      } catch (error) {
        console.error('[Frontend Worker] Error fetching asset:', error);
      }
    }

    // For client-side routing (React Router):
    // If path doesn't have a file extension and isn't /api/, serve index.html
    const hasFileExtension = /\.[a-zA-Z0-9]+$/.test(path);
    const isApiRoute = path.startsWith('/api/');

    if (!hasFileExtension && !isApiRoute) {
      // Serve index.html for React Router to handle client-side routing
      const indexRequest = new Request(new URL('/index.html', request.url), request);
      
      if (env.ASSETS) {
        try {
          const indexAsset = await env.ASSETS.fetch(indexRequest);
          if (indexAsset && indexAsset.status !== 404) {
            return indexAsset;
          }
        } catch (error) {
          console.error('[Frontend Worker] Error fetching index.html:', error);
        }
      }
    }

    // Fallback: return 404
    return new Response('Not Found', { 
      status: 404,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
};

