import PlacesComponent from '../components/placesComponent.js';
import locationService from '../services/locationService.js';

export default class HomePage {
    constructor(mapService) {
        this.mapService = mapService;
    }

    async render() {
        return `
            <div class="pt-4">
                <div class="flex px-4 mb-1 items-center">
                    <h3 class="text-sm font-medium text-gray-500">BARS & CLUBS</h3>
                    <div class="w-2 h-2 rounded-full bg-red-600 mx-2"></div>
                </div>

                <div id="places-container" class="mb-4"></div>

                <div class="flex px-4 mb-1 items-center">
                    <h3 class="text-sm font-medium text-gray-500">RESTAURANTS & CAFÉS</h3>
                    <div class="w-2 h-2 rounded-full bg-blue-500 mx-2"></div>
                </div>
                <div id="entertainment-container" class="mb-4"></div>

                <!-- Rest of home content -->
            </div>
        `;
    }

    async afterRender() {
        // Initialize venues component
        window.placesComponent = new PlacesComponent(
            this.mapService, 
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
            this.mapService, 
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
} 