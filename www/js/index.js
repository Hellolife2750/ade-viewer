import { StorageManager } from './storage_manager.js';
import { SecureStorageManager } from './secure_storage_manager.js';
import { RequestsManager } from './requests_manager.js';
import { ICSParser } from './ics_parser.js';
import { StyleFormatter } from './style_formatter.js';
import { FileManager } from './file_manager.js';
import { WeatherManager } from './weather_manager.js';


const DEBUG = false;
const IS_ENSEIRB = true;
const UPDATE_THRESHOLD_HOURS = 30;

let ICS_URL;
let eventsCache = [];
let blacklistedEventsCache = [];

let LOGIN = "";
let PASSWORD = "";

// Gestion de la vue "week-view"
let eventDays = []; // liste des jours (Date sans heure)
let currentDayIndex = 0;

document.addEventListener('deviceready', onDeviceReady, false);

let activeLoaderCount = 0;

async function withLoader(asyncFn) {
    showLoader(true);
    try {
        return await asyncFn();
    } finally {
        showLoader(false);
    }
}

function showLoader(show) {
    console.log("showLoader", show);
    const loaderContainer = document.getElementById("loader-container");

    if (show) {
        activeLoaderCount++;
    } else {
        activeLoaderCount = Math.max(0, activeLoaderCount - 1);
    }

    // Affiche ou cache le loader selon le compteur
    if (activeLoaderCount > 0) {
        loaderContainer.style.display = "flex";
        document.body.style.overflow = "hidden";
    } else {
        loaderContainer.style.display = "none";
        document.body.style.overflow = "auto";
    }
}

// montre/masque des éléments (tableaux d'IDs)    
function toggleView(showIds, hideIds, showStyle = "block") {
    for (let id of showIds) {
        document.getElementById(id).style.display = showStyle;
    }
    for (let id of hideIds) {
        document.getElementById(id).style.display = "none";
    }
}

function toggleActiveView(activeViewId, inactiveViewIds) {
    for (let id of activeViewId) {
        document.getElementById(id).classList.add("active-view");
    }
    for (let id of inactiveViewIds) {
        document.getElementById(id).classList.remove("active-view");
    }

    document.getElementById("add-event-btn").style.display =
    activeViewId.includes("week-view") ? "block" : "none";

    // anim remonte haut de page
    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });
}

// afficher le popup de changement du lien
function showChangeAddressModal(can_close = true) {
    toggleView(["change-address-modal"], [], "flex");
    document.getElementById("close-address-modal-btn").style.display = can_close ? "block" : "none";
}

// binder les boutons / événements au clic
function initEvents() {

    // afficher vue détaillée devoirs
    document.getElementById("next-events-container").addEventListener("click", () => {
        // toggleView(["week-view"], ["home-view"]);
        toggleActiveView(["week-view"], ["home-view"]);

        if (eventDays.length > 0) {
            const idx = findNextEventDayIndex();
            renderDayView(idx);
        }
    });

    document.getElementById("toggle-home-view").addEventListener("click", () => {
        // toggleView(["home-view"], ["week-view"]);
        toggleActiveView(["home-view"], ["week-view"]);
    });

    document.getElementById("header-logo").addEventListener("click", () => {
        toggleActiveView(["home-view"], ["week-view"]);
    });

    document.getElementById("change-address-btn").addEventListener("click", function () {
        showChangeAddressModal();
    });

    document.getElementById("add-event-btn").addEventListener("click", function () {
        toggleView(["add-event-modal"], [], "flex");
        const day = eventDays[currentDayIndex];
        document.querySelector("#add-event-modal .day-container").textContent = StyleFormatter.formatJour(day, "long");
    });

    document.getElementById("config-mail-btn").addEventListener("click", function () {
        toggleView(["config-mail-modal"], [], "flex");
        resetConfigMailForm();
    });

    document.querySelectorAll(".close-modal-btn").forEach((btn)=>{
        btn.addEventListener("click", function(){
            toggleView([], [this.closest(".modal").id]);
        });
    });

    document.getElementById("save-address-btn").addEventListener("click", function () {
        trySaveAddress();
    });

    document.getElementById("open-scanner-btn").addEventListener("click", function () {
        tryScanAdressQrCOde();
    });

    document.getElementById("refresh-cal-btn").addEventListener("click", function () {
        refreshCalendar();
    });

    // on rafraichit les prochains cours si on revient sur l'app    
    document.addEventListener("resume", function () {
        renderNextCourses();
        refreshInbox();
    });

    // retour arrière natif
    document.addEventListener("backbutton", function (e) {
        const weekView = document.querySelector('#week-view');
        if (weekView && weekView.classList.contains('active-view')){
            e.preventDefault();
            toggleActiveView(["home-view"], ["week-view"]);
        }else{
            navigator.app.exitApp();
        }
    }, false);

}


async function refreshCalendar({showLoader = true, failSilently = false} = {}) {
    const task = async () => {
        await fetchICS({failSilently: failSilently});
        await loadICS();
        await renderDayView(currentDayIndex);
    };

    if (showLoader) {
        await withLoader(task);
    } else {
        await task();
    }
}

function setupConsoleRedirect() {
    if (DEBUG) {
        const textareaHTML = '<textarea id="debug-view"></textarea>';
        document.getElementById("app").insertAdjacentHTML('beforeend', textareaHTML);
    }

    const debugView = document.getElementById("debug-view");
    if (!debugView) {
        console.warn("⚠️ Pas de textarea #debug-view trouvé.");
        return;
    }

    // Fonction utilitaire pour écrire dans la textarea
    function appendLog(level, args) {
        const timestamp = new Date().toISOString();
        const msg = args.map(a =>
            (typeof a === "object" ? JSON.stringify(a) : a)
        ).join(" ");
        debugView.value += `[${timestamp}] [${level}] ${msg}\n`;
        debugView.scrollTop = debugView.scrollHeight; // auto-scroll
    }

    // Redirection
    const originalLog = console.log;
    console.log = (...args) => {
        appendLog("LOG", args);
        originalLog.apply(console, args);
    };

    const originalWarn = console.warn;
    console.warn = (...args) => {
        appendLog("WARN", args);
        originalWarn.apply(console, args);
    };

    const originalError = console.error;
    console.error = (...args) => {
        appendLog("ERROR", args);
        originalError.apply(console, args);
    };
}

// téléchargement périodique de l'ICS en tâche de fond
async function fetchIcsJob() {
    // Vérifie si BackgroundFetch dispo
    if ((typeof BackgroundFetch === 'undefined') ||
        (typeof cordova !== "undefined" && cordova.platformId === "browser")) {
        console.warn("⚠️ BackgroundFetch non disponible.");
        return;
    }

    // Vérifie si déjà configuré
    const wasConfigured = await StorageManager.getItemAsync("backgroundFetchConfigured");
    if (wasConfigured) {
        console.log("✅ BackgroundFetch déjà configuré");
        return;
    }

    console.log("⚙️ Configuration initiale du BackgroundFetch...");

    // Configure BackgroundFetch (quand app est en premier plan ou arrière-plan)
    BackgroundFetch.configure(
        {
            minimumFetchInterval: 1440,
            stopOnTerminate: false,
            enableHeadless: true,
            requiresBatteryNotLow: true,
            requiredNetworkType: BackgroundFetch.NETWORK_TYPE_ANY,
        },
        async function (taskId) {
            console.log("[BackgroundFetch] 🕑 Tâche reçue (foreground/background) :", taskId);

            try {
                await fetchICS();
                console.log("[BackgroundFetch] ✅ fetchICS exécuté");
            } catch (err) {
                console.error("[BackgroundFetch] ❌ Erreur fetchICS :", err);
            }

            console.log("[BackgroundFetch] 🔄 maj_last_update_termine");

            BackgroundFetch.finish(taskId);
        },
        function (error) {
            console.error("[BackgroundFetch] ❌ Erreur config :", error);
        }
    );

    // Marque comme configuré
    StorageManager.setItem("backgroundFetchConfigured", true);
}

function onDeviceReady() {
    if (DEBUG){
        setupConsoleRedirect();
    }

    initEvents();

    // afficher prochains cours et devoirs
    StorageManager.getItem("ics_url", async function (value) {
        if (value === null) {
            showChangeAddressModal(false);
        } else {
            ICS_URL = value;
            document.getElementById("address-input").value = value;
            blacklistedEventsCache = await getEventsBlacklist();
            loadICS();
            refreshIfOutdated();
        }
    });

    // afficher mails
    refreshInbox();

    // fetchIcsJob();
}

// refetch le ics au chargement s'il est trop vieux
function refreshIfOutdated() {
    StorageManager.getItem("last_update", function (dateStr) {
        const now = new Date();

        if (!dateStr) {
            console.log("🕒 Aucune mise à jour enregistrée. Rafraîchissement nécessaire.");
            return refreshCalendar({failSilently: true});
        }

        const lastUpdate = new Date(dateStr);
        const diffMs = now - lastUpdate;
        const diffHours = diffMs / (1000 * 60 * 60);

        if (diffHours > UPDATE_THRESHOLD_HOURS) {
            console.log(`🔁 Mise à jour dépassée (${diffHours.toFixed(1)}h > ${UPDATE_THRESHOLD_HOURS}h). Rafraîchissement...`);
            refreshCalendar({failSilently: true});
        } else {
            console.log(`✅ Données à jour (${diffHours.toFixed(1)}h < ${UPDATE_THRESHOLD_HOURS}h).`);
        }
    });
}

function trySaveAddress() {
    const input = document.getElementById("address-input");
    const newURL = input.value.trim();

    if (newURL) {
        ICS_URL = newURL;
        StorageManager.setItem("ics_url", newURL);
        toggleView([], ["change-address-modal"]);
        refreshCalendar();
    } else {
        alert("Veuillez entrer une URL valide.");
    }
}

function tryScanAdressQrCOde() {
    cordova.plugins.barcodeScanner.scan(
        function (result) {
            if (!result.cancelled) {
                var qrContent = result.text;
                document.getElementById("address-input").value = qrContent;
                trySaveAddress();
            }
        },
        function (error) {
            alert("Erreur lors du scan : " + error);
        },
        {
            prompt: "Placez un QR code devant la caméra",
            resultDisplayDuration: 500,
            formats: "QR_CODE",
            orientation: "portrait"
        }
    );
}

// obtenir l'URL ICS (depuis variable globale de préférence, stockage sinon)
async function getIcsUrl() {
    if (typeof ICS_URL !== "undefined" && ICS_URL) {
        return ICS_URL;
    }

    const url = await StorageManager.getItemAsync("ics_url");
    if (!url) {
        console.error("❌ Aucun ICS_URL disponible.");
        throw new Error("ICS_URL introuvable.");
    }

    return url;
}

// afficher un message toast
function showToast(message){
    window.plugins.toast.showShortBottom(message);
}

// récupère le fichier ICS depuis le serveur et le sauvegarde en local
async function fetchICS({failSilently = false} = {}) {
    try {
        const url = await getIcsUrl();
        const response = await RequestsManager.httpGet(url); // response.data contient le texte ICS

        await FileManager.saveIcsFile(response.data);
        StorageManager.setItem("last_update", new Date().toISOString());

        showToast("✅ Calendrier mis à jour");

        return response.data; // <- renvoyer le texte directement
    } catch (err) {
        console.error("❌ Erreur:", err);
        if (!failSilently){
            alert("Erreur chargement ICS: " + err.error || err);
        }
        showToast("❌ Impossible de mettre à jour le calendrier");
        return ""; // ou throw err si tu veux propager l'erreur
    }
}

// après chargement ICS → construire la liste des jours et initialiser la vue
async function loadICS() {
    try {
        const icsText = await FileManager.loadIcsFile(withLoader, fetchICS);  // await fetchICS();
        eventsCache = ICSParser.parseICS(icsText).concat(await getAddedEvents());
        eventsCache.sort((a, b) => a.start - b.start);

        buildEventDays();       // <-- ici
        renderNextCourses();    // vue 3 prochains
        // vue journée → commence au 1er jour trouvé
        setupDayNavigation();   // brancher les boutons

        console.log("Events chargés: ", eventsCache.length + " événements.");
    } catch (err) {
        console.error("Erreur ICS:", err);
    }
}

// affiche les 3 prochains cours
async function renderNextCourses() {
    const container = document.getElementById("day-events-container");
    if (!container) return;

    console.log('renderNextCourses');
    container.innerHTML = ``;

    const now = new Date();
    const upcoming = eventsCache
        .filter(e => e.end > now && !isEventBlacklisted(e.title, new Date(e.start), blacklistedEventsCache))
        .slice(0, 3);
    console.log("Prochains cours:", upcoming.length);

    // groupement par jour
    let currentDay = "";
    let dayContainer = null;

    for (let event of upcoming) {
        const dayLabel = StyleFormatter.formatJourSpecial(event.start);

        if (dayLabel !== currentDay) {
            currentDay = dayLabel;
            dayContainer = document.createElement("div");
            dayContainer.className = "day-events";
            dayContainer.innerHTML = `<p class="day-title">${dayLabel}</p>`;
            container.appendChild(dayContainer);
        }

        const startTime = StyleFormatter.formatHeure(event.start);
        const endTime = StyleFormatter.formatHeure(event.end);

        const color = StyleFormatter.stringToColor(event.title);

        const eventDiv = document.createElement("div");
        eventDiv.className = "event";
        eventDiv.innerHTML = `
            <div class="times">
                <p>${startTime}</p>
                <p>${endTime}</p>
            </div>
            <div class="details">
                <div class="seperator" style="background-color: ${color};"></div>
                <div class="details-text">
                    <p class="title">${event.title}</p>
                    <p class="location">${event.location}</p>
                    <div class="badges-container">
                        ${isCM(event.location) ? '<img src="res/img/icons/amphi.svg" class="event-badge" title="event\'s badge" draggable="false"/>' : ''}
                    </div>
                </div>
            </div>
        `;

        dayContainer.appendChild(eventDiv);
    }

    if (upcoming.length === 0) {
        container.innerHTML += `<p class="centered">Aucun cours à venir</p>`;
    }else{
        startCountdown(upcoming[0].start);
    }

    // dernière date de MAJ
    StorageManager.getItem("last_update", function (dateStr) {
        if (dateStr) {
            const texte = StyleFormatter.formatDuree(dateStr);
            document.querySelector("#last-update-label span").textContent = texte;
            console.log("Dernière mise à jour : il y a", texte);
        } else {
            console.log("Pas de date enregistrée.");
        }
    });

    await renderHomeworks();
}

/**
 * Met à jour un compte à rebours vers une date donnée.
 * Masque l'élément si l'événement est dans plus de 24h.
 * @param {Date} targetDate - La date/heure de l’événement à venir.
 */
function startCountdown(targetDate) {
    const timerElement = document.getElementById("next-course-timer");

    if (!timerElement) {
        console.warn("[Countdown] Élément #next-course-timer introuvable.");
        return;
    }

    const ONE_MINUTE = 60 * 1000;
    const ONE_DAY = 24 * 60 * 60 * 1000;
    let interval = null;

    function updateTimer() {
        const now = new Date();
        const diffMs = targetDate - now;

        // Si plus de 24h → on masque le timer
        if (diffMs > ONE_DAY) {
            timerElement.style.display = "none";
            clearInterval(interval);
            return;
        }

        // Sinon, on affiche le timer
        timerElement.style.display = "block";

        if (diffMs <= 0) {
            timerElement.textContent = "EN COURS";
            clearInterval(interval);
            return;
        }

        const totalMinutes = Math.floor(diffMs / 1000 / 60);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;

        const hh = String(hours).padStart(2, "0");
        const mm = String(minutes).padStart(2, "0");

        timerElement.textContent = `${hh}:${mm}`;
    }

    // Mise à jour immédiate
    updateTimer();

    // Puis toutes les minutes
    interval = setInterval(updateTimer, ONE_MINUTE);
}

// supprimer les devoirs expirés du stockage
async function cleanupExpiredHomeworks(homeworks) {
    const today = new Date();
    today.setHours(0, 0, 0, 0); // on neutralise l'heure pour ne comparer que la date

    const validHomeworks = homeworks.filter(hw => {
        const hwDate = new Date(hw.date);
        hwDate.setHours(0, 0, 0, 0);
        return hwDate >= today;
    });

    // Si des devoirs expirés ont été supprimés, mettre à jour le stockage
    if (validHomeworks.length !== homeworks.length) {
        await StorageManager.setItem("homeworks", JSON.stringify(validHomeworks));
        console.log("🧹 Devoirs expirés supprimés du stockage.");
    }

    return validHomeworks;
}

// trier par date plus proche au plus loin
function sortHomeworksByDate(allHomeworks) {
    return allHomeworks.slice().sort((a, b) => new Date(a.date) - new Date(b.date));
}

// afficher les devoirs
async function renderHomeworks() {
    const container = document.getElementById("homeworks-container");
    if (!container) {
        console.error("❌ #homeworks-container introuvable dans le DOM !");
        return;
    }

    // récupérer les devoirs
    let homeworks = await StorageManager.getItemAsync("homeworks");
    try {
        homeworks = homeworks ? JSON.parse(homeworks) : [];
    } catch (e) {
        console.warn("[renderHomeworks] homeworks corrompu, reset.");
        homeworks = [];
    }

    // Nettoyage des devoirs expirés
    let validHomeworks = await cleanupExpiredHomeworks(homeworks);

    validHomeworks = sortHomeworksByDate(validHomeworks);

    // reset du container avant de réinsérer
    container.innerHTML = "";

    if (validHomeworks.length === 0) {
        container.insertAdjacentHTML("beforeend", `<p class="centered">Aucun devoir pour l'instant.</p>`);
        return;
    }

    // insertion des devoirs
    validHomeworks.forEach(hw => {
        const dateObj = new Date(hw.date);
        const html = `
        <div class="day-homeworks">
            <p class="day-title">Pour <span class="bold">${StyleFormatter.formatJourSpecial(dateObj)}</span></p>
            <div class="homework">
                <div class="header">
                    <div class="course-name">${hw.course}</div>
                    <div class="made ${hw.made ? "is-mad" : ""}" id="made-${hw.id}">${hw.made ? "Fait" : "Non Fait"}</div>
                </div>
                <p class="homework-description ${hw.made ? "is-mad" : ""}" id="desc-${hw.id}">${hw.homework}</p>
                <div class="footer">
                    <label for="homework-${hw.id}-made">J'ai terminé</label>
                    <input class="classic-checkbox homework-toggle" type="checkbox" id="homework-${hw.id}-made" name="homework-${hw.id}-made" data-id="${hw.id}"
       ${hw.made ? "checked" : ""}/>
                </div>
            </div>
        </div>
        `;
        container.insertAdjacentHTML("beforeend", html);
    });

    attachHomeworksListeners();
}

function attachHomeworksListeners(){
    // Attacher les listeners de checkbox après l'injection HTML
    document.querySelectorAll(".homework-toggle").forEach(checkbox => {
        checkbox.addEventListener("change", async (e) => {
            const id = e.target.dataset.id;
            const isChecked = e.target.checked;

            // Récupérer les devoirs
            let homeworks = await StorageManager.getItemAsync("homeworks");
            try {
                homeworks = homeworks ? JSON.parse(homeworks) : [];
            } catch (err) {
                console.warn("[checkbox change] homeworks corrompu, reset.");
                homeworks = [];
            }

            // Trouver le devoir à modifier
            const index = homeworks.findIndex(hw => hw.id === id);
            if (index !== -1) {
                homeworks[index].made = isChecked;

                // Sauvegarde
                StorageManager.setItem("homeworks", JSON.stringify(homeworks));

                // Cacher ou montrer la description
                const madeEl = document.getElementById(`made-${id}`);
                if (madeEl) {
                    madeEl.classList.toggle("is-mad", isChecked);
                    madeEl.innerText = isChecked ? "Fait" : "Non Fait";
                }
                const descEl = document.getElementById(`desc-${id}`);
                descEl?.classList.toggle("is-mad", isChecked);
            }
        });
    });
}

// construit la liste des jours uniques avec événements
function buildEventDays() {
    const dayMap = new Map();
    for (let e of eventsCache) {
        const day = StyleFormatter.normalizeDate(e.start).getTime();
        if (!dayMap.has(day)) {
            dayMap.set(day, StyleFormatter.normalizeDate(e.start));
        }
    }
    // tri croissant
    eventDays = Array.from(dayMap.values()).sort((a, b) => a - b);
    console.log("Jours avec événements:", eventDays.length);
}

// renvoie si le lieu est un amphi
function isCM(location) {
    return location.includes("AMPHI");
}

// affiche les événements du jour courant
async function renderDayView(index) {
    if (eventDays.length === 0) return;
    if (index < 0 || index >= eventDays.length) return;

    currentDayIndex = index;
    const day = eventDays[currentDayIndex];

    // maj du header
    const navLabel = document.querySelector("#week-view .navigator-bar p");
    navLabel.textContent = StyleFormatter.formatJour(day, "long");

    // événements de ce jour
    const container = document.getElementById("week-events-container");
    container.innerHTML = "";

    const events = eventsCache.filter(e =>
        StyleFormatter.normalizeDate(e.start).getTime() === day.getTime()
    );

    // Afficher les événements du jour
    for (let ev of events) {
        const startTime = StyleFormatter.formatHeure(ev.start);

        const endTime = StyleFormatter.formatHeure(ev.end);

        const professorName = (IS_ENSEIRB) ? StyleFormatter.extractProfessor(ev.notes) : "";

        let eventHeight = (ev.end - ev.start) / (1000 * 60 * 60);
        
        let color = StyleFormatter.stringToColor(ev.title);

        // événements sans lieu, généralement cours alternatifs
        if (IS_ENSEIRB && ev.location === "") { color = "#888"; eventHeight = 0; }

        const div = document.createElement("div");
        div.setAttribute("data-course-name", ev.title);
        div.setAttribute("data-course-start", ev.start.toISOString());
        div.className = "event";

        if (isEventBlacklisted(ev.title, ev.start, blacklistedEventsCache)){
            div.innerHTML = `
                <div class="blacklisted-event-container">
                    <img src="res/img/icons/eye-slash.svg" class="blacklist-event" title="unblacklist event button" draggable="false"/>
                    <p>...</p>
                </div>
            `;
        }else{
            div.innerHTML = `
                <div class="times">
                    <p>${startTime}</p>
                    <p>${endTime}</p>
                </div>
                <div class="details">
                    <div class="seperator" style="background-color: ${color}; min-height: ${eventHeight * 8}vh;"></div>
                    <div class="details-text">
                        <p class="title">${ev.title}</p>
                        <p class="location">${ev.location}</p>
                        <p class="professor">${professorName}</p>
                        <div class="badges-container">
                            ${isCM(ev.location) ? '<img src="res/img/icons/amphi.svg" class="event-badge" title="event\'s badge" draggable="false"/>' : ''}
                            ${ev.isPeriodic !== undefined ? '<img src="res/img/icons/trash.svg" class="delete-event expandable-icon hidden" title="delete event button" draggable="false"/>' : '<img src="res/img/icons/eye.svg" class="blacklist-event expandable-icon hidden" title="blacklist event button" draggable="false"/>'}
                            <img src="res/img/icons/pencil.svg" class="add-homework expandable-icon hidden" title="add homework button" draggable="false"/>
                        </div>
                    </div>
                </div>
            `;
        }
        
        div.addEventListener("click", () => {
            div.querySelectorAll(".expandable-icon").forEach(icon => {
                icon.classList.toggle("hidden");
            });
        });

        container.appendChild(div);
    }

    if (events.length === 0) {
        container.innerHTML = "<p>Aucun événement ce jour</p>";
    }

    // Si des événements existent, on récup la météo
    /*if (events.length > 0) {
        const weatherContainer = document.createElement("div");
        weatherContainer.classList.add("weather-container");

        // Récupère les deux blocs HTML météo en parallèle
        Promise.all([
            WeatherManager.getWeatherDetailsHTML(events[0].start),
            WeatherManager.getWeatherDetailsHTML(events[events.length - 1].end)
        ]).then(([startHtml, endHtml]) => {
            // Ajoute les deux blocs dans l'ordre dans le weatherContainer
            weatherContainer.insertAdjacentHTML("beforeend", startHtml);
            weatherContainer.insertAdjacentHTML("beforeend", endHtml);

            // Enfin, ajoute le weatherContainer au container principal
            if (startHtml !== "??" && endHtml !== "??"){
                container.appendChild(weatherContainer, container.lastChild); // insertBefore, firstChild
            }
        });
    }*/

    addHomeworkEvents();
    blacklistEventEvents();
    deleteEventEvents()
}

// navigation jour précédent / suivant
function setupDayNavigation() {
    const prevBtn = document.getElementById("preview-day-btn");
    const nextBtn = document.getElementById("next-day-btn");

    // Remplacer complètement le handler précédent (évite empilement)
    prevBtn.onclick = () => {
        if (currentDayIndex > 0) {
            renderDayView(currentDayIndex - 1);
        }
    };

    nextBtn.onclick = () => {
        if (currentDayIndex < eventDays.length - 1) {
            renderDayView(currentDayIndex + 1);
        }
    };
}

// trouve l'index du jour du prochain cours à venir
function findNextEventDayIndex() {
    const now = new Date();
    for (let i = 0; i < eventDays.length; i++) {
        const day = eventDays[i];
        const hasFutureEvent = eventsCache.some(e =>
            StyleFormatter.normalizeDate(e.start).getTime() === day.getTime() && e.end > now
        );
        if (hasFutureEvent) {
            return i;
        }
    }
    // fallback: si rien trouvé (par ex. tous passés) → dernier jour dispo
    return eventDays.length - 1;
}

// Petite fonction pour générer un identifiant unique
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// Fonction d’ajout ou de modification de devoir
async function addHomeworkFromEvent(eventDiv) {
    const courseName = eventDiv.dataset.courseName;
    const courseDate = eventDiv.dataset.courseStart;

    const courseDateObj = new Date(courseDate);

    // Récupérer la liste existante
    let homeworks = await StorageManager.getItemAsync("homeworks");
    try {
        homeworks = homeworks ? JSON.parse(homeworks) : [];
    } catch (e) {
        console.warn("[StorageManager] homeworks corrompu, reset.");
        homeworks = [];
    }

    // Chercher s'il y a déjà un devoir pour ce cours et cette date
    const existingHomework = homeworks.find(
        hw => hw.course === courseName && hw.date === courseDate
    );

    const defaultText = existingHomework ? existingHomework.homework : "";
    const promptText = existingHomework
        ? `Modifier le devoir pour ${courseName} le ${StyleFormatter.formatJour(courseDateObj)} :`
        : `Ajouter un devoir pour ${courseName} le ${StyleFormatter.formatJour(courseDateObj)} :`;

    const homeworkText = prompt(promptText, defaultText);
    if (homeworkText === null) return; // annulation

    // 🔥 CAS MODIFICATION AVEC TEXTE VIDE => SUPPRESSION
    if (existingHomework && homeworkText.trim() === "") {
        homeworks = homeworks.filter(hw => hw !== existingHomework);
        StorageManager.setItem("homeworks", JSON.stringify(homeworks));
        showToast("✅ Devoir supprimé");
        console.log("🗑️ Devoir supprimé :", existingHomework);
        return;
    }

    // 🚫 CAS AJOUT AVEC TEXTE VIDE => IGNORER (comportement conservé)
    if (!existingHomework && homeworkText.trim() === "") {
        return;
    }

    if (existingHomework) {
        // Modifier l'existant
        existingHomework.homework = homeworkText;
        showToast("✅ Devoir modifié");
        console.log("✏️ Devoir modifié :", existingHomework);
    } else {
        // Créer un nouvel objet
        const newHomework = {
            id: generateUUID(),
            course: courseName,
            homework: homeworkText,
            made: false,
            date: courseDate
        };
        homeworks.push(newHomework);
        showToast("✅ Devoir ajouté");
        console.log("✅ Devoir ajouté :", newHomework);
    }

    // Sauvegarder
    StorageManager.setItem("homeworks", JSON.stringify(homeworks));
}

function addHomeworkEvents() {
    document.querySelectorAll('#week-view .event').forEach(eventDiv => {
        const addButton = eventDiv.querySelector('.add-homework');

        if (addButton) {
            addButton.addEventListener('click', (e) => {
                e.stopPropagation(); // évite les effets de bord si d'autres événements sont liés à l'event
                addHomeworkFromEvent(eventDiv).then(() => {
                    renderHomeworks();
                });
            });
        }
    });
}

// renvoie si un event est blacklisté (nom_cours, horaire) en fonction de la blacklist
function isEventBlacklisted(courseName, courseDateObj, eventsBlacklist) {
    const weekday = courseDateObj.getDay();
    const hour = courseDateObj.getHours();
    const minute = courseDateObj.getMinutes();

    return eventsBlacklist.some(ev =>
        ev.course === courseName &&
        ev.weekday === weekday &&
        ev.hour === hour &&
        ev.minute === minute
    );
}

async function getEventsBlacklist() {
    let list = await StorageManager.getItemAsync("events-blacklist");
    try {
        return list ? JSON.parse(list) : [];
    } catch (e) {
        console.warn("[StorageManager] Evénements blacklistés corrompus, reset.");
        return [];
    }
}

async function blacklistEvent(eventDiv) {
    const courseName = eventDiv.dataset.courseName;
    const courseDate = eventDiv.dataset.courseStart;
    const courseDateObj = new Date(courseDate);

    const weekday = courseDateObj.getDay();
    const hour = courseDateObj.getHours();
    const minute = courseDateObj.getMinutes();

    const index = blacklistedEventsCache.findIndex(ev =>
        ev.course === courseName &&
        ev.weekday === weekday &&
        ev.hour === hour &&
        ev.minute === minute
    );

    if (index !== -1) {
        console.log("🗑 Suppression de l'event blacklisté :", blacklistedEventsCache[index]);
        showToast("✅ Cours retiré de la blacklist");
        blacklistedEventsCache.splice(index, 1);
    } else {
        const newBlacklist = {
            id: generateUUID(),
            course: courseName,
            weekday,
            hour,
            minute
        };
        blacklistedEventsCache.push(newBlacklist);
        console.log("✅ Event blacklisté ajouté :", newBlacklist);
        showToast("✅ Cours blacklisté");
    }

    // Sauvegarde
    await StorageManager.setItem("events-blacklist", JSON.stringify(blacklistedEventsCache));
}

// binder les évents bouton blacklister event
function blacklistEventEvents() {
    document.querySelectorAll('#week-view .event').forEach(eventDiv => {
        const blacklistButton = eventDiv.querySelector('.blacklist-event');

        if (blacklistButton) {
            blacklistButton.addEventListener('click', (e) => {
                e.stopPropagation(); // évite les effets de bord si d'autres événements sont liés à l'event
                blacklistEvent(eventDiv).then(() => {
                    renderDayView(currentDayIndex);
                    renderNextCourses();
                });
            });
        }
    });
}

// === DATEPICKER ===

let datepickerState = {
  visible: false,
  currentMonth: null,
  currentYear: null,
};

// Bouton d'ouverture
document.getElementById("open-calendar-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  toggleDatepicker();
});

// Fermer en cliquant dehors
document.addEventListener("click", (e) => {
  const picker = document.getElementById("datepicker");
  if (!picker) return;
  if (datepickerState.visible && !picker.contains(e.target) && e.target.id !== "open-calendar-btn") {
    toggleDatepicker(false);
  }
});

function toggleDatepicker(show = !datepickerState.visible) {
  const picker = document.getElementById("datepicker");
  if (!picker) return;

  datepickerState.visible = show;
  picker.style.display = show ? "block" : "none";
  picker.classList.toggle("active", show);

  if (show) {
    const currentDate = eventDays.length > 0 ? eventDays[currentDayIndex] : new Date();
    datepickerState.currentMonth = currentDate.getMonth();
    datepickerState.currentYear = currentDate.getFullYear();
    buildDatepicker();
  }
}

function buildDatepicker() {
  const picker = document.getElementById("datepicker");
  if (!picker) return;

  const tbody = picker.querySelector("tbody");
  const label = picker.querySelector(".month-label");
  const prevBtn = picker.querySelector(".preview-month-btn");
  const nextBtn = picker.querySelector(".next-month-btn");

  const month = datepickerState.currentMonth;
  const year = datepickerState.currentYear;

  // Nom du mois
  const monthName = new Date(year, month).toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
  });
  label.textContent = monthName.charAt(0).toUpperCase() + monthName.slice(1);

  // Reset
  tbody.innerHTML = "";

  // Premier jour du mois
  const firstDay = new Date(year, month, 1);
  const firstDayWeek = (firstDay.getDay() + 6) % 7; // Lundi = 0
  const firstVisible = new Date(year, month, 1 - firstDayWeek);

  for (let week = 0; week < 5; week++) {
    const tr = document.createElement("tr");

    for (let day = 0; day < 6; day++) {
      const td = document.createElement("td");
      const currentDate = new Date(firstVisible);
      currentDate.setDate(firstVisible.getDate() + week * 7 + day);

      const dayNum = currentDate.getDate();
      td.textContent = dayNum;

      const normalized = StyleFormatter.normalizeDate(currentDate);
      const inCurrentMonth = currentDate.getMonth() === month;

      // Tous les événements du jour
      const events = eventsCache.filter(e =>
        StyleFormatter.normalizeDate(e.start).getTime() === normalized.getTime() && !isEventBlacklisted(e.title, e.start, blacklistedEventsCache)
      );

      // Durée totale en heures
      const totalHours = events.reduce((acc, ev) => {
        const start = new Date(ev.start);
        const end = new Date(ev.end);
        const diff = (end - start) / (1000 * 60 * 60);
        return acc + diff;
      }, 0);

      const hasCourse = totalHours > 0;
      const isSelected =
        normalized.getTime() ===
        StyleFormatter.normalizeDate(eventDays[currentDayIndex] ?? new Date()).getTime();

      // Classes de base
      td.classList.toggle("disabled", !inCurrentMonth || !hasCourse);
      td.classList.toggle("active", inCurrentMonth && hasCourse);
      td.classList.toggle("selected", isSelected);

      // 🔵 Gestion de la couleur dynamique (de 0h à 8h)
    if (inCurrentMonth && hasCourse && !isSelected) {
    const ratio = Math.min(totalHours / 8, 1);

    // Palette adoucie : clair → moyen pastel
    const base = { r: 219, g: 234, b: 254 }; // #dbeafe (4h)
    const dark = { r: 147, g: 197, b: 253 }; // #93c5fd (8h, doux)
    const light = { r: 240, g: 248, b: 255 }; // #f0f8ff (1h ou moins, très léger)

    // On fait d’abord tendre vers "base" à mi-parcours, puis vers "dark"
    let r, g, b;
    if (ratio < 0.5) {
        const t = ratio * 2; // 0 → 0.5 => interpolation light → base
        r = Math.round(light.r + (base.r - light.r) * t);
        g = Math.round(light.g + (base.g - light.g) * t);
        b = Math.round(light.b + (base.b - light.b) * t);
    } else {
        const t = (ratio - 0.5) * 2; // 0.5 → 1 => interpolation base → dark
        r = Math.round(base.r + (dark.r - base.r) * t);
        g = Math.round(base.g + (dark.g - base.g) * t);
        b = Math.round(base.b + (dark.b - base.b) * t);
    }

    td.style.backgroundColor = `rgb(${r}, ${g}, ${b})`;
    }

      // Clic sur jour actif
      if (inCurrentMonth && hasCourse) {
        td.addEventListener("click", (e) => {
          e.stopPropagation();
          const idx = eventDays.findIndex(d => d.getTime() === normalized.getTime());
          if (idx !== -1) {
            renderDayView(idx);
            toggleDatepicker(false);
          }
        });
      }

      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  }

  // === Navigation mois précédent/suivant ===
  prevBtn.onclick = (e) => {
    e.stopPropagation();
    if (month === 0) {
      datepickerState.currentMonth = 11;
      datepickerState.currentYear--;
    } else {
      datepickerState.currentMonth--;
    }
    buildDatepicker();
  };

  nextBtn.onclick = (e) => {
    e.stopPropagation();
    if (month === 11) {
      datepickerState.currentMonth = 0;
      datepickerState.currentYear++;
    } else {
      datepickerState.currentMonth++;
    }
    buildDatepicker();
  };
}

// === Scroll pour passer de jour en jour === //

let startX = 0;
let startY = 0;
let isScrolling = false;
const swipeThreshold = 50; // distance minimale pour déclencher un swipe

document.addEventListener('touchstart', (e) => {
    // Ne rien faire si #week-view n'est pas actif
    const weekView = document.querySelector('#week-view');
    if (!weekView || !weekView.classList.contains('active-view')) return;

    const touch = e.touches[0];
    startX = touch.pageX;
    startY = touch.pageY;
    isScrolling = false;
}, false);

document.addEventListener('touchmove', (e) => {
    const weekView = document.querySelector('#week-view');
    if (!weekView || !weekView.classList.contains('active-view')) return;

    const touch = e.touches[0];
    const deltaX = touch.pageX - startX;
    const deltaY = touch.pageY - startY;

    // si le déplacement horizontal est plus important que le vertical → c’est un swipe horizontal
    if (Math.abs(deltaX) > Math.abs(deltaY)) {
        isScrolling = true;
    }
}, false);

document.addEventListener('touchend', (e) => {
    const weekView = document.querySelector('#week-view');
    if (!weekView || !weekView.classList.contains('active-view')) return;

    const touch = e.changedTouches[0];
    const deltaX = touch.pageX - startX;

    if (!isScrolling) return; // pas un swipe horizontal

    // Swipe vers la droite → "jour précédent"
    if (deltaX > swipeThreshold) {
        if (typeof currentDayIndex !== 'undefined' && typeof renderDayView === 'function') {
            if (currentDayIndex > 0) {
                renderDayView(currentDayIndex - 1);
            }
        }
    }
    // Swipe vers la gauche → "jour suivant"
    else if (deltaX < -swipeThreshold) {
        if (typeof currentDayIndex !== 'undefined' && typeof renderDayView === 'function') {
            if (currentDayIndex < eventDays.length - 1) {
                renderDayView(currentDayIndex + 1);
            }
        }
    }

    startX = 0;
    startY = 0;
    isScrolling = false;
}, false);

/* --- Ajouter des événements personnalisés --- */

// Récupérer la liste des événements créés avec objets Date()
async function getAddedEvents() {
    let addedEventsTableau = await StorageManager.getItemAsync("added-events");
    
    try {
        addedEventsTableau = addedEventsTableau ? JSON.parse(addedEventsTableau) : [];
        
        // Parcourir chaque événement pour convertir start et end en objets Date
        addedEventsTableau = addedEventsTableau.map(event => {
            return {
                ...event,
                start: new Date(event.start), // Conversion de start en objet Date
                end: new Date(event.end)      // Conversion de end en objet Date
            };
        });
    } catch (e) {
        addedEventsTableau = [];
    }
    
    return addedEventsTableau;
}

document.getElementById('add-event-form').addEventListener('submit', async function(event) {
    event.preventDefault(); // Empêche le rechargement de la page lors de la soumission du formulaire

    // Récupérer les valeurs des champs du formulaire
    const title = document.getElementById('event-name').value;
    const location = document.getElementById('event-location').value;
    const start = document.getElementById('start-time').value;
    const end = document.getElementById('end-time').value;
    const isPeriodic = document.getElementById('recurring').checked;

    const day = eventDays[currentDayIndex];

    // Validation des dates
    const startDate = new Date(day);
    const endDate = new Date(day);

    // On récupère heures et minutes depuis les inputs
    const [startHour, startMin] = start.split(':').map(Number);
    const [endHour, endMin] = end.split(':').map(Number);

    // On injecte l’heure/minute dans les objets Date
    startDate.setHours(startHour, startMin, 0, 0);
    endDate.setHours(endHour, endMin, 0, 0);

    // Vérification que la date de fin est après la date de début
    if (endDate <= startDate) {
        alert("La date de fin doit être après la date de début.");
        return; // Arrête l'exécution si la validation échoue
    }

    // Vérification que les deux dates sont sur le même jour (en comparant uniquement la date, pas l'heure)
    const startDay = startDate.toISOString().split('T')[0]; // Extrait la date sans l'heure
    const endDay = endDate.toISOString().split('T')[0]; // Extrait la date sans l'heure

    if (startDay !== endDay) {
        alert("Les deux dates doivent être sur le même jour.");
        return; // Arrête l'exécution si la validation échoue
    }

    // Créer l'objet événement
    const newEvent = {
        title,
        location,
        notes: "",
        start: startDate,
        end: endDate,
        isPeriodic
    };

    // Récupérer la liste des événements stockés
    let addedEventsTableau = await StorageManager.getItemAsync("added-events");
    try {
        addedEventsTableau = addedEventsTableau ? JSON.parse(addedEventsTableau) : [];
    } catch (e) {
        addedEventsTableau = [];
    }

    // Ajouter le nouvel événement à la liste
    addedEventsTableau.push(newEvent);

    console.log(addedEventsTableau);

    // Sauvegarder la liste mise à jour dans le stockage local
    await StorageManager.setItem("added-events", JSON.stringify(addedEventsTableau));
    await loadICS();
    await renderDayView(currentDayIndex);

    // Réinitialiser le formulaire et fermer la vue
    toggleView([], ["add-event-modal"]);
    document.getElementById('add-event-form').reset();

    showToast("✅ Evénement ajouté");
});

// binder les évents supprimer event
function deleteEventEvents() {
    document.querySelectorAll('#week-view .event').forEach(eventDiv => {
        const delEventBtn = eventDiv.querySelector('.delete-event');

        if (delEventBtn) {
            delEventBtn.addEventListener('click', (e) => {
                e.stopPropagation(); // évite les effets de bord si d'autres événements sont liés à l'event
                deleteEvent(eventDiv).then(() => {
                    loadICS();
                });
            });
        }
    });
}

async function deleteEvent(eventDiv) {
    const courseName = eventDiv.dataset.courseName;
    const courseDate = eventDiv.dataset.courseStart;
    const courseDateObj = new Date(courseDate);

    // Récupérer la liste des événements stockés
    let addedEventsTableau = await getAddedEvents();

    // Filtrer la liste des événements pour supprimer celui correspondant au nom et à la date
    const updatedEvents = addedEventsTableau.filter(event => {
        return !(event.title === courseName && event.start.getTime() === courseDateObj.getTime());
    });

    // Sauvegarder la liste mise à jour dans le stockage local
    await StorageManager.setItem("added-events", JSON.stringify(updatedEvents));
    await loadICS();
    await renderDayView(currentDayIndex);

    // Afficher un toast pour notifier l'utilisateur
    showToast("✅ Evénement retiré");
}

// MAILS //

const ZIMBRA_ADDRESS = (typeof cordova !== "undefined" && cordova.platformId === "browser") ? "http://localhost:3000/zimbra_proxy" : "https://partage.bordeaux-inp.fr/service/soap";  
  
// --- Récupérer le token depuis SecureStorage ---
async function getStoredToken() {
  return new Promise((resolve, reject) => {
    SecureStorageManager.getItem("zimbraToken", (value) => {
      if (value) {
        try {
          let cleanToken = JSON.parse(value); 
          cleanToken = cleanToken.replace(/^\"|\"$/g, '');
          resolve(cleanToken);
        } catch (err) {
          reject(new Error("Erreur de parsing du token"));
        }
      } else {
        reject(new Error("Token non trouvé"));
      }
    });
  });
}

// --- Stocker un token dans SecureStorage ---
async function storeToken(token) {
    SecureStorageManager.setItem("zimbraToken", token);
}

// --- Vérifier si le token est valide ---
async function isTokenValid(token) {
    try {
        const inboxId = await getInboxId(token);
        return inboxId ? true : false;
    } catch (error) {
        console.error("Token invalide ou requête échouée :", error);
        return false;
    }
}

  // --- Récupération du token Zimbra ---
  async function getZimbraToken() {
    const soapBody = `<?xml version="1.0" encoding="UTF-8"?>
    <soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
      <soap:Header/>
      <soap:Body>
        <AuthRequest xmlns="urn:zimbraAccount">
          <account by="name">${LOGIN}</account>
          <password>${PASSWORD}</password>
        </AuthRequest>
      </soap:Body>
    </soap:Envelope>`;

    cordova.plugin.http.clearCookies(); // supprimer les moyens d'auth encore en cache

    const response = await RequestsManager.httpPost(ZIMBRA_ADDRESS, soapBody, {
        "Content-Type": "text/xml; charset=utf-8",
    });

    const text = await response.text();
    const match = text.match(/<authToken>([^<]+)<\/authToken>/);
    if (!match) throw new Error("Impossible d'extraire le token : " + text);
    return match[1];
  }

  // --- Récupérer l'ID de la boîte Inbox ---
  async function getInboxId(token) {
    const soapFolder = `<?xml version="1.0" encoding="UTF-8"?>
    <soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
      <soap:Header>
        <context xmlns="urn:zimbra">
          <authToken>${token}</authToken>
        </context>
      </soap:Header>
      <soap:Body>
        <GetFolderRequest xmlns="urn:zimbraMail">
          <folder l="1"/>
        </GetFolderRequest>
      </soap:Body>
    </soap:Envelope>`;

    const response = await RequestsManager.httpPost(ZIMBRA_ADDRESS, soapFolder, {
        "Content-Type": "text/xml; charset=utf-8",
    });

    const xml = await response.text();
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xml, "text/xml");
    const ns = "urn:zimbraMail";

    // Chercher le folder nommé "Inbox"
    const folders = xmlDoc.getElementsByTagNameNS(ns, "folder");
    for (const folder of folders) {
      if (folder.getAttribute("name") === "Inbox") {
        return folder.getAttribute("id");
      }
    }
    throw new Error("Impossible de trouver Inbox : " + xml);
  }

  // --- Récupérer les mails non lus dans Inbox ---
  async function getUnreadEmailsInInbox(token, inboxId) {
    const soapSearch = `<?xml version="1.0" encoding="UTF-8"?>
    <soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
      <soap:Header>
        <context xmlns="urn:zimbra">
          <authToken>${token}</authToken>
        </context>
      </soap:Header>
      <soap:Body>
        <SearchRequest xmlns="urn:zimbraMail" types="message" sortBy="dateDesc">
          <query>is:unread</query>
          <l>${inboxId}</l>
          <limit>50</limit>
        </SearchRequest>
      </soap:Body>
    </soap:Envelope>`;

    const response = await RequestsManager.httpPost(ZIMBRA_ADDRESS, soapSearch, {
        "Content-Type": "text/xml; charset=utf-8",
    });

    const xml = await response.text();

    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xml, "text/xml");
    const ns = "urn:zimbraMail";

    const messages = Array.from(xmlDoc.getElementsByTagNameNS(ns, "m")).map(m => {
      const su = m.getElementsByTagNameNS(ns, "su")[0]?.textContent || "";
      const e = m.getElementsByTagNameNS(ns, "e")[0];
      const from = e?.getAttribute("p") || "";
      return { id: m.getAttribute("id"), subject: su, from };
    });

    return messages;
  }

async function refreshInbox(){
  // --- Execution ---
  try {
    // Étape 1 : Essayer de récupérer les login et password depuis SecureStorage
    let login = null;
    let password = null;

    try {
      login = await new Promise((resolve, reject) => {
        SecureStorageManager.getItem("zimbraLogin", (value) => {
          if (value) resolve(value);
          else reject("Login non trouvé");
        });
      });
      document.getElementById("zimbra-login").value = login;
    } catch (error) {
      console.log("Aucun login trouvé dans SecureStorage");
    }

    try {
      password = await new Promise((resolve, reject) => {
        SecureStorageManager.getItem("zimbraPassword", (value) => {
          if (value) resolve(value);
          else reject("Password non trouvé");
        });
      });
      document.getElementById("zimbra-password").value = password;
    } catch (error) {
      console.log("Aucun password trouvé dans SecureStorage");
    }

    // Si les deux éléments sont trouvés, assigner les valeurs à LOGIN et PASSWORD
    if (login && password) {
      LOGIN = login;
      PASSWORD = password;
    } else {
      console.log("Login ou Password manquant, arrêt du processus.");
      //print_inbox_error("Erreur d'authentification");
      return; // Ne rien faire si l'un des deux est manquant
    }

    // Étape 2 : Essayer de récupérer un token existant depuis SecureStorage
    let token = null;
    try {
      token = await getStoredToken();
    } catch (error) {
      console.log("Aucun token trouvé dans SecureStorage");
    }

    console.log(token)

    // Étape 3 : Vérifier la validité du token ou en obtenir un nouveau si nécessaire
    if (!token || !(await isTokenValid(token))) {
      console.log("Token invalide ou expiré. Récupération d'un nouveau token...");
      token = await getZimbraToken();
      await storeToken(token); // Stocker le nouveau token dans SecureStorage
    }

    if (!token){
        print_inbox_error("Erreur d'authentification");
        return;
    }

    // Étape 4 : Utiliser le token pour récupérer les mails non lus
    const inboxId = await getInboxId(token);
    const unreadMails = await getUnreadEmailsInInbox(token, inboxId);
    console.log("📧 Mails non lus dans Inbox :", unreadMails);

    // Affichage dans l'interface
    const container = document.querySelector("#unread-inbox-container");
    const countDiv = document.querySelector("#unread-mails-count");

    if (container) {
        container.innerHTML = ""; // vider avant

        if (countDiv) {
            countDiv.textContent = unreadMails.length;
        }

        if (unreadMails.length === 0) {
            container.insertAdjacentHTML(
                "beforeend",
                `<p class="centered">Aucun mail pour l'instant.</p>`
            );
        } else {
            unreadMails.forEach(mail => {
                container.insertAdjacentHTML(
                    "beforeend",
                    `<p class="one-mail"><span class="bold">${mail.subject}</span> - ${mail.from}</p>`
                );
            });
        }
    }

  } catch (err) {
    console.error("Erreur générale :", err);
    print_inbox_error("Impossible de charger les mails");
  }

}


document.getElementById('config-mail-form').addEventListener('submit', async function(event) {
    event.preventDefault(); // Empêche le rechargement de la page lors de la soumission du formulaire

    // Récupérer les valeurs des champs du formulaire
    const login = document.getElementById('zimbra-login').value;
    const password = document.getElementById('zimbra-password').value;

    if (!login || !password) {
        alert("Veuillez renseigner une adresse mail et un mot de passe valides.");
        return;
    }

    // Sauvegarder la liste mise à jour dans le stockage local
    await SecureStorageManager.setItem("zimbraLogin", login);
    await SecureStorageManager.setItem("zimbraPassword", password);
    LOGIN = login;
    PASSWORD = password;
    cordova.plugin.http.clearCookies(); // supprimer les moyens d'auth encore en cache

    // Réinitialiser le formulaire et fermer la vue
    toggleView([], ["config-mail-modal"]);
    resetConfigMailForm();

    refreshInbox();
    showToast("✅ Paramètres enregistrés.");
});

/** Reset login et password affichage */
async function resetConfigMailForm() {
    document.getElementById('config-mail-form').reset();
    document.getElementById("zimbra-login").value = LOGIN;
    document.getElementById("zimbra-password").value = PASSWORD;
}

// affiche message erreur dans section "inbox"
function print_inbox_error(message){
    document.getElementById("unread-inbox-container").innerHTML = `<div class="error-message">⚠️ ${message}</div>`;
}

// const getValue = key => new Promise(resolve =>
//     SecureStorageManager.getItem(key, value => resolve(value || ""))
// );
//await getValue("zimbraLogin");

