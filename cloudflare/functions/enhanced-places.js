/**
 * Enhanced Places API
 * Combines Radar Places API with Google Places API, with caching
 * 
 * Detail Levels:
 * 1. basic
 *    - Uses Radar for all place details (name, location, categories)
 *    - Only fetches place_id from Google (minimal API usage)
 *    - Returns data in Google Places API format
 *    - Cached for 1 week using radar_id + detail level as key
 * 
 * 2. full
 *    - Uses Radar for base place data
 *    - Fetches full details from Google (place_id, name, address, phone, etc)
 *    - Returns both Radar and Google data
 *    - Cached for 1 week using radar_id + detail level as key
 * 
 * Cache Strategy:
 * - Key format: `place:{radar_id}:{detail_level}`
 * - TTL: 1 week
 * - Separate cache entries for basic/full to optimize response size
 * 
 * TODO: When returning cached Google place details, we need to:
 * 1. Update opening_hours.open_now based on current time and periods
 * 2. Update current_opening_hours.open_now to match
 * 3. Remove opening_hours field entirely if no periods data exists
 * 4. Handle proper timezone based on place location (currently assuming EST)
 */

const API_VERSION = 'v2.0.5';  // Update: Added Radar categories, fallback place_id, and cache types

const CACHE_KEYS = {
    PREFIX: 'place',
    LEVELS: {
        BASIC: 'basic',
        FULL: 'full'
    }
};

const GRID = {
    // Less aggressive grid sizes than nearby-places
    MIN_RADIUS: 100,  // Minimum 100m radius
    getCoordinatePrecision(radius) {
        // Returns decimal places to round to based on radius
        if (radius <= 100) return 4;        // ~11m precision
        if (radius <= 500) return 3;        // ~111m precision
        if (radius <= 2000) return 2;       // ~1.1km precision
        return 1;                           // ~11km precision
    },
    roundRadius(radius) {
        // Round to nearest power of 2, but only above 500m
        if (radius <= 500) return radius;
        return Math.pow(2, Math.ceil(Math.log2(radius)));
    }
};

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, X-Radar-Key, X-Google-API-Key',
    'Access-Control-Max-Age': '86400',
};


// Update findGooglePlacesByName to add detailed logging
const PLACE_DETAIL_FIELDS_DETAILS = [
    "accessibilityOptions",
    "addressComponents",
    "adrFormatAddress",
    "businessStatus",
    "curbsidePickup",
    "currentOpeningHours",
    "currentSecondaryOpeningHours",
    "delivery",
    "dineIn",
    "displayName",
    "editorialSummary",
    "formattedAddress",
    "googleMapsUri",
    "iconBackgroundColor",
    "iconMaskBaseUri",
    "id",
    "internationalPhoneNumber",
    "location",
    "name",
    "nationalPhoneNumber",
    "parkingOptions",
    "paymentOptions",
    "photos",
    "plusCode",
    "priceLevel",
    "primaryType",
    "rating",
    "regularOpeningHours",
    "reservable",
    "servesBeer",
    "servesBreakfast",
    "servesBrunch",
    "servesDinner",
    "servesLunch",
    "servesVegetarianFood",
    "servesWine",
    "takeout",
    "types",
    "userRatingCount",
    "utcOffsetMinutes",
    "viewport",
    "websiteUri",
    "allowsDogs",
    "curbsidePickup",
    "delivery",
    "dineIn",
    "editorialSummary",
    "evChargeOptions",
    "fuelOptions",
    "goodForChildren",
    "goodForGroups",
    "goodForWatchingSports",
    "liveMusic",
    "menuForChildren",
    "parkingOptions",
    "paymentOptions",
    "outdoorSeating",
    "reservable",
    "restroom",
    "servesBeer",
    "servesBreakfast",
    "servesBrunch",
    "servesCocktails",
    "servesCoffee",
    "servesDessert",
    "servesDinner",
    "servesLunch",
    "servesVegetarianFood",
    "servesWine",
    "takeout"
    ].sort(); // Sort for consistent ordering

const PLACE_DETAIL_FIELDS_NEW = PLACE_DETAIL_FIELDS_DETAILS.map(s=>`places.${s}`)
  

// Simple hash function
const FIELDS_HASH = PLACE_DETAIL_FIELDS_NEW.join(',').split('').reduce((hash, char) => {
    return ((hash << 5) - hash) + char.charCodeAt(0) | 0;
}, 0).toString(36);

// Add at top with other constants
const CACHE_TTL = {
    BASIC: 60 * 60 * 24 * 14,  // 2 weeks for basic mapping
    FULL: 60 * 60 * 24 * 7,    // 1 week for full details
    RADAR: 60 * 60 * 24 * 7,    // 1 week for radar results
    NEARBY: 60 * 60 * 24 * 7     // 1 week for nearby search results
};

function getNearbyCacheKey(params) {
    const precision = GRID.getCoordinatePrecision(params.radius);
    const roundedLat = Number(params.lat).toFixed(precision);
    const roundedLng = Number(params.lng).toFixed(precision);
    const roundedRadius = GRID.roundRadius(params.radius);
    const limit = params.limit || 20;

    // Use derived categories instead of input params
    const limitStr = `:limit=${limit}`;
    const keywordsStr = `:keywords=${(params.keywords||[]).join(',')}`;
    const typeStr = `:type=${(params.type||'').toLowerCase()}`;

    return `${API_VERSION}:radar:${roundedLat},${roundedLng}:${roundedRadius}${keywordsStr}${typeStr}${limitStr}`;
}

async function fillNearbyPlaces(results, env) {
    if (!results?.nearby) return results;
    results.nearby = await Promise.all(results.nearby.map(async (result) => {
        return await getPlaceDetailsCached({
            placeId:result.id, detailLevel:'full', cacheOnly:true
        }, env) || result
    }));

    let counter = 0, max = 5;
    results.nearby = await Promise.all(results.nearby.map(async (result) => {
        if (result.name || counter++ >= max) return result;
        const r = await getPlaceDetailsCached({
            placeId:result.id, detailLevel:'full'
        }, env)
        return r
    }));
    return results;
}

async function getNearbyPlacesCached({type, keywords, lat, lng, radius}, env) {
    const cacheKey = getNearbyCacheKey({type, keywords, lat, lng, radius});
    try {
        const cached = await env.PLACES_KV.get(cacheKey);
        if (cached) {
            const results = JSON.parse(cached);
            return fillNearbyPlaces({
                nearby_cache_hit: true,
                nearby: results.nearby  // Raw radar places
            }, env);
        }
    } catch (error) {
        console.error('Cache read error:', error);
    }

    const nearby = await findGooglePlacesByName({
                    name:keywords.join(), lat, lng, radius, 
                    detailLevel:'basic'
                }, env);

    // Cache the raw Radar results
    try {
        const cacheData = {
            nearby,  // Store raw radar places
            metadata: {
                type, keywords, lat, lng, radius,
                timestamp: new Date().toISOString()
            }
        };
        
        await env.PLACES_KV.put(cacheKey, JSON.stringify(cacheData), {
            expirationTtl: CACHE_TTL.RADAR
        });

    } catch (error) {
        console.error('Cache write error:', error);
    }

    return fillNearbyPlaces({
        nearby          // Return raw places for processing
    }, env);
}

async function findGooglePlacesById({placeId}, env) {
    const findUrl = `https://places.googleapis.com/v1/places/${placeId}`;
    const findResponse = await fetch(findUrl, {
        headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': env.GOOGLE_PLACES_API_KEY,
            'X-Goog-FieldMask': PLACE_DETAIL_FIELDS_DETAILS.join(',')
        }
    });
    const findData = await findResponse.json();
    if (!findData?.id) {
        console.log(`No Google Place match found for: ${placeId}`);
        return null;
    }
    return updateOpenNowStatus(findData);
}

async function findGooglePlacesByName({name, lat, lng, radius, detailLevel, type}, env) {    
    // First try to find the place
    const requestBody = {textQuery: `${name || ''}`.trim()};
    if (lat && lng) requestBody.locationBias = {circle: {center: {latitude: lat, longitude: lng}, radius: radius ? 50.0 : 500.0}};
    if (type) requestBody.includeType = type;

    const findUrl = 'https://places.googleapis.com/v1/places:searchText';
    const findResponse = await fetch(findUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': env.GOOGLE_PLACES_API_KEY,
            'X-Goog-FieldMask': detailLevel === CACHE_KEYS.LEVELS.BASIC || 1 ?  //always force basic for now
                'places.id,nextPageToken' : 
                PLACE_DETAIL_FIELDS_NEW.join(',')
        },
        body: JSON.stringify(requestBody)
    });

    const findData = await findResponse.json();
    if (!findData.places?.[0]?.id) {
        console.log(`No Google Place match found for: ${name}`);
        return null;
    }

    findData?.places?.forEach(place => updateOpenNowStatus(place));
    return findData.places;
}


// Add this function to get full details from a Google Place ID
async function getPlaceDetailsCached({placeId, detailLevel = 'full', cacheOnly}, env) {
    const cacheKey = `${API_VERSION}:Fields-${FIELDS_HASH}:${CACHE_KEYS.PREFIX}:${placeId}:${detailLevel}`;
    
    // Try cache first
    try {
        const cached = await env.PLACES_KV.get(cacheKey);
        if (cached) {
            const result = JSON.parse(cached);
            result.cache_hit = true;
            if (detailLevel === CACHE_KEYS.LEVELS.FULL) {
                return updateOpenNowStatus(result);
            }
            return result;
        }
    } catch (error) {
        console.error('Cache read error:', error);
    }

    if (cacheOnly) return null;

    // If not in cache or basic details requested, fetch from Google
    const result = await findGooglePlacesById({placeId}, env);

    // Cache the result
    try {
        await env.PLACES_KV.put(cacheKey, JSON.stringify(result), {
            expirationTtl: detailLevel === CACHE_KEYS.LEVELS.BASIC ? CACHE_TTL.BASIC : CACHE_TTL.FULL
        });
    } catch (error) {
        console.error('Cache write error:', error);
    }

    return {
        ...result,
        cache_hit: false,
        cache_type: 'google_fresh'
    };
}

//function to geocode a location
async function geocode({ name, mapboxKey }) {
    const endpoint = `https://api.mapbox.com/geocoding/v5/mapbox.places/${name}.json`;
    const url = new URL(endpoint);
    url.searchParams.append('access_token', mapboxKey);
    //url.searchParams.append('types', 'address,place,neighborhood');
    url.searchParams.append('limit', '10');
    const response = await fetch(url);
    const data = await response.json();
    return data.features;
}

// Instead, move the response formatting into the fetch handler where we have access to the variables
export default {
    async fetch(request, env, ctx) {
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        try {
            // Basic auth check
            const url = new URL(request.url);
            const authKey = request.headers.get('X-API-Key') || url.searchParams.get('apiKey');
            if (false) //debugging
            if (!authKey || authKey !== env.SECURE_API_KEY_PLACES) {
                return new Response(JSON.stringify({
                    error: 'Unauthorized',
                    message: 'Missing or invalid API Key',
                    status: 403
                }), {
                    status: 403,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

            let placeId = url.searchParams.get('placeId'), place;
            const noCache = url.searchParams.get('noCache') === 'true'; //debugging
            const placeName = url.searchParams.get('name');
            const lat = parseFloat(url.searchParams.get('lat'));
            const lng = parseFloat(url.searchParams.get('lng'));
            const geo = url.searchParams.get('geocode');

            if (geo && placeName) {
                console.error('geocode', geo);
                let result;
                switch (geo) {
                    case 'mapbox': result = await geocode({ placeName, mapboxKey:env.MAPBOX_API_KEY }, env); break;
                }
                if (!result) throw new Error('No geocoding result');
                return new Response(JSON.stringify({
                    status: 'success',
                    result: result
                }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

            if (placeName) {
                const detailLevel = url.searchParams.get('detailLevel') || 'basic';
                place = await findGooglePlacesByName({name:placeName, lat, lng, detailLevel}, env);
                placeId = place?.[0]?.id;
                if (!placeId) {
                    return new Response(JSON.stringify({
                        error: 'No place found',
                        message: 'No place found for the given name and location',
                        status: 404
                    }), { status: 404 });
                }
            }
            
            if (placeId) {
                // Handle place details request
                const detailLevel = url.searchParams.get('detailLevel') || 'full';
                const details = place || await getPlaceDetailsCached({placeId, detailLevel}, env);
                return new Response(JSON.stringify({
                    status: 'success',
                    cache_hit: details.cache_hit,
                    results: details
                }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

            let revgeo = url.searchParams.get('reverseGeocode')
            if (revgeo) {
                let result
                switch (revgeo) {
                    case 'mapbox': result = await reverseGeocodeMapbox({ lat, lng }, env); break;
                    case 'google': result = await reverseGeocodeGoogle({ lat, lng,  }, env); break;
                    case 'radar': result = await reverseGeocodeRadar({ lat, lng}, env); break;
                }
                if (!result) throw new Error('No reverse geocoding result');
                return new Response(JSON.stringify({
                    status: 'success',
                    result: result
                }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

            const radius = parseFloat(url.searchParams.get('radius') || '500');
            const detailLevel = url.searchParams.get('detailLevel') || 'full';
            const type = url.searchParams.get('type');
            const keywords = url.searchParams.getAll('keyword');
            const limit = parseInt(url.searchParams.get('limit') || 100);

            if (isNaN(lat) || isNaN(lng) || isNaN(radius)) {
                return new Response(JSON.stringify({
                    error: 'Invalid Parameters',
                    message: 'latitude, longitude, and radius must be valid numbers',
                    status: 400,
                    params: { lat, lng, radius }
                }), {
                    status: 400,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

            // Get Radar places with error handling
            const searchResult = await getNearbyPlacesCached(
                { lat, lng, radius, type, keywords, limit }, 
                env
            );

            // Only process if we have places
            if (searchResult?.nearby?.length > 0) {
                // Replace the single result test with batch processing
                const results = searchResult.nearby
                
                /*
                await Promise.all(radarPlaces.map(radarPlace => {
                    console.log(`Processing place ${radarPlace.name} with detailLevel: ${detailLevel}`);
                    return getCachedGooglePlace(radarPlace, detailLevel, env.GOOGLE_PLACES_API_KEY, env, noCache);
                }));
                */

                const responseBody = {
                    metadata: {
                        lat: lat,
                        lng: lng,
                        radius: radius,
                        nearby_cache_hit: searchResult.nearby_cache_hit || false,
                        total_results: results.length,
                        cache_hits: results.filter(r => r.cache_hit).length,
                        timestamp: new Date().toISOString()
                    },
                    results
                };

                try {
                    const responseString = JSON.stringify(responseBody);
                    return new Response(responseString, {
                        status: 200,
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                } catch (error) {
                    console.error('Response creation error:', error);
                    return new Response(JSON.stringify({
                        status: 'error',
                        error: 'Response Creation Error',
                        message: error.message
                    }), {
                        status: 500,
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                }
            } else {
                // Return empty results if no places found
                return new Response(JSON.stringify({
                    metadata: {
                        lat: lat,
                        lng: lng,
                        radius: radius,
                        total_results: 0,
                        cache_hits: 0,
                        timestamp: new Date().toISOString()
                    },
                    results: [],
                }), {
                    status: 200,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

        } catch (error) {
            console.error('Error details:', error);
            return new Response(JSON.stringify({
                status: 'error',
                error: 'Internal Server Error',
                message: error.message || 'Unknown error',
                details: error.toString(),
                timestamp: new Date().toISOString()
            }), {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }
    }
};



/* ================================
    Helper functions
   ================================ */
function updateOpenNowStatus(place) {
    if (!place?.regularOpeningHours?.periods) {
        delete place.regularOpeningHours;
        delete place.currentOpeningHours;
        return place;
    }

    // Get current time in Tampa's timezone (UTC-5)
    const now = new Date();
    const tampaTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const currentDay = tampaTime.getDay(); // 0 = Sunday, 1 = Monday, etc.
    const currentHour = tampaTime.getHours();
    const currentMinute = tampaTime.getMinutes();

    // Check if place data exists and has opening hours
    if (!place.regularOpeningHours.periods) {
        console.error('No opening hours data available');
        return;
    }

    const periods = place.regularOpeningHours.periods;
    let isOpen = false;

    // Check each period
    for (const period of periods) {
        // Handle 24-hour case (no close time specified)
        if (!period.close) {
            isOpen = true;
            break;
        }

        const openDay = period.open.day;
        const openHour = period.open.hour;
        const openMinute = period.open.minute;
        const closeDay = period.close.day;
        const closeHour = period.close.hour;
        const closeMinute = period.close.minute;

        // Convert times to comparable minutes since start of week
        let currentTime = (currentDay * 1440) + (currentHour * 60) + currentMinute;
        const openTime = (openDay * 1440) + (openHour * 60) + openMinute;
        let closeTime = (closeDay * 1440) + (closeHour * 60) + closeMinute;

        // Handle cases where closing time is on the next day
        if (closeTime < openTime) {
            closeTime += 7 * 1440; // Add a week's worth of minutes
            if (currentTime < openTime) {
                // If we're before opening time, add a week to current time for comparison
                currentTime += 7 * 1440;
            }
        }

        if (currentTime >= openTime && currentTime < closeTime) {
            isOpen = true;
            break;
        }
    }

    place.regularOpeningHours.open_now = isOpen;
    if (place.currentOpeningHours) {
        place.currentOpeningHours.open_now = isOpen;
    }

    return place;
}


async function reverseGeocodeMapbox({ lat, lng }, env) {
    const endpoint = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json`;
    const url = new URL(endpoint);
    
    // Add query parameters
    url.searchParams.append('access_token', env.MAPBOX_API_KEY);
    url.searchParams.append('types', 'address,place,neighborhood');
    url.searchParams.append('limit', '1');

    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Mapbox API error: ${response.status}`);
        }

        const data = await response.json();
        
        if (!data.features || data.features.length === 0) {
            return null;
        }

        // Return formatted address data
        const feature = data.features[0];
        return {
            formatted_address: feature.place_name,
            location: {
                lat: feature.center[1],
                lng: feature.center[0]
            },
            place_type: feature.place_type[0],
            context: feature.context || [],
            raw: feature
        };
    } catch (error) {
        console.error('Reverse geocoding error:', error);
        throw error;
    }
}


async function reverseGeocodeGoogle({ lat, lng }) {
    const endpoint = 'https://places.googleapis.com/v1/places:searchNearby';
    const requestBody = {
        locationRestriction: {
            circle: {
                center: {
                    latitude: lat,
                    longitude: lng
                },
                radius: 50.0 // 50 meters radius to get closest match
            }
        },
        maxResultCount: 1
    };

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': env.GOOGLE_PLACES_API_KEY,
                'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location,places.types,places.addressComponents'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            throw new Error(`Google Places API error: ${response.status}`);
        }

        const data = await response.json();
        
        if (!data.places || data.places.length === 0) {
            return null;
        }

        const place = data.places[0];
        return {
            formatted_address: place.formattedAddress,
            name: place.displayName?.text,
            location: {
                lat: place.location?.latitude,
                lng: place.location?.longitude
            },
            types: place.types,
            address_components: place.addressComponents,
            raw: place
        };
    } catch (error) {
        console.error('Google reverse geocoding error:', error);
        throw error;
    }
}

async function reverseGeocodeRadar({ lat, lng }) {
    const endpoint = `https://api.radar.io/v1/geocode/reverse`;
    const url = new URL(endpoint);
    
    // Add query parameters
    url.searchParams.append('coordinates', `${lat},${lng}`);

    try {
        const response = await fetch(url, {
            headers: {
                'Authorization': env.RADAR_API_KEY
            }
        });

        if (!response.ok) {
            throw new Error(`Radar API error: ${response.status}`);
        }

        const data = await response.json();
        
        if (!data.addresses || data.addresses.length === 0) {
            return null;
        }

        const address = data.addresses[0];
        return {
            formatted_address: address.formattedAddress,
            location: {
                lat: address.latitude,
                lng: address.longitude
            },
            country: address.country,
            countryCode: address.countryCode,
            state: address.state,
            stateCode: address.stateCode,
            city: address.city,
            postalCode: address.postalCode,
            raw: address
        };
    } catch (error) {
        console.error('Radar reverse geocoding error:', error);
        throw error;
    }
}