(function () {
    'use strict';

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
                    Lampa.Noty.show('Збережено! Наступна серія за 4 сек...');
                    
                    // --- НОВЕ: Примусово очищаємо стан плеєра в Лампі ---
                    try {
                        if (Lampa.Player) Lampa.Player.destroy();
                    } catch (e) {}

                    // --- НОВЕ: Збільшено затримку до 4 секунд, щоб уникнути конфлікту процесів ---
                    setTimeout(playNextEpisode, 4000);
                } else {
                    lastSeenTime = currentTime; 
                }
            }
        }
    }, 2000);

    console.log('Lampa Auto-Next: Сканер активовано (з фіксом крашу)');
})();
