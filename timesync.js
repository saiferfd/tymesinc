(function () {
    'use strict';

    var currentEpisodeIndex = -1;
    var nextEpisodeTriggered = false;
    
    var lastTimeLeft = 999999;
    var lastDuration = 0;
    var lastTime = 0;

    // Запам'ятовуємо ПОРЯДКОВИЙ НОМЕР серії
    $(document).on('click hover:enter', '.torrent-list > .online-prestige.selector', function () {
        var $allEpisodes = $('.torrent-list > .online-prestige.selector');
        currentEpisodeIndex = $allEpisodes.index(this);
        nextEpisodeTriggered = false;
    });

    function playNextEpisode() {
        if (currentEpisodeIndex === -1) return;

        // Шукаємо елементи заново, бо Лампа могла перемалювати сторінку
        var $allEpisodes = $('.torrent-list > .online-prestige.selector');
        var nextIndex = currentEpisodeIndex + 1;
        
        if (nextIndex < $allEpisodes.length) {
            var $next = $allEpisodes.eq(nextIndex);
            currentEpisodeIndex = nextIndex;
            nextEpisodeTriggered = true;
            
            // Три способи "достукатися" до Лампи
            $next.trigger('hover:enter'); // Симуляція пульта
            $next.click();                // Симуляція jQuery
            
            // Нативний клік мишкою
            var el = $next[0];
            if (el) {
                el.dispatchEvent(new MouseEvent('click', { view: window, bubbles: true, cancelable: true }));
            }
        } else {
            Lampa.Noty.show('Автоперехід: Це остання серія');
        }
    }

    function initAutoNext() {
        var originalUpdate = Lampa.Timeline.update;
        
        Lampa.Timeline.update = function (data) {
            if (originalUpdate) originalUpdate.apply(Lampa.Timeline, arguments);

            if (data && data.duration && data.time) {
                lastDuration = data.duration;
                lastTime = data.time;
                lastTimeLeft = data.duration - data.time;
            }
        };

        // Ловимо закриття плеєра
        Lampa.Player.listener.follow('destroy', function () {
            if (nextEpisodeTriggered) return;

            var percentWatched = lastDuration > 0 ? (lastTime / lastDuration) : 0;
            
            // Якщо продивились >80% або залишалось < 3 хвилин (180 сек)
            if (lastDuration > 60 && (lastTimeLeft <= 180 || percentWatched > 0.80)) {
                nextEpisodeTriggered = true;
                Lampa.Noty.show('Наступна серія за 2 сек...');
                
                // Затримка 2 секунди, щоб інтерфейс Лампи встиг відновитися
                setTimeout(function() {
                    playNextEpisode();
                }, 2000);
            }
        });

        Lampa.Player.listener.follow('start', function () {
            nextEpisodeTriggered = false;
            lastTimeLeft = 999999;
            lastDuration = 0;
            lastTime = 0;
        });
    }

    if (window.appready) initAutoNext();
    else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type == 'ready') initAutoNext();
        });
    }
})();
