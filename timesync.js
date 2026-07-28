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

        // Даємо Лампі чверть секунди на створення запису в базі і беремо актуальний останній хеш
        setTimeout(function() {
            try {
                var fileViews = Lampa.Storage.get('file_view', {});
                var keys = Object.keys(fileViews);
                if (keys.length > 0) {
                    // Беремо найсвіжіший запис із бази Лампи
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
            playbackStarted = false;
            
            var el = $next[0];
            if (el) el.dispatchEvent(new MouseEvent('click', { view: window, bubbles: true, cancelable: true }));

            setTimeout(function() { nextEpisodeTriggered = false; }, 5000);
        } else {
            Lampa.Noty.show('Автоперехід: Це остання серія');
        }
    }

    // 2. Фоновий сканер (стежить виключно за закінченням серії)
    setInterval(function() {
        if (!currentHash || nextEpisodeTriggered || currentEpisodeIndex === -1) return;

        var fileViews = Lampa.Storage.get('file_view', {});
        var info = fileViews[currentHash];

        if (info && info.duration && info.duration > 60) {
            var currentTime = info.time || 0;
            var percentWatched = currentTime / info.duration;
            var timeLeft = info.duration - currentTime;

            // Захист від хибного спрацьовування на старті
            if (!playbackStarted) {
                if (Math.abs(currentTime - lastSeenTime) >= 1) {
                    playbackStarted = true;
                    lastSeenTime = currentTime;
                }
                return; 
            }

            // Перевіряємо, чи час зупинився (VLC закрився)
            if (Math.abs(currentTime - lastSeenTime) < 2) { 
                timeStalledCount++; 
            } else {
                timeStalledCount = 0; 
                lastSeenTime = currentTime;
            }

            // Умова завершення серії
            if (timeStalledCount >= 2 && (percentWatched > 0.85 || timeLeft <= 180)) {
                nextEpisodeTriggered = true;
                Lampa.Noty.show('Серія завершена. Запуск наступної...');
                playNextEpisode();
            }
        }
    }, 2000);

    console.log('Lampa Auto-Next: Режим мʼякого читання бази активовано');
})();
