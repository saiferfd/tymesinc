(function () {
    'use strict';

    var currentHash = null;
    var currentEpisodeIndex = -1;
    var lastSeenTime = -1; 
    var timeStalledCount = 0; // Лічильник секунд, скільки час "стоїть на місці"
    var nextEpisodeTriggered = false;

    // 1. Ловимо клік по серії
    $(document).on('click hover:enter', '.torrent-list > .online-prestige.selector', function () {
        var $allEpisodes = $('.torrent-list > .online-prestige.selector');
        currentEpisodeIndex = $allEpisodes.index(this);
        currentHash = $(this).find('.time-line').attr('data-hash');
        
        nextEpisodeTriggered = false;
        timeStalledCount = 0;

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
            
            // Оновлюємо змінні для нової серії
            currentEpisodeIndex = nextIndex;
            currentHash = $next.find('.time-line').attr('data-hash');
            timeStalledCount = 0;
            
            if (currentHash) {
                var fileViews = Lampa.Storage.get('file_view', {});
                var info = fileViews[currentHash];
                lastSeenTime = (info && info.time) ? info.time : 0;
            }

            // ВІДПРАВЛЯЄМО РІВНО ОДИН КЛІК (захист від дублів і крашів)
            var el = $next[0];
            if (el) {
                el.dispatchEvent(new MouseEvent('click', { view: window, bubbles: true, cancelable: true }));
            }

            // Блокуємо сканер на 5 секунд, поки завантажується нове відео
            setTimeout(function() { nextEpisodeTriggered = false; }, 5000);
        } else {
            Lampa.Noty.show('Автоперехід: Це остання серія');
        }
    }

    // 2. Сканер бази даних (працює кожні 2 секунди)
    setInterval(function() {
        if (!currentHash || nextEpisodeTriggered || currentEpisodeIndex === -1) return;

        var fileViews = Lampa.Storage.get('file_view', {});
        var info = fileViews[currentHash];

        if (info && info.duration && info.duration > 60) {
            var currentTime = info.time || 0;
            var percentWatched = currentTime / info.duration;
            var timeLeft = info.duration - currentTime;

            // Перевіряємо, чи час "стоїть на місці" (VLC закрився)
            if (Math.abs(currentTime - lastSeenTime) < 2) { 
                timeStalledCount++; // Час не змінився
            } else {
                timeStalledCount = 0; // Час змінився (відео йде), скидаємо лічильник
                lastSeenTime = currentTime;
            }

            // Якщо час не змінюється 4 секунди (timeStalledCount >= 2) 
            // І ми знаходимось в кінці серії (>85% або <3 хв до кінця)
            if (timeStalledCount >= 2 && (percentWatched > 0.85 || timeLeft <= 180)) {
                nextEpisodeTriggered = true;
                Lampa.Noty.show('Серія завершена. Запуск наступної...');
                
                playNextEpisode();
            }
        }
    }, 2000);

    console.log('Lampa Auto-Next: Встановлено розумний сканер зупинки часу');
})();
