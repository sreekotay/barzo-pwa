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

// Version number for cache invalidation
const API_VERSION = 'v1.0.0';

// CORS headers for cross-origin requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, X-Google-API-Key',
  'Access-Control-Max-Age': '86400',  // 24 hours
};

// Grid configuration for coordinate rounding to improve cache hits
const GRID_SIZE_METERS = 100; // Size of grid for rounding coordinates
const GRID = {
  SIZE_METERS: GRID_SIZE_METERS,  // Size of grid for rounding coordinates
  LAT_PRECISION: 5,               // Decimal places for latitude
  LNG_PRECISION: 5,               // Decimal places for longitude
  MIN_RADIUS: GRID_SIZE_METERS,   // Minimum search radius
  RADIUS_STEP: GRID_SIZE_METERS   // Round radius to nearest step for cache consistency
};

// Available data providers
const PROVIDER = {
  GOOGLE: 'google',   // Google Places API
  MAPBOX: 'mapbox',   // Mapbox Places API
  RADAR: 'radar',      // Radar.io API
  DEFAULT: 'google'
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
  [PROVIDER.MAPBOX]: {
    restaurant: 'restaurant',
    bar: 'bar,pub',
    cafe: 'cafe,coffee'
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
        KV: 60,          // 1 minute for development
        BROWSER: 60,     // 1 minute for development
        DETAILS: 60      // 1 minute for development
    }
};

// Provider-specific API configurations
const API_CONFIG = {
  [PROVIDER.GOOGLE]: {
    nearbySearch: async (params) => {
      try {
        // Build search parameters for Google Places API
        const searchParams = new URLSearchParams({
          location: `${params.lat},${params.lng}`,
          radius: params.radius,
          type: params.type,
          key: params.apiKey
        });

        // Add keyword filtering if provided
        if (params.keywords && params.keywords.length > 0) {
          searchParams.append('keyword', params.keywords.join('|'));
        }

        const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?${searchParams}`;
        
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Google Places API error: ${response.status}`);
        }
        
        return response.json();
      } catch (error) {
        console.error('Google Places API error:', error);
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
  [PROVIDER.MAPBOX]: {
    nearbySearch: async (params) => {
      try {
        let url;
        if (params.type.includes('bar') || params.type.includes('restaurant')) {
          const amenityTypes = params.type.includes('bar') ? 'bar|nightclub' : 'restaurant';
          url = `https://overpass-api.de/api/interpreter?data=[out:json];` +
                `(node[amenity~"${amenityTypes}"](around:${params.radius},${params.lat},${params.lng}););out;`;
        } else {
          const searchParams = new URLSearchParams({
            access_token: params.apiKey,
            radius: params.radius,
            limit: '40',
            layers: 'poi_label'
          });
          url = `https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/tilequery/${params.lng},${params.lat}.json?${searchParams}`;
        }

        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Mapbox API error: ${response.status}`);
        }
        
        return response.json();
      } catch (error) {
        console.error('Mapbox API error:', error);
        throw error;
      }
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

        // Parse opening hours
        const openingHours = parseOSMHours(tags.opening_hours);

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
                location: {
                    lat: element.lat || element.center?.lat,
                    lng: element.lon || element.center?.lon
                }
            },
            types: [tags.amenity, tags.leisure, tags.shop].filter(Boolean),
            current_opening_hours: openingHours,
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

// Add coordinate rounding functions
function getCoordinateGridSize(lat, lng, radius) {
    // For coordinates, we want much finer precision
    // ~111,111 meters per degree at equator
    // radius 50m -> ~0.0001° grid (~11m)
    // radius 500m -> ~0.0005° grid (~55m)
    // radius 2000m -> ~0.001° grid (~111m)
    // radius 5000m -> ~0.002° grid (~222m)
    return Math.min(radius / 111111, 0.01);  // Cap at 0.01 degrees (~1.1km)
}

function getRadiusGridSize(radius) {
    // For radius, we can be more aggressive
    // radius 50m -> round to nearest 50m
    // radius 500m -> round to nearest 100m
    // radius 2000m -> round to nearest 200m
    // radius 5000m -> round to nearest 500m
    return Math.pow(2, Math.floor(Math.log2(radius/50))) * 50;
}

function getNearbySearchCacheKey(lat, lng, radius, type, provider, keywords = []) {
    // Round coordinates based on radius
    const coordGridSize = getCoordinateGridSize(lat, lng, radius);
    const roundedLat = (Math.round(lat / coordGridSize) * coordGridSize).toFixed(5);
    const roundedLng = (Math.round(lng / coordGridSize) * coordGridSize).toFixed(5);
    
    // Round radius logarithmically
    const roundedRadius = Math.ceil(radius / getRadiusGridSize(radius)) * getRadiusGridSize(radius);

    // Generate cache key - keep provider for flexibility
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

// Helper function to parse OpenStreetMap hours format
function parseOSMHours(openingHours) {
    if (!openingHours) return null;

    try {
        const now = new Date();
        const dayNames = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
        const currentDay = dayNames[now.getDay()];
        const currentTime = now.getHours() * 100 + now.getMinutes();

        // Split rules by semicolon
        const rules = openingHours.split(';').map(r => r.trim());
        
        for (const rule of rules) {
            // Match day ranges and time ranges
            const match = rule.match(/([A-Za-z,\-]+)\s+(.+)/);
            if (!match) continue;

            const [_, days, times] = match;
            
            // Check if current day is in the range
            if (days.includes(currentDay)) {
                // Parse time ranges
                const timeRanges = times.split(',').map(t => t.trim());
                
                for (const timeRange of timeRanges) {
                    const [start, end] = timeRange.split('-')
                        .map(t => {
                            const [hours, minutes = '00'] = t.split(':');
                            return parseInt(hours) * 100 + parseInt(minutes);
                        });

                    if (currentTime >= start && currentTime <= end) {
                        return {
                            open_now: true,
                            weekday_text: [openingHours]
                        };
                    }
                }
            }
        }

        return {
            open_now: false,
            weekday_text: [openingHours]
        };

    } catch (error) {
        console.error('Error parsing OSM hours:', error);
        return null;
    }
}

async function fetchWithProvider(url, provider) {
    const config = API_CONFIG[provider];
    const headers = {
        'Content-Type': 'application/json',
        ...(config.headers || {})
    };

    const response = await fetch(url, { headers });
    if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
    }
    return await response.json();
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
          console.error("Cache fetch error:", error);
        }
      }

      // Cache miss - log and fetch fresh data
      console.log('Cache miss for nearby places:', {
          lat,
          lng,
          radius,
          type,
          roundedValues: {
              lat: (Math.round(lat / getCoordinateGridSize(lat, lng, radius)) * getCoordinateGridSize(lat, lng, radius)).toFixed(5),
              lng: (Math.round(lng / getCoordinateGridSize(lat, lng, radius)) * getCoordinateGridSize(lat, lng, radius)).toFixed(5),
              radius: Math.ceil(radius / getRadiusGridSize(radius)) * getRadiusGridSize(radius),
              coordGridSize: getCoordinateGridSize(lat, lng, radius),
              radiusGridSize: getRadiusGridSize(radius)
          },
          cacheKey
      });

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
