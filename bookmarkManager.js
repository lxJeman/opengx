export class BookmarkManager {
    constructor() {
        // Initialize with empty structure
        this.bookmarks = {
            folders: {
                default: {
                    name: 'Bookmarks',
                    bookmarks: []
                }
            }
        };
        // Load bookmarks asynchronously
        this.loadBookmarks();
    }

    async loadBookmarks() {
        const stored = await window.electronAPI.storage.get('bookmarks');
        if (stored) {
            this.bookmarks = stored;
        } else {
            // Initialize with default folders
            this.bookmarks = {
                folders: {
                    default: {
                        name: 'Bookmarks',
                        bookmarks: []
                    }
                }
            };
            await this.saveBookmarks();
        }
    }

    async saveBookmarks() {
        await window.electronAPI.storage.set('bookmarks', this.bookmarks);
    }

    async addBookmark(title, url, folderId = 'default') {
        if (!this.bookmarks.folders[folderId]) {
            throw new Error('Folder not found');
        }

        // Validate URL using our security API
        const urlValidation = await window.electronAPI.security.validateUrl(url);
        if (!urlValidation.isValid) {
            throw new Error('Invalid URL');
        }

        const bookmark = {
            id: 'bm_' + Date.now(),
            title,
            url,
            favicon: `https://www.google.com/s2/favicons?domain=${urlValidation.hostname}`,
            createdAt: new Date().toISOString()
        };

        this.bookmarks.folders[folderId].bookmarks.push(bookmark);
        await this.saveBookmarks();
        return bookmark;
    }

    async createFolder(name) {
        const folderId = 'folder_' + Date.now();
        this.bookmarks.folders[folderId] = {
            name,
            bookmarks: []
        };
        await this.saveBookmarks();
        return folderId;
    }

    async deleteFolder(folderId) {
        if (folderId === 'default') {
            throw new Error('Cannot delete default folder');
        }
        delete this.bookmarks.folders[folderId];
        await this.saveBookmarks();
    }

    async renameFolder(folderId, newName) {
        if (this.bookmarks.folders[folderId]) {
            this.bookmarks.folders[folderId].name = newName;
            await this.saveBookmarks();
        }
    }

    async deleteBookmark(folderId, bookmarkId) {
        const folder = this.bookmarks.folders[folderId];
        if (folder) {
            folder.bookmarks = folder.bookmarks.filter(b => b.id !== bookmarkId);
            await this.saveBookmarks();
        }
    }

    async moveBookmark(bookmarkId, fromFolderId, toFolderId) {
        const fromFolder = this.bookmarks.folders[fromFolderId];
        const toFolder = this.bookmarks.folders[toFolderId];
        
        if (!fromFolder || !toFolder) return false;

        const bookmarkIndex = fromFolder.bookmarks.findIndex(b => b.id === bookmarkId);
        if (bookmarkIndex === -1) return false;

        const [bookmark] = fromFolder.bookmarks.splice(bookmarkIndex, 1);
        toFolder.bookmarks.push(bookmark);
        await this.saveBookmarks();
        return true;
    }

    async editBookmark(folderId, bookmarkId, newTitle) {
        const folder = this.bookmarks.folders[folderId];
        if (folder) {
            const bookmark = folder.bookmarks.find(b => b.id === bookmarkId);
            if (bookmark) {
                bookmark.title = newTitle;
                await this.saveBookmarks();
                return true;
            }
        }
        return false;
    }

    getAllFolders() {
        return this.bookmarks.folders;
    }

    getBookmarksInFolder(folderId) {
        return this.bookmarks.folders[folderId]?.bookmarks || [];
    }
}

// Export already handled at class definition
