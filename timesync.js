(function () {
    'use strict';

    var currentEpisodeIndex = -1;
    var currentHash = null;
    var nextEpisodeTriggered = false;

    // 1. Запам'ятовуємо ПОРЯДКОВИЙ НОМЕР серії при кліку
    $(document).on('click hover:enter', '.torrent-list > .online-prestige.selector', function () {
        var $allEpisodes = $('.torrent-list > .online-prestige.selector');
        currentEpisodeIndex = $allEpisodes.index(this);
        nextEpisodeTriggered = false;
    });

    function playNextEpisode() {
        if (currentEpisodeIndex === -1) return;

        var $allEpisodes = $('.torrent-list > .online-prestige.selector');
        var nextIndex = currentEpisodeIndex + 1;
        
        if (nextIndex < $allEpisodes.length) {
            var $next = $allEpisodes.eq(nextIndex);
            currentEpisodeIndex = nextIndex;
            nextEpisodeTriggered = true;
            
            // Натискаємо на наступну
            $next.trigger('hover:enter');
            $next.trigger('click');
            var el = $next[0];
            if (el) el.dispatchEvent(new MouseEvent('click', { view: window, bubbles: true, cancelable: true }));
        } else {
            Lampa.Noty.show('Автоперехід: Це остання серія');
        }
    }

    function initAutoNext() {
        // 2. Перехоплюємо старт плеєра, щоб отримати ХЕШ поточного відео
        var originalPlay = Lampa.Player.play;
        Lampa.Player.play = function (data) {
            if (data && data.timeline && data.timeline.hash) {
                currentHash = data.timeline.hash;
            }
            if (originalPlay) originalPlay.apply(this, arguments);
        };

        // 3. Ловимо закриття плеєра
        Lampa.Player.listener.follow('destroy', function () {
            if (nextEpisodeTriggered || !currentHash) return;

            // Чекаємо 2.5 секунди, поки милиця VLC збереже таймкоди в Лампу
            setTimeout(function() {
                // Дістаємо історію переглядів безпосередньо з бази Лампи
                var fileViews = Lampa.Storage.get('file_view', {});
                var info = fileViews[currentHash];

                if (info && info.duration && info.duration > 60) {
                    var lastTime = info.time || 0;
                    var lastDuration = info.duration;
                    var timeLeft = lastDuration - lastTime;
                    var percentWatched = lastTime / lastDuration;
                    var percentText = Math.round(percentWatched * 100);

                    // ВИВОДИМО НА ЕКРАН, ЩО ЗБЕРЕГЛОСЬ В БАЗІ
                    Lampa.Noty.show('Збережений прогрес серії: ' + percentText + '%');

                    // Якщо переглянуто > 85% АБО до кінця залишилось менше 3 хвилин
                    if (percentWatched > 0.85 || timeLeft <= 180) {
                        nextEpisodeTriggered = true;
                        setTimeout(playNextEpisode, 500); // Ще півсекунди затримки для надійності кліку
                    }
                } else {
                    Lampa.Noty.show('Помилка автопереходу: таймкод серії не зберігся');
                }
            }, 2500);
        });

        // Скидання перед початком
        Lampa.Player.listener.follow('start', function () {
            nextEpisodeTriggered = false;
        });
    }

    // Запуск плагіна
    if (window.appready) initAutoNext();
    else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type == 'ready') initAutoNext();
        });
    }
})();
