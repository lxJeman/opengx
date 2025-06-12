export class TabDragManager {
    constructor(tab, webview, manager) {
        this.tab = tab;
        this.webview = webview;
        this.manager = manager;
        this.dragTimer = null;
        this.isDraggingOutside = false;
        this.isDetaching = false;
        this.lastX = 0;
        this.lastY = 0;
        this.ipc = window.electronAPI.ipc;

        // Track mouse position globally
        this.mouseMoveHandler = (e) => {
            this.lastX = e.screenX;
            this.lastY = e.screenY;
        };
        window.addEventListener('mousemove', this.mouseMoveHandler);
        
        this.setupEventListeners();
    }

    cleanup() {
        clearTimeout(this.dragTimer);
        this.isDraggingOutside = false;
        this.isDetaching = false;
        this.tab.classList.remove('dragging');
        window.removeEventListener('mousemove', this.mouseMoveHandler);
    }

    setupEventListeners() {
        this.handleDragStart = this.handleDragStart.bind(this);
        this.handleDrag = this.handleDrag.bind(this);
        this.tab.addEventListener('dragstart', this.handleDragStart);
        this.tab.addEventListener('drag', this.handleDrag);
        this.tab.addEventListener('dragend', () => this.cleanup());
    }

    handleDragStart(e) {
        console.log('Drag start detected');
        if (this.isDetaching) return;

        this.tab.classList.add('dragging');
        const tabData = {
            id: this.tab.id,
            url: this.webview.src,
            title: this.tab.querySelector('.tab-title').textContent
        };

        console.log('Tab data:', tabData);
        e.dataTransfer.setData('text/plain', JSON.stringify(tabData));
        e.dataTransfer.effectAllowed = 'move';
    }

    handleDrag(e) {
        if (this.isDetaching) return;

        const rect = document.documentElement.getBoundingClientRect();
        const isOutside = 
            this.lastY < rect.top || 
            this.lastY > rect.bottom || 
            this.lastX < rect.left || 
            this.lastX > rect.right;

        console.log('Drag event:', {
            clientX: e.clientX,
            clientY: e.clientY,
            screenX: e.screenX,
            screenY: e.screenY,
            isOutside
        });

        if (isOutside && !this.isDraggingOutside) {
            console.log('Starting detachment timer');
            this.isDraggingOutside = true;
            this.dragTimer = setTimeout(() => {
                if (this.isDraggingOutside) {
                    console.log('Detaching tab');
                    this.isDetaching = true;
                    
                    this.ipc.send('detach-tab', {
                        tabId: this.tab.id,
                        url: this.webview.src,
                        title: this.tab.querySelector('.tab-title').textContent,
                        bounds: {
                            x: this.lastX - 400,
                            y: this.lastY - 20,
                            width: 800,
                            height: 600
                        }
                    });

                    this.manager.closeTab(this.tab.id);
                    this.manager.updateWindowTabs();
                    this.cleanup();
                }
            }, 300);
        } else if (!isOutside) {
            this.isDraggingOutside = false;
            clearTimeout(this.dragTimer);
        }
    }
}
