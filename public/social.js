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

async function getClientKeys() {
    const response = await fetch('/api/getClientKeys');
    const data = await response.json();
    return data;
}

function jitterCoordinate(coord, meters) {
    // Convert meters to approximate degrees (rough approximation)
    // 111,111 meters = 1 degree at equator
    const jitterDegrees = meters / 111111;
    return coord + (Math.random() - 0.5) * jitterDegrees * 2; // multiply by 2 to get full range
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

        // Fetch messages from Supabase
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

        // Create GeoJSON features with jittered coordinates
        const features = messages.map(msg => ({
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: [
                    jitterCoordinate(msg.longitude, 50),
                    jitterCoordinate(msg.latitude, 50)
                ]
            },
            properties: {
                weight: 1
            }
        }));

        // Add heatmap layer
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
                // Increase weight as zoom level increases
                'heatmap-weight': [
                    'interpolate',
                    ['linear'],
                    ['get', 'weight'],
                    0, 0,
                    1, 1
                ],
                // Increase intensity as zoom level increases
                'heatmap-intensity': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    0, 1,
                    9, 3
                ],
                // Cool green gradient for the heatmap
                'heatmap-color': [
                    'interpolate',
                    ['linear'],
                    ['heatmap-density'],
                    0, 'rgba(255,255,255,0)',
                    0.2, 'rgb(240,253,244)',  // Lightest green
                    0.4, 'rgb(187,247,208)',  // Light green
                    0.6, 'rgb(134,239,172)',  // Medium green
                    0.8, 'rgb(34,197,94)',    // Bright green
                    1, 'rgb(21,128,61)'       // Dark green
                ],
                // Adjust the heatmap radius by zoom level
                'heatmap-radius': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    0, 2,
                    9, 20
                ],
                // Transition from heatmap to circle layer by zoom level
                'heatmap-opacity': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    7, 1,
                    9, 0.5
                ]
            }
        });

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

    if (!localStorage.getItem('authToken')) {
        window.location.href = '/legacy.html?redirect=' + encodeURIComponent(window.location.href);
    }

    mapService._supabase = supabase.createClient(clientKeys.supabaseUrl, clientKeys.supabaseAnonKey);
    const supabaseSession = localStorage.getItem('supabaseSessionJWT');
    if (supabaseSession) {
        const session = JSON.parse(supabaseSession);
        await mapService._supabase.auth.setSession(session.access_token);
        console.log ("supabasUser", await mapService._supabase.auth.getUser());
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

// Remove the export
async function initialize() {
    await startupThisApp();
    locationService.requestGeoLocation();
    const { closeMenu } = initializeMobileMenu();
    
    document.querySelectorAll('a[href^="#"]').forEach(link => {
        link.addEventListener('click', (e) => {
            const isMobile = window.innerWidth < 1024;
            if (isMobile) {
                closeMenu();
            }
        });
    });

    initMapResize();
}

// Make it globally available
window.initialize = initialize;

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
        sidebar.classList.toggle('translate-x-full');
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