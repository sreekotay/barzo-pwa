import ProfileComponent from '../components/profileComponent.js';
import sheetComponent from '../components/sheetComponent.js';

export default class ProfilePage {
    constructor() {
        this.profileComponent = null;
    }

    async render() {
        const content = document.createElement('div');
        content.id = 'profile-content';
        
        const sheet = sheetComponent.show(content, {
            isProfile: true,
            showCloseButton: true,
            closeOnSwipe: true,
            closeOnBackdrop: true,
            className: 'profile-sheet',
            animateImmediately: false,
            onClose: () => {
                window.router.closeSheet();
            }
        });
        
        this.profileComponent = new ProfileComponent();
        
        const dataLoadedHandler = async (evt) => {
            await evt.detail.component.updateProfileUI();
            sheet.animateIn();
            document.removeEventListener('profileDataLoaded', dataLoadedHandler);
        };
        document.addEventListener('profileDataLoaded', dataLoadedHandler);
    }
} 