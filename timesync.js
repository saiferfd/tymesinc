(function () {
    'use strict';

    var $lastEpisodeRow = null;
    var nextEpisodeTriggered = false;
    
    // Поріг у секундах до кінця серії, при якому вмикаємо наступну
    var NEXT_EPISODE_THRESHOLD = 5; 

    // Ловимо клік по серії, щоб знати, з якого місця рахувати "наступну"
    $(document).on('click hover:enter', '.torrent-list > .online-prestige.selector', function () {
        $lastEpisodeRow = $(this);
        nextEpisodeTriggered = false; // Скидаємо прапорець при ручному виборі
    });

    function triggerNextEpisode() {
        try {
            if (!$lastEpisodeRow || !$lastEpisodeRow.length) return;

            var $next = $lastEpisodeRow.nextAll('.online-prestige.selector').first();
            if ($next.length) {
                Lampa.Noty.show('Автоперехід до наступної серії');
                $next.trigger('hover:enter');
                $next.trigger('click');
                $lastEpisodeRow = $next;
            } else {
                Lampa.Noty.show('Це остання серія в списку');
            }
        } catch (e) {
            console.log('Помилка автопереходу:', e);
        }
    }

    function initAutoNext() {
        // Перехоплюємо стандартне збереження таймкодів Лампи
        var originalTimelineUpdate = Lampa.Timeline.update;
        
        Lampa.Timeline.update = function (data) {
            // Викликаємо оригінальну функцію, щоб Лампа зберегла прогрес як зазвичай
            if (originalTimelineUpdate) {
                originalTimelineUpdate.apply(Lampa.Timeline, arguments);
            }

            // data містить { time: поточний_час, duration: загальна_тривалість, ... }
            if (data && data.duration && data.time) {
                var timeLeft = data.duration - data.time;

                // Умова спрацьовування: 
                // 1. Ще не спрацьовувало (nextEpisodeTriggered)
                // 2. Тривалість більше 60 сек (захист від глюків при завантаженні плеєра)
                // 3. Залишилось менше NEXT_EPISODE_THRESHOLD секунд
                if (!nextEpisodeTriggered && data.duration > 60 && timeLeft <= NEXT_EPISODE_THRESHOLD && timeLeft >= 0) {
                    nextEpisodeTriggered = true;
                    triggerNextEpisode();
                }
            }
        };

        // Скидаємо прапорець при запуску нового плеєра або його закритті
        Lampa.Player.listener.follow('start', function () {
            nextEpisodeTriggered = false;
        });
        Lampa.Player.listener.follow('destroy', function () {
            nextEpisodeTriggered = false;
        });
        
        console.log('Lampa Auto-Next Episode: Ініціалізовано');
    }

    // Запуск плагіна після повного завантаження Лампи
    if (window.appready) initAutoNext();
    else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type == 'ready') initAutoNext();
        });
    }
})();
