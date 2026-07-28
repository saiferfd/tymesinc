(function () {
    'use strict';

    var currentHash = null;
    var currentEpisodeIndex = -1;
    var lastSeenTime = -1; 
    var timeStalledCount = 0; 
    var nextEpisodeTriggered = false;
    var currentSelector = '';

    // Ловимо клік по серії
    $(document).on('click hover:enter', '.torrent-list > .online-prestige.selector, .torrent-files > .torrent-serial.selector, .torrent-files > .torrent-item.selector', function () {
        if ($(this).hasClass('online-prestige')) currentSelector = '.torrent-list > .online-prestige.selector';
        else if ($(this).hasClass('torrent-serial')) currentSelector = '.torrent-files > .torrent-serial.selector';
        else currentSelector = '.torrent-files > .torrent-item.selector';

        var $allEpisodes = $(currentSelector);
        currentEpisodeIndex = $allEpisodes.index(this);
        
        nextEpisodeTriggered = false;
        timeStalledCount = 0;

        setTimeout(function() {
            try {
                var fileViews = Lampa.Storage.get('file_view', {});
                var keys = Object.keys(fileViews);
                if (keys.length > 0) {
                    currentHash = keys[keys.length - 1];
                    var info = fileViews[currentHash];
                    lastSeenTime = (info && info.time) ? info.time : 0;
                }
            } catch(e) {}
        }, 300);
    });

    function playNextEpisode() {
        if (currentEpisodeIndex === -1 || !currentSelector) return;

        var $allEpisodes = $(currentSelector);
        var nextIndex = currentEpisodeIndex + 1;
        
        if (nextIndex < $allEpisodes.length) {
            var $next = $allEpisodes.eq(nextIndex);
            currentEpisodeIndex = nextIndex;
            timeStalledCount = 0;
            
            // Імітуємо повноцінний клік пультом/мишкою, щоб збірка сприйняла це як ручний запуск
            $next.trigger('hover:enter');
            $next.trigger('click');
            var el = $next[0];
            if (el) {
                el.dispatchEvent(new MouseEvent('click', { view: window, bubbles: true, cancelable: true }));
            }

            setTimeout(function() { nextEpisodeTriggered = false; }, 6000);
        } else {
            Lampa.Noty.show('Автоперехід: Це остання серія');
        }
    }

    // Фоновий сканер
    setInterval(function() {
        if (!currentHash || nextEpisodeTriggered || currentEpisodeIndex === -1) return;

        var fileViews = Lampa.Storage.get('file_view', {});
        var info = fileViews[currentHash];

        if (info && info.duration && info.duration > 60) {
            var currentTime = info.time || 0;
            var percentWatched = currentTime / info.duration;
            var timeLeft = info.duration - currentTime;

            if (Math.abs(currentTime - lastSeenTime) < 2) { 
                timeStalledCount++; 
            } else {
                timeStalledCount = 0; 
                lastSeenTime = currentTime;
            }

            // Якщо серія закінчилась
            if (timeStalledCount >= 2 && (percentWatched > 0.85 || timeLeft <= 180)) {
                nextEpisodeTriggered = true;
                Lampa.Noty.show('Серія завершена. Перемикаємо...');
                
                // Даємо невелику паузу, щоб Лампа остаточно закрила попередній процес
                setTimeout(playNextEpisode, 1500);
            }
        }
    }, 2000);

    console.log('Lampa Auto-Next: Режим імітації нативного кліку активовано');
})();
