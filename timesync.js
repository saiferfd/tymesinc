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
    var MAX_FAILS = 15;

    // --- Системні змінні ---
    var pollingInterval = null;
    var currentTimeline = null;
    var failCount = 0;
    var proxyProcess = null;

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
            if (!response.ok) throw new Error('Proxy status not OK');
            
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
                    // Записуємо прогрес у базу Lampa
                    Lampa.Timeline.update(currentTimeline);
                }
            } else {
                throw new Error('Position not found in HTML');
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

            // --- ФІКС ТАЙМЛАЙНУ ТА ХЕШУ ---
            // Створюємо хеш фільму, якщо його немає, щоб Lampa розуміла, що це за відео
            var itemHash = (data.timeline && data.timeline.hash) ? data.timeline.hash : Lampa.Utils.hash(videoUrl);
            
            // Перевіряємо збережений прогрес перегляду в Lampa
            var savedTimeline = Lampa.Timeline.view(itemHash);
            
            currentTimeline = data.timeline || {};
            currentTimeline.hash = itemHash;

            // Визначаємо секунду, з якої треба продовжити перегляд
            var targetTimeSec = 0;
            if (savedTimeline && savedTimeline.time > 5) {
                targetTimeSec = savedTimeline.time;
            } else if (currentTimeline && currentTimeline.time > 5) {
                targetTimeSec = currentTimeline.time;
            }

            try {
                proxyProcess = node_cp.spawn(NODE_EXE_PATH, [PROXY_SCRIPT_PATH], { detached: true, stdio: 'ignore' });
                if (proxyProcess.unref) proxyProcess.unref();

                setTimeout(function() {
                    var args = [videoUrl];
                    
                    // Якщо є збережений час (> 5 сек) — передаємо команду /start у мілісекундах для MPC-BE
                    if (targetTimeSec > 5) {
                        args.push('/start', Math.round(targetTimeSec * 1000));
                    }

                    var playerProcess = node_cp.spawn(MPC_PATH, args, { detached: true, stdio: 'ignore' });
                    if (playerProcess.unref) playerProcess.unref();

                    setTimeout(startPolling, 2000);
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
