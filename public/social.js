import locationService from '/src/services/locationService.js';
locationService.requestGeoLocation();

import MapService from '/src/services/mapService.js';

const mapService = new MapService(locationService, {
    mapContainer: 'map',
    accessToken: 'pk.eyJ1Ijoic3JlZWJhcnpvIiwiYSI6ImNtNXdwOHl1aDAwaGgyam9vbHdjYnIyazQifQ.StZ77F8-5g43kq29k2OLaw',
    googleApiKey: 'AIzaSyDy1nNu0vLAHvnSJHPVVHPmPuJmlq3NSlo',
    searchInput: 'search-container',
    searchInputLevel: 'neighborhood',
    initialZoom: 13,
    nearbyPlaces: 30,
    placesEndpoint: 'supabase'  // Make sure we're using Supabase endpoint
});

mapService.initialize();

// Keep track of places data
let currentPlaces = [];

// Add at the top with other state variables
let currentIntersectionObserver = null;
let isUpdating = false;
let lastScrollTime = 0;

// Update places change callback to store data
mapService.onPlacesChange((places) => {
    console.log('Places update received:', places);
    currentPlaces = places; // Store the places data
    updatePlacesContainer(places);
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
    if (card) {
        lastScrollTime = performance.now();
        scrollIntoViewWithOffset(card, document.querySelector('.places-scroll'), 16);
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

// Update the updatePlacesContainer function
function updatePlacesContainer(places) {
    const placesContainer = document.querySelector('#places-container');
    if (!placesContainer) {
        console.log('No places container found');
        return;
    }

    if (!places || places.length === 0) {
        console.log('No places data received');
        placesContainer.style.height = '0';
        placesContainer.innerHTML = '<p>No places found nearby</p>';
        return;
    }

    // First update the content
    placesContainer.innerHTML = `
        <div class="places-scroll pb-2">
            <div class="w-1" style="flex-shrink: 0;"></div>
            ${places.map(place => `
                <div class="place-card" data-place-id="${place.place_id}">
                    ${place.photos && place.photos.length > 0 ? `
                        <div class="place-image">
                            <img 
                                src="https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photo_reference=${place.photos[0].photo_reference}&key=${mapService._googleApiKey}"
                                alt="${place.name}"
                                loading="lazy"
                            >
                        </div>
                    ` : ''}
                    <div class="flex-1 px-2 pb-2">
                        <div class="types-scroll nowrap">
                            ${(place.types || [])
                                .filter(type => !['point_of_interest', 'establishment'].includes(type))
                                .map((type, index, array) => `
                                    <span class="text-gray-500 text-xs">${type.replace(/_/g, ' ')}</span>${index < array.length - 1 ? '<span class="text-gray-300"> | </span>' : ''}
                                `).join('')}
                        </div>
                        <h3 class="name">${place.name}</h3>
                        <div class="flex" style="align-items: baseline;">
                            <div class="status ${place.opening_hours?.open_now ? 'open' : 'closed'}">
                                ${place.opening_hours?.open_now ? 'OPEN' : 'CLOSED'}
                            </div>
                            <div class="flex-1"></div>
                            <div class="text-gray-500 text-xs pr-1">${place.formattedDistance}</div>
                        </div>
                    </div>
                    <img 
                        src="/images/free-drink.png" 
                        alt="Free Drink Available" 
                        class="free-drink"
                    >
                </div>
            `).join('')}
        </div>
    `;

    // Cleanup any existing observer
    if (currentIntersectionObserver) {
        currentIntersectionObserver.disconnect();
    }

    // Update the intersection observer to log timestamps
    const observer = new IntersectionObserver(
        (entries) => {
            if (isUpdating) return;
            
            // Ignore intersection events that happen too soon after a scroll
            const now = performance.now();
            if (now - lastScrollTime < 200) return;

            let maxRatio = 0;
            let mostVisibleCard = null;

            entries.forEach(entry => {
                if (entry.intersectionRatio > maxRatio) {
                    maxRatio = entry.intersectionRatio;
                    mostVisibleCard = entry.target;
                }
            });

            if (mostVisibleCard && maxRatio > 0.5) {
                const placeId = mostVisibleCard.dataset.placeId;
                isUpdating = true;
                document.querySelectorAll('.place-card').forEach(card => {
                    card.dataset.selected = (card.dataset.placeId === placeId).toString();
                });
                mapService.selectMarker(placeId);
                isUpdating = false;
            }
        },
        {
            root: document.querySelector('.places-scroll'),
            threshold: [0, 0.25, 0.5, 0.75, 1],
            rootMargin: '0px'
        }
    );

    // Observe all place cards
    placesContainer.querySelectorAll('.place-card').forEach(card => {
        observer.observe(card);
    });

    // Store observer for cleanup
    currentIntersectionObserver = observer;

    // Update card click handler to handle marker selection and show details
    placesContainer.querySelectorAll('.place-card').forEach(card => {
        card.addEventListener('click', () => {
            if (isUpdating) return;
            isUpdating = true;
            
            const placeId = card.dataset.placeId;
            mapService.selectMarker(placeId);
            
            // Show bottom sheet
            const place = currentPlaces.find(p => p.place_id === placeId);
            if (place) {
                showPlaceDetails(place);
            }
            
            isUpdating = false;
        });
    });
}

// Private functions
function initializeMobileMenu() {
    const hamburger = document.getElementById('hamburger-menu');
    const sidebar = document.getElementById('mobile-sidebar');
    const overlay = document.getElementById('overlay');
    
    hamburger.addEventListener('click', toggleMenu);
    overlay.addEventListener('click', closeMenu);

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
        <div id="places-container" class="pt-4"></div>
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
    `,
    profile: `
        <h1 class="text-2xl font-bold mb-2 pt-4 px-2 mx-4">Your Profile</h1>
        <div class="bg-white rounded-lg shadow p-6 mx-4">
            <div class="flex items-center mb-6">
                <div class="w-20 h-20 bg-gray-200 rounded-full mr-4"></div>
                <div>
                    <h2 class="text-xl font-semibold">John Doe</h2>
                    <p class="text-gray-600">Member since 2024</p>
                </div>
            </div>
            <div class="space-y-4">
                <div class="border-b pb-4">
                    <h3 class="font-medium">Bio</h3>
                    <p class="text-gray-600">Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>
                </div>
                <div class="border-b pb-4">
                    <h3 class="font-medium">Stats</h3>
                    <p class="text-gray-600">Posts: 42 | Friends: 156 | Likes: 320</p>
                </div>
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

// Modify router to handle places container
function router() {
    console.log('Router called, path:', window.location.hash);
    const mainContent = document.querySelector('#main-content');
    const path = window.location.hash.slice(1) || 'home';
    const content = routes[path] || routes.home;
    mainContent.innerHTML = content;
    console.log('Content updated for main-content');

    // Re-render places if we're on the home route and have places data
    if (path === 'home' && currentPlaces.length > 0) {
        updatePlacesContainer(currentPlaces);
    }
}

function initMapResize() {
    const mapElement = document.getElementById('map');
    const resizeHandle = document.getElementById('map-resize-handle');
    let startY, startHeight;

    // Mouse events
    resizeHandle.addEventListener('mousedown', initDrag);
    
    // Touch events
    resizeHandle.addEventListener('touchstart', initDrag, { passive: false });

    function initDrag(e) {
        e.preventDefault(); // Prevent scrolling when touching the handle
        
        // Get initial positions
        startY = e.type === 'mousedown' ? e.clientY : e.touches[0].clientY;
        startHeight = parseInt(getComputedStyle(mapElement).height);
        
        // Add appropriate event listeners
        if (e.type === 'mousedown') {
            document.addEventListener('mousemove', doDrag);
            document.addEventListener('mouseup', stopDrag);
        } else {
            document.addEventListener('touchmove', doDrag, { passive: false });
            document.addEventListener('touchend', stopDrag);
        }
    }

    function doDrag(e) {
        e.preventDefault(); // Prevent scrolling during drag
        
        // Get current position
        const currentY = e.type === 'mousemove' ? e.clientY : e.touches[0].clientY;
        const newHeight = startHeight + (currentY - startY);
        
        // Constrain height between min and max values
        const constrainedHeight = Math.min(Math.max(newHeight, 200), window.innerHeight * 0.8);
        mapElement.style.height = `${constrainedHeight}px`;
        
        // Trigger a resize event for the map
        if (mapService._map) {
            mapService._map.resize();
        }
    }

    function stopDrag() {
        // Remove all event listeners
        document.removeEventListener('mousemove', doDrag);
        document.removeEventListener('mouseup', stopDrag);
        document.removeEventListener('touchmove', doDrag);
        document.removeEventListener('touchend', stopDrag);
    }
}

// Add this near the top of the file after other initialization code
function initializeBottomSheet() {
    // Create and append bottom sheet elements
    const sheetContainer = document.createElement('div');
    sheetContainer.innerHTML = `
        <div class="place-details-backdrop"></div>
        <div class="place-details-sheet">
            <button class="close-button">&times;</button>
            <div class="details"></div>
        </div>
    `;
    document.body.appendChild(sheetContainer);
    
    // Setup close handlers
    const sheet = sheetContainer.querySelector('.place-details-sheet');
    const backdrop = sheetContainer.querySelector('.place-details-backdrop');
    const closeButton = sheet.querySelector('.close-button');
    
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
    `;

    // Update content and show the sheet
    detailsDiv.innerHTML = contentHTML;
    sheet.classList.add('active');
    backdrop.classList.add('active');
}

// Call initializeBottomSheet in the initialize function
export function initialize() {
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
}

export function updateLocation() {
    return locationService.getUserLocation();
} 

export function scrollIntoViewWithOffset(el, scrollContainer, offset) {
  scrollContainer.scrollTo({
    behavior: 'smooth',
    left:
      el.getBoundingClientRect().left - offset + scrollContainer.scrollLeft,
  })
}