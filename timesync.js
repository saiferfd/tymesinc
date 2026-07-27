(function () {
    'use strict';

    // --- ПЕРЕВІРКА ПЛАТФОРМИ ---
    // Перевіряємо, чи це Windows
    var isWindows = navigator.platform.indexOf('Win') > -1 || navigator.userAgent.indexOf('Windows') > -1;

    // Перевіряємо наявність середовища Node.js (NW.js / Electron), яке є тільки в програмі для ПК
    var req = window.require || window.nodeRequire;
    var node_cp = null;
    var node_fs = null;

    if (isWindows && req) {
        try {
            node_cp = req('child_process');
            node_fs = req('fs');
        } catch (e) {}
    }

    // Якщо це не Windows або це просто браузер/ТВ/Андроїд — повністю виходимо з плагіна.
    // Це збереже стандартний плеєр Lampa на інших пристроях недоторканим.
    if (!isWindows || !node_cp) {
        console.log('MPC-BE Plugin: Запуск скасовано. Це не Windows PC середовище.');
        return;
    }

    // --- НАЛАШТУВАННЯ ---
    var MPC_PATH = 'D:\\MPC-BE\\mpc-be64.exe'; // Вкажіть правильний шлях до вашого плеєру!!!
    var NODE_EXE_PATH = 'D:\\node.js\\node.exe'; // Вкажіть правильний шлях до вашого node.exe !!!
    var PROXY_SCRIPT_PATH = 'D:\\mpc-proxy.js';  // Вкажіть правильний шлях до вашого проксі !!!
    var PROXY_URL = 'http://localhost:8080';
    var MAX_FAILS = 1;
    var LOG_PATH = 'D:\\mpc_timesync.log'; // Тут будуть записуватись усі помилки й події

    // --- Системні змінні ---
    var pollingInterval = null;
    var currentTimeline = null;
    var failCount = 0;
    var proxyProcess = null;

    // --- ЛОГУВАННЯ У ФАЙЛ ---
    function log(msg) {
        try {
            var line = '[' + new Date().toISOString() + '] ' + msg + '\n';
            node_fs.appendFileSync(LOG_PATH, line);
        } catch (e) {
            // якщо навіть лог не пишеться - нічого не робимо, щоб не зламати плагін
        }
    }

    log('=== Плагін завантажено ===');

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
            log('Опитування (polling) зупинено');
        }
        if (proxyProcess) {
            try {
                proxyProcess.kill();
                log('Проксі-процес завершено (kill)');
            } catch (err) {
                log('Помилка при kill проксі-процесу: ' + err.message);
            }
            proxyProcess = null;
        }
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
            log('Помилка опитування проксі (' + failCount + '/' + MAX_FAILS + '): ' + error.message);
            if (failCount > MAX_FAILS) stopPolling();
        }
    }

    function startPolling() {
        if (pollingInterval) clearInterval(pollingInterval);
        failCount = 0;
        log('Старт опитування (polling)');
        pollingInterval = setInterval(pollMpcViaProxy, 2000);
        pollMpcViaProxy();
    }

    function initExternalPlayer() {
        // Підміняємо плеєр ТІЛЬКИ на Windows
        Lampa.Player.play = function (data) {
            stopPolling();

            var videoUrl = data.url || data.file || "";
            if (!videoUrl) {
                log('play() викликано, але videoUrl порожній - вихід');
                return;
            }

            currentTimeline = data.timeline;
            var targetTimeSec = (currentTimeline && currentTimeline.time) ? currentTimeline.time : 0;

            log('play() викликано. videoUrl=' + videoUrl + ' targetTimeSec=' + targetTimeSec);

            // --- Запуск проксі ---
            try {
                proxyProcess = node_cp.spawn(NODE_EXE_PATH, [PROXY_SCRIPT_PATH], { detached: true, stdio: 'ignore' });

                proxyProcess.on('error', function (err) {
                    log('ПОМИЛКА (async) запуску проксі: ' + err.message);
                });
                proxyProcess.on('spawn', function () {
                    log('Проксі успішно запущено, pid=' + proxyProcess.pid);
                });

                if (proxyProcess.unref) proxyProcess.unref();
            } catch (err) {
                log('СИНХРОННА ПОМИЛКА запуску проксі: ' + err.message);
                stopPolling();
                return;
            }

            // --- Запуск MPC-BE (з затримкою, щоб проксі встиг піднятись) ---
            setTimeout(function () {
                try {
                    var args = [videoUrl];
                    if (targetTimeSec > 5) {
                        args.push('/start', targetTimeSec * 1000);
                    }

                    var playerProcess = node_cp.spawn(MPC_PATH, args, { detached: true, stdio: 'ignore' });

                    playerProcess.on('error', function (err) {
                        log('ПОМИЛКА (async) запуску MPC-BE: ' + err.message);
                    });
                    playerProcess.on('spawn', function () {
                        log('MPC-BE успішно запущено, pid=' + playerProcess.pid);
                    });

                    if (playerProcess.unref) playerProcess.unref();

                    setTimeout(startPolling, 2000);
                } catch (err) {
                    log('СИНХРОННА ПОМИЛКА запуску MPC-BE: ' + err.message);
                    stopPolling();
                }
            }, 1000);
        };
    }

    Lampa.Player.listener.follow('destroy', stopPolling);
    if (window.appready) initExternalPlayer();
    else Lampa.Listener.follow('app', (e) => { if (e.type == 'ready') initExternalPlayer(); });

})();
