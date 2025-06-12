
export class TabDragManager {
    constructor(tabManager) {
        this.tabManager = tabManager;
        this.dragTimer = null;
        this.isDraggingOutside = false;
        this.isDetaching = false;
        this.mouseX = 0;
        this.mouseY = 0;
        this.dragStartX = 0;
        this.dragStartY = 0;
        this.dragThreshold = 10; // pixels before considering it a drag
        this.outsideThreshold = 50; // pixels outside window before detaching
        this.detachDebounceTime = 300; // ms to wait before detaching

        // Track mouse position globally
        this.handleMouseMove = this.handleMouseMove.bind(this);
        window.addEventListener('mousemove', this.handleMouseMove);
    }

    handleMouseMove(e) {
        this.mouseX = e.screenX;
        this.mouseY = e.screenY;
        
        // Update visual feedback if we have an active drag
        if (this.currentTab?.classList.contains('dragging-active')) {
            const offsetX = this.mouseX - this.dragStartX;
            const offsetY = this.mouseY - this.dragStartY;
            this.currentTab.style.setProperty('--drag-offset-x', `${offsetX}px`);
            this.currentTab.style.setProperty('--drag-offset-y', `${offsetY}px`);
        }
    }

    handleDragStart(tab, webview, e) {
        console.log('Drag start detected');
        if (this.isDetaching) return;

        this.dragStartX = e.screenX;
        this.dragStartY = e.screenY;
        this.currentTab = tab;
        this.currentWebview = webview;

        // Apply visual styles
        tab.classList.add('dragging');
        tab.classList.add('dragging-active');

        // Prepare drag data
        const tabData = {
            id: tab.id,
            url: webview.src,
            title: tab.querySelector('.tab-title').textContent,
            startPosition: { x: this.dragStartX, y: this.dragStartY }
        };

        // Set drag data and effect
        e.dataTransfer.setData('text/plain', JSON.stringify(tabData));
        e.dataTransfer.effectAllowed = 'move';

        // Set custom drag image
        const ghost = tab.cloneNode(true);
        ghost.style.position = 'absolute';
        ghost.style.top = '-1000px';
        ghost.style.opacity = '0.8';
        document.body.appendChild(ghost);
        e.dataTransfer.setDragImage(ghost, tab.offsetWidth / 2, tab.offsetHeight / 2);
        setTimeout(() => ghost.remove(), 0);

        // Start checking for dragging outside
        this.startDragCheck(tab, webview);
    }

    startDragCheck(tab, webview) {
        let lastCheck = Date.now();
        this.dragTimer = setInterval(() => {
            const rect = document.documentElement.getBoundingClientRect();
            const isOutside = 
                this.mouseY < rect.top - this.outsideThreshold || 
                this.mouseY > rect.bottom + this.outsideThreshold || 
                this.mouseX < rect.left - this.outsideThreshold || 
                this.mouseX > rect.right + this.outsideThreshold;

            const dragDistance = Math.sqrt(
                Math.pow(this.mouseX - this.dragStartX, 2) +
                Math.pow(this.mouseY - this.dragStartY, 2)
            );

            const now = Date.now();
            if (isOutside && !this.isDraggingOutside && 
                dragDistance > this.dragThreshold &&
                now - lastCheck > this.detachDebounceTime) {
                console.log('Detected drag outside window');
                this.isDraggingOutside = true;
                this.handleOutsideDrag(tab, webview);
                lastCheck = now;
            } else if (!isOutside) {
                this.isDraggingOutside = false;
            }
        }, 16); // ~60fps
    }

    handleOutsideDrag(tab, webview) {
        if (this.isDetaching) return;

        setTimeout(() => {
            if (this.isDraggingOutside) {
                console.log('Detaching tab');
                this.isDetaching = true;
                const rect = tab.getBoundingClientRect();

                const { ipc } = window.electronAPI;
                ipc.send('detach-tab', {
                    tabId: tab.id,
                    url: webview.src,
                    title: tab.querySelector('.tab-title').textContent,
                    bounds: {
                        x: this.mouseX - rect.width / 2,
                        y: this.mouseY - rect.height / 2,
                        width: 1000,
                        height: 700
                    }
                });

                this.tabManager.closeTab(tab.id);
                this.cleanup();
            }
        }, 300);
    }

    cleanup() {
        if (this.dragTimer) {
            clearInterval(this.dragTimer);
            this.dragTimer = null;
        }
        
        // Remove drag-related classes and styles
        if (this.currentTab) {
            this.currentTab.classList.remove('dragging', 'dragging-active');
            this.currentTab.style.removeProperty('--drag-offset-x');
            this.currentTab.style.removeProperty('--drag-offset-y');
            this.currentTab = null;
            this.currentWebview = null;
        }

        this.isDraggingOutside = false;
        this.isDetaching = false;
        this.dragStartX = 0;
        this.dragStartY = 0;
    }
}
