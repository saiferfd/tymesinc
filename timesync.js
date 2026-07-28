(function () {
    'use strict';

    var currentHash = null;
    var currentEpisodeIndex = -1;
    var lastSeenTime = -1; 
    var nextEpisodeTriggered = false;

    // 1. Ловимо клік по серії
    $(document).on('click hover:enter', '.torrent-list > .online-prestige.selector', function () {
        var $allEpisodes = $('.torrent-list > .online-prestige.selector');
        currentEpisodeIndex = $allEpisodes.index(this);
        
        // Витягуємо унікальний HASH серії прямо з HTML (data-hash)
        currentHash = $(this).find('.time-line').attr('data-hash');
        nextEpisodeTriggered = false;

        // Запам'ятовуємо, який час був у базі на момент запуску
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
            
            // Оновлюємо дані для нової серії
            currentEpisodeIndex = nextIndex;
            currentHash = $next.find('.time-line').attr('data-hash');
            
            if (currentHash) {
                var fileViews = Lampa.Storage.get('file_view', {});
                var info = fileViews[currentHash];
                lastSeenTime = (info && info.time) ? info.time : 0;
            }

            // Натискаємо
            $next.trigger('hover:enter');
            $next.trigger('click');
            var el = $next[0];
            if (el) el.dispatchEvent(new MouseEvent('click', { view: window, bubbles: true, cancelable: true }));

            // Відновлюємо сканування для нової серії через 3 секунди
            setTimeout(function() {
                nextEpisodeTriggered = false;
            }, 3000);
        } else {
            Lampa.Noty.show('Автоперехід: Це остання серія');
        }
    }

    // 2. Безперервний сканер (працює кожні 2 секунди)
    setInterval(function() {
        // Якщо серія не обрана або ми вже перемикаємось - нічого не робимо
        if (!currentHash || nextEpisodeTriggered || currentEpisodeIndex === -1) return;

        // Зазираємо в базу Лампи
        var fileViews = Lampa.Storage.get('file_view', {});
        var info = fileViews[currentHash];

        if (info && info.duration && info.duration > 60) {
            var currentTime = info.time || 0;
            var timeLeft = info.duration - currentTime;
            var percentWatched = currentTime / info.duration;

            // Якщо час РІЗКО ЗМІНИВСЯ порівняно з тим, що був до запуску
            if (Math.abs(currentTime - lastSeenTime) > 5) {
                
                // Якщо після оновлення переглянуто > 85% АБО залишилось менше 3 хвилин (180 сек)
                if (percentWatched > 0.85 || timeLeft <= 180) {
                    nextEpisodeTriggered = true;
                    Lampa.Noty.show('Збережено! Автоперехід...');
                    
                    // Затримка 1 сек, щоб дати Лампі зберегти прогрес
                    setTimeout(playNextEpisode, 1000);
                } else {
                    // Якщо час оновився, але це ще не кінець (раптом милиця оновлює раз на хвилину)
                    lastSeenTime = currentTime; 
                }
            }
        }
    }, 2000);

    console.log('Lampa Auto-Next: Сканер бази даних активовано');
})();
