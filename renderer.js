import { TabDragManager } from './tabDragEvents.js';
import { BookmarkManager } from './bookmarkManager.js';
import { BookmarkUI } from './bookmarkUI.js';

// Use the exposed API instead of direct electron require
const { ipc } = window.electronAPI;

// Track global mouse position
let globalMouseX = 0;
let globalMouseY = 0;
window.addEventListener('mousemove', (e) => {
    globalMouseX = e.screenX;
    globalMouseY = e.screenY;
});

class TabManager {
    constructor() {
        this.tabs = [];
        this.activeTabId = null;
        this.draggedTab = null;

        // Cache DOM elements
        this.tabbar = document.getElementById('tabbar');
        this.urlInput = document.getElementById('url');
        this.webviewsContainer = document.getElementById('webviews-container');

        // Handle detachment errors
        ipc.receive('detach-tab-error', ({ error, tabId }) => {
            const tab = this.tabs.find(t => t.id === tabId);
            if (tab) {
                // Restore the tab if it was removed
                if (!this.tabbar.contains(tab.tab)) {
                    this.tabbar.insertBefore(tab.tab, document.getElementById('new-tab'));
                    this.webviewsContainer.appendChild(tab.wrapper);
                }
                tab.tab.classList.remove('dragging');
            }
            console.error('Tab detachment failed:', error);
        });
        
        // Setup event listeners
        document.getElementById('new-tab').addEventListener('click', () => this.createTab());
        document.getElementById('back-button').addEventListener('click', () => this.getActiveWebview()?.goBack());
        document.getElementById('forward-button').addEventListener('click', () => this.getActiveWebview()?.goForward());
        document.getElementById('reload-button').addEventListener('click', () => this.getActiveWebview()?.reload());
        document.getElementById('go-button').addEventListener('click', () => this.loadUrl());
        this.urlInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.loadUrl();
        });

        // Create initial tab
        this.createTab();

        // Handle IPC events for tab merging
        ipc.receive('merge-tabs', ({ tabs, sourceWindowId }) => {
            tabs.forEach(tab => {
                this.createTab(tab.url, tab.title, tab.id);
            });
        });

        // Handle initialization of detached tab
        ipc.receive('init-detached-tab', (tabData) => {
            this.createTab(tabData.url, tabData.title, tabData.tabId);
        });

        // Handle detachment errors
        ipc.receive('detach-tab-error', ({ error, tabId }) => {
            const tab = this.tabs.find(t => t.id === tabId);
            if (tab) {
                // Restore the tab if it was removed
                if (!this.tabbar.contains(tab.tab)) {
                    this.tabbar.insertBefore(tab.tab, document.getElementById('new-tab'));
                    this.webviewsContainer.appendChild(tab.wrapper);
                }
                tab.tab.classList.remove('dragging');
            }
            console.error('Tab detachment failed:', error);
        });

        // Update main process about tab changes
        this.updateWindowTabs();
    }

    createTab(url = 'https://google.com', title = 'New Tab') {
        const tabId = 'tab-' + Date.now();
        
        // Create tab element
        const tab = document.createElement('div');
        tab.className = 'tab';
        tab.id = tabId;
        tab.draggable = true;
        tab.innerHTML = `
            <img class="tab-favicon" width="16" height="16" src=""/>
            <div class="tab-title" title="${title}">${title}</div>
            <button class="tab-close" aria-label="Close tab">×</button>
        `;

        // Insert tab before the new-tab button
        this.tabbar.insertBefore(tab, document.getElementById('new-tab'));

        // Create webview
        const webviewWrapper = document.createElement('div');
        webviewWrapper.className = 'webview-wrapper';
        webviewWrapper.id = `${tabId}-view`;

        const webview = document.createElement('webview');
        webview.setAttribute('src', url);
        webview.setAttribute('webpreferences', 'contextIsolation');
        webviewWrapper.appendChild(webview);
        this.webviewsContainer.appendChild(webviewWrapper);

        // Setup tab event listeners
        tab.addEventListener('click', (e) => {
            if (!e.target.matches('.tab-close')) {
                this.activateTab(tabId);
            }
        });

        tab.querySelector('.tab-close').addEventListener('click', (e) => {
            e.stopPropagation();
            this.closeTab(tabId);
        });

        // Setup drag events
        const dragManager = new TabDragManager(tab, webview, this);
        tab.addEventListener('dragstart', (e) => {
            e.stopPropagation();
            dragManager.handleDragStart(e);
        });
        tab.addEventListener('drag', (e) => {
            e.stopPropagation();
            dragManager.handleDrag(e);
        });
        tab.addEventListener('dragend', (e) => {
            e.stopPropagation();
            dragManager.cleanup();
        });

        // Setup drop zone for tab reordering
        tab.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });

        tab.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });

        // Setup webview events
        this.setupWebviewEvents(webview, tab);

        // Store tab data
        this.tabs.push({ id: tabId, tab, webview, wrapper: webviewWrapper });

        // Activate the new tab
        this.activateTab(tabId);
        
        return tabId;
    }

    setupTabDragEvents(tab, webview) {
        let dropIndicator = null;
        const dragManager = new TabDragManager(this);
        let mouseTracker = null;

        const createDropIndicator = () => {
            if (!dropIndicator) {
                dropIndicator = document.createElement('div');
                dropIndicator.className = 'tab-drop-indicator';
                this.tabbar.appendChild(dropIndicator);
            }
            return dropIndicator;
        };

        const cleanup = () => {
            clearTimeout(dragTimer);
            if (dropIndicator) {
                dropIndicator.remove();
                dropIndicator = null;
            }
            isDraggingOutside = false;
            isDetaching = false;
            this.draggedTab = null;
            this.tabbar.classList.remove('drop-target');
            tab.classList.remove('dragging');
        };

        // Track mouse position relative to window
        let lastMouseX = 0;
        let lastMouseY = 0;
        window.addEventListener('mousemove', (e) => {
            lastMouseX = e.screenX;
            lastMouseY = e.screenY;
        });

        tab.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return; // Only handle left click
            startX = e.clientX;
            startY = e.clientY;
            isDragging = false;
            tab.draggable = true;
        });

        tab.addEventListener('dragstart', async (e) => {
            console.log('Drag start detected');
            if (isDetaching) {
                console.log('Already detaching, ignoring drag');
                return;
            }
            
            this.draggedTab = tab;
            tab.classList.add('dragging');
            createDropIndicator();

            const tabData = {
                id: tab.id,
                url: webview.src,
                title: tab.querySelector('.tab-title').textContent,
                windowId: window.windowId // Add window ID
            };

            console.log('Tab data prepared:', tabData);
            e.dataTransfer.setData('text/plain', JSON.stringify(tabData));
            e.dataTransfer.effectAllowed = 'move';

            // Create visual drag preview
            await this.createDragPreview(tab, e);
        });

        tab.addEventListener('drag', (e) => {
            if (isDetaching) {
                console.log('Already detaching, ignoring drag');
                return;
            }

            const windowRect = document.documentElement.getBoundingClientRect();
            console.log('Mouse position:', { x: lastMouseX, y: lastMouseY });
            console.log('Window bounds:', windowRect);
            
            // Check if dragging outside the window bounds
            if (lastMouseY < windowRect.top || 
                lastMouseY > windowRect.bottom || 
                lastMouseX < windowRect.left || 
                lastMouseX > windowRect.right) {
                
                console.log('Dragging outside window');
                if (!isDraggingOutside) {
                    isDraggingOutside = true;
                    console.log('Starting detach timer');
                    dragTimer = setTimeout(() => {
                        if (isDraggingOutside && !isDetaching) {
                            console.log('Detaching tab');
                            isDetaching = true;
                            const rect = tab.getBoundingClientRect();
                            const detachData = {
                                tabId: tab.id,
                                url: webview.src,
                                title: tab.querySelector('.tab-title').textContent,
                                bounds: {
                                    x: lastMouseX - rect.width / 2,
                                    y: lastMouseY - rect.height / 2,
                                    width: 1000,
                                    height: 700
                                }
                            };
                            console.log('Sending detach-tab event:', detachData);
                            ipc.send('detach-tab', detachData);
                            
                            // Remove the tab from the current window
                            this.closeTab(tab.id);
                            this.updateWindowTabs();
                            cleanup();
                        }
                    }, 300);
                }
            } else {
                if (isDraggingOutside) {
                    console.log('Dragging back inside window');
                }
                isDraggingOutside = false;
                clearTimeout(dragTimer);
            }
        });

        tab.addEventListener('dragend', () => {
            cleanup();
        });

        this.tabbar.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (this.draggedTab) {
                this.tabbar.classList.add('drop-target');
                const targetIndex = updateDropIndicator(e);
                if (targetIndex !== -1) {
                    e.dataTransfer.dropEffect = 'move';
                }
            }
        });

        this.tabbar.addEventListener('drop', (e) => {
            e.preventDefault();
            if (!this.draggedTab) return;

            const dropData = JSON.parse(e.dataTransfer.getData('text/plain'));
            const tabs = Array.from(this.tabbar.querySelectorAll('.tab:not(.dragging)'));
            const targetIndex = tabs.findIndex(tab => {
                const rect = tab.getBoundingClientRect();
                return e.clientX < (rect.left + rect.width / 2);
            });

            if (dropData.windowId && dropData.windowId !== window.windowId) {
                // Handle tab from another window
                ipc.send('merge-tab', {
                    sourceWindowId: dropData.windowId,
                    tabId: dropData.id,
                    targetIndex: targetIndex
                });
            } else {
                // Handle tab reordering within the same window
                const draggedTabIndex = this.tabs.findIndex(t => t.id === this.draggedTab.id);
                if (draggedTabIndex !== -1) {
                    const tabData = this.tabs[draggedTabIndex];
                    
                    // Remove from current position
                    this.tabs.splice(draggedTabIndex, 1);
                    
                    // Insert at new position
                    const newIndex = targetIndex === -1 ? this.tabs.length : targetIndex;
                    this.tabs.splice(newIndex, 0, tabData);
                    
                    // Update DOM
                    if (targetIndex === -1) {
                        this.tabbar.insertBefore(this.draggedTab, document.getElementById('new-tab'));
                    } else {
                        this.tabbar.insertBefore(this.draggedTab, tabs[targetIndex]);
                    }
                }
            }

            // Clean up
            if (dropIndicator) {
                dropIndicator.remove();
                dropIndicator = null;
            }
            this.tabbar.classList.remove('drop-target');
            this.draggedTab.classList.remove('dragging');
            this.draggedTab = null;
            this.updateWindowTabs();
        });

        this.tabbar.addEventListener('dragleave', (e) => {
            if (!this.tabbar.contains(e.relatedTarget)) {
                isDraggingOutside = true;
                this.tabbar.classList.remove('drop-target');
                if (dropIndicator) {
                    dropIndicator.classList.remove('visible');
                }
            }
        });

        this.tabbar.addEventListener('dragenter', (e) => {
            if (this.draggedTab) {
                isDraggingOutside = false;
                e.preventDefault();
            }
        });
    }

    setupEventListeners() {
        // Setup drag event listeners
        this.handleDragStart = this.handleDragStart.bind(this);
        this.handleDrag = this.handleDrag.bind(this);
        this.handleDragEnd = this.handleDragEnd.bind(this);
        
        this.tab.addEventListener('dragstart', this.handleDragStart);
        this.tab.addEventListener('drag', this.handleDrag);
        this.tab.addEventListener('dragend', this.handleDragEnd);
        
        // Setup drop zone for tab reordering
        this.tab.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (this.draggedTab && this.draggedTab !== this.tab) {
                this.tab.classList.add('drop-target');
            }
        });

        this.tab.addEventListener('dragleave', (e) => {
            this.tab.classList.remove('drop-target');
        });

        this.tab.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.tab.classList.remove('drop-target');
            
            if (this.draggedTab && this.draggedTab !== this.tab) {
                const dropData = JSON.parse(e.dataTransfer.getData('text/plain'));
                const draggedIdx = Array.from(this.tabbar.children).indexOf(this.draggedTab);
                const dropIdx = Array.from(this.tabbar.children).indexOf(this.tab);
                
                if (draggedIdx !== -1 && dropIdx !== -1) {
                    // Move the tab to new position
                    if (draggedIdx < dropIdx) {
                        this.tab.parentNode.insertBefore(this.draggedTab, this.tab.nextSibling);
                    } else {
                        this.tab.parentNode.insertBefore(this.draggedTab, this.tab);
                    }
                }
            }
        });
    }

    setupWebviewEvents(webview, tab) {
        webview.addEventListener('page-title-updated', (e) => {
            tab.querySelector('.tab-title').textContent = e.title;
        });

        webview.addEventListener('did-start-loading', () => {
            tab.classList.add('loading');
        });

        webview.addEventListener('did-stop-loading', () => {
            tab.classList.remove('loading');
        });

        webview.addEventListener('did-navigate', (e) => {
            if (this.getActiveWebview() === webview) {
                this.urlInput.value = e.url;
            }
        });
    }

    activateTab(tabId) {
        // Deactivate current tab
        this.tabs.forEach(({ id, tab, wrapper }) => {
            if (id === tabId) {
                tab.classList.add('active');
                wrapper.classList.add('active');
            } else {
                tab.classList.remove('active');
                wrapper.classList.remove('active');
            }
        });

        this.activeTabId = tabId;
        const activeWebview = this.getActiveWebview();
        if (activeWebview) {
            this.urlInput.value = activeWebview.src;
        }
    }

    closeTab(tabId) {
        const index = this.tabs.findIndex(t => t.id === tabId);
        if (index === -1) return;

        // Remove DOM elements
        const { tab, wrapper } = this.tabs[index];
        tab.remove();
        wrapper.remove();

        // Remove from tabs array
        this.tabs.splice(index, 1);

        // If we closed the active tab, activate another one
        if (tabId === this.activeTabId) {
            if (this.tabs.length > 0) {
                this.activateTab(this.tabs[Math.max(0, index - 1)].id);
            } else {
                this.createTab(); // Create a new tab if we closed the last one
            }
        }
    }

    getActiveWebview() {
        const activeTab = this.tabs.find(t => t.id === this.activeTabId);
        return activeTab ? activeTab.webview : null;
    }

    isDomainLike(input) {
        if (typeof input !== 'string') return false; // Early exit if not string
        const regex = /\.[a-z]{2,}$/;
        return regex.test(input.toLowerCase());
    }

    loadUrl() {
        const webview = this.getActiveWebview();
        if (!webview) return;

        let input = this.urlInput.value.trim().toLowerCase();

        // Regex to check if input looks like domain, with optional www.
        // Example matches: example.com, www.example.io, test.org
        const domainRegex = /^(www\.)?([a-z0-9-]+\.)+[a-z]{2,}$/;

        if (input.startsWith('http://') || input.startsWith('https://')) {
            // Input is a full URL, load directly
            webview.src = input;
        } else if (domainRegex.test(input)) {
            // Looks like a domain, add https:// if missing
            webview.src = 'https://' + input;
        } else {
            // Treat as a search query, encode it for URL safety
            const encodedQuery = encodeURIComponent(input);
            webview.src = `https://www.google.com/search?q=${encodedQuery}`;
        }
    }

    updateWindowTabs() {
        const tabsData = this.tabs.map(({ id, tab, webview }) => ({
            id,
            url: webview.src,
            title: tab.querySelector('.tab-title').textContent
        }));
        
        ipc.send('update-window-tabs', tabsData);
    }

    async createDragPreview(tab, e) {
        return new Promise((resolve) => {
            const rect = tab.getBoundingClientRect();
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            canvas.width = rect.width;
            canvas.height = rect.height;
            
            // Create an offscreen rendering
            const data = new XMLSerializer().serializeToString(tab);
            const img = new Image();
            img.onload = () => {
                ctx.drawImage(img, 0, 0);
                canvas.toBlob(blob => {
                    e.dataTransfer.setDragImage(canvas, rect.width / 2, rect.height / 2);
                    resolve();
                });
            };
            img.src = 'data:image/svg+xml,' + encodeURIComponent(data);
        });
    }

    handleDragStart(e) {
        if (this.isDetaching) return;

        this.dragStartX = e.screenX;
        this.dragStartY = e.screenY;
        this.draggedTab = this.tab;
        
        const tabData = {
            id: this.tab.id,
            url: this.webview.src,
            title: this.tab.querySelector('.tab-title').textContent,
            windowId: window.windowId
        };

        e.dataTransfer.setData('text/plain', JSON.stringify(tabData));
        e.dataTransfer.effectAllowed = 'move';

        // Add visual feedback
        this.tab.classList.add('dragging');
        this.tab.classList.add('dragging-active');

        // Create and set custom drag image
        const ghost = this.tab.cloneNode(true);
        ghost.style.position = 'absolute';
        ghost.style.top = '-1000px';
        ghost.style.opacity = '0.8';
        document.body.appendChild(ghost);
        e.dataTransfer.setDragImage(ghost, this.tab.offsetWidth / 2, this.tab.offsetHeight / 2);
        setTimeout(() => ghost.remove(), 0);
    }

    handleDrag(e) {
        if (this.isDetaching || !this.draggedTab) return;

        // Update visual feedback
        const offsetX = e.screenX - this.dragStartX;
        const offsetY = e.screenY - this.dragStartY;
        this.tab.style.setProperty('--drag-offset-x', `${offsetX}px`);
        this.tab.style.setProperty('--drag-offset-y', `${offsetY}px`);

        // Check if dragging outside window
        const rect = document.documentElement.getBoundingClientRect();
        const isOutside = 
            e.clientY < rect.top || 
            e.clientY > rect.bottom || 
            e.clientX < rect.left || 
            e.clientX > rect.right;

        if (isOutside && !this.isDraggingOutside) {
            this.handleOutsideDrag(e);
        }
    }

    handleDragEnd(e) {
        // Clean up
        if (this.dragTimer) {
            clearTimeout(this.dragTimer);
            this.dragTimer = null;
        }

        this.tab.classList.remove('dragging', 'dragging-active');
        this.tab.style.removeProperty('--drag-offset-x');
        this.tab.style.removeProperty('--drag-offset-y');
        
        this.isDraggingOutside = false;
        this.isDetaching = false;
        this.draggedTab = null;
    }

    handleOutsideDrag(e) {
        if (this.isDetaching) return;
        
        this.isDraggingOutside = true;
        this.dragTimer = setTimeout(() => {
            if (this.isDraggingOutside) {
                this.isDetaching = true;
                const rect = this.tab.getBoundingClientRect();

                window.electronAPI.ipc.send('detach-tab', {
                    tabId: this.tab.id,
                    url: this.webview.src,
                    title: this.tab.querySelector('.tab-title').textContent,
                    bounds: {
                        x: e.screenX - rect.width / 2,
                        y: e.screenY - rect.height / 2,
                        width: 1000,
                        height: 700
                    }
                });

                this.manager.closeTab(this.tab.id);
                this.manager.updateWindowTabs();
            }
        }, 300);
    }
}

// Initialize the tab and bookmark managers
const tabManager = new TabManager();
const bookmarkManager = new BookmarkManager();
const bookmarkUI = new BookmarkUI(bookmarkManager, tabManager);
