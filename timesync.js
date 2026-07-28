(function () {
    'use strict';

    var $lastEpisodeRow = null;
    var nextEpisodeTriggered = false;
    
    // Змінні для відстеження прогресу перед закриттям VLC
    var lastTimeLeft = 999999;
    var lastDuration = 0;
    var lastTime = 0;

    // Ловимо клік по серії
    $(document).on('click hover:enter', '.torrent-list > .online-prestige.selector', function () {
        $lastEpisodeRow = $(this);
        nextEpisodeTriggered = false;
    });

    function playNextEpisode() {
        if (!$lastEpisodeRow || !$lastEpisodeRow.length) {
            console.log('Автоперехід: Немає прив\'язки до списку серій');
            return;
        }

        var $next = $lastEpisodeRow.nextAll('.online-prestige.selector').first();
        if ($next.length) {
            Lampa.Noty.show('Автоперехід до наступної серії...');
            
            // Оновлюємо рядок, щоб наступний перехід теж спрацював
            $lastEpisodeRow = $next;
            nextEpisodeTriggered = true;

            // Нативна симуляція кліку (більш надійна для Лампи)
            var el = $next[0];
            if (el) {
                var clickEvent = new MouseEvent('click', {
                    view: window,
                    bubbles: true,
                    cancelable: true
                });
                el.dispatchEvent(clickEvent);
                $next.trigger('hover:enter'); // На випадок якщо слухається пульт
            }
        } else {
            Lampa.Noty.show('Це остання серія в списку');
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

                // Умова 1: Завчасне перемикання (якщо оновлення прийшло на останніх 10 секундах)
                if (!nextEpisodeTriggered && lastDuration > 60 && lastTimeLeft <= 10 && lastTimeLeft >= 0) {
                    nextEpisodeTriggered = true;
                    playNextEpisode();
                }
            }
        };

        // Умова 2: Плеєр закрився сам (VLC дійшов до кінця файлу)
        Lampa.Player.listener.follow('destroy', function () {
            if (nextEpisodeTriggered) return; // Якщо вже перемкнули, нічого не робимо

            // Якщо плеєр закрився, і ми були близько до кінця 
            // (залишалось менше 45 сек АБО переглянуто більше 95%)
            if (lastDuration > 60 && (lastTimeLeft <= 45 || (lastTime / lastDuration) > 0.95)) {
                nextEpisodeTriggered = true;
                Lampa.Noty.show('Серія завершилась, запуск наступної...');
                
                // Даємо Лампі 1.5 секунди, щоб вона штатно закрила старий плеєр і повернула інтерфейс,
                // після чого "клікаємо" на наступну серію
                setTimeout(function() {
                    playNextEpisode();
                }, 1500);
            }
        });

        // Скидаємо змінні при старті нового відео
        Lampa.Player.listener.follow('start', function () {
            nextEpisodeTriggered = false;
            lastTimeLeft = 999999;
            lastDuration = 0;
            lastTime = 0;
        });
        
        console.log('Lampa Auto-Next: Ініціалізовано (перехоплення destroy)');
    }

    if (window.appready) initAutoNext();
    else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type == 'ready') initAutoNext();
        });
    }
})();
