import React, { useState, useEffect } from 'react';
import {
  Page,
  Card,
  FormLayout,
  TextField,
  Button,
  Banner,
  BlockStack,
  InlineStack,
  Text,
} from '@shopify/polaris';

const API_URL = 'https://saa-voyager-app-prod.tofmail2022.workers.dev';

export default function Home() {
  const [pointsRate, setPointsRate] = useState('0.1');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      console.log('[Settings React] Loading settings from:', `${API_URL}/api/settings/points-rate`);
      const response = await fetch(`${API_URL}/api/settings/points-rate`);
      console.log('[Settings React] Load response status:', response.status);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Settings React] Load error response:', errorText);
        setMessage({ type: 'error', text: 'Failed to load current settings' });
        return;
      }
      
      const data = await response.json();
      console.log('[Settings React] Loaded data:', data);
      
      if (data.success && data.pointsToZarRate) {
        setPointsRate(data.pointsToZarRate.toString());
        setMessage(null);
      }
    } catch (err) {
      console.error('[Settings React] Load error:', err);
      setMessage({ type: 'error', text: 'Failed to load current settings' });
    }
  };

  const saveSettings = async () => {
    setLoading(true);
    setMessage(null);

    try {
      const rate = parseFloat(pointsRate);
      
      if (isNaN(rate) || rate <= 0) {
        setMessage({ type: 'error', text: 'Please enter a valid positive number' });
        setLoading(false);
        return;
      }

      console.log('[Settings React] Saving rate:', rate);
      console.log('[Settings React] API URL:', API_URL);
      console.log('[Settings React] Full URL:', `${API_URL}/api/settings/points-rate`);
      console.log('[Settings React] Request body:', JSON.stringify({ pointsToZarRate: rate }));
      console.log('[Settings React] Executing fetch now...');

      const response = await fetch(`${API_URL}/api/settings/points-rate`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ pointsToZarRate: rate }),
      });

      console.log('[Settings React] Fetch promise resolved');
      console.log('[Settings React] Response status:', response.status, response.statusText);
      console.log('[Settings React] Response ok:', response.ok);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Settings React] Error response:', errorText);
        setMessage({ type: 'error', text: `Failed to save: HTTP ${response.status}` });
        setLoading(false);
        return;
      }

      const data = await response.json();
      console.log('[Settings React] Response data:', data);

      if (data.success) {
        setMessage({ type: 'success', text: 'Settings saved successfully!' });
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to save settings' });
      }
    } catch (err: any) {
      console.error('[Settings React] Save error:', err);
      console.error('[Settings React] Error name:', err.name);
      console.error('[Settings React] Error message:', err.message);
      console.error('[Settings React] Error stack:', err.stack);
      setMessage({ type: 'error', text: err.message || 'Failed to save settings' });
    } finally {
      setLoading(false);
    }
  };

  const rate = parseFloat(pointsRate || '0');

  return (
    <Page
      title="SAA Voyager Points Settings"
      primaryAction={{
        content: 'Save Settings',
        onAction: saveSettings,
        loading: loading,
      }}
      secondaryActions={[
        {
          content: 'Reload',
          onAction: loadSettings,
        },
      ]}
    >
      <BlockStack gap="400">
        {message && (
          <Banner
            tone={message.type === 'success' ? 'success' : 'critical'}
            onDismiss={() => setMessage(null)}
          >
            {message.text}
          </Banner>
        )}

        <Card>
          <BlockStack gap="400">

            <FormLayout>
              <TextField
                label="Points to ZAR Conversion Rate"
                value={pointsRate}
                onChange={setPointsRate}
                type="number"
                step={0.01}
                min={0.01}
               
                autoComplete="off"
              />
            </FormLayout>

            <Card>
              <BlockStack gap="200">
                <Text variant="headingSm" as="h3">
                  Current Configuration
                </Text>
                <Text variant="bodyMd" tone="subdued" as="p">
                  Rate: {pointsRate} (1 point = R{rate.toFixed(2)})
                </Text>
              
              </BlockStack>
            </Card>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}

