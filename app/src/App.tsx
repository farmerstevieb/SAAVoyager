import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppProvider } from '@shopify/polaris';
import { Provider as AppBridgeProvider } from '@shopify/app-bridge-react';
import '@shopify/polaris/build/esm/styles.css';
import Home from './pages/Home';

// Get shop and host from URL params (required for App Bridge)
function getShopAndHost() {
  const urlParams = new URLSearchParams(window.location.search);
  const shop = urlParams.get('shop') || '';
  const host = urlParams.get('host') || btoa(`${shop}/admin`);
  
  return { shop, host };
}

function App() {
  const { shop, host } = getShopAndHost();
  
  // App Bridge config
  // API key is the client_id from shopify.app.toml
  const apiKey = import.meta.env.VITE_SHOPIFY_API_KEY || '5dd47accf1ac433ca66a52699fa9a4b0';
  
  if (!apiKey) {
    console.error('[App] Shopify API key is missing. Please set VITE_SHOPIFY_API_KEY environment variable.');
  }
  
  const config = {
    apiKey: apiKey,
    host: host,
    forceRedirect: true,
  };

  return (
    <AppBridgeProvider config={config}>
      <AppProvider i18n={{}}>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Home />} />
          </Routes>
        </BrowserRouter>
      </AppProvider>
    </AppBridgeProvider>
  );
}

export default App;

