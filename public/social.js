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
    nearbyPlaces: 10000
});

mapService.initialize();
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
        <h1 class="text-2xl font-bold mb-6">Welcome to Barzo</h1>
        <div class="bg-white rounded-lg shadow p-6">
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
        <h1 class="text-2xl font-bold mb-6">Your Profile</h1>
        <div class="bg-white rounded-lg shadow p-6">
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
        <h1 class="text-2xl font-bold mb-6">Settings</h1>
        <div class="bg-white rounded-lg shadow p-6">
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

function router() {
    const mainContents = document.querySelectorAll('.main-content');
    const path = window.location.hash.slice(1) || 'home';
    const content = routes[path] || routes.home;
    mainContents.forEach(mainContent => {
        mainContent.innerHTML = content;
    });
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