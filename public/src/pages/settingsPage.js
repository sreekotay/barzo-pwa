export default class SettingsPage {
    constructor() {
        this.settings = {
            mapDebug: localStorage.getItem('mapDebug') === 'true'
        };
    }

    async render() {
        return `
            <div class="p-4">
                <h2 class="text-2xl font-bold mb-4">Settings</h2>
                
                <div class="space-y-4">
                    <!-- Debug Mode Toggle -->
                    <div class="flex items-center justify-between">
                        <label class="text-gray-700">Map Debug Mode</label>
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
                window.mapService?.setDebugMode(e.target.checked);
            });
        }
    }
} 