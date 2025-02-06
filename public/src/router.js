import HomePage from './pages/homePage.js';
import ProfilePage from './pages/profilePage.js';
import SettingsPage from './pages/settingsPage.js';
import PlaceDetailsPage from './pages/placeDetailsPage.js';

export default class Router {
    constructor(mapService) {
        this._mapService = mapService;
        this._currentPage = null;
        this._currentObserver = null;
        this.routes = {};  // Routes will be set from app.js
        this.sheetRoutes = new Set();  // Sheet routes will be set from app.js
        this.routeStack = ['home'];
        this.currentSheetDepth = 0;
    }

    setRoutes(routes, sheetRoutes) {
        this.routes = routes;
        this.sheetRoutes = new Set(sheetRoutes);
    }

    async handleRoute(route = '') {
        // Clean up existing observers before changing routes
        if (this._currentObserver) {
            this._currentObserver.disconnect();
            this._currentObserver = null;
        }

        // Clean up existing components
        if (this._currentPage) {
            this._currentPage.destroy?.();
        }

        const [mainRoute, underlyingRoute] = route.split('##');
        
        let basePath, params;
        const questionMarkIndex = mainRoute.indexOf('?');
        if (questionMarkIndex !== -1) {
            basePath = mainRoute.slice(0, questionMarkIndex);
            params = mainRoute.slice(questionMarkIndex + 1);
        } else {
            basePath = mainRoute;
            params = '';
        }
        
        const searchParams = new URLSearchParams(params);
        const getPage = this.routes[basePath];
        
        if (!getPage) {
            window.location.hash = '';
            return;
        }

        this._currentPage = getPage();
        
        if (this.sheetRoutes.has(basePath)) {
            if (route.endsWith('##')) {
                this.currentSheetDepth++;
                window.history.replaceState(
                    null, 
                    '', 
                    `#${basePath}${params ? '?' + params : ''}`
                );
            }

            if (basePath === 'place') {
                const placeId = searchParams.get('id');
                if (!placeId) {
                    return this.handleRoute('home');
                }
                await this._currentPage.render(placeId);
            } else {
                await this._currentPage.render();
            }
        } else {
            this.currentSheetDepth = 0;
            this.routeStack[0] = basePath;
            
            const html = await this._currentPage.render();
            const mainContent = document.querySelector('#main-content');
            mainContent.innerHTML = html;
            mainContent.className = 'relative z-20';
            
            if (this._currentPage.afterRender) {
                await this._currentPage.afterRender();
            }
        }
    }

    closeSheet() {
        if (this.currentSheetDepth > 0) {
            this.currentSheetDepth--;
            const previousRoute = this.routeStack[this.currentSheetDepth];
            if (previousRoute) {
                window.history.replaceState(null, '', `#${previousRoute}`);
                return;
            } 
        }
        window.location.hash = '';
    }

    async _loadHomePage() {
        const { default: PlacesComponent } = await import('./components/placesComponent.js');
        const placesContainer = document.getElementById('places-container');
        
        // Clear existing content
        placesContainer.innerHTML = '';
        
        // Create new places component
        window.placesComponent = new PlacesComponent(this._mapService);
        this._currentPage = window.placesComponent;
        
        // Component will handle its own intersection observer setup
        await window.placesComponent.initialize();
    }
} 