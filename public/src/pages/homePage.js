import PlacesComponent from '../components/placesComponent.js';

export default class HomePage {
    constructor(mapService, locationService) {
        this._mapService = mapService;
        this._locationService = locationService;
        this._components = new Map();
    }

    async render() {
        // Return the HTML structure first
        return `
            <div class="pt-4">
                <div class="flex px-4 mb-1 items-center">
                    <h3 class="text-sm font-medium text-gray-500">BARS & CLUBS</h3>
                    <div class="w-2 h-2 rounded-full bg-red-600 mx-2 opacity-0 transition-opacity duration-300" data-dot="bar"></div>
                </div>
                <div id="bar-container"></div>

                <div class="flex px-4 mb-1 items-center">
                    <h3 class="text-sm font-medium text-gray-500">RESTAURANTS</h3>
                    <div class="w-2 h-2 rounded-full bg-amber-600 mx-2 opacity-0 transition-opacity duration-300" data-dot="restaurant"></div>
                </div>
                <div id="restaurant-container"></div>

                <div class="flex px-4 mb-1 items-center">
                    <h3 class="text-sm font-medium text-gray-500">CIGAR & HOOKAH</h3>
                    <div class="w-2 h-2 rounded-full bg-purple-600 mx-2 opacity-0 transition-opacity duration-300" data-dot="cigar"></div>
                </div>
                <div id="cigar-hookah-container"></div>

                <div class="flex px-4 mb-1 items-center">
                    <h3 class="text-sm font-medium text-gray-500">KARAOKE & LIVE MUSIC</h3>
                    <div class="w-2 h-2 rounded-full bg-green-600 mx-2 opacity-0 transition-opacity duration-300" data-dot="music"></div>
                </div>
                <div id="music-container"></div>
            </div>
        `;
    }

    async afterRender() {
        // Initialize components with their specific configs
        const barComponent = new PlacesComponent(
            this._mapService,
            this._locationService,
            '#bar-container',
            {
                placeTypes: ['bar', 'night_club'],
                maxResults: 30,
                markerColors: {
                    open: '#DC2626',
                    closed: '#9CA3AF',
                    pulse: '#DC2626'
                },
                onExpand: () => this._handleExpand('bar')
            }
        );
        this._components.set('bar', barComponent);

        this._components.set('restaurant', new PlacesComponent(
            this._mapService,
            this._locationService,
            '#restaurant-container',
            {
                placeTypes: ['restaurant', 'cafe'],
                maxResults: 20,
                markerColors: {
                    open: '#F59E0B',
                    closed: '#9CA3AF',
                    pulse: '#F59E0B'
                },
                onExpand: () => this._handleExpand('restaurant')
            }
        ));

        this._components.set('cigar', new PlacesComponent(
            this._mapService,
            this._locationService,
            '#cigar-hookah-container',
            {
                placeTypes: ['bar'],
                maxResults: 15,
                markerColors: {
                    open: '#9333EA',
                    closed: '#9CA3AF',
                    pulse: '#9333EA'
                },
                keywords: ['cigar', 'hookah', 'shisha'],
                onExpand: () => this._handleExpand('cigar')
            }
        ));

        this._components.set('music', new PlacesComponent(
            this._mapService,
            this._locationService,
            '#music-container',
            {
                placeTypes: ['bar'],
                maxResults: 15,
                markerColors: {
                    open: '#059669',
                    closed: '#9CA3AF',
                    pulse: '#059669'
                },
                keywords: ['karaoke', 'live music'],
                onExpand: () => this._handleExpand('music')
            }
        ));

        // Trigger initial expansion of bar section
        const location = this._locationService.getMapLocation();
        if (location) {
            barComponent._handleHeaderClick();
        }
    }

    _handleExpand(componentName) {
        this._components.forEach((component, name) => {
            if (name !== componentName && component._carousel._isExpanded) {
                component._carousel.collapse();
            }
        });
    }

    destroy() {
        this._components.forEach(component => component.reset());
        this._components.clear();
    }
} 