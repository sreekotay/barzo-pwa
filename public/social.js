import locationService from '/src/services/locationService.js';
locationService.requestGeoLocation();

import MapService from '/src/services/mapService.js';
import PlacesComponent from '/src/components/placesComponent.js';
import EventsComponent from '/src/components/eventsComponent.js';
import ProfileComponent from './src/components/profileComponent.js';

async function getGoogleApiKey() {
    const response = await fetch('/api/googleMapsAPIKey');
    const data = await response.json();
    return data.key;
}

let mapService // global variable

async function startupThisApp() {
    let googleApiKey = localStorage.getItem('googleApiKey') 
    if (!googleApiKey) {
        googleApiKey = await getGoogleApiKey();
        if (googleApiKey) localStorage.setItem('googleApiKey', googleApiKey);
    } else {
        getGoogleApiKey(googleApiKey=>{
            if (googleApiKey) localStorage.setItem('googleApiKey', googleApiKey);
        });
    }

    mapService = new MapService(locationService, {
        mapContainer: 'map',
        accessToken: 'pk.eyJ1Ijoic3JlZWJhcnpvIiwiYSI6ImNtNXdwOHl1aDAwaGgyam9vbHdjYnIyazQifQ.StZ77F8-5g43kq29k2OLaw',
        googleApiKey: googleApiKey,
        searchInput: 'search-container',
        searchInputLevel: 'neighborhood'
    });

    if (!localStorage.getItem('authToken')) {
        //alert ("no auth token");
        window.location.href = '/legacy.html?redirect=' + encodeURIComponent(window.location.href);
    }

    mapService.initialize();

    // Keep track of places data
    let currentPlaces = [];

    // Add at the top with other state variables
    let currentIntersectionObserver = null;
    let isUpdating = false;

    // Add state for current POI type
    let currentPOIType = 'venues'; // or 'events'

    // Update places change callback to store data
    mapService.onPlacesChange((places) => {
        currentPlaces = places;
    });

    // Update the marker click handler to handle everything
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
            // Use the proper method from placesComponent
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





// Update the initialize function to remove scroll-related initialization
export async function initialize() {
    await startupThisApp();
    locationService.requestGeoLocation();
    const { closeMenu } = initializeMobileMenu();
    initializeBottomSheet();
    router(); // Initial route
    
    // Handle route changes
    window.addEventListener('hashchange', router);
    
    // Setup navigation links
    document.querySelectorAll('a[href^="#"]').forEach(link => {
        link.addEventListener('click', () => {
            const isMobile = window.innerWidth < 1024;
            if (isMobile) {
                closeMenu();
            }
        });
    });

    initMapResize();

    // When entering manual mode
    mapService.setManualMode(true);

    // When exiting manual mode
    mapService.setManualMode(false);

    // Add center button handler
    const centerButton = document.getElementById('center-button');
    if (centerButton) {
        centerButton.addEventListener('click', () => {
            mapService.centerOnCurrentLocation();
        });
    }

    // Initialize header profile component only
    window.profileComponent = new ProfileComponent();
}

export function updateLocation() {
    return locationService.getUserLocation();
}

// Helper function to update active tab
function updateActiveTab(route) {
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.route === route);
    });
}

// fix me $$$SREE
// Add a new messages link to the navigation
const navLists = document.querySelectorAll('nav ul');
navLists.forEach(ul => {
    const messagesLink = document.createElement('li');
    messagesLink.innerHTML = '<a href="#messages" class="block text-gray-600 hover:text-red-500">Messages</a>';
    ul.insertBefore(messagesLink, ul.querySelector('a[href="#settings"]').parentElement);
});

     // Private functions
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

const routes = {
    home: `
        <div class="pt-4">
            <!-- First row - Bars & Restaurants -->
            <div class="flex px-4 mb-1 items-center">
                <div class="w-2 h-2 rounded-full bg-red-600 mx-2"></div>
                <h3 class="text-sm font-medium text-gray-500">BARS & CLUBS</h3>
            </div>

            <div id="places-container" class="mb-4"></div>
        <!-- <div class="flex px-4 mb-1">
                <div class="poi-toggle bg-white rounded-lg shadow">
                    <div class="flex">
                        <button class="px-4 py-2 rounded-l-lg bg-red-600 text-white" data-type="venues">
                            Venues
                        </button>   
                        <button class="px-4 py-2 rounded-r-lg text-gray-700" data-type="events">
                            Events
                        </button>
                    </div>
                </div>
            </div> -->

            <!-- Second row - Entertainment -->
            <div class="flex px-4 mb-1 items-center">
                <div class="w-2 h-2 rounded-full bg-blue-500 mx-2"></div>
                <h3 class="text-sm font-medium text-gray-500">RESTAURANTS & CAFÉS</h3>
            </div>
            <div id="entertainment-container" class="mb-4"></div>

            <!-- Rest of the content -->
            <h1 class="text-2xl font-bold mb-2 mx-4">Welcome to Barzo</h1>
            <div class="bg-white rounded-lg shadow mx-4 p-6">
                <h2 class="text-xl font-semibold mb-4">Latest Updates</h2>
                <div class="space-y-4">
                    <div class="border-b pb-4">
                        <h3 class="font-medium">New Feature Released</h3>
                        <p class="text-gray-600">We've just launched our new messaging system!</p>
                    </div>
                    <div class="border-b pb-4">
                        <h3 class="font-medium">Community Highlight</h3>
                        <p class="text-gray-600">Check out this week's most active members.</p>
                    </div>
                </div>
            </div>
        </div>
    `,
    messages: `
        <h1 class="text-2xl font-bold mb-2 pt-4 px-2 mx-4">Messages</h1>
        <div class="bg-white rounded-lg shadow p-6 mx-4">
            <div class="flex items-center mb-6">
                <div class="w-20 h-20 bg-gray-200 rounded-full mr-4"></div>
                <div>
                    <h2 class="text-xl font-semibold">Messages</h2>
                    <p class="text-gray-600">No new messages</p>
                </div>
            </div>
            <div class="space-y-4">
                <div class="border-b pb-4">
                    <h3 class="font-medium">Recent</h3>
                    <p class="text-gray-600">Your messages will appear here.</p>
                </div>
            </div>
        </div>
    `,
    profile: `
        <div class="place-details-backdrop"></div>
        <div class="place-details-sheet">
            <button class="close-button absolute right-4 top-4 w-8 h-8 flex items-center justify-center rounded-full text-gray-500 hover:bg-gray-100">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
            </button>
            <div id="profile-content">
                <!-- ProfileComponent will inject content here -->
            </div>
        </div>
    `,
    settings: `
        <h1 class="text-2xl font-bold pt-4 mb-2 mx-4">Settings</h1>
        <div class="bg-white rounded-lg shadow p-6 mx-4">
            <div class="space-y-6">
                <div class="border-b pb-4">
                    <h3 class="font-medium mb-2">Account Settings</h3>
                    <div class="flex items-center justify-between">
                        <span class="text-gray-600">Email Notifications</span>
                        <button class="bg-red-500 text-white px-3 py-1 rounded">Enable</button>
                    </div>
                </div>
                <div class="border-b pb-4">
                    <h3 class="font-medium mb-2">Privacy</h3>
                    <div class="flex items-center justify-between">
                        <span class="text-gray-600">Profile Visibility</span>
                        <button class="bg-red-500 text-white px-3 py-1 rounded">Public</button>
                    </div>
                </div>
                <div class="pb-4">
                    <h3 class="font-medium mb-2">Theme</h3>
                    <div class="flex items-center justify-between">
                        <span class="text-gray-600">Dark Mode</span>
                        <button class="bg-gray-200 text-gray-800 px-3 py-1 rounded">Disabled</button>
                    </div>
                </div>
            </div>
        </div>
    `
};

function handleRouteChange(route) {
    const mainContent = document.querySelector('#main-content');
    
    if (route === 'profile') {
        // Remove any existing sheets first
        const existingSheet = document.querySelector('.place-details-sheet');
        const existingBackdrop = document.querySelector('.place-details-backdrop');
        if (existingSheet) existingSheet.parentElement.removeChild(existingSheet);
        if (existingBackdrop) existingBackdrop.parentElement.removeChild(existingBackdrop);
        
        // Don't clear main content for profile route
        document.body.insertAdjacentHTML('beforeend', routes[route]);
        
        // Add close handlers immediately
        const closeButton = document.querySelector('.place-details-sheet .close-button');
        const backdrop = document.querySelector('.place-details-backdrop');
        
        const closeProfile = () => {
            const sheet = document.querySelector('.place-details-sheet');
            const backdrop = document.querySelector('.place-details-backdrop');
            sheet.classList.remove('active');
            backdrop.classList.remove('active');
            
            // Remove the elements after animation
            setTimeout(() => {
                sheet.parentElement.removeChild(sheet);
                backdrop.parentElement.removeChild(backdrop);
                window.location.hash = 'home';
            }, 300);
        };

        [closeButton, backdrop].forEach(el => {
            el.addEventListener('click', closeProfile);
        });

        // Create new instance of ProfileComponent
        const profileComponent = new ProfileComponent();
        
        // Set up one-time event listener for this profile view
        const dataLoadedHandler = async (evt) => {
            console.log('Caught profileDataLoaded event');
            const sheet = document.querySelector('.place-details-sheet');
            const backdrop = document.querySelector('.place-details-backdrop');
            const profileContent = document.querySelector('#profile-content');
            
            if (profileContent && sheet) {
                console.log('Updating profile UI');
                // Update content first
                await evt.detail.component.updateProfileUI();
                
                // Reset animation state without triggering close handler
                sheet.classList.remove('active');
                backdrop.classList.remove('active');
                
                // Force reflow
                void sheet.offsetHeight;
                
                // Show the sheet again
                requestAnimationFrame(() => {
                    sheet.classList.add('active');
                    backdrop.classList.add('active');
                });
            }
            document.removeEventListener('profileDataLoaded', dataLoadedHandler);
        };
        document.addEventListener('profileDataLoaded', dataLoadedHandler);

    } else {
        // Remove any existing profile sheets
        const existingSheet = document.querySelector('.place-details-sheet');
        const existingBackdrop = document.querySelector('.place-details-backdrop');
        if (existingSheet) existingSheet.parentElement.removeChild(existingSheet);
        if (existingBackdrop) existingBackdrop.parentElement.removeChild(existingBackdrop);
        
        // Only update content if it's empty or we're switching to a different route
        if (!mainContent.children.length || !mainContent.querySelector(`[data-route="${route}"]`)) {
            mainContent.innerHTML = routes[route] || routes.home;
            
            // Add data-route attribute to identify the current route's content
            const content = mainContent.firstElementChild;
            if (content) {
                content.setAttribute('data-route', route);
            }
        }
        mainContent.className = 'relative z-20';
    }
    
    // Reset components if we're on home route and components don't exist
    if (route === 'home' && !window.placesComponent) {
        initializeHomeComponents();
    }
}

// Simplify router
function router() {
    const path = window.location.hash.slice(1) || 'home';
    handleRouteChange(path);

    // Initialize components when on home route
    if (path === 'home' && !window.placesComponent) {
        initializeHomeComponents();
    }
}

// Extract component initialization
function initializeHomeComponents() {
    // Initialize venues component
    window.placesComponent = new PlacesComponent(
        mapService, 
        locationService, 
        '#places-container',
        {
            placeTypes: ['bar', 'night_club'],
            maxResults: 30,
            endpoint: 'supabase',
            markerColors: {
                open: '#DC2626',
                closed: '#9CA3AF',
                pulse: '#DC2626'
            }
        }
    );

    // Initialize entertainment component
    window.entertainmentComponent = new PlacesComponent(
        mapService, 
        locationService, 
        '#entertainment-container',
        {
            placeTypes: ['restaurant', 'cafe'],
            maxResults: 20,
            endpoint: 'supabase',
            markerColors: {
                open: '#3B82F6',
                closed: '#9CA3AF',
                pulse: '#3B82F6'
            }
        }
    );
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

// Add this near the top of the file after other initialization code
function initializeBottomSheet() {
    // Create and append bottom sheet elements
    const sheetContainer = document.createElement('div');
    sheetContainer.innerHTML = `
        <div class="place-details-backdrop z-999"></div>
        <div class="place-details-sheet z-1000">
            <button style="background-color: white;" class="close-button absolute right-4 top-4 w-8 h-8 flex items-center justify-center rounded-full backdrop-blur-sm text-white hover:bg-black/30 focus:outline-none transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                </svg>
            </button>
            <div class="details"></div>
        </div>
    `;
    document.body.appendChild(sheetContainer);
    
    const sheet = sheetContainer.querySelector('.place-details-sheet');
    const backdrop = sheetContainer.querySelector('.place-details-backdrop');
    const closeButton = sheet.querySelector('.close-button');
    
    // Add swipe handling
    let touchStart = null;
    let currentTranslate = 0;
    
    sheet.addEventListener('touchstart', (e) => {
        touchStart = e.touches[0].clientY;
        sheet.style.transition = 'none';
    }, { passive: true });
    
    sheet.addEventListener('touchmove', (e) => {
        if (touchStart === null) return;
        
        const currentTouch = e.touches[0].clientY;
        const diff = currentTouch - touchStart;
        
        // Only allow downward swipe
        if (diff < 0) return;
        
        currentTranslate = diff;
        sheet.style.transform = `translateY(${diff}px)`;
        
        // Fade backdrop based on swipe progress
        const opacity = Math.max(0, 1 - (diff / sheet.offsetHeight));
        backdrop.style.opacity = opacity;
        
    }, { passive: true });
    
    sheet.addEventListener('touchend', (e) => {
        if (touchStart === null) return;
        
        sheet.style.transition = 'transform 0.3s ease-out';
        backdrop.style.transition = 'opacity 0.3s ease-out';
        
        // If swiped down more than 30% of sheet height, dismiss
        if (currentTranslate > sheet.offsetHeight * 0.3) {
            sheet.style.transform = `translateY(${sheet.offsetHeight}px)`;
            backdrop.style.opacity = '0';
            setTimeout(() => {
                sheet.style.transform = '';
                sheet.classList.remove('active');
                backdrop.classList.remove('active');
                backdrop.style.opacity = '';
            }, 300);
        } else {
            // Reset position
            sheet.style.transform = '';
            backdrop.style.opacity = '';
        }
        
        touchStart = null;
        currentTranslate = 0;
    });

    // Setup close handlers
    [backdrop, closeButton].forEach(el => {
        el.addEventListener('click', () => {
            sheet.classList.remove('active');
            backdrop.classList.remove('active');
        });
    });
}

// Add this function to handle showing place details
function showPlaceDetails(place) {
    const sheet = document.querySelector('.place-details-sheet');
    const backdrop = document.querySelector('.place-details-backdrop');
    const detailsDiv = sheet.querySelector('.details');
    
    // Format types for display
    const formattedTypes = (place.types || [])
        .filter(type => !['point_of_interest', 'establishment'].includes(type))
        .map(type => type.replace(/_/g, ' '))
        .join(', ') || 'Business';
    
    // Build the content HTML
    let contentHTML = `
            ${place.photos && place.photos.length > 0 ? `
            <div class="photos">
                <div class="photo-grid">
                    ${place.photos.map(photo => `
                        <img 
                            src="https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photo_reference=${photo.photo_reference}&key=${mapService._googleApiKey}"
                            alt="${place.name}"
                            loading="lazy"
                        >
                    `).join('')}
                </div>
            </div>
        ` : ''}

        <div class="content-grid">
            <div class="main-info">
                <div class="place-type">${formattedTypes}</div>
                <h2 class="name">${place.name || 'Unnamed Location'}</h2>
            </div>

            <div class="info-row">
                <span class="material-icons">schedule</span>
                ${place.opening_hours?.open_now !== undefined
                    ? `<span class="${place.opening_hours.open_now ? 'open' : 'closed'}">${place.opening_hours.open_now ? 'OPEN' : 'CLOSED'}</span>`
                    : `<span class="unknown">Status unknown</span>`
                }
            </div>

            <div class="info-row">
                <span class="material-icons">place</span>
                <span>${place.vicinity || 'Address not available'}</span>
            </div>

            ${place.rating ? `
                <div class="info-row">
                    <span class="material-icons">star</span>
                    <span>${place.rating} ⭐️ (${place.user_ratings_total || 0})</span>
                </div>
            ` : ''}
        </div>
    `;

    // Update content and show the sheet
    detailsDiv.innerHTML = contentHTML;
    sheet.classList.add('active');
    backdrop.classList.add('active');
}

// Update POIs based on current type
async function updatePOIs() {
    const location = locationService.getMapLocation();
    if (!location) return;

    if (currentPOIType === 'venues') {
        const venues = await fetchNearbyVenues(location.lat, location.lng);
        mapService.addPOIMarkers(venues, {
            markerClass: 'venue-marker',
            getMarkerColor: venue => venue.opening_hours?.open_now ? '#E31C5F' : '#666666'
        });
    } else {
        const events = await fetchNearbyEvents(location.lat, location.lng);
        mapService.addPOIMarkers(events, {
            markerClass: 'event-marker',
            getMarkerColor: event => {
                const now = new Date();
                const start = new Date(event.start.local);
                const end = new Date(event.end.local);
                return now >= start && now <= end ? '#4CAF50' : '#FFC107';
            }
        });
    }
}
