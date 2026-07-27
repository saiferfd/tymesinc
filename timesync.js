(function () {
    'use strict';

    var isWindows = navigator.platform.indexOf('Win') > -1 || navigator.userAgent.indexOf('Windows') > -1;
    var req = window.require || window.nodeRequire;

    var node_cp = null;
    var node_http = null;

    if (isWindows && req) {
        try {
            node_cp = req('child_process');
            node_http = req('http'); // Використовуємо вбудований HTTP модуль Lampa
        } catch (e) {}
    }

    if (!isWindows || !node_cp || !node_http) {
        console.log('MPC-BE Plugin: Скасовано (немає необхідних модулів)');
        return;
    }

    // --- НАЛАШТУВАННЯ ---
    var MPC_PATH = 'D:\\MPC-BE\\mpc-be64.exe'; // Перевірте шлях до плеєра!
    var PROXY_PORT = 8080;
    var MPC_PORT = 13579;
    var MAX_FAILS = 15;

    var pollingInterval = null;
    var currentTimeline = null;
    var failCount = 0;
    var internalServer = null;

    // --- ВБУДОВАНИЙ ПРОКСІ (ПРАЦЮЄ ВСЕРЕДИНІ LAMPA БЕЗ ЗОВНІШНІХ ФАЙЛІВ) ---
    function ensureInternalProxy() {
        if (internalServer) return;
        try {
            internalServer = node_http.createServer(function (req, res) {
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, GET');
                res.setHeader('Access-Control-Allow-Headers', '*');

                if (req.method === 'OPTIONS') {
                    res.writeHead(204);
                    res.end();
                    return;
                }

                var proxyReq = node_http.get('http://127.0.0.1:' + MPC_PORT + '/variables.html', function (mpcRes) {
                    res.writeHead(mpcRes.statusCode, mpcRes.headers);
                    mpcRes.pipe(res, { end: true });
                });

                proxyReq.on('error', function () {
                    res.writeHead(502);
                    res.end('MPC-BE not responding');
                });
            });

            internalServer.on('error', function () {
                // Якщо порт вже зайнятий — ігноруємо
            });

            internalServer.listen(PROXY_PORT, '127.0.0.1');
        } catch (e) {}
    }

    // Запускаємо проксі одразу
    ensureInternalProxy();

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
    }

    async function pollMpcViaProxy() {
        try {
            const response = await fetch('http://127.0.0.1:' + PROXY_PORT);
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
        pollingInterval = setInterval(pollMpcViaProxy, 2000);
        pollMpcViaProxy();
    }

    function initExternalPlayer() {
        Lampa.Player.play = function (data) {
            stopPolling();
            ensureInternalProxy();

            var videoUrl = data.url || data.file || "";
            if (!videoUrl) return;

            var itemHash = (data.timeline && data.timeline.hash) ? data.timeline.hash : Lampa.Utils.hash(videoUrl);
            var savedTimeline = Lampa.Timeline.view(itemHash);

            currentTimeline = data.timeline || {};
            currentTimeline.hash = itemHash;

            var targetTimeSec = 0;
            if (savedTimeline && savedTimeline.time > 5) {
                targetTimeSec = savedTimeline.time;
            } else if (currentTimeline && currentTimeline.time > 5) {
                targetTimeSec = currentTimeline.time;
            }

            try {
                var args = [videoUrl];
                if (targetTimeSec > 5) {
                    args.push('/start', Math.round(targetTimeSec * 1000));
                }

                var playerProcess = node_cp.spawn(MPC_PATH, args, { detached: true, stdio: 'ignore' });
                if (playerProcess.unref) playerProcess.unref();

                setTimeout(startPolling, 3000);
            } catch (err) {
                Lampa.Noty.show('Помилка запуску: ' + err.message);
                stopPolling();
            }
        };
    }

    Lampa.Player.listener.follow('destroy', stopPolling);
    if (window.appready) initExternalPlayer();
    else Lampa.Listener.follow('app', (e) => { if (e.type == 'ready') initExternalPlayer(); });

})();
