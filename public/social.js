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

// Update places change callback to store data
mapService.onPlacesChange((places) => {
    console.log('Places update received:', places);
    currentPlaces = places; // Store the places data
    updatePlacesContainer(places);
});

// Separate function to update places container
function updatePlacesContainer(places) {
    const placesContainer = document.querySelector('#places-container');
    if (!placesContainer) {
        console.log('No places container found');
        return;
    }

    if (!places || places.length === 0) {
        console.log('No places data received');
        placesContainer.innerHTML = '<p>No places found nearby</p>';
        return;
    }

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

    // Add click handlers to cards
    placesContainer.querySelectorAll('.place-card').forEach(card => {
        card.addEventListener('click', () => {
            const placeId = card.dataset.placeId;
            const marker = mapService._placeMarkers.find(m => m.placeId === placeId);
            if (marker) {
                marker.getElement().click();
            }
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

export function initialize() {
    locationService.requestGeoLocation();
    const { closeMenu } = initializeMobileMenu();
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
}

export function updateLocation() {
    return locationService.getUserLocation();
} 