import webPush from 'web-push';

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      
      // CORS headers
      const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      };

      // Handle CORS preflight
      if (request.method === 'OPTIONS') {
        return new Response(null, { 
          headers: {
            ...corsHeaders,
            'Access-Control-Max-Age': '86400',
          }
        });
      }

      // Configure web-push with VAPID details
      webPush.setVapidDetails(
        'mailto:admin@barzo.app',
        env.VAPID_PUBLIC_KEY,
        env.VAPID_PRIVATE_KEY
      );

      // PWA Authentication Check
      const isPWA = url.searchParams.has('pwa');
      const authToken = url.searchParams.get('authToken');
      
      if (isPWA && !authToken) {
        // Redirect to authentication
        const currentUrl = encodeURIComponent(request.url);
        return Response.redirect(`https://barzo.work?redirect=${currentUrl}`);
      }

      if (authToken) {
        // Parse user info from authToken
        try {
          console.log('Auth token received:', {
            length: authToken.length,
            sample: authToken.substring(0, 20) + '...'
          });
          const userInfo = JSON.parse(decodeURIComponent(authToken));
          console.log('Parsed user info:', userInfo);
          
          // Create subscription key using identity
          const subscriptionKey = `subscription:${userInfo?.token?.identity.userId}`;
          
          // Try to get existing subscription
          let subscription = await env.SUBSCRIPTIONS.get(subscriptionKey);
          
          if (!subscription) {
            // Create new subscription with identity binding
            const newSubscription = {
              userId: userInfo.id,
              createdAt: new Date().toISOString(),
              lastUsed: new Date().toISOString()
            };
            
            await env.SUBSCRIPTIONS.put(subscriptionKey, JSON.stringify(newSubscription));
            subscription = JSON.stringify(newSubscription);
          }
        } catch (error) {
          console.error('Auth token parsing error:', {
            error: error.message,
            errorType: error.name,
            tokenLength: authToken?.length
          });
        }
      }

      // Route handling
      if (url.pathname === '/api/vapidPublicKey' && request.method === 'GET') {
        return new Response(
          JSON.stringify({ publicKey: env.VAPID_PUBLIC_KEY }), 
          { headers: { 'Content-Type': 'application/json', ...corsHeaders } }
        );
      }

      if (url.pathname === '/api/subscribe' && request.method === 'POST') {
        const subscription = await request.json();
        if (!subscription || !subscription.endpoint) {
          return new Response(JSON.stringify({ error: 'Invalid subscription' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        // Get auth token and subscription key
        const authToken = request.headers.get('Authorization')?.split('Bearer ')?.[1];
        let subscriptionKey = subscription.endpoint;
        let userId = 'anonymous';

        if (authToken) {
          try {
            const userInfo = JSON.parse(decodeURIComponent(authToken));
            userId = userInfo?.token?.identity.userId;
            subscriptionKey = `subscription:${userId}`;
          } catch (error) {
            console.error('Invalid auth token:', error);
          }
        }

        // Store subscription in KV
        await env.SUBSCRIPTIONS.put(
          subscriptionKey,
          JSON.stringify({
            subscription,
            userId,
            createdAt: new Date().toISOString(),
            lastUsed: new Date().toISOString()
          })
        );

        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      if (url.pathname === '/api/notify' && request.method === 'POST') {
        const { message, key } = await request.json();
        
        // If key is provided, only notify that specific subscription
        if (key) {
          const data = await env.SUBSCRIPTIONS.get(key, 'json');
          if (!data) {
            return new Response(JSON.stringify({ error: 'Subscription not found' }), {
              status: 404,
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
          }

          try {
            await webPush.sendNotification(
              data.subscription,
              JSON.stringify({
                title: 'Barzo',
                body: message || 'You have a new message!',
                icon: '/icon-192.png',
                badge: '/icon-192.png',
                data: {
                  url: '/?source=push'
                }
              })
            );

            // Update last used timestamp
            await env.SUBSCRIPTIONS.put(key, JSON.stringify({
              ...data,
              lastUsed: new Date().toISOString()
            }));

            return new Response(JSON.stringify({ success: true }), {
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
          } catch (error) {
            // Remove failed subscription
            await env.SUBSCRIPTIONS.delete(key);
            return new Response(JSON.stringify({ error: error.message }), {
              status: 500,
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
          }
        }

        // Broadcast to all subscriptions
        const subscriptionList = await env.SUBSCRIPTIONS.list();
        const results = [];

        for (const key of subscriptionList.keys) {
          const data = await env.SUBSCRIPTIONS.get(key.name, 'json');
          if (!data) continue;

          try {
            await webPush.sendNotification(
              data.subscription,
              JSON.stringify({
                title: 'Barzo',
                body: message || 'You have a new message!',
                icon: '/icon-192.png',
                badge: '/icon-192.png',
                data: {
                  url: '/?source=push'
                }
              })
            );

            // Update last used timestamp
            await env.SUBSCRIPTIONS.put(
              key.name,
              JSON.stringify({
                ...data,
                lastUsed: new Date().toISOString()
              })
            );

            results.push({ success: true, endpoint: key.name });
          } catch (error) {
            results.push({ success: false, endpoint: key.name, error: error.message });
            // Remove failed subscription
            await env.SUBSCRIPTIONS.delete(key.name);
          }
        }

        return new Response(JSON.stringify({ 
          results,
          activeSubscriptions: results.filter(r => r.success).length 
        }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      return new Response('Not found', { status: 404, headers: corsHeaders });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  }
};

// VAPID JWT helper functions
async function createVAPIDToken(audience, publicKey, privateKey) {
  console.log('1. Starting VAPID token creation with inputs:', {
    audience,
    publicKeyLength: publicKey?.length,
    privateKeyLength: privateKey?.length,
    publicKeyStart: publicKey?.substring(0, 10),
    privateKeyStart: privateKey?.substring(0, 10)
  });

  const header = {
    typ: 'JWT',
    alg: 'ES256'
  };
  console.log('2. Created JWT header:', header);

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud: new URL(audience).origin,
    exp: now + 12 * 3600,
    sub: 'mailto:admin@barzo.app'
  };
  console.log('3. Created JWT payload:', payload);

  const encodedHeader = btoa(JSON.stringify(header));
  const encodedPayload = btoa(JSON.stringify(payload));
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  console.log('4. Created unsigned token:', {
    encodedHeader,
    encodedPayload,
    unsignedToken
  });

  try {
    console.log('5. Starting key conversion process');
    const privateKeyData = urlBase64ToUint8Array(privateKey);
    const publicKeyData = urlBase64ToUint8Array(publicKey);

    console.log('6. Converted keys to Uint8Array:', {
      privateKey: {
        originalLength: privateKey.length,
        processedLength: privateKeyData.length,
        firstBytes: Array.from(privateKeyData.slice(0, 5))
      },
      publicKey: {
        originalLength: publicKey.length,
        processedLength: publicKeyData.length,
        firstBytes: Array.from(publicKeyData.slice(0, 5))
      }
    });

    // The public key starts with 0x04 to indicate uncompressed point format
    // Then X and Y coordinates follow, 32 bytes each
    const x = publicKeyData.slice(1, 33);
    const y = publicKeyData.slice(33, 65);

    // Convert to JWK format
    const jwk = {
      kty: 'EC',
      crv: 'P-256',
      x: btoa(String.fromCharCode.apply(null, x)),
      y: btoa(String.fromCharCode.apply(null, y)),
      d: btoa(String.fromCharCode.apply(null, privateKeyData)),
      ext: true
    };

    console.log('7. Created JWK:', {
      kty: jwk.kty,
      crv: jwk.crv,
      hasX: !!jwk.x,
      hasY: !!jwk.y,
      hasD: !!jwk.d,
      xLength: jwk.x?.length,
      yLength: jwk.y?.length,
      dLength: jwk.d?.length
    });

    // Import as private key
    const key = await crypto.subtle.importKey(
      'jwk',
      jwk,
      {
        name: 'ECDSA',
        namedCurve: 'P-256',
        hash: { name: 'SHA-256' }
      },
      true, // Make extractable to verify the key
      ['sign']
    );

    console.log('8. Private key imported successfully');

    console.log('9. Preparing to sign token');
    const encoder = new TextEncoder();
    const signatureInput = encoder.encode(unsignedToken);
    console.log('10. Token encoded for signing:', {
      inputLength: signatureInput.length,
      firstBytes: Array.from(signatureInput.slice(0, 5))
    });
    
    console.log('11. Signing token');
    const signature = await crypto.subtle.sign(
      {
        name: 'ECDSA',
        hash: { name: 'SHA-256' },
      },
      key,
      signatureInput
    );
    console.log('12. Token signed successfully');

    const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)));
    console.log('13. Signature encoded:', {
      signatureLength: encodedSignature.length,
      signatureStart: encodedSignature.substring(0, 10)
    });

    const finalToken = `${unsignedToken}.${encodedSignature}`;
    console.log('14. Final token created:', {
      length: finalToken.length,
      start: finalToken.substring(0, 20)
    });

    return finalToken;

  } catch (error) {
    console.error('VAPID token creation failed:', {
      step: error.step || 'unknown',
      error: error.message,
      name: error.name,
      stack: error.stack,
      privateKeyFormat: {
        length: privateKey?.length,
        isBase64: /^[A-Za-z0-9+/=]+$/.test(privateKey),
        containsUrlSafeChars: /^[A-Za-z0-9\-_]+$/.test(privateKey),
        sample: privateKey?.substring(0, 10)
      },
      publicKeyFormat: {
        length: publicKey?.length,
        isBase64: /^[A-Za-z0-9+/=]+$/.test(publicKey),
        containsUrlSafeChars: /^[A-Za-z0-9\-_]+$/.test(publicKey),
        sample: publicKey?.substring(0, 10)
      },
      keyData: {
        private: Array.from(urlBase64ToUint8Array(privateKey).slice(0, 5)),
        public: Array.from(urlBase64ToUint8Array(publicKey).slice(0, 5))
      }
    });
    throw error;
  }
}

// Modified urlBase64ToUint8Array to include more logging
function urlBase64ToUint8Array(base64String) {
  console.log('a. Starting base64 conversion:', {
    input: base64String.substring(0, 10) + '...',
    length: base64String.length
  });

  // First convert from URL-safe to standard base64
  const base64 = base64String
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  
  console.log('b. Converted to standard base64:', {
    converted: base64.substring(0, 10) + '...'
  });

  // Add padding if needed
  const padding = '='.repeat((4 - base64.length % 4) % 4);
  const padded = base64 + padding;

  console.log('c. Added padding:', {
    paddingLength: padding.length,
    finalLength: padded.length,
    final: padded.substring(0, 10) + '...'
  });

  // Convert to binary
  const rawData = atob(padded);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  console.log('d. Converted to Uint8Array:', {
    length: outputArray.length,
    firstBytes: Array.from(outputArray.slice(0, 5))
  });

  return outputArray;
}

// Add at the top with other constants
const MAX_SUBSCRIPTION_AGE = 180 * 24 * 60 * 60 * 1000; // 180 days in milliseconds 