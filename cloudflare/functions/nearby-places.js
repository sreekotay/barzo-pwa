/**
 * Google Places API Proxy with Caching
 * 
 * This worker provides a cached interface to Google Places API with two main endpoints:
 * 1. Nearby Search: Find places near a location
 * 2. Place Details: Get detailed information about a specific place
 * 
 * Features:
 * - Cloudflare KV caching with metadata
 * - Cache control options (no-cache, cache-reset)
 * - Support for user-provided Google API keys
 * - Coordinate rounding for better cache hits
 * - Cache status headers
 * 
 * Endpoints:
 * 1. Nearby Search:
 *    GET /nearby-places?lat={latitude}&lng={longitude}&radius={meters}&type={place_type}
 * 
 * 2. Place Details:
 *    GET /nearby-places?placeId={google_place_id}
 * 
 * Headers:
 * - X-API-Key: Required. Your API key for this service
 * - X-Google-API-Key: Optional. Your own Google Places API key
 * 
 * Query Parameters:
 * - no-cache: Set to 'true' to bypass cache
 * - cache-reset: Timestamp to ignore cache entries older than this time
 * 
 * Cache Headers in Response:
 * - X-Cache-Hit: 'true' or 'false'
 * - X-Cache-Type: 'places_nearby' or 'places_details'
 * 
 * Example Usage:
 * curl "http://localhost:8787/nearby-plcaaces?lat=27.9506&lng=-82.4572" \
 *   -H "X-API-Key: your_api_key"
 * 
 * curl "http://localhost:8787/nearby-places?placeId=ChIJv-_K-JzhwogRteKYG94IedY" \
 *   -H "X-API-Key: your_api_key"
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, X-Google-API-Key',
  'Access-Control-Max-Age': '86400',  // 24 hours
};

const GRID_SIZE_METERS = 100; // Size of grid for rounding coordinates
const GRID = {
  SIZE_METERS: GRID_SIZE_METERS,  // Size of grid for rounding coordinates
  LAT_PRECISION: 5, // Decimal places for latitude
  LNG_PRECISION: 5, // Decimal places for longitude
  MIN_RADIUS: GRID_SIZE_METERS,   // Minimum radius in meters
  RADIUS_STEP: GRID_SIZE_METERS   // Round radius to nearest step
};

// Add provider constants
const PROVIDER = {
  GOOGLE: 'google',
  MAPBOX: 'mapbox'
};

const TYPE_MAPPING = {
  [PROVIDER.GOOGLE]: {
    restaurant: 'restaurant',
    bar: 'bar',
    cafe: 'cafe'
  },
  [PROVIDER.MAPBOX]: {
    restaurant: 'restaurant',
    bar: 'bar,pub',
    cafe: 'cafe,coffee'
  }
};

// Add provider-specific configs
const API_CONFIG = {
  [PROVIDER.GOOGLE]: {
    nearbySearch: (params, key) => 
      `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${params.lat},${params.lng}&radius=${params.radius}&type=${params.type}&key=${key}`,
    placeDetails: (placeId, key) => 
      `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}` +
      `&fields=place_id,name,geometry,formatted_address,formatted_phone_number,website,opening_hours,current_opening_hours,` +
      `price_level,types,editorial_summary,serves_breakfast,serves_lunch,serves_dinner,serves_brunch,` +
      `photos&key=${key}`,
    parseNearbyResults: (data) => data.results,
    parsePlaceDetails: (data) => data.result
  },
  [PROVIDER.MAPBOX]: {
      nearbySearch: (params, apiKey) => {
        // Use Overpass API for bars/restaurants/nightclubs
        if (params.type.includes('bar') || params.type.includes('restaurant')) {
            const amenityTypes = params.type.includes('bar') ? 'bar|nightclub' : 'restaurant';
            return `https://overpass-api.de/api/interpreter?data=[out:json];` +
                   `(node[amenity~"${amenityTypes}"](around:${params.radius},${params.lat},${params.lng}););out;`;
        }
        
        // Fallback to Mapbox for other types
        return `https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/tilequery/${params.lng},${params.lat}.json?` +
               `access_token=${apiKey}&` +
               `radius=${params.radius}&` +
               `limit=40&` +
               `layers=poi_label`;
    },
    placeDetails: (placeId, apiKey) => 
        `https://overpass-api.de/api/interpreter?data=[out:json];` +
        `(node(${placeId});way(${placeId});relation(${placeId}););out tags;`,
    parseNearbyResults: (data) => {
        // Check if this is Overpass data
        if (data.elements) {
            return data.elements.map(place => ({
                place_id: place.id.toString(),
                name: place.tags.name || 'Unnamed Location',
                vicinity: place.tags['addr:street'] ? 
                    `${place.tags['addr:housenumber'] || ''} ${place.tags['addr:street']}` : 
                    (place.tags.address || place.tags.name || 'No address'),
                geometry: {
                    location: {
                        lat: place.lat,
                        lng: place.lon
                    }
                },
                types: [place.tags.amenity].filter(Boolean),
                rating: null,
                user_ratings_total: null,
                photos: [],
                opening_hours: { 
                    open_now: null,
                    weekday_text: place.tags.opening_hours ? [place.tags.opening_hours] : []
                }
            }));
        }

        // Original Mapbox parsing for other types
        return data.features.map(place => ({
            place_id: place.id,
            name: place.properties.name,
            vicinity: place.properties.address || place.properties.name,
            geometry: {
                location: {
                    lat: place.geometry.coordinates[1],
                    lng: place.geometry.coordinates[0]
                }
            },
            types: [place.properties.type].filter(Boolean),
            rating: null,
            user_ratings_total: null,
            photos: [],
            opening_hours: { open_now: null }
        }));
    },
    parsePlaceDetails: (data) => {
        if (!data.elements || !data.elements[0]) {
            throw new Error('No place details found');
        }
        const element = data.elements[0];
        const tags = element.tags || {};

        // Get coordinates based on element type
        let lat, lng;
        if (element.type === 'node') {
            lat = element.lat;
            lng = element.lon;
        } else if (element.center) {
            // Ways and relations have a center point
            lat = element.center.lat;
            lng = element.center.lon;
        }

        return {
            place_id: element.id.toString(),
            name: tags.name || 'Unnamed Location',
            formatted_address: [
                tags['addr:housenumber'],
                tags['addr:street'],
                tags['addr:city'],
                tags['addr:postcode']
            ].filter(Boolean).join(', ') || tags.address || '',
            geometry: {
                location: { lat, lng }
            },
            types: [tags.amenity, tags.leisure, tags.shop].filter(Boolean),
            current_opening_hours: {
                open_now: null,
                weekday_text: tags.opening_hours ? [tags.opening_hours] : []
            },
            formatted_phone_number: tags.phone || tags['contact:phone'],
            website: tags.website || tags['contact:website'] || tags.url,
            price_level: tags.price_level ? parseInt(tags.price_level) : null,
            rating: null,
            user_ratings_total: null,
            photos: [],
            serves_breakfast: tags.breakfast === 'yes' || tags.cuisine?.includes('breakfast'),
            serves_lunch: tags.lunch === 'yes' || tags.cuisine?.includes('lunch'),
            serves_dinner: tags.dinner === 'yes' || tags.cuisine?.includes('dinner'),
            serves_brunch: tags.brunch === 'yes' || tags.cuisine?.includes('brunch')
        };
    }
  }
};

// Normalize Mapbox place to match Google Places format
function normalizeMapboxPlace(place) {
  // Mapbox doesn't provide opening hours directly
  // We need to handle this missing data
  const opening_hours = place.properties.hours ? {
    open_now: null, // Mapbox doesn't provide this
    periods: [], // Would need to parse Mapbox's hours format
    weekday_text: [] // Would need to convert from Mapbox format
  } : null;

  return {
    place_id: place.id,
    name: place.text,
    geometry: {
      location: {
        lat: place.center[1],
        lng: place.center[0]
      }
    },
    formatted_address: place.place_name,
    types: place.properties.category?.split(',') || [],
    opening_hours,
    formatted_phone_number: place.properties.tel || null,
    website: place.properties.website || null,
    price_level: place.properties.price ? place.properties.price.length : null, // Convert '$' to number
    rating: null, // Mapbox doesn't provide ratings
    user_ratings_total: null,
    photos: place.properties.image ? [{
      photo_reference: place.properties.image
    }] : []
  };
}

// At the top, add cache duration constants
const CACHE_DURATION = {
    PRODUCTION: {
        KV: 604800,      // 1 week (7 * 24 * 60 * 60)
        BROWSER: 604800,  // 1 week
        DETAILS: 604800   // 1 week
    },
    DEVELOPMENT: {
        KV: 604800,          // 1 minute
        BROWSER: 604800,     // 1 minute
        DETAILS: 604800      // 1 minute
    }
};

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
    // Handle CORS preflight requests first, before any other logic
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders,
        status: 200  // Make sure OPTIONS returns 200 OK
      });
    }

    // Add debug response to check env vars
    if (!env) {
      return new Response(JSON.stringify({
        error: "Environment not provided"
      }), { 
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }

    // Add debug response to check specific env vars
    const debugInfo = {
      hasGoogleKey: typeof env.GOOGLE_PLACES_API_KEY === 'string',
      hasSecureKey: typeof env.SECURE_API_KEY_PLACES === 'string',
      hasKV: typeof env.PLACES_KV === 'object',
      headers: request.headers ? Array.from(request.headers.entries()) : null
    };

    if (!env.GOOGLE_PLACES_API_KEY || !env.SECURE_API_KEY_PLACES || !env.PLACES_KV) {
      return new Response(JSON.stringify({
        error: "Missing required environment variables or KV binding",
        debug: debugInfo
      }), { 
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }

    try {
      const url = new URL(request.url);
      const authKey = request.headers?.get("X-API-Key") || '';
      const userGoogleKey = request.headers?.get("X-Google-API-Key");
      
      // Cache control parameters
      const cacheReset = url.searchParams.get("cache-reset");
      const noCache = url.searchParams.get("no-cache") === 'true' && false; //debug

      // Cache control function
      const shouldUseCache = async (cacheKey) => {
        if (noCache) return false;
        if (!cacheReset) return true;

        // If cacheReset is a timestamp, check if cache is newer
        const resetTime = parseInt(cacheReset);
        if (!isNaN(resetTime)) {
          const metadata = await env.PLACES_KV.getWithMetadata(cacheKey);
          return metadata && metadata.metadata && metadata.metadata.timestamp > resetTime;
        }
        
        return false;
      };

      if (!authKey || authKey !== env.SECURE_API_KEY_PLACES) {
        return new Response(JSON.stringify({
          error: "Unauthorized"
        }), { 
          status: 403,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }

      // Add provider selection
      console.log(1)
      const provider = url.searchParams.get("provider") || PROVIDER.GOOGLE//MAPBOX;
      const apiConfig = API_CONFIG[provider];
      
      if (!apiConfig) {
        return new Response(JSON.stringify({
          error: "Invalid provider",
          providedValue: provider,
          validProviders: Object.values(PROVIDER),ç
          debug: { provider, apiConfig, availableConfigs: Object.keys(API_CONFIG) }
        }), { 
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }

      // Use appropriate API key
      const apiKey = provider === PROVIDER.GOOGLE ? 
        (userGoogleKey || env.GOOGLE_PLACES_API_KEY) : 
        env.MAPBOX_API_KEY;

      // Check if this is a place details request
      const placeId = url.searchParams.get("placeId");
      if (placeId) {
        const detailsCacheKey = getDetailsCacheKey(placeId, provider);
        
        // Check if we should use cache
        const useCache = await shouldUseCache(detailsCacheKey);
        
        console.log(2)
        // Check cache first if allowed
        if (useCache) {
            let cachedDetails = await env.PLACES_KV.get(detailsCacheKey, { type: "json" });
            if (cachedDetails) {
                return new Response(JSON.stringify(cachedDetails), {
                    headers: { 
                        ...corsHeaders,
                        "Content-Type": "application/json",
                        "Cache-Control": "public, max-age=86400",
                        "X-Cache-Hit": "true",
                        "X-Cache-Type": "places_details"
                    },
                });
            }
        }

        // Use provider-specific details URL and parsing
        const detailsUrl = apiConfig.placeDetails(placeId, apiKey);
        const detailsResponse = await fetch(detailsUrl);
        const detailsData = await detailsResponse.json();
        console.log('Details Data', JSON.stringify(detailsData));
        
        if (!detailsResponse.ok) {
          console.error ('Details Url', detailsUrl);
          return new Response(JSON.stringify({
            error: `Failed to fetch place details from ${provider}`,
            details: detailsData
          }), { 
            status: 500,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json"
            }
          });
        }

        const normalizedDetails = apiConfig.parsePlaceDetails(detailsData);
        
        // Cache normalized data
        const isDevelopment = request.url.includes('localhost') || request.url.includes('127.0.0.1');
        const cacheDuration = isDevelopment ? CACHE_DURATION.DEVELOPMENT : CACHE_DURATION.PRODUCTION;
        await env.PLACES_KV.put(detailsCacheKey, JSON.stringify(normalizedDetails), {
          expirationTtl: cacheDuration.DETAILS
        });

        return new Response(JSON.stringify(normalizedDetails), {
          headers: { 
            ...corsHeaders,
            "Content-Type": "application/json",
            "Cache-Control": `public, max-age=${cacheDuration.DETAILS}`
          },
        });
      }

      const lat = parseFloat(url.searchParams.get("lat"));
      const lng = parseFloat(url.searchParams.get("lng"));
      const radius = Math.max(GRID.MIN_RADIUS, parseInt(url.searchParams.get("radius") || "500"));
      const type = url.searchParams.get("type") || "restaurant";
      
      if (isNaN(lat) || isNaN(lng)) {
        return new Response("Invalid latitude or longitude", { status: 400 });
      }

      // Round radius up to nearest step
      const roundedRadius = Math.ceil(radius / GRID.RADIUS_STEP) * GRID.RADIUS_STEP;

      // Round coordinates to grid
      const METERS_PER_LAT_DEGREE = 111319.9;
      const METERS_PER_LNG_DEGREE = Math.cos(lat * Math.PI / 180) * METERS_PER_LAT_DEGREE;
      
      const roundedLat = Math.round(lat * METERS_PER_LAT_DEGREE / GRID.SIZE_METERS) * GRID.SIZE_METERS / METERS_PER_LAT_DEGREE;
      const roundedLng = Math.round(lng * METERS_PER_LNG_DEGREE / GRID.SIZE_METERS) * GRID.SIZE_METERS / METERS_PER_LNG_DEGREE;

      // Format cache key with consistent precision
      const cacheKey = getNearbySearchCacheKey(roundedLat, roundedLng, roundedRadius, type, provider);
      
      // Move this up before any cache operations
      const isDevelopment = request.url.includes('localhost') || request.url.includes('127.0.0.1');
      const cacheDuration = isDevelopment ? CACHE_DURATION.DEVELOPMENT : CACHE_DURATION.PRODUCTION;

      // Then in the cac((he check section
      const useCache =  await shouldUseCache(cacheKey);
      if (useCache) {
          try {
              let cachedData = await env.PLACES_KV.getWithMetadata(cacheKey, { type: "json" });
              if (cachedData && cachedData.value) {
                  // Check if cache entry would have expired based on current policy
                  const cacheAge = Date.now() - cachedData.metadata.timestamp;
                  const maxAge = cacheDuration.KV * 1000; // Convert to milliseconds
                  
                  if (cacheAge < maxAge) {
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
                  // Cache is too old based on current policy, let it fall through to refresh
              }
          } catch (error) {
              console.error("Cache fetch error ----------------", error)
              throw error;
          }
      }

      // For nearby search
      const searchParams = {
        lat: roundedLat,
        lng: roundedLng,
        radius: roundedRadius,
        type: TYPE_MAPPING[provider][type] || type
      };

      const searchUrl = apiConfig.nearbySearch(searchParams, apiKey);
      const searchResponse = await fetch(searchUrl);
      const searchData = await searchResponse.json();

      if (!searchResponse.ok) {
        console.error ('Search Url', searchUrl);
        console.error('Search response error:', {
          status: searchResponse.status,
          statusText: searchResponse.statusText
        });
        return new Response(JSON.stringify({
          error: `Failed to fetch data from ${provider}`,
          details: searchData,
          status: searchResponse.status,
          statusText: searchResponse.statusText,
          response: searchData
        }), { 
          status: searchResponse.status || 500,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }

      const normalizedResults = apiConfig.parseNearbyResults(searchData);
      
      // Store in KV with expiration
      await env.PLACES_KV.put(cacheKey, JSON.stringify(normalizedResults), { 
        expirationTtl: cacheDuration.KV,
        metadata: { timestamp: Date.now() }
      });

      // For non-cache responses, add cache miss header
      return new Response(JSON.stringify(normalizedResults), {
        headers: { 
          ...corsHeaders,
          "Content-Type": "application/json", 
          "Cache-Control": `public, max-age=${cacheDuration.BROWSER}`,
          "X-Cache-Hit": "false",
          "X-Cache-Type": "places_nearby"
        },
      });
    } catch (error) {
      console.error('Error in handleRequest - after data fetch', error)
      return new Response(JSON.stringify({
        error: "Internal Server Error",
        message: error.message,
        // Include more debug info in development
        details: env.NODE_ENV === 'development' ? {
          url: request.url,
          hasGoogleKey: !!env.GOOGLE_PLACES_API_KEY,
          hasSecureKey: !!env.SECURE_API_KEY_PLACES,
          hasKV: !!env.PLACES_KV
        } : undefined
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

function getCacheKey(params) {
    const { lat, lng, radius, type, provider = PROVIDER.GOOGLE } = params;
    // Use short prefix 'p' for places and include provider initial
    return `p:${provider[0]}:${lat}:${lng}:${radius}:${type}`;
}

function getDetailsCacheKey(placeId, provider) {
    return `details:${provider}:${placeId}`;
}

// Add these helper functions at the top with other constants
function getNearbySearchCacheKey(lat, lng, radius, type, provider) {
    return `nearby:${provider}:${lat},${lng}:${radius}:${type}`;
}
