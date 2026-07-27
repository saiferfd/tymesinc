(function () {
    'use strict';

    var isWindows = navigator.platform.indexOf('Win') > -1 || navigator.userAgent.indexOf('Windows') > -1;
    var req = window.require || window.nodeRequire;

    var node_cp = null;
    var node_http = null;

    if (isWindows && req) {
        try {
            node_cp = req('child_process');
            node_http = req('http');
        } catch (e) {}
    }

    if (!isWindows || !node_cp || !node_http) {
        console.log('MPC-BE Plugin: Скасовано (немає необхідних модулів)');
        return;
    }

    // --- НАЛАШТУВАННЯ ---
    var MPC_PATH = 'D:\\MPC-BE\\mpc-be64.exe';
    var PROXY_PORT = 8080;
    var MPC_PORT = 13579;
    var MAX_FAILS = 30;

    var pollingInterval = null;
    var currentTimeline = null;
    var failCount = 0;
    var internalServer = null;

    var targetTimeSec = 0;
    var hasSought = false; // Прапорець перемотки

    function secondsToHms(d) {
        d = Number(d);
        var h = Math.floor(d / 3600);
        var m = Math.floor(d % 3600 / 60);
        var s = Math.floor(d % 3600 % 60);
        return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
    }

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

            internalServer.on('error', function () {});
            internalServer.listen(PROXY_PORT, '127.0.0.1');
        } catch (e) {}
    }

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

    // Автоматична перемотка через Web UI MPC-BE
    function seekMpcWebUi(seconds) {
        if (hasSought || seconds <= 5) return;
        hasSought = true;

        var hms = secondsToHms(seconds);
        var seekUrl = 'http://127.0.0.1:' + MPC_PORT + '/command.html?wm_command=-1&position=' + encodeURIComponent(hms);

        try {
            node_http.get(seekUrl, function () {
                Lampa.Noty.show('MPC-BE: Перемотано на ' + hms);
            }).on('error', function () {});
        } catch (e) {}
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

                // Як тільки плеєр підключився до мережі — виконуємо перемотку!
                if (!hasSought && targetTimeSec > 5) {
                    seekMpcWebUi(targetTimeSec);
                }

                if (curSec >= 0 && currentTimeline && currentTimeline.hash) {
                    currentTimeline.time = curSec;
                    currentTimeline.duration = durSec || 0;
                    currentTimeline.percent = durSec > 0 ? (curSec / durSec) * 100 : 0;
                    
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
            hasSought = false; // Скидаємо прапорець перемотки

            var videoUrl = data.url || data.file || "";
            if (!videoUrl) return;

            var hash1 = (data.timeline && data.timeline.hash) ? data.timeline.hash : '';
            var hash2 = Lampa.Utils.hash(videoUrl);

            var view1 = hash1 ? Lampa.Timeline.view(hash1) : null;
            var view2 = hash2 ? Lampa.Timeline.view(hash2) : null;

            targetTimeSec = 0;
            if (data.timeline && data.timeline.time > 5) {
                targetTimeSec = data.timeline.time;
            } else if (view1 && view1.time > 5) {
                targetTimeSec = view1.time;
            } else if (view2 && view2.time > 5) {
                targetTimeSec = view2.time;
            }

            var activeHash = hash1 || hash2;
            currentTimeline = data.timeline || {};
            currentTimeline.hash = activeHash;

            Lampa.Noty.show('MPC-BE: Старт з ' + secondsToHms(targetTimeSec));

            try {
                // Запускаємо плеєр без заплутаних параметрів
                var playerProcess = node_cp.spawn(MPC_PATH, [videoUrl], { detached: true, stdio: 'ignore' });
                if (playerProcess.unref) playerProcess.unref();

                setTimeout(startPolling, 2000);
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
