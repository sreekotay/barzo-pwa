import ProfileComponent from '../components/profileComponent.js';
import sheetComponent from '../components/sheetComponent.js';

export default class ProfilePage {
    constructor() {
        this.profileComponent = null;
    }

    async render() {
        const content = document.createElement('div');
        content.id = 'profile-content';
        
        // Get userId from URL params
        const params = new URLSearchParams(window.location.hash.split('?')[1]);
        const userId = params.get('id');
        
        const sheet = sheetComponent.show(content, {
            isProfile: true,
            showCloseButton: true,
            closeOnSwipe: true,
            closeOnBackdrop: true,
            className: 'profile-sheet',
            animateImmediately: false,
            onClose: () => {
                // Use router's closeSheet but prevent default hash change
                const prevHash = window.location.hash;
                window.router.closeSheet();
            }
        });
        
        this.profileComponent = new ProfileComponent(userId);
        
        const dataLoadedHandler = async (evt) => {
            await evt.detail.component.updateProfileUI();
            sheet.animateIn();
            document.removeEventListener('profileDataLoaded', dataLoadedHandler);
        };
        document.addEventListener('profileDataLoaded', dataLoadedHandler);
    }
} 