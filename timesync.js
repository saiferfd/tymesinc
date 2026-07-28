(function () {
    'use strict';

    // --- ANTI-CRASH HACK (ЗАХИСТ ВІД ЗЕЛЕНОГО ЕКРАНУ) ---
    // Додаємо безпечну функцію .kill() до всіх базових типів. 
    // Це приховує баг десктопної Лампи, коли вона намагається вбити вже мертвий процес VLC.
    ['Object', 'String', 'Number', 'Boolean', 'Array'].forEach(function(type) {
        if (window[type] && !window[type].prototype.kill) {
            Object.defineProperty(window[type].prototype, 'kill', {
                value: function() { console.log('Анти-краш: перехоплено виклик .kill() для мертвого процесу'); },
                writable: true,
                configurable: true,
                enumerable: false // Важливо, щоб не зламати інші цикли в Лампі
            });
        }
    });

    // На випадок, якщо змінна глобальна
    if (typeof window.currentPlayerProcess !== 'undefined') {
        window.currentPlayerProcess = null;
    }
    // ---------------------------------------------------

    var currentHash = null;
    var currentEpisodeIndex = -1;
    var lastSeenTime = -1; 
    var nextEpisodeTriggered = false;

    // Ловимо клік по серії
    $(document).on('click hover:enter', '.torrent-list > .online-prestige.selector', function () {
        var $allEpisodes = $('.torrent-list > .online-prestige.selector');
        currentEpisodeIndex = $allEpisodes.index(this);
        currentHash = $(this).find('.time-line').attr('data-hash');
        nextEpisodeTriggered = false;

        if (currentHash) {
            var fileViews = Lampa.Storage.get('file_view', {});
            var info = fileViews[currentHash];
            lastSeenTime = (info && info.time) ? info.time : 0;
        }
    });

    function playNextEpisode() {
        if (currentEpisodeIndex === -1) return;

        var $allEpisodes = $('.torrent-list > .online-prestige.selector');
        var nextIndex = currentEpisodeIndex + 1;
        
        if (nextIndex < $allEpisodes.length) {
            var $next = $allEpisodes.eq(nextIndex);
            
            currentEpisodeIndex = nextIndex;
            currentHash = $next.find('.time-line').attr('data-hash');
            
            if (currentHash) {
                var fileViews = Lampa.Storage.get('file_view', {});
                var info = fileViews[currentHash];
                lastSeenTime = (info && info.time) ? info.time : 0;
            }

            // Натискаємо на наступну
            $next.trigger('hover:enter');
            $next.trigger('click');
            var el = $next[0];
            if (el) el.dispatchEvent(new MouseEvent('click', { view: window, bubbles: true, cancelable: true }));

            setTimeout(function() { nextEpisodeTriggered = false; }, 3000);
        } else {
            Lampa.Noty.show('Автоперехід: Це остання серія');
        }
    }

    // Сканер
    setInterval(function() {
        if (!currentHash || nextEpisodeTriggered || currentEpisodeIndex === -1) return;

        var fileViews = Lampa.Storage.get('file_view', {});
        var info = fileViews[currentHash];

        if (info && info.duration && info.duration > 60) {
            var currentTime = info.time || 0;
            var timeLeft = info.duration - currentTime;
            var percentWatched = currentTime / info.duration;

            if (Math.abs(currentTime - lastSeenTime) > 5) {
                
                if (percentWatched > 0.85 || timeLeft <= 180) {
                    nextEpisodeTriggered = true;
                    Lampa.Noty.show('Збережено! Наступна серія за 3 сек...');
                    
                    setTimeout(playNextEpisode, 3000);
                } else {
                    lastSeenTime = currentTime; 
                }
            }
        }
    }, 2000);

    console.log('Lampa Auto-Next: Сканер активовано (з ANTI-CRASH фіксом)');
})();
