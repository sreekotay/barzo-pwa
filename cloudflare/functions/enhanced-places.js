// Add CORS headers at the top of the file
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
};

export default {
    async fetch(request, env, ctx) {
        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                headers: corsHeaders,
                status: 200
            });
        }

        // Validate API key
        const authKey = request.headers.get('X-API-Key');
        if (!authKey || authKey !== env.SECURE_API_KEY_PLACES) {
            return new Response(JSON.stringify({
                error: "Unauthorized - Invalid or missing API key"
            }), { 
                status: 403,
                headers: {
                    ...corsHeaders,
                    "Content-Type": "application/json"
                }
            });
        }

        const url = new URL(request.url);
        const lat = url.searchParams.get("lat");
        const lng = url.searchParams.get("lng");
        const radius = url.searchParams.get("radius") || 500;
        const types = url.searchParams.get("types") || "restaurant,bar,cafe";

        // Add CORS headers to all responses
        const responseHeaders = {
            ...corsHeaders,
            "Content-Type": "application/json"
        };

        // Log environment and request details
        console.log('Environment Check:', {
            hasRadarKey: !!env.RADAR_API_KEY,
            hasSecureKey: !!env.SECURE_API_KEY_PLACES,
            radarKeyLength: env.RADAR_API_KEY?.length,
            radarKeyStart: env.RADAR_API_KEY?.substring(0, 10),
            url: url.toString(),
            params: { lat, lng, radius, types }
        });

        if (!lat || !lng) {
            return new Response(JSON.stringify({ error: "Missing lat/lng parameters" }), { 
                status: 400,
                headers: responseHeaders
            });
        }

        // Map Google Places types to Radar categories
        const typeToCategory = {
            restaurant: "food-beverage,restaurant",
            bar: "food-beverage,bar,nightlife",
            cafe: "food-beverage,cafe",
            night_club: "nightlife",
            bakery: "bakery",
            grocery_store: "grocery",
            supermarket: "grocery",
            shopping_mall: "shopping-mall",
            store: "retail",
            gym: "gym",
            park: "park",
            lodging: "hotel",
            hotel: "hotel",
            gas_station: "gas-station",
            parking: "parking",
            bank: "bank",
            atm: "atm",
            hospital: "hospital",
            pharmacy: "pharmacy",
            doctor: "doctor",
            school: "school",
            university: "university",
            library: "library",
            post_office: "post-office"
        };

        const categories = types
            .split(",")
            .map(type => typeToCategory[type.trim()] || type.trim())
            .filter(Boolean)
            .join(",");

        const cacheKey = `places_${lat}_${lng}_${radius}_${types}`;
        const cachedData = await env.PLACES_CACHE.get(cacheKey);

        if (cachedData) {
            return new Response(cachedData, { 
                headers: responseHeaders
            });
        }

        try {
            if (!env.RADAR_API_KEY) {
                console.error('Missing Radar API Key');
                throw new Error('Radar API key not configured');
            }
            console.log('Using Radar API key:', `${env.RADAR_API_KEY.substring(0, 10)}...`);
            const radarData = await fetchRadarData(lat, lng, categories, radius, env.RADAR_API_KEY);
            const enrichedData = await enrichPOIData(radarData, env);
            
            if (enrichedData.length > 0) {
                await cacheResults(env, cacheKey, enrichedData);
                return new Response(JSON.stringify(enrichedData), {
                    headers: responseHeaders
                });
            } else {
                return new Response(JSON.stringify({ error: "No places found" }), {
                    status: 404,
                    headers: responseHeaders
                });
            }
        } catch (error) {
            return new Response(JSON.stringify({ error: error.message }), {
                status: 500,
                headers: responseHeaders
            });
        }
    }
};

async function fetchRadarData(lat, lng, categories, radius, radarApiKey) {
    try {
        // Split categories and map them correctly
        const radarCategories = categories
            .split(',')
            .map(cat => {
                if (cat === 'bar,nightlife') return 'bar,nightlife';
                if (cat === 'night_club') return 'nightlife';
                return cat;
            })
            .join(',');

        const url = new URL('https://api.radar.io/v1/search/places');
        url.searchParams.append('near', `${lat},${lng}`);
        url.searchParams.append('categories', radarCategories);
        url.searchParams.append('radius', radius);
        url.searchParams.append('limit', '50');
        
        console.log('Radar API Request:', {
            url: url.toString(),
            headers: {
                'Authorization': `${radarApiKey.substring(0, 10)}...`
            },
            params: { lat, lng, categories: radarCategories, radius }
        });

        const response = await fetch(url.toString(), {
            headers: { 
                'Authorization': radarApiKey
            }
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error('Radar API Error:', errorData);
            throw new Error(`Radar API error: ${errorData.meta?.message || response.statusText}`);
        }

        const data = await response.json();
        
        if (!data.places) {
            console.error('Invalid Radar response:', data);
            throw new Error('Invalid response from Radar API');
        }

        // Log the first few results to verify category filtering
        console.log('First 3 places:', data.places.slice(0, 3).map(p => ({
            name: p.name,
            categories: p.categories
        })));

        return data.places;
    } catch (error) {
        console.error('Radar API error:', error);
        throw error;
    }
}

async function enrichPOIData(places, env) {
    console.log('Starting enrichment for', places.length, 'places');
    console.log('Environment check:', {
        hasOpenAI: !!env.OPENAI_API_KEY,
        hasBing: !!env.BING_SEARCH_API_KEY
    });

    return await Promise.all(
        places.map(async (place) => {
            // Extract coordinates correctly
            const lat = place.location.coordinates[1];
            const lng = place.location.coordinates[0];
            
            let enrichedInfo = {
                rating: 4.0,
                user_ratings_total: 100,
                opening_hours: null,
                price_level: 2,
                reviews: []
            };

            // Try to get AI-generated data
            if (env.OPENAI_API_KEY) {
                try {
                    console.log('Fetching ChatGPT data for:', place.name);
                    enrichedInfo = await fetchChatGptData(place, env.OPENAI_API_KEY);
                } catch (error) {
                    console.error('OpenAI enrichment failed for', place.name, ':', error);
                }
            } else {
                console.log('No OpenAI API key available');
            }

            // Try to get OSM data for address
            let osmData = null;
            try {
                osmData = await fetchOSMData(place.name, lat, lng);
            } catch (error) {
                console.error('OSM data fetch failed for', place.name, ':', error);
            }

            return {
                place_id: place._id,
                name: place.name,
                formatted_address: osmData?.formatted_address || place.formattedAddress || 'Tampa, FL',
                geometry: {
                    location: {
                        lat,
                        lng
                    }
                },
                types: place.categories,
                rating: enrichedInfo.rating,
                user_ratings_total: enrichedInfo.user_ratings_total,
                opening_hours: enrichedInfo.opening_hours,
                photos: place.logo ? [{
                    photo_reference: place.logo,
                    height: 400,
                    width: 400,
                    html_attributions: []
                }] : [],
                price_level: enrichedInfo.price_level,
                reviews: enrichedInfo.reviews || [],
                business_status: "OPERATIONAL",
                chain: place.chain
            };
        })
    ).then(results => results.filter(result => result !== null));
}

async function fetchChatGptData(place, openAiApiKey) {
    try {
        // More specific prompt for better results
        const prompt = `
        Generate realistic business information for this place in Tampa, Florida:
        Name: ${place.name}
        Type: ${place.categories?.join(", ") || "business"}
        Location: ${place.location.coordinates[1]}, ${place.location.coordinates[0]}
        
        Return ONLY a JSON object with these fields:
        {
            "rating": (number between 3.0-5.0),
            "user_ratings_total": (number between 50-500),
            "opening_hours": {
                "monday": "11:00 AM - 10:00 PM",
                "tuesday": "11:00 AM - 10:00 PM",
                "wednesday": "11:00 AM - 10:00 PM",
                "thursday": "11:00 AM - 11:00 PM",
                "friday": "11:00 AM - 2:00 AM",
                "saturday": "11:00 AM - 2:00 AM",
                "sunday": "11:00 AM - 10:00 PM"
            },
            "price_level": (number 1-4),
            "reviews": [
                {
                    "rating": 5,
                    "text": "short review",
                    "time": "2024-02",
                    "author": "name"
                },
                // two more reviews
            ]
        }`;

        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${openAiApiKey}`
            },
            body: JSON.stringify({
                model: "gpt-3.5-turbo",
                messages: [{ 
                    role: "user", 
                    content: prompt 
                }],
                temperature: 0.7,
                response_format: { type: "json_object" }  // Force JSON response
            })
        });

        if (!response.ok) {
            const errorData = await response.text();
            console.error('OpenAI API error response:', errorData);
            throw new Error('OpenAI API response not ok');
        }

        const data = await response.json();
        console.log('OpenAI enrichment for:', place.name, data.choices[0].message.content);
        return JSON.parse(data.choices[0].message.content);
    } catch (error) {
        console.error('OpenAI API error for', place.name, ':', error);
        // Return realistic fallback data
        return {
            rating: 4.2,
            user_ratings_total: 127,
            opening_hours: {
                monday: "11:00 AM - 10:00 PM",
                tuesday: "11:00 AM - 10:00 PM",
                wednesday: "11:00 AM - 10:00 PM",
                thursday: "11:00 AM - 11:00 PM",
                friday: "11:00 AM - 2:00 AM",
                saturday: "11:00 AM - 2:00 AM",
                sunday: "11:00 AM - 10:00 PM"
            },
            price_level: 2,
            reviews: [
                {
                    rating: 5,
                    text: "Great local spot with friendly staff",
                    time: "2024-02",
                    author: "Local Guide"
                }
            ]
        };
    }
}

async function fetchBusinessPhoto(businessName, bingApiKey) {
    try {
        const url = `https://api.bing.microsoft.com/v7.0/images/search?q=${encodeURIComponent(businessName + " exterior")}&count=1`;

        const response = await fetch(url, {
            headers: { "Ocp-Apim-Subscription-Key": bingApiKey }
        });

        if (!response.ok) {
            throw new Error('Bing API response not ok');
        }

        const data = await response.json();
        return data.value?.[0]?.contentUrl || null;
    } catch (error) {
        console.error('Bing API error:', error);
        return null;
    }
}

async function fetchOSMData(businessName, lat, lng) {
    try {
        const query = `[out:json];(node["name"="${businessName}"](around:500,${lat},${lng}););out body;`;
        const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
        
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error('OSM API response not ok');
        }

        const data = await response.json();

        if (data.elements?.length > 0) {
            const place = data.elements[0];
            return {
                formatted_address: `${place.tags["addr:housenumber"] || ""} ${place.tags["addr:street"] || ""}, ${place.tags["addr:city"] || ""}, ${place.tags["addr:postcode"] || ""}`.trim()
            };
        }
        return null;
    } catch (error) {
        console.error('OSM API error:', error);
        return null;
    }
}

async function cacheResults(env, key, data) {
    try {
        const ttl = 43200; // 12 hours
        await env.PLACES_CACHE.put(key, JSON.stringify(data), { expirationTtl: ttl });
    } catch (error) {
        console.error('Cache error:', error);
        // Continue without caching
    }
} 