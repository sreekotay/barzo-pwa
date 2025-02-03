import HomePage from './pages/homePage.js';
import ProfilePage from './pages/profilePage.js';
import SettingsPage from './pages/settingsPage.js';
import PlaceDetailsPage from './pages/placeDetailsPage.js';

export default class Router {
    constructor(mapService) {
        this.mapService = mapService;
        this.currentPage = null;
        this.routes = {
            home: () => new HomePage(this.mapService),
            profile: () => new ProfilePage(),
            settings: () => new SettingsPage(),
            place: () => new PlaceDetailsPage(this.mapService)
        };
        
        this.sheetRoutes = new Set(['place', 'profile']);
        this.routeStack = ['home']; // Stack of routes
        this.currentSheetDepth = 0;

        // Debug history state
        window.addEventListener('popstate', (e) => {
            console.log('PopState Event:', {
                state: e.state,
                historyLength: window.history.length,
                currentHash: window.location.hash,
                referrer: document.referrer
            });
        });
    }

    async handleRoute(route = 'home') {
        const [mainRoute, underlyingRoute] = route.split('##');
        
        // Parse the main route and params, handling the case where params are part of a sheet route
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
            return this.handleRoute('home');
        }

        this.currentPage = getPage();
        
        if (this.sheetRoutes.has(basePath)) {
            // Handle sheet route
            if (route.endsWith('##')) {
                // New sheet being opened
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
                await this.currentPage.render(placeId);
            } else {
                await this.currentPage.render();
            }
        } else {
            // Handle normal route
            this.currentSheetDepth = 0;
            this.routeStack[0] = basePath;
            
            const html = await this.currentPage.render();
            const mainContent = document.querySelector('#main-content');
            mainContent.innerHTML = html;
            mainContent.className = 'relative z-20';
            
            if (this.currentPage.afterRender) {
                await this.currentPage.afterRender();
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
} 