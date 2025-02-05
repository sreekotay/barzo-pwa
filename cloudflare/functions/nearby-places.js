/**
 * Cloudflare Worker for Places API Integration
 * 
 * This worker provides a cached interface to various place data providers (primarily Google Places API)
 * with support for nearby search and place details. It includes coordinate grid-based caching to improve
 * cache hit rates and reduce API costs.
 * 
 * Core Features:
 * - Nearby place search with configurable radius and type
 * - Detailed place information lookup
 * - Grid-based coordinate caching
 * - Cache control with version-based invalidation
 * - Request rate limiting and error handling
 * 
 * Supported Providers:
 * - Google Places API (primary)
 * - Radar.io API (alternative)
 * 
 * API Endpoints:
 * 1. Nearby Search:
 *    GET /nearby-places?lat={latitude}&lng={longitude}&radius={meters}&type={place_type}
 *    Optional: &keyword={search terms}
 * 
 * 2. Place Details:
 *    GET /nearby-places?placeId={place_id}
 * 
 * Headers:
 * - X-API-Key: Required. Service authentication key
 * - X-Google-API-Key: Optional. Custom Google Places API key
 * 
 * Cache Control:
 * - no-cache: Set to 'true' to bypass cache
 * - cache-reset: Unix timestamp to ignore older cache entries
 * 
 * Response Headers:
 * - X-Cache-Hit: Indicates if response was served from cache
 * - X-Cache-Type: Type of cache entry (places_nearby or places_details)
 * 
 * Grid Configuration:
 * - Coordinates are rounded based on search radius
 * - Grid size adapts to maintain optimal cache hits
 * - Minimum radius enforced for consistency
 * 
 * Example Usage:
 * ```
 * // Nearby search
 * curl "https://api.example.com/nearby-places?lat=27.9506&lng=-82.4572&radius=500&type=restaurant" \
 *   -H "X-API-Key: your_api_key"
 * 
 * // Place details
 * curl "https://api.example.com/nearby-places?placeId=ChIJN1t_tDeuEmsRUsoyG83frY4" \
 *   -H "X-API-Key: your_api_key"
 * ```
 * 
 * @version v1.0.1
 */

// Version number for cache invalidation
const API_VERSION = 'v1.0.2';

// CORS headers for cross-origin requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, X-Google-API-Key',
  'Access-Control-Max-Age': '86400',  // 24 hours
};

// Grid configuration
const GRID_SIZE_METERS = 100; // Base grid size
const GRID = {
    SIZE_METERS: GRID_SIZE_METERS,
    LAT_PRECISION: 5,               // 5 decimal places ≈ 1.1m precision
    LNG_PRECISION: 5,
    MIN_RADIUS: GRID_SIZE_METERS,   // Minimum 100m radius
    RADIUS_STEP: GRID_SIZE_METERS   // Round radius to nearest 100m
};

// Available data providers
const PROVIDER = {
  GOOGLE: 'google',   // Google Places API
  RADAR: 'radar',     // Radar.io API
  DEFAULT: 'google'   // Default provider
};

// Helper function to map place types to Radar categories
function getRadarCategory(type) {
    return TYPE_MAPPING[PROVIDER.RADAR][type] || TYPE_MAPPING[PROVIDER.DEFAULT];
}

// Helper function to parse Radar hours format
function parseRadarHours(hours) {
    if (!hours) return null;

    try {
        const now = new Date();
        const dayIndex = now.getDay();
        const currentTime = now.getHours() * 100 + now.getMinutes();

        const dayHours = hours[dayIndex];
        if (!dayHours) return null;

        const isOpen = dayHours.some(period => {
            const start = parseInt(period.start.replace(':', ''));
            const end = parseInt(period.end.replace(':', ''));
            return currentTime >= start && currentTime <= end;
        });

        return {
            open_now: isOpen,
            weekday_text: hours.map((dayHours, index) => {
                const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                const timeRanges = dayHours.map(period => 
                    `${period.start}-${period.end}`
                ).join(', ');
                return `${dayNames[index]}: ${timeRanges || 'Closed'}`;
            })
        };
    } catch (error) {
        console.error('Error parsing Radar hours:', error);
        return null;
    }
}

const TYPE_MAPPING = {
  [PROVIDER.GOOGLE]: {
    restaurant: 'restaurant',
    bar: 'bar',
    cafe: 'cafe'
  },
  [PROVIDER.RADAR]: {
    bar: 'bar',
    night_club: 'nightlife',
    restaurant: 'restaurant',
    cafe: 'cafe',
    default: 'food_beverage'
  }
};

// Helper function to create/track a Radar user
async function createRadarUser(apiKey) {
    const deviceId = crypto.randomUUID(); // Generate a unique device ID
    
    try {
        const response = await fetch('https://api.radar.io/v1/track', {
            method: 'POST',
            headers: {
                'Authorization': apiKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                deviceId: deviceId,
                latitude: 27.7717,  // Default location (St Pete)
                longitude: -82.6387,
                accuracy: 65,
                foreground: true
            })
        });

        if (!response.ok) {
            throw new Error(`Radar user creation failed: ${response.status}`);
        }

        const data = await response.json();
        return { deviceId, userId: data.user?._id };
    } catch (error) {
        console.error('Error creating Radar user:', error);
        throw error;
    }
}

// Cache duration settings (in seconds)
const CACHE_DURATION = {
    PRODUCTION: {
        KV: 604800,      // 1 week for KV store
        BROWSER: 604800,  // 1 week for browser cache
        DETAILS: 604800   // 1 week for place details
    },
    DEVELOPMENT: {
        KV: 600,          // 1 minute for development
        BROWSER: 600,     // 1 minute for development
        DETAILS: 600      // 1 minute for development
    }
};

// Provider-specific API configurations
const API_CONFIG = {
  [PROVIDER.GOOGLE]: {
    nearbySearch: async (params) => {
      try {
        const searchParams = new URLSearchParams({
          location: `${params.lat},${params.lng}`,
          radius: params.radius,
          type: params.type,
          key: params.apiKey
        });

        if (params.keywords && params.keywords.length > 0) {
          searchParams.append('keyword', params.keywords.join(' '));
        }

        const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?${searchParams}`;
        const response = await fetch(url);
        const data = await response.json();
        
        if (!response.ok) {
          throw new Error(`Google Places API error: ${response.status} - ${data.error_message || 'Unknown error'}`);
        }
        
        return data;
      } catch (error) {
        throw error;
      }
    },
    placeDetails: async (placeId, apiKey) => {
      try {
        const searchParams = new URLSearchParams({
          place_id: placeId,
          key: apiKey,
          fields: [
            'place_id', 'name', 'geometry', 'formatted_address',
            'formatted_phone_number', 'website', 'opening_hours',
            'current_opening_hours', 'price_level', 'types',
            'editorial_summary', 'serves_breakfast', 'serves_lunch',
            'serves_dinner', 'serves_brunch', 'photos'
          ].join(',')
        });

        const url = `https://maps.googleapis.com/maps/api/place/details/json?${searchParams}`;
        
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Google Places Details API error: ${response.status}`);
        }
        
        return response.json();
      } catch (error) {
        console.error('Google Places Details API error:', error);
        throw error;
      }
    },
    parseNearbyResults: (data) => data.results,
    parsePlaceDetails: (data) => data.result
  },
  [PROVIDER.RADAR]: {
    nearbySearch: async (params) => {
      try {
        const searchParams = new URLSearchParams({
          radius: params.radius,
          categories: getRadarCategory(params.type),
          limit: '50'
        });

        const url = `https://api.radar.io/v1/search/places?${searchParams}&near=${params.lat},${params.lng}`;
        
        const response = await fetch(url, {
          headers: {
            'Authorization': `${params.apiKey}`,  // Add prj_live_sk_ prefix
            'Content-Type': 'application/json'
          }
        });

        if (!response.ok) {
          throw new Error(`Radar Places API error: ${response.status}`);
        }
        
        return response.json();
      } catch (error) {
        console.error('Radar Places API error:', error);
        throw error;
      }
    },
    placeDetails: async (placeId, apiKey) => {
      try {
        const url = `https://api.radar.io/v1/places/${placeId}`;
        
        const response = await fetch(url, {
          headers: {
            'Authorization': `prj_live_sk_${apiKey}`,  // Add prj_live_sk_ prefix
            'Content-Type': 'application/json'
          }
        });

        if (!response.ok) {
          throw new Error(`Radar Places Details API error: ${response.status}`);
        }
        
        return response.json();
      } catch (error) {
        console.error('Radar Places Details API error:', error);
        throw error;
      }
    },
    parseNearbyResults: (data) => data.places || [],
    parsePlaceDetails: (data) => data.place || null
  }
};

// Coordinate quantization tuned for map viewing
function getCoordinateGridSize(lat, lng, radius) {
    let gridSize;
    if (radius <= 100) {
        gridSize = 0.0001;
    } else if (radius <= 500) {
        gridSize = 0.0005;
    } else if (radius <= 1000) {
        gridSize = 0.001;
    } else {
        gridSize = 0.002;
    }

    const lngGridSize = gridSize / Math.cos(lat * Math.PI / 180);
    return {
        lat: gridSize,
        lng: lngGridSize
    };
}

// Radius quantization
function getRadiusGridSize(radius) {
    // For radius, we can be more aggressive
    // radius 50m -> round to nearest 50m
    // radius 500m -> round to nearest 100m
    // radius 2000m -> round to nearest 200m
    // radius 5000m -> round to nearest 500m
    return Math.pow(2, Math.floor(Math.log2(radius/50))) * 50;
}

// Update the cache key generation to use separate lat/lng grids
function getNearbySearchCacheKey(lat, lng, radius, type, provider, keywords = []) {
    const grid = getCoordinateGridSize(lat, lng, radius);
    const roundedLat = (Math.round(lat / grid.lat) * grid.lat).toFixed(5);
    const roundedLng = (Math.round(lng / grid.lng) * grid.lng).toFixed(5);
    const roundedRadius = Math.ceil(radius / getRadiusGridSize(radius)) * getRadiusGridSize(radius);
    const keywordString = keywords.length > 0 ? `:${keywords.sort().join('+')}` : '';
    return `${API_VERSION}:nearby:${provider}:${roundedLat},${roundedLng}:${roundedRadius}:${type}${keywordString}`;
}

// Cache key generation functions
function getCacheKey(params) {
    const { lat, lng, radius, type, provider = PROVIDER.GOOGLE } = params;
    // Include API version in cache key for version-based invalidation
    return `${API_VERSION}:p:${provider[0]}:${lat}:${lng}:${radius}:${type}`;
}

function getDetailsCacheKey(placeId, provider) {
    // Cache key for place details includes API version
    return `${API_VERSION}:details:${provider}:${placeId}`;
}

// Add this near the top with other constants
const shouldUseCache = async (cacheKey, noCache, cacheReset) => {
  if (noCache) return false;
  if (!cacheReset) return true;

  const resetTime = parseInt(cacheReset);
  if (!isNaN(resetTime)) {
    const metadata = await env.PLACES_KV.getWithMetadata(cacheKey);
    return metadata && metadata.metadata && metadata.metadata.timestamp > resetTime;
  }
  
  return false;
};

// Main request handler
export default {
  async fetch(request, env, ctx) {
    try {
      return await this.handleRequest(request, env, ctx);
    } catch (error) {
      console.error('Error in fetch:', error);
      return new Response('Internal Server Error - Wrapper Catch', { status: 500 });
    }
  },

  async handleRequest(request, env, ctx) {
    // Handle CORS preflight with all necessary headers
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          ...corsHeaders,
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, X-Google-API-Key',
          'Access-Control-Max-Age': '86400',
        },
        status: 200
      });
    }

    try {
      const url = new URL(request.url);
      const authKey = request.headers?.get("X-API-Key") || '';
      const userGoogleKey = request.headers?.get("X-Google-API-Key");
      const provider = PROVIDER.DEFAULT;
      
      // Move auth check after CORS
      if (!authKey || authKey !== env.SECURE_API_KEY_PLACES) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { 
          status: 403,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }

      // Check if this is a place details request
      const placeId = url.searchParams.get("placeId");
      if (placeId) {
        // Handle place details request
        const cacheKey = getDetailsCacheKey(placeId, provider);
        
        // Cache control parameters
        const cacheReset = url.searchParams.get("cache-reset");
        const noCache = url.searchParams.get("no-cache") === 'true';

        // Check cache if enabled
        if (!noCache) {
          const cachedData = await env.PLACES_KV.getWithMetadata(cacheKey, { type: "json" });
          if (cachedData?.value) {
            return new Response(JSON.stringify(cachedData.value), {
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
                "Cache-Control": `public, max-age=${CACHE_DURATION.PRODUCTION.DETAILS}`,
                "X-Cache-Hit": "true",
                "X-Cache-Type": "places_details"
              }
            });
          }
        }

        try {
          // Cache miss - log and fetch fresh data
          console.log('Cache miss for place details:', placeId);
          const data = await API_CONFIG[provider].placeDetails(placeId, userGoogleKey || env.GOOGLE_PLACES_API_KEY);
          const details = API_CONFIG[provider].parsePlaceDetails(data);

          // Cache the results
          if (details) {
            await env.PLACES_KV.put(cacheKey, JSON.stringify(details), {
              expirationTtl: CACHE_DURATION.PRODUCTION.DETAILS,
              metadata: { timestamp: Date.now() }
            });
          }

          return new Response(JSON.stringify(details), {
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
              "Cache-Control": `public, max-age=${CACHE_DURATION.PRODUCTION.DETAILS}`,
              "X-Cache-Hit": "false",
              "X-Cache-Type": "places_details"
            }
          });
        } catch (error) {
          console.error('Error fetching place details:', error);
          return new Response(JSON.stringify({
            error: "Failed to fetch place details",
            message: error.message
          }), { 
            status: 500,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json"
            }
          });
        }
      }

      const lat = parseFloat(url.searchParams.get("lat"));
      const lng = parseFloat(url.searchParams.get("lng"));
      const radius = Math.max(GRID.MIN_RADIUS, parseInt(url.searchParams.get("radius") || "500"));
      const type = url.searchParams.get("type") || "restaurant";
      
      if (isNaN(lat) || isNaN(lng)) {
        return new Response("Invalid latitude or longitude", { status: 400 });
      }

      const cacheKey = getNearbySearchCacheKey(
          lat, 
          lng, 
          radius, 
          type,
          provider,
          url.searchParams.getAll("keyword")
      );
      
      const isDevelopment = request.url.includes('localhost') || request.url.includes('127.0.0.1');
      const cacheDuration = isDevelopment ? CACHE_DURATION.DEVELOPMENT : CACHE_DURATION.PRODUCTION;
      const useCache = await shouldUseCache(cacheKey, url.searchParams.get("no-cache") === 'true', url.searchParams.get("cache-reset"));

      if (useCache) {
        try {
          let cachedData = await env.PLACES_KV.getWithMetadata(cacheKey, { type: "json" });
          if (cachedData && cachedData.value) {
            const cacheAge = Date.now() - (cachedData.metadata?.timestamp || 0);
            const maxAge = cacheDuration.KV * 1000;
            
            if (cacheAge < maxAge) {
              console.log(`Cache HIT with key: ${cacheKey}`);
              return new Response(JSON.stringify(cachedData.value), {
                  headers: { 
                      ...corsHeaders,
                      "Content-Type": "application/json", 
                      "Cache-Control": `public, max-age=${cacheDuration.KV}`,
                      "X-Cache-Hit": "true",
                      "X-Cache-Type": "places_nearby"
                  },
              });
            }
          }
        } catch (error) {
          // Silent fail on cache errors
        }
      }

      // Single log for cache miss
      console.log(`Cache MISS with key: ${cacheKey}`);

      // Cache miss - log and fetch fresh data
      const searchParams = {
        lat,
        lng,
        radius,
        type,
        apiKey: provider === PROVIDER.RADAR ? env.RADAR_API_KEY : (userGoogleKey || env.GOOGLE_PLACES_API_KEY),
        keywords: url.searchParams.getAll("keyword"),
        provider
      };

      try {
        const data = await API_CONFIG[provider].nearbySearch(searchParams);

        if (!data) {
          throw new Error('No data returned from API');
        }

        const normalizedResults = API_CONFIG[provider].parseNearbyResults(data);
        
        if (normalizedResults && normalizedResults.length > 0) {
          console.log('Writing to cache:', {
              key: cacheKey,
              resultCount: normalizedResults.length,
              expirationTtl: cacheDuration.KV
          });
          
          await env.PLACES_KV.put(cacheKey, JSON.stringify(normalizedResults), { 
              expirationTtl: cacheDuration.KV,
              metadata: { timestamp: Date.now() }
          });
        }

        return new Response(JSON.stringify(normalizedResults), {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
            "Cache-Control": `public, max-age=${cacheDuration.BROWSER}`,
            "X-Cache-Hit": "false"
          }
        });
      } catch (error) {
        console.error('API request failed:', error);
        throw error;
      }
    } catch (error) {
      console.error('Error in handleRequest:', error);
      return new Response(JSON.stringify({
        error: "Internal Server Error",
        message: error.message
      }), { 
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
  }
};
