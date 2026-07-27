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
    var MAX_FAILS = 15; // Збільшено ліміт очікування!

    // --- Системні змінні ---
    var pollingInterval = null;
    var currentTimeline = null;
    var failCount = 0;
    var proxyProcess = null;

    // Перетворення секунд у формат HH:MM:SS для MPC-BE
    function secondsToHms(d) {
        d = Number(d);
        var h = Math.floor(d / 3600);
        var m = Math.floor(d % 3600 / 60);
        var s = Math.floor(d % 3600 % 60);
        return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
    }

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

                if (curSec >= 0 && currentTimeline && currentTimeline.hash) {
                    currentTimeline.time = curSec;
                    currentTimeline.duration = durSec || 0;
                    currentTimeline.percent = durSec > 0 ? (curSec / durSec) * 100 : 0;
                    
                    // Зберігаємо прогрес у базу Lampa
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
            
            var videoUrl = data.url || data.file || "";
            if (!videoUrl) return;

            // Подвійний пошук хешу та збереженого часу
            var hash1 = (data.timeline && data.timeline.hash) ? data.timeline.hash : '';
            var hash2 = Lampa.Utils.hash(videoUrl);

            var view1 = hash1 ? Lampa.Timeline.view(hash1) : null;
            var view2 = hash2 ? Lampa.Timeline.view(hash2) : null;

            var targetTimeSec = 0;
            if (data.timeline && data.timeline.time > 5) {
                targetTimeSec = data.timeline.time;
            } else if (view1 && view1.time > 5) {
                targetTimeSec = view1.time;
            } else if (view2 && view2.time > 5) {
                targetTimeSec = view2.time;
            }

            currentTimeline = data.timeline || {};
            currentTimeline.hash = hash1 || hash2;

            Lampa.Noty.show('MPC-BE: Старт з ' + Math.round(targetTimeSec) + ' сек.');

            try {
                // Запуск проксі з додаванням shell: true для надійності в Windows
                proxyProcess = node_cp.spawn(NODE_EXE_PATH, [PROXY_SCRIPT_PATH], { detached: true, shell: true, stdio: 'ignore' });
                if (proxyProcess.unref) proxyProcess.unref();

                setTimeout(function() {
                    // Команда /startpos HH:MM:SS передається ДО посилання на відео
                    var args = [];
                    if (targetTimeSec > 5) {
                        args.push('/startpos', secondsToHms(targetTimeSec));
                    }
                    args.push(videoUrl);

                    var playerProcess = node_cp.spawn(MPC_PATH, args, { detached: true, stdio: 'ignore' });
                    if (playerProcess.unref) playerProcess.unref();

                    setTimeout(startPolling, 3000);
                }, 1000);
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
