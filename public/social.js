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

async function getClientKeys() {
    const response = await fetch('/api/getClientKeys');
    const data = await response.json();
    return data;
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
    mapService._supabase = supabase.createClient(clientKeys.supabaseUrl, clientKeys.supabaseAnonKey);

    if (!localStorage.getItem('authToken')) {
        window.location.href = '/legacy.html?redirect=' + encodeURIComponent(window.location.href);
    }

    mapService.initialize();
    
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

    // Update places change callback to store data
    mapService.onPlacesChange((places) => {
        currentPlaces = places;
    });

    // Update marker click handler
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
}

// Update the initialize function
export async function initialize() {
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

            // If this is a sheet route with ##, handle it specially
            if (link.getAttribute('href').endsWith('##')) {
                e.preventDefault();
                const currentHash = window.location.hash.slice(1);
                const currentRoute = currentHash.includes('##') 
                    ? currentHash.split('##')[1]  // If we're in a sheet, use its underlying route
                    : currentHash || 'home';      // Otherwise use current route or home
                
                const newRoute = link.getAttribute('href').slice(1, -2); // Remove # and ##
                window.location.hash = `${newRoute}##${currentRoute}`;
            }
        });
    });

    initMapResize();
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