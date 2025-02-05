import locationService from '/src/services/locationService.js';
import MapService from '/src/services/mapService.js';
import Router from './src/router.js';
import sheetComponent from '/src/components/sheetComponent.js';
import ProfileComponent from '/src/components/profileComponent.js';

// global variables
let mapService;
let clientKeys;
let router;
let currentPlaces = [];
let currentIntersectionObserver = null;
let isUpdating = false;
let messageMarkersLayer = null;

// Add this timeout promise wrapper function at the top level
function withTimeout(promise, timeout) {
    return Promise.race([
        promise,
        new Promise((_, reject) => 
            setTimeout(() => reject(new Error(`Timeout after ${timeout}ms`)), timeout)
        )
    ]);
}

async function getClientKeys() {
    const response = await fetch('/api/getClientKeys');
    const data = await response.json();
    return data;
}

function jitterLocation(lat, lng, maxMeters) {
    // Random distance up to maxMeters, using square root for more natural distribution
    const distance = Math.sqrt(Math.random()) * maxMeters;
    
    // Random angle in radians
    const angle = Math.random() * 2 * Math.PI;
    
    // Convert distance to degrees (approximate)
    // 111,111 meters = 1 degree at equator
    const latOffset = (distance * Math.cos(angle)) / 111111;
    const lngOffset = (distance * Math.sin(angle)) / (111111 * Math.cos(lat * Math.PI / 180));
    
    return {
        lat: lat + latOffset,
        lng: lng + lngOffset
    };
}

async function createMessageMarkers() {
    try {
        // Debug session status
        const { data: { session }, error: sessionError } = await mapService._supabase.auth.getSession();
        console.log('Supabase Session:', {
            exists: !!session,
            error: sessionError,
            user: session?.user,
            token: session?.access_token?.slice(0, 20) + '...'
        });

        if (!session) {
            console.error('No valid Supabase session');
            return;
        }

        // Remove existing message markers layer if it exists
        if (messageMarkersLayer) {
            mapService._map.removeLayer(messageMarkersLayer);
        }

        // Fetch messages from Supabase and sort by latitude
        const { data: messages, error } = await mapService._supabase
            .from('messages')
            .select('*');

        if (error) {
            console.error('Supabase query error:', error);
            throw error;
        }

        if (!messages || messages.length === 0) {
            console.log('No messages found - this might be an RLS issue');
            return;
        }

        // Sort messages by latitude (north to south)
        messages.sort((a, b) => b.latitude - a.latitude);

        // Create GeoJSON features with jittered coordinates and varied weights
        const features = messages.map(msg => {
            const jittered = jitterLocation(msg.latitude, msg.longitude, 50);
            return {
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: [jittered.lng, jittered.lat]
                },
                properties: {
                    weight: Math.random() * 0.5 + 0.5
                }
            };
        });

        // Find the first symbol layer in the map style
        const firstSymbolId = mapService._map.getStyle().layers.find(layer => layer.type === 'symbol').id;

        // Add heatmap layer before the first symbol layer
        messageMarkersLayer = mapService._map.addLayer({
            id: 'messages-heat',
            type: 'heatmap',
            source: {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: features
                }
            },
            paint: {
                // Nonlinear weight contribution
                'heatmap-weight': [
                    'interpolate',
                    ['exponential', 2],  // Using exponential interpolation with base 2
                    ['get', 'weight'],
                    0, 0,
                    0.2, 0.1,    // Low weights have minimal impact
                    0.5, 0.4,    // Medium weights have moderate impact
                    0.8, 0.8,    // Higher weights start to dominate
                    1, 2         // Maximum weight has strong impact
                ],
                // Increase intensity as zoom level increases
                'heatmap-intensity': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    0, 1,
                    9, 5
                ],
                // Cool green gradient for the heatmap - brighter colors
                'heatmap-color': [
                    'interpolate',
                    ['linear'],
                    ['heatmap-density'],
                    0, 'rgba(255,255,255,0)',
                    0.2, 'rgb(240,253,244)',  // Lightest green
                    0.4, 'rgb(187,247,208)',  // Light green
                    0.6, 'rgb(74,222,128)',   // Brighter medium green
                    0.8, 'rgb(22,163,74)',    // Brighter green
                    1, 'rgb(21,128,61)'       // Dark green
                ],
                // Adjust the heatmap radius by zoom level
                'heatmap-radius': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    0, 2,
                    9, 16
                ],
                // Transition from heatmap to circle layer by zoom level
                'heatmap-opacity': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    7, 1,
                    9, 0.7
                ]
            }
        }, firstSymbolId);  // Add this parameter to insert before symbols

    } catch (error) {
        console.error('Error creating message heatmap:', error);
    }
}

async function startupThisApp() {
    try {clientKeys = JSON.parse(localStorage.getItem('clientKeys'))} catch (e) {clientKeys = null} 
    if (!clientKeys) {
        clientKeys = await getClientKeys();
        if (clientKeys) localStorage.setItem('clientKeys', JSON.stringify(clientKeys));
    } else {
        getClientKeys().then(cks=>{
            if (cks && cks!=JSON.stringify(clientKeys)) localStorage.setItem('clientKeys', cks);
        });
    }

    mapService = new MapService(locationService, {
        mapContainer: 'map',
        accessToken: 'pk.eyJ1Ijoic3JlZWJhcnpvIiwiYSI6ImNtNXdwOHl1aDAwaGgyam9vbHdjYnIyazQifQ.StZ77F8-5g43kq29k2OLaw',
        googleApiKey: clientKeys.googleKey,
        searchInput: 'search-container',
        searchInputLevel: 'neighborhood'
    });

    const authToken = localStorage.getItem('authToken');
    const supabaseSession = localStorage.getItem('supabaseSessionJWT');

    if (authToken && supabaseSession) {
        try {
            mapService._supabase = supabase.createClient(clientKeys.supabaseUrl, clientKeys.supabaseAnonKey);
            const session = JSON.parse(supabaseSession);
            
            // Wrap setSession with timeout
            try {
                await withTimeout(
                    mapService._supabase.auth.setSession(session.access_token),
                    3000 // 3 second timeout
                );
            } catch (timeoutError) {
                console.error('Session setup timed out:', timeoutError);
                mapService._supabase = null; // Force redirect to login
                throw timeoutError;
            }

            const {data, error} = await mapService._supabase.auth.getUser();
            if (error) mapService._supabase = null; // force a reload of the page below
            console.log("supabasUser", data);
        } catch (error) {
            console.error('Error setting Supabase session:', error);
            console.error('[SHOULD REDIRECT]', error);
        }
    }

    if (!mapService._supabase) {
        window.location.href = '/login.html?redirect=' + encodeURIComponent(window.location.href);
    }

    // Register callbacks before map initialization
    mapService.onPlacesChange((places) => {
        currentPlaces = places;
    });

    mapService.onMarkerClick((place) => {
        if (isUpdating) return;
        isUpdating = true;

        // Disconnect observer before any changes
        if (currentIntersectionObserver) {
            currentIntersectionObserver.disconnect();
        }

        // Update card borders and scroll
        document.querySelectorAll('.place-card').forEach(card => {
            card.dataset.selected = (card.dataset.placeId === place.place_id).toString();
        });

        const card = document.querySelector(`.place-card[data-place-id="${place.place_id}"]`);
        if (card && window.placesComponent) {
            window.placesComponent._scrollCardIntoView(place.place_id);
        }

        mapService.selectMarker(place.place_id);

        // Re-observe after a delay
        setTimeout(() => {
            if (currentIntersectionObserver) {
                document.querySelectorAll('.place-card').forEach(card => {
                    currentIntersectionObserver.observe(card);
                });
            }
            isUpdating = false;
        }, 100);
    });

    // Now initialize the map
    mapService.initialize();
    createMessageMarkers(); // should be async
    
    // Initialize profile component for header icon
    window.profileComponent = new ProfileComponent();
    
    // Initialize router
    router = new Router(mapService);
    // Make router globally accessible immediately after creation
    window.router = router;
    
    // Handle initial route
    const path = window.location.hash.slice(1) || 'home';
    router.handleRoute(path);
    
    // Handle route changes
    window.addEventListener('hashchange', () => {
        const path = window.location.hash.slice(1) || 'home';
        router.handleRoute(path);
    });
}

// Update the initialize function
export async function initialize() {
    try {
        await startupThisApp();
        locationService.requestGeoLocation();
        const { closeMenu } = initializeMobileMenu();
        
        // Setup navigation links
        document.querySelectorAll('a[href^="#"]').forEach(link => {
            link.addEventListener('click', (e) => {
                const isMobile = window.innerWidth < 1024;
                if (isMobile) {
                    closeMenu();
                }

            });
        });

        initMapResize();
    } catch (error) {
        console.error('Error initializing app:', error);
        throw error;
    }
}

function initMapResize() {
    const mapElement = document.getElementById('map');
    const resizeHandle = document.getElementById('map-resize-handle');
    let startY, startHeight;
    
    // Add debounce function
    let resizeTimeout;
    function debouncedResize() {
        if (resizeTimeout) clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            if (mapService._map) {
                mapService._map.resize();
            }
        }, 0); // roughly one frame at 60fps
    }

    // Mouse events
    resizeHandle.addEventListener('mousedown', initDrag);
    
    // Touch events
    resizeHandle.addEventListener('touchstart', initDrag, { passive: false });

    function initDrag(e) {
        e.preventDefault();
        startY = e.type === 'mousedown' ? e.clientY : e.touches[0].clientY;
        startHeight = parseInt(getComputedStyle(mapElement).height);
        
        if (e.type === 'mousedown') {
            document.addEventListener('mousemove', doDrag);
            document.addEventListener('mouseup', stopDrag);
        } else {
            document.addEventListener('touchmove', doDrag, { passive: false });
            document.addEventListener('touchend', stopDrag);
        }
    }

    function doDrag(e) {
        e.preventDefault();
        const currentY = e.type === 'mousemove' ? e.clientY : e.touches[0].clientY;
        const newHeight = startHeight + (currentY - startY);
        const constrainedHeight = Math.min(Math.max(newHeight, 0), window.innerHeight * 0.8);
        mapElement.style.height = `${constrainedHeight}px`;
        
        // Use debounced resize instead of immediate resize
        debouncedResize();
    }

    function stopDrag() {
        document.removeEventListener('mousemove', doDrag);
        document.removeEventListener('mouseup', stopDrag);
        document.removeEventListener('touchmove', doDrag);
        document.removeEventListener('touchend', stopDrag);
        
        // Force a final resize after drag ends
        if (mapService._map) {
            mapService._map.resize();
        }
    }
}

function initializeMobileMenu() {
    const hamburger = document.getElementById('hamburger-menu');
    const sidebar = document.getElementById('mobile-sidebar');
    const overlay = document.getElementById('overlay');
    
    hamburger.addEventListener('click', toggleMenu);
    overlay.addEventListener('click', closeMenu);

    // Add z-index to ensure menu is above map
    sidebar.classList.add('z-50');
    overlay.classList.add('z-40');

    function toggleMenu() {
        hamburger.classList.toggle('open');
        sidebar.classList.toggle('visible');
        overlay.classList.toggle('hidden');
        document.body.classList.toggle('overflow-hidden');
    }

    function closeMenu() {
        hamburger.classList.remove('open');
        sidebar.classList.add('translate-x-full');
        overlay.classList.add('hidden');
        document.body.classList.remove('overflow-hidden');
    }

    return { closeMenu };
}