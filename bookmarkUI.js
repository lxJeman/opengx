export class BookmarkUI {
    constructor(bookmarkManager, tabManager) {
        this.bookmarkManager = bookmarkManager;
        this.tabManager = tabManager;
        this.sidebarVisible = false;
        this.setupUI();
        this.setupDialog();
        this.renderBookmarks();
    }

    setupDialog() {
        this.dialogOverlay = document.querySelector('.custom-dialog-overlay');
        this.dialogTitle = document.getElementById('dialog-title');
        this.dialogInput = document.getElementById('dialog-input');
        this.dialogOk = document.getElementById('dialog-ok');
        this.dialogCancel = document.getElementById('dialog-cancel');

        this.dialogCancel.addEventListener('click', () => this.hideDialog());
        this.dialogInput.addEventListener('keyup', (e) => {
            if (e.key === 'Enter') this.dialogOk.click();
            if (e.key === 'Escape') this.hideDialog();
        });
    }

    showDialog(title, defaultValue = '') {
        return new Promise((resolve) => {
            this.dialogTitle.textContent = title;
            this.dialogInput.value = defaultValue;
            this.dialogOverlay.classList.add('visible');
            this.dialogInput.focus();

            const handleOk = () => {
                const value = this.dialogInput.value.trim();
                if (value) {
                    resolve(value);
                }
                cleanup();
            };

            const handleCancel = () => {
                resolve(null);
                cleanup();
            };

            const cleanup = () => {
                this.hideDialog();
                this.dialogOk.removeEventListener('click', handleOk);
                this.dialogCancel.removeEventListener('click', handleCancel);
            };

            this.dialogOk.addEventListener('click', handleOk);
            this.dialogCancel.addEventListener('click', handleCancel);
        });
    }

    hideDialog() {
        this.dialogOverlay.classList.remove('visible');
        this.dialogInput.value = '';
    }

    setupUI() {
        // Set up event delegation for the bookmark container
        this.bookmarkContainer.addEventListener('click', (e) => this.handleBookmarkClick(e));
        this.bookmarkContainer.addEventListener('dragstart', (e) => this.handleDragStart(e));
        this.bookmarkContainer.addEventListener('dragover', (e) => this.handleDragOver(e));
        this.bookmarkContainer.addEventListener('drop', (e) => this.handleDrop(e));

        // Setup new folder button
        document.getElementById('new-folder-btn').addEventListener('click', async () => {
            const name = await this.showDialog('Enter folder name');
            if (name) {
                await this.bookmarkManager.createFolder(name);
                this.renderBookmarks();
            }
        });

        // Setup bookmark current page button
        document.getElementById('bookmark-page-btn').addEventListener('click', async () => {
            const webview = this.tabManager.getActiveWebview();
            if (webview) {
                const url = webview.src;
                const title = webview.getTitle() || url;
                const customTitle = await this.showDialog('Enter bookmark name', title);
                if (customTitle) {
                    await this.bookmarkManager.addBookmark(customTitle, url);
                    this.renderBookmarks();
                }
            }
        });

        // Setup toggle sidebar button
        document.getElementById('toggle-bookmarks-btn').addEventListener('click', () => {
            this.toggleSidebar();
        });
    }

    toggleSidebar() {
        this.sidebarVisible = !this.sidebarVisible;
        document.getElementById('bookmark-sidebar').classList.toggle('visible');
        document.getElementById('webviews-container').classList.toggle('sidebar-visible');
    }

    renderBookmarks() {
        const folders = this.bookmarkManager.getAllFolders();
        const container = this.bookmarkContainer;
        container.innerHTML = '';

        Object.entries(folders).forEach(([folderId, folder]) => {
            const folderEl = this.createFolderElement(folderId, folder);
            container.appendChild(folderEl);
        });
    }

    createFolderElement(folderId, folder) {
        const folderEl = document.createElement('div');
        folderEl.className = 'bookmark-folder';
        folderEl.innerHTML = `
            <div class="folder-header">
                <span class="folder-name">${folder.name}</span>
                ${folderId !== 'default' ? `
                    <div class="folder-actions">
                        <button class="rename-folder" data-folder="${folderId}">✎</button>
                        <button class="delete-folder" data-folder="${folderId}">×</button>
                    </div>
                ` : ''}
            </div>
            <div class="folder-content" data-folder="${folderId}">
                ${folder.bookmarks.map(bookmark => `
                    <div class="bookmark" draggable="true" data-id="${bookmark.id}" data-folder="${folderId}">
                        <img class="bookmark-favicon" src="${bookmark.favicon}" alt="" />
                        <span class="bookmark-title">${bookmark.title}</span>
                        <div class="bookmark-actions">
                            <button class="edit-bookmark" data-id="${bookmark.id}" title="Edit">✎</button>
                            <button class="delete-bookmark" data-id="${bookmark.id}" title="Delete">×</button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;

        return folderEl;
    }

    async handleBookmarkClick(e) {
        if (e.target.matches('.edit-bookmark')) {
            const bookmarkId = e.target.dataset.id;
            const folderId = e.target.closest('.folder-content').dataset.folder;
            const bookmark = this.bookmarkManager.getBookmarksInFolder(folderId)
                .find(b => b.id === bookmarkId);
            
            if (bookmark) {
                const newTitle = await this.showDialog('Edit bookmark', bookmark.title);
                if (newTitle && newTitle !== bookmark.title) {
                    await this.bookmarkManager.editBookmark(folderId, bookmarkId, newTitle);
                    this.renderBookmarks();
                }
            }
        } else if (e.target.matches('.delete-bookmark')) {
            const bookmarkId = e.target.dataset.id;
            const folderId = e.target.closest('.folder-content').dataset.folder;
            this.bookmarkManager.deleteBookmark(folderId, bookmarkId);
            this.renderBookmarks();
        } else if (e.target.matches('.rename-folder')) {
            const folderId = e.target.dataset.folder;
            const folder = this.bookmarkManager.getAllFolders()[folderId];
            const handleRename = async () => {
                const newName = await this.showDialog('Rename folder', folder.name);
                if (newName && newName !== folder.name) {
                    this.bookmarkManager.renameFolder(folderId, newName);
                    this.renderBookmarks();
                }
            };
            handleRename();
        } else if (e.target.matches('.delete-folder')) {
            const folderId = e.target.dataset.folder;
            if (confirm('Delete this folder and all its bookmarks?')) {
                this.bookmarkManager.deleteFolder(folderId);
                this.renderBookmarks();
            }
        } else if (e.target.closest('.bookmark')) {
            const bookmark = e.target.closest('.bookmark');
            const folderId = bookmark.dataset.folder;
            const bookmarkId = bookmark.dataset.id;
            const bookmarkData = this.bookmarkManager.getBookmarksInFolder(folderId)
                .find(b => b.id === bookmarkId);
            
            if (bookmarkData) {
                this.tabManager.createTab(bookmarkData.url, bookmarkData.title);
            }
        }
    }

    handleDragStart(e) {
        if (!e.target.matches('.bookmark')) return;
        e.dataTransfer.setData('text/plain', JSON.stringify({
            bookmarkId: e.target.dataset.id,
            fromFolderId: e.target.dataset.folder
        }));
    }

    handleDragOver(e) {
        if (e.target.matches('.folder-content') || e.target.closest('.folder-content')) {
            e.preventDefault();
        }
    }

    handleDrop(e) {
        const folderContent = e.target.matches('.folder-content') 
            ? e.target 
            : e.target.closest('.folder-content');
            
        if (!folderContent) return;

        e.preventDefault();
        const data = JSON.parse(e.dataTransfer.getData('text/plain'));
        const toFolderId = folderContent.dataset.folder;

        if (data.fromFolderId !== toFolderId) {
            this.bookmarkManager.moveBookmark(
                data.bookmarkId,
                data.fromFolderId,
                toFolderId
            );
            this.renderBookmarks();
        }
    }

    get bookmarkContainer() {
        return document.getElementById('bookmark-folders');
    }
}

// Export already handled at class definition
