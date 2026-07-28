(function () {
    'use strict';

    // --- ПЕРЕВІРКА ПЛАТФОРМИ ---
    var isWindows = navigator.platform.indexOf('Win') > -1 || navigator.userAgent.indexOf('Windows') > -1;

    var req = window.require || window.nodeRequire;
    var node_cp = null;

    if (isWindows && req) {
        try {
            node_cp = req('child_process');
        } catch (e) {}
    }

    if (!isWindows || !node_cp) {
        console.log('MPC-BE Plugin: Запуск скасовано. Це не Windows PC середовище.');
        return;
    }

    // --- НАЛАШТУВАННЯ ---
    var MPC_PATH = 'D:\\MPC-BE\\mpc-be64.exe';
    var NODE_EXE_PATH = 'D:\\node.js\\node.exe';
    var PROXY_SCRIPT_PATH = 'D:\\mpc-proxy.js';
    var PROXY_URL = 'http://localhost:8080';
    var MAX_FAILS = 1;

    // Поріг у секундах до кінця серії, при якому вважаємо що вона закінчилась
    var NEXT_EPISODE_THRESHOLD = 3;

    // --- Системні змінні ---
    var pollingInterval = null;
    var currentTimeline = null;
    var failCount = 0;
    var proxyProcess = null;
    var nextEpisodeTriggered = false;

    // Запам'ятовуємо DOM-елемент рядка серії, який востаннє клікнули (вручну чи автоматично)
    var $lastEpisodeRow = null;

    // Ловимо клік по будь-якому рядку серії в списку .torrent-list,
    // щоб знати, з якого місця рахувати "наступну"
    $(document).on('click hover:enter', '.torrent-list > .online-prestige.selector', function () {
        $lastEpisodeRow = $(this);
    });

    function timeToSeconds(timeStr) {
        if (!timeStr) return 0;
        var parts = timeStr.trim().split(':').reverse();
        var seconds = 0;
        if (parts[0]) seconds += parseInt(parts[0], 10);
        if (parts[1]) seconds += parseInt(parts[1], 10) * 60;
        if (parts[2]) seconds += parseInt(parts[2], 10) * 3600;
        return seconds;
    }

    function stopPolling() {
        if (pollingInterval) {
            clearInterval(pollingInterval);
            pollingInterval = null;
            Lampa.Noty.show('MPC-BE: Синхронізацію зупинено');
        }
        if (proxyProcess) {
            try {
                proxyProcess.kill();
            } catch (err) {}
            proxyProcess = null;
        }
    }

    // --- АВТОПЕРЕХІД ДО НАСТУПНОЇ СЕРІЇ ---
    // Список серій - плоский список сусідніх .online-prestige.selector
    // елементів всередині .torrent-list. Беремо запам'ятований рядок
    // поточної серії і клікаємо по наступному в тому ж списку.
    function triggerNextEpisode() {
        try {
            if (!$lastEpisodeRow || !$lastEpisodeRow.length) return;

            var $next = $lastEpisodeRow.nextAll('.online-prestige.selector').first();
            if ($next.length) {
                Lampa.Noty.show('MPC-BE: Автоперехід до наступної серії');
                $next.trigger('hover:enter');
                $next.trigger('click');
                $lastEpisodeRow = $next;
            }
        } catch (e) {
            // остання серія чи список іншої структури - просто нічого не робимо
        }
    }

    async function pollMpcViaProxy() {
        try {
            const response = await fetch(PROXY_URL);
            if (!response.ok) throw new Error();

            const data = await response.text();
            const posMatch = data.match(/id="positionstring"[^>]*>\s*(.*?)\s*</i);
            const durMatch = data.match(/id="durationstring"[^>]*>\s*(.*?)\s*</i);

            if (posMatch && posMatch[1]) {
                failCount = 0;
                const curSec = timeToSeconds(posMatch[1]);
                const durSec = (durMatch && durMatch[1]) ? timeToSeconds(durMatch[1]) : 0;

                if (curSec >= 0 && currentTimeline) {
                    currentTimeline.time = curSec;
                    if (durSec > 0) {
                        currentTimeline.duration = durSec;
                        currentTimeline.percent = (curSec / durSec) * 100;
                    }
                    Lampa.Timeline.update(currentTimeline);
                }

                if (!nextEpisodeTriggered && durSec > 0 && (durSec - curSec) <= NEXT_EPISODE_THRESHOLD) {
                    nextEpisodeTriggered = true;
                    triggerNextEpisode();
                }
            } else {
                throw new Error();
            }
        } catch (error) {
            failCount++;
            if (failCount > MAX_FAILS) stopPolling();
        }
    }

    function startPolling() {
        if (pollingInterval) clearInterval(pollingInterval);
        failCount = 0;
        nextEpisodeTriggered = false;
        pollingInterval = setInterval(pollMpcViaProxy, 2000);
        pollMpcViaProxy();
    }

    function initExternalPlayer() {
        Lampa.Player.play = function (data) {
            stopPolling();

            var videoUrl = data.url || data.file || "";
            if (!videoUrl) return;

            currentTimeline = data.timeline;
            var targetTimeSec = (currentTimeline && currentTimeline.time) ? currentTimeline.time : 0;

            try {
                proxyProcess = node_cp.spawn(NODE_EXE_PATH, [PROXY_SCRIPT_PATH], { detached: true, stdio: 'ignore' });
                if (proxyProcess.unref) proxyProcess.unref();

                setTimeout(function () {
                    var args = [videoUrl];
                    if (targetTimeSec > 5) {
                        args.push('/start', targetTimeSec * 1000);
                    }
                    var playerProcess = node_cp.spawn(MPC_PATH, args, { detached: true, stdio: 'ignore' });
                    if (playerProcess.unref) playerProcess.unref();

                    setTimeout(startPolling, 2000);
                }, 1000);
            } catch (err) {
                stopPolling();
            }
        };
    }

    Lampa.Player.listener.follow('destroy', stopPolling);
    if (window.appready) initExternalPlayer();
    else Lampa.Listener.follow('app', (e) => { if (e.type == 'ready') initExternalPlayer(); });

})();
