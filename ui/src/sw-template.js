if ('function' === typeof importScripts) {
    importScripts(
        'https://storage.googleapis.com/workbox-cdn/releases/3.5.0/workbox-sw.js'
    );
    /* global workbox */
    if (workbox) {
        console.log('Workbox is loaded');

        /* injection point for manifest files.  */
        workbox.precaching.precacheAndRoute([]);

        /* custom cache rules*/
        workbox.routing.registerNavigationRoute('/index.html', {
            blacklist: [/^\/_/, /\/[^\/]+\.[^\/]+$/],
        });

        workbox.routing.registerRoute(
            /\.(?:png|gif|jpg|jpeg)$/,
            workbox.strategies.cacheFirst({
                cacheName: 'images',
                plugins: [
                    new workbox.expiration.Plugin({
                        maxEntries: 60,
                        maxAgeSeconds: 30 * 24 * 60 * 60, // 30 Days
                    }),
                ],
            })
        );

    } else {
        console.log('Workbox could not be loaded. No Offline support');
    }
}

// Handle share target POST requests
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    
    // Check if this is a share target request
    if (url.pathname === '/share-target' && event.request.method === 'POST') {
        event.respondWith((async () => {
            try {
                const formData = await event.request.formData();
                const files = formData.getAll('media');
                const title = formData.get('title') || '';
                const text = formData.get('text') || '';
                const sharedUrl = formData.get('url') || '';
                
                console.log('Share target received:', { 
                    files: files.length, 
                    title, 
                    text, 
                    url: sharedUrl 
                });
                
                if (files.length > 0) {
                    // Store files in IndexedDB for the app to pick up
                    const db = await openShareTargetDB();
                    const tx = db.transaction('shared-files', 'readwrite');
                    const store = tx.objectStore('shared-files');
                    
                    // Clear any old shared files first
                    await store.clear();
                    
                    // Store each file
                    for (let i = 0; i < files.length; i++) {
                        const file = files[i];
                        await store.add({
                            id: Date.now() + '-' + i,
                            name: file.name,
                            type: file.type,
                            size: file.size,
                            data: await file.arrayBuffer(),
                            timestamp: Date.now()
                        });
                    }
                    
                    await tx.complete;
                    db.close();
                    
                    console.log('Stored ' + files.length + ' files for share target');
                }
                
                // Redirect to the app with a flag indicating shared content
                return Response.redirect('/?shared=true', 303);
            } catch (error) {
                console.error('Share target error:', error);
                // Still redirect to app even on error
                return Response.redirect('/?shared=error', 303);
            }
        })());
    }
});

// Helper function to open IndexedDB for share target files
function openShareTargetDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('photogroup-share-target', 1);
        
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('shared-files')) {
                db.createObjectStore('shared-files', { keyPath: 'id' });
            }
        };
    });
}

self.addEventListener('message', function (event) {
    console.log('message ' + event.data.action);
    if (event.data.action === 'skipWaiting') {
        return self.skipWaiting();
    }
});
