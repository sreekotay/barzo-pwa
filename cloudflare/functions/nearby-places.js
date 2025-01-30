const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders
      });
    }

    try {
      const { latitude, longitude, radius, types } = await request.json();

      // Ensure radius is within Google Places API limits (0-50000 meters)
      const validRadius = Math.min(Math.max(radius, 1), 50000);
      
      const url = new URL('https://maps.googleapis.com/maps/api/place/nearbysearch/json');
      url.searchParams.append('location', `${latitude},${longitude}`);
      url.searchParams.append('radius', validRadius.toString());
      url.searchParams.append('type', types.join('|'));
      url.searchParams.append('key', env.GOOGLE_MAPS_API_KEY);

      const response = await fetch(url.toString());
      const data = await response.json();

      if (data.status !== 'OK') {
        console.warn('Google Places API returned non-OK status:', data.status);
        return new Response(
          JSON.stringify({ 
            results: [], 
            status: data.status, 
            error_message: data.error_message 
          }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200 
          }
        );
      }

      return new Response(
        JSON.stringify(data),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200 
        }
      );
    } catch (error) {
      console.error('Error in Google Places search:', error.message);
      return new Response(
        JSON.stringify({ error: error.message, results: [] }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400 
        }
      );
    }
  }
}; 