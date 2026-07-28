(function () {
    'use strict';

    var currentHash = null;
    var currentEpisodeIndex = -1;
    var lastSeenTime = -1; 
    var timeStalledCount = 0; 
    var nextEpisodeTriggered = false;
    var currentSelector = ''; 
    var playbackStarted = false;

    // 1. Ловимо клік по серії (Онлайн або Торрент)
    $(document).on('click hover:enter', '.torrent-list > .online-prestige.selector, .torrent-files > .torrent-serial.selector, .torrent-files > .torrent-item.selector', function () {
        
        if ($(this).hasClass('online-prestige')) currentSelector = '.torrent-list > .online-prestige.selector';
        else if ($(this).hasClass('torrent-serial')) currentSelector = '.torrent-files > .torrent-serial.selector';
        else currentSelector = '.torrent-files > .torrent-item.selector';

        var $allEpisodes = $(currentSelector);
        currentEpisodeIndex = $allEpisodes.index(this);
        
        nextEpisodeTriggered = false;
        timeStalledCount = 0;
        playbackStarted = false;

        // Шукаємо хеш у DOM (для онлайну)
        currentHash = $(this).find('.time-line').attr('data-hash') || null;

        // Якщо в DOM хешу немає (торрент), пробуємо взяти останній активний з Лампи через невелику затримку
        if (!currentHash) {
            setTimeout(function() {
                try {
                    if (Lampa.Player && Lampa.Player.video && Lampa.Player.video.hash) {
                        currentHash = Lampa.Player.video.hash;
                    } else {
                        // Резервний варіант: беремо останній змінений хеш з бази
                        var fileViews = Lampa.Storage.get('file_view', {});
                        var keys = Object.keys(fileViews);
                        if (keys.length > 0) currentHash = keys[keys.length - 1];
                    }
                    var fileViews = Lampa.Storage.get('file_view', {});
                    var info = fileViews[currentHash];
                    lastSeenTime = (info && info.time) ? info.time : 0;
                } catch(e) {}
            }, 1000);
        } else {
            var fileViews = Lampa.Storage.get('file_view', {});
            var info = fileViews[currentHash];
            lastSeenTime = (info && info.time) ? info.time : 0;
        }
    });

    function playNextEpisode() {
        if (currentEpisodeIndex === -1 || !currentSelector) return;

        var $allEpisodes = $(currentSelector);
        var nextIndex = currentEpisodeIndex + 1;
        
        if (nextIndex < $allEpisodes.length) {
            var $next = $allEpisodes.eq(nextIndex);
            currentEpisodeIndex = nextIndex;
            timeStalledCount = 0;
            playbackStarted = false;
            
            var el = $next[0];
            if (el) el.dispatchEvent(new MouseEvent('click', { view: window, bubbles: true, cancelable: true }));

            setTimeout(function() { nextEpisodeTriggered = false; }, 5000);
        } else {
            Lampa.Noty.show('Автоперехід: Це остання серія');
        }
    }

    function initAutoNext() {
        // Сканер бази даних (не чіпає запуск, а тільки слідкує за таймкодом)
        setInterval(function() {
            if (!currentHash || nextEpisodeTriggered || currentEpisodeIndex === -1) return;

            var fileViews = Lampa.Storage.get('file_view', {});
            var info = fileViews[currentHash];

            if (info && info.duration && info.duration > 60) {
                var currentTime = info.time || 0;
                var percentWatched = currentTime / info.duration;
                var timeLeft = info.duration - currentTime;

                if (!playbackStarted) {
                    if (Math.abs(currentTime - lastSeenTime) >= 1) {
                        playbackStarted = true;
                        lastSeenTime = currentTime;
                    }
                    return; 
                }

                if (Math.abs(currentTime - lastSeenTime) < 2) { 
                    timeStalledCount++; 
                } else {
                    timeStalledCount = 0; 
                    lastSeenTime = currentTime;
                }

                if (timeStalledCount >= 2 && (percentWatched > 0.85 || timeLeft <= 180)) {
                    nextEpisodeTriggered = true;
                    Lampa.Noty.show('Серія завершена. Запуск наступної...');
                    playNextEpisode();
                }
            }
        }, 2000);

        console.log('Lampa Auto-Next: Безпечний режим активовано');
    }

    if (window.appready) initAutoNext();
    else {
        Lampa.Listener.follow('app', function (e) { if (e.type == 'ready') initAutoNext(); });
    }
})();
