import locationService from '../services/locationService.js';

export default class SettingsPage {
    constructor() {
        this.settings = {
            mapDebug: localStorage.getItem('mapDebug') === 'true'
        };
        
        // Initialize debug state on load
        if (this.settings.mapDebug) {
            locationService.setIsDebugLocation(true);
            locationService.setDebugUserLocation({
                lat: 27.9478,  // 400 N St Tampa coordinates
                lng: -82.4584
            });
        } else {
            // Ensure debug mode is off on initialization if not enabled
            locationService.setIsDebugLocation(false);
        }
    }

    async render() {
        return `
            <div class="p-4">
                <h2 class="text-2xl font-bold mb-4">Settings</h2>
                
                <div class="space-y-4">
                    <!-- Debug Mode Toggle -->
                    <div class="flex items-center justify-between">
                        <label class="text-gray-700">Debug Mode</label>
                        <label class="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" id="mapDebug" 
                                class="sr-only peer" 
                                ${this.settings.mapDebug ? 'checked' : ''}>
                            <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 
                                peer-focus:ring-red-300 rounded-full peer 
                                peer-checked:after:translate-x-full peer-checked:after:border-white 
                                after:content-[''] after:absolute after:top-[2px] after:left-[2px] 
                                after:bg-white after:border-gray-300 after:border after:rounded-full 
                                after:h-5 after:w-5 after:transition-all peer-checked:bg-red-600">
                            </div>
                        </label>
                    </div>

                    <!-- Reset Animation Button -->
                    <div class="flex items-center justify-between">
                        <label class="text-gray-700">Reset Globe Animation</label>
                        <button id="resetAnimation" 
                            class="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 transition-colors">
                            Reset
                        </button>
                    </div>

                    <!-- Sign Out Button -->
                    <div class="flex items-center justify-between border-t pt-4 mt-4">
                        <label class="text-gray-700">Sign Out</label>
                        <button id="signOutButton" 
                            class="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors">
                            Sign Out
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    async afterRender() {
        const mapDebugToggle = document.getElementById('mapDebug');
        if (mapDebugToggle) {
            mapDebugToggle.addEventListener('change', (e) => {
                this.settings.mapDebug = e.target.checked;
                localStorage.setItem('mapDebug', e.target.checked);
                
                // Set debug mode and refresh the page
                window.mapService?.setDebugMode(e.target.checked);
                locationService.setIsDebugLocation(e.target.checked);
                window.location.reload();
            });
        }

        const resetButton = document.getElementById('resetAnimation');
        if (resetButton) {
            resetButton.addEventListener('click', () => {
                localStorage.removeItem('lastGlobeAnimation');
                alert('Globe animation will play on next app load');
                
                // After reset is complete, navigate to home
                window.location.hash = 'home';
            });
        }

        const signOutButton = document.getElementById('signOutButton');
        if (signOutButton) {
            signOutButton.addEventListener('click', async () => {
                try {
                    await window.socialService?.signOut();
                    window.location.href = '/login.html';
                } catch (error) {
                    console.error('Error signing out:', error);
                    alert('Error signing out. Please try again.');
                }
            });
        }
    }
} 