(function () {
    'use strict';

    // --- ПЕРЕВІРКА ПЛАТФОРМИ ---
    var isWindows = navigator.platform.indexOf('Win') > -1 || navigator.userAgent.indexOf('Windows') > -1;

    var req = window.require || window.nodeRequire;
    var node_cp = null;
    var node_fs = null;

    if (isWindows && req) {
        try {
            node_cp = req('child_process');
        } catch (e) {}
        try {
            node_fs = req('fs');
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
    var LOG_PATH = 'D:\\mpc_timesync.log';

    // --- Системні змінні ---
    var pollingInterval = null;
    var currentTimeline = null;
    var failCount = 0;
    var proxyProcess = null;
    var firstFailShown = false; // щоб не спамити тостами на кожен фейл

    // --- ЛОГУВАННЯ: на екран (Noty) + у файл (якщо можливо) ---
    function log(msg, showOnScreen) {
        try {
            if (node_fs) {
                var line = '[' + new Date().toISOString() + '] ' + msg + '\n';
                node_fs.appendFileSync(LOG_PATH, line);
            }
        } catch (e) {
            // файл не пишеться - не критично, бо є Noty
        }

        if (showOnScreen) {
            try {
                Lampa.Noty.show('MPC-BE debug: ' + msg);
            } catch (e) {}
        }

        try { console.log('[MPC-BE] ' + msg); } catch (e) {}
    }

    log('Плагін завантажено', true);

    function timeToSeconds(timeStr) {
        if (!timeStr) return 0;
        var parts = timeStr.trim().split(':').reverse();
        var seconds = 0;
        if (parts[0]) seconds += parseInt(parts[0], 10);
        if (parts[1]) seconds += parseInt(parts[1], 10) * 60;
        if (parts[2]) seconds += parseInt(parts[2], 10) * 3600;
        return seconds;
    }

    function stopPolling(reason) {
        if (pollingInterval) {
            clearInterval(pollingInterval);
            pollingInterval = null;
            Lampa.Noty.show('MPC-BE: Синхронізацію зупинено' + (reason ? (' (' + reason + ')') : ''));
            log('Опитування зупинено. Причина: ' + (reason || 'невідома'), false);
        }
        if (proxyProcess) {
            try {
                proxyProcess.kill();
                log('Проксі-процес завершено (kill)', false);
            } catch (err) {
                log('Помилка при kill проксі-процесу: ' + err.message, false);
            }
            proxyProcess = null;
        }
        firstFailShown = false;
    }

    async function pollMpcViaProxy() {
        try {
            const response = await fetch(PROXY_URL);
            if (!response.ok) throw new Error('HTTP статус ' + response.status);

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
            } else {
                throw new Error('Не знайдено positionstring у відповіді проксі');
            }
        } catch (error) {
            failCount++;
            var msg = 'Помилка опитування (' + failCount + '/' + MAX_FAILS + '): ' + error.message;
            log(msg, false);

            // показуємо на екрані причину ПЕРШОГО фейлу - саме там зазвичай ключова інформація
            if (!firstFailShown) {
                firstFailShown = true;
                try { Lampa.Noty.show('MPC-BE debug: ' + msg); } catch (e) {}
            }

            if (failCount > MAX_FAILS) stopPolling('немає відповіді від проксі: ' + error.message);
        }
    }

    function startPolling() {
        if (pollingInterval) clearInterval(pollingInterval);
        failCount = 0;
        firstFailShown = false;
        log('Старт опитування (polling)', false);
        pollingInterval = setInterval(pollMpcViaProxy, 2000);
        pollMpcViaProxy();
    }

    function initExternalPlayer() {
        Lampa.Player.play = function (data) {
            stopPolling();

            var videoUrl = data.url || data.file || "";
            if (!videoUrl) {
                log('play() викликано, але videoUrl порожній - вихід', true);
                return;
            }

            currentTimeline = data.timeline;
            var targetTimeSec = (currentTimeline && currentTimeline.time) ? currentTimeline.time : 0;

            log('play() викликано. targetTimeSec=' + targetTimeSec, true);

            // --- Запуск проксі ---
            try {
                proxyProcess = node_cp.spawn(NODE_EXE_PATH, [PROXY_SCRIPT_PATH], { detached: true, stdio: 'ignore' });

                proxyProcess.on('error', function (err) {
                    log('ПОМИЛКА (async) запуску проксі: ' + err.message, true);
                });
                proxyProcess.on('spawn', function () {
                    log('Проксі успішно запущено, pid=' + proxyProcess.pid, true);
                });

                if (proxyProcess.unref) proxyProcess.unref();
            } catch (err) {
                log('СИНХРОННА ПОМИЛКА запуску проксі: ' + err.message, true);
                stopPolling('помилка запуску проксі');
                return;
            }

            // --- Запуск MPC-BE ---
            setTimeout(function () {
                try {
                    var args = [videoUrl];
                    if (targetTimeSec > 5) {
                        args.push('/start', targetTimeSec * 1000);
                    }

                    var playerProcess = node_cp.spawn(MPC_PATH, args, { detached: true, stdio: 'ignore' });

                    playerProcess.on('error', function (err) {
                        log('ПОМИЛКА (async) запуску MPC-BE: ' + err.message, true);
                    });
                    playerProcess.on('spawn', function () {
                        log('MPC-BE успішно запущено, pid=' + playerProcess.pid, false);
                    });

                    if (playerProcess.unref) playerProcess.unref();

                    setTimeout(startPolling, 2000);
                } catch (err) {
                    log('СИНХРОННА ПОМИЛКА запуску MPC-BE: ' + err.message, true);
                    stopPolling('помилка запуску MPC-BE');
                }
            }, 1000);
        };
    }

    Lampa.Player.listener.follow('destroy', function () { stopPolling('плеєр закрито'); });
    if (window.appready) initExternalPlayer();
    else Lampa.Listener.follow('app', (e) => { if (e.type == 'ready') initExternalPlayer(); });

})();
