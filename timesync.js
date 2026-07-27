(function () {
    'use strict';

    // --- ПЕРЕВІРКА ПЛАТФОРМИ ---
    var isWindows = navigator.platform.indexOf('Win') > -1 || navigator.userAgent.indexOf('Windows') > -1;

    var req = window.require || window.nodeRequire;
    var node_http = null;
    var node_fs = null;

    if (isWindows && req) {
        try { node_http = req('http'); } catch (e) {}
        try { node_fs = req('fs'); } catch (e) {}
    }

    if (!isWindows || !node_http) {
        console.log('MPC-BE Plugin: Запуск скасовано. Це не Windows PC середовище або немає доступу до Node.');
        return;
    }

    // --- НАЛАШТУВАННЯ ---
    var MPC_WEB_PORT = 13579;  // порт веб-інтерфейсу MPC-BE (Відтворення -> Веб-інтерфейс)
    var PROXY_PORT = 8080;     // порт нашого вбудованого проксі
    var PROXY_URL = 'http://127.0.0.1:' + PROXY_PORT;
    var MAX_FAILS = 3;         // трохи збільшив запас, щоб не відвалювалось на тимчасовий лаг
    var LOG_PATH = 'D:\\mpc_timesync.log';

    // --- Системні змінні ---
    var pollingInterval = null;
    var currentTimeline = null;
    var failCount = 0;
    var proxyServer = null;
    var firstFailShown = false;

    // --- ЛОГУВАННЯ: на екран (Noty) + у файл (якщо можливо) ---
    function log(msg, showOnScreen) {
        try {
            if (node_fs) {
                node_fs.appendFileSync(LOG_PATH, '[' + new Date().toISOString() + '] ' + msg + '\n');
            }
        } catch (e) {}

        if (showOnScreen) {
            try { Lampa.Noty.show('MPC-BE: ' + msg); } catch (e) {}
        }

        try { console.log('[MPC-BE] ' + msg); } catch (e) {}
    }

    log('Плагін завантажено', false);

    function timeToSeconds(timeStr) {
        if (!timeStr) return 0;
        var parts = timeStr.trim().split(':').reverse();
        var seconds = 0;
        if (parts[0]) seconds += parseInt(parts[0], 10);
        if (parts[1]) seconds += parseInt(parts[1], 10) * 60;
        if (parts[2]) seconds += parseInt(parts[2], 10) * 3600;
        return seconds;
    }

    // --- ВБУДОВАНИЙ ПРОКСІ (без spawn, без whitelist-обмежень) ---
    // Замінює окремий mpc-proxy.js: піднімає HTTP-сервер прямо в процесі Lampa
    function ensureProxyServer(callback) {
        if (proxyServer) {
            callback();
            return;
        }

        try {
            proxyServer = node_http.createServer(function (request, response) {
                response.setHeader('Access-Control-Allow-Origin', '*');
                response.setHeader('Access-Control-Allow-Methods', 'OPTIONS, GET');
                response.setHeader('Access-Control-Allow-Headers', '*');

                if (request.method === 'OPTIONS') {
                    response.writeHead(204);
                    response.end();
                    return;
                }

                var mpcReq = node_http.get('http://127.0.0.1:' + MPC_WEB_PORT + '/variables.html', function (mpcRes) {
                    response.writeHead(mpcRes.statusCode, mpcRes.headers);
                    mpcRes.pipe(response, { end: true });
                });

                mpcReq.on('error', function (err) {
                    response.writeHead(502);
                    response.end('Failed to connect to MPC-BE: ' + err.message);
                });
            });

            proxyServer.on('error', function (err) {
                log('Помилка вбудованого проксі-сервера: ' + err.message, true);
                proxyServer = null;
            });

            proxyServer.listen(PROXY_PORT, '127.0.0.1', function () {
                log('Вбудований проксі запущено на порту ' + PROXY_PORT, false);
                callback();
            });
        } catch (err) {
            log('Не вдалося підняти вбудований проксі: ' + err.message, true);
            proxyServer = null;
        }
    }

    function stopPolling(reason) {
        if (pollingInterval) {
            clearInterval(pollingInterval);
            pollingInterval = null;
            Lampa.Noty.show('MPC-BE: Синхронізацію зупинено' + (reason ? (' (' + reason + ')') : ''));
            log('Опитування зупинено. Причина: ' + (reason || 'невідома'), false);
        }
        firstFailShown = false;
        // Проксі-сервер НЕ закриваємо - хай живе весь час роботи Lampa,
        // це просто локальний http.Server у тому ж процесі, ресурсів майже не їсть.
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
                throw new Error('Не знайдено positionstring (MPC-BE веб-інтерфейс не відповідає як очікувалось)');
            }
        } catch (error) {
            failCount++;
            var msg = 'Помилка опитування (' + failCount + '/' + MAX_FAILS + '): ' + error.message;
            log(msg, false);

            if (!firstFailShown) {
                firstFailShown = true;
                try { Lampa.Noty.show('MPC-BE debug: ' + msg); } catch (e) {}
            }

            if (failCount > MAX_FAILS) stopPolling(error.message);
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
        // ВАЖЛИВО: сам MPC-BE ми більше НЕ запускаємо -
        // це вже робить сама Lampa через налаштування "зовнішній плеєр".
        // Наше завдання - тільки піймати момент старту відтворення,
        // підняти проксі і почати опитування для синхронізації прогресу.
        Lampa.Player.play = function (data) {
            stopPolling();

            currentTimeline = data.timeline;

            log('play() викликано, старт синхронізації', false);

            ensureProxyServer(function () {
                // невелика затримка, щоб MPC-BE встиг відкритись і підняти свій веб-інтерфейс
                setTimeout(startPolling, 2000);
            });
        };
    }

    Lampa.Player.listener.follow('destroy', function () { stopPolling('плеєр закрито'); });
    if (window.appready) initExternalPlayer();
    else Lampa.Listener.follow('app', (e) => { if (e.type == 'ready') initExternalPlayer(); });

})();
