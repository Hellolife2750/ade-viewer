import { StorageManager } from './storage_manager.js';
import { RequestsManager } from './requests_manager.js';
import { ICSParser } from './ics_parser.js';
import { StyleFormatter } from './style_formatter.js';

document.addEventListener('deviceready', onDeviceReady, false);

// let ICS_URL = "https://adeapp.bordeaux-inp.fr/jsp/custom/modules/plannings/anonymous_cal.jsp?resources=3972&projectId=1&calType=ical&firstDate=2025-08-18&lastDate=2026-08-23&displayConfigId=71";
// let ICS_URL = "http://localhost:3000/ics"; // ton ICS
let ICS_URL = "https://drive.google.com/uc?export=download&id=1QC-h3XB5YKJP-AsqwXB-Hr9ybCnFjVBk"; // debug

let DEBUG = false;

let eventsCache = [];

// enregistrer/charger un fichier ICS dans le stockage local
class FileManager {
    static filename = "planning.ics";

    static isNativeFileSystemAvailable() {
        const isCordova = typeof cordova !== "undefined";
        const hasFile = isCordova && typeof cordova.file !== "undefined";
        const hasFS = typeof window.resolveLocalFileSystemURL !== "undefined";

        // 🔑 Vérifier si on n'est PAS en mode "cordova run browser"
        const isBrowserPlatform = isCordova && cordova.platformId === "browser";

        return hasFile && hasFS && !isBrowserPlatform;
    }

    static async saveIcsFile(text) {
        if (!this.isNativeFileSystemAvailable()) {
            console.warn("💡 Native file system non disponible (browser mode). Sauvegarde ignorée.");
            return;
        }

        return new Promise((resolve, reject) => {
            window.resolveLocalFileSystemURL(cordova.file.dataDirectory, function (dirEntry) {
                dirEntry.getFile(FileManager.filename, { create: true, exclusive: false }, function (fileEntry) {
                    fileEntry.createWriter(function (fileWriter) {
                        fileWriter.onwriteend = function () {
                            console.log("✅ Fichier ICS enregistré localement !");
                            resolve(true);
                        };

                        fileWriter.onerror = function (e) {
                            console.error("❌ Erreur d'écriture :", e);
                            reject(e);
                        };

                        const blob = new Blob([text], { type: "text/calendar" });
                        fileWriter.write(blob);
                    }, reject);
                }, reject);
            }, reject);
        });
    }

    static async loadIcsFile() {
        showLoader(true);

        // Natif uniquement
        if (this.isNativeFileSystemAvailable()) {

            try {
                const result = await new Promise((resolve, reject) => {
                    window.resolveLocalFileSystemURL(
                        cordova.file.dataDirectory + FileManager.filename,
                        function (fileEntry) {
                            fileEntry.file(function (file) {
                                const reader = new FileReader();

                                reader.onloadend = function () {
                                    console.log("✅ Fichier ICS lu depuis le stockage natif !");
                                    resolve(this.result);
                                };

                                reader.onerror = function (e) {
                                    reject(e);
                                };

                                reader.readAsText(file);
                            }, reject);
                        },
                        reject
                    );
                });

                showLoader(false);

                return result;
            } catch (err) {
                console.warn("⚠️ Fichier ICS introuvable ou erreur lecture :", err);
                // => fallback : fetch depuis l’URL
            }
        } else {
            console.warn("💡 Mode browser ou plugin fichier indisponible. Téléchargement direct.");
        }

        showLoader(false);

        return await fetchICS();
    }

    static async deleteIcsFile() {
        if (!this.isNativeFileSystemAvailable()) {
            console.warn("💡 Pas de système de fichier (browser). Rien à supprimer.");
            return;
        }

        return new Promise((resolve, reject) => {
            window.resolveLocalFileSystemURL(cordova.file.dataDirectory, function (dirEntry) {
                dirEntry.getFile(FileManager.filename, { create: false }, function (fileEntry) {
                    fileEntry.remove(function () {
                        console.log("🗑️ Fichier supprimé !");
                        resolve();
                    }, reject);
                }, reject);
            }, reject);
        });
    }
}

function showLoader(show) {
    console.log("showLoader", show);
    const loaderContainer = document.getElementById("loader-container");
    if (show) {
        loaderContainer.style.display = "flex";
        document.body.style.overflow = "hidden"; // empêche le scroll
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
}

// afficjer le popup de changement du lien
function showChangeAddressModal(can_close = true) {
    toggleView(["change-address-modal"], [], "flex");
    document.getElementById("close-address-modal-btn").style.display = can_close ? "block" : "none";
}


// binder les boutons / événements au clic
function initEvents() {
    document.getElementById("toggle-week-view").addEventListener("click", () => {
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

    document.getElementById("change-address-btn").addEventListener("click", function () {
        showChangeAddressModal();
    });

    document.getElementById("close-address-modal-btn").addEventListener("click", function () {
        toggleView([], ["change-address-modal"]);
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
        if (document.getElementById("home-view").classList.contains("active-view")) {
            renderNextCourses();
        }
    });
}

function refreshCalendar() {
    fetchICS().then(() => loadICS()).then(() => renderNextCourses());
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
    setupConsoleRedirect();
    /*console.log = (msg) => {
        logToFile(msg);
        window.console.log(msg);
    };*/

    initEvents();

    StorageManager.getItem("ics_url", function (value) {
        if (value === null) {
            showChangeAddressModal(false);
        } else {
            ICS_URL = value;
            document.getElementById("address-input").value = value;
            loadICS().then(() => renderNextCourses());
        }
    });

    fetchIcsJob();
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

// récupère le fichier ICS depuis le serveur et le sauvegarde en local
async function fetchICS() {
    try {
        const url = await getIcsUrl();
        const response = await RequestsManager.httpGet(url); // response.data contient le texte ICS
        await FileManager.saveIcsFile(response.data);
        StorageManager.setItem("last_update", new Date().toISOString());
        return response.data; // <- renvoyer le texte directement
    } catch (err) {
        console.error("❌ Erreur:", err);
        alert("Erreur chargement ICS: " + err.error || err);
        return ""; // ou throw err si tu veux propager l'erreur
    }
}

// après chargement ICS → construire la liste des jours et initialiser la vue
async function loadICS() {
    try {
        const icsText = await FileManager.loadIcsFile();  // await fetchICS();
        eventsCache = ICSParser.parseICS(icsText);
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
function renderNextCourses() {
    const container = document.getElementById("day-events-container");
    if (!container) return;

    console.log('renderNextCourses');
    container.innerHTML = ``;

    const now = new Date();
    const upcoming = eventsCache.filter(e => e.end > now).slice(0, 3);
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
        container.innerHTML += `<p>Aucun cours à venir</p>`;
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

    renderHomeworks();
}

// afficher les devoirs
async function renderHomeworks() {
    const container = document.getElementById("homeworks-container");
    if (!container) {
        console.error("❌ #homeworks-container introuvable dans le DOM !");
        return;
    }

    // reset du container avant de réinsérer
    container.innerHTML = "";

    // récupérer les devoirs
    let homeworks = await StorageManager.getItemAsync("homeworks");
    try {
        homeworks = homeworks ? JSON.parse(homeworks) : [];
    } catch (e) {
        console.warn("[renderHomeworks] homeworks corrompu, reset.");
        homeworks = [];
    }

    if (homeworks.length === 0) {
        container.insertAdjacentHTML("beforeend", `<p>Aucun devoir pour l'instant.</p>`);
        return;
    }

    // insertion des devoirs
    homeworks.forEach(hw => {
        const dateObj = new Date(hw.date);
        const html = `
        <div class="day-homeworks">
            <p class="day-title">Pour <span class="bold">${StyleFormatter.formatJourSpecial(dateObj)}</span></p>
            <div class="homework">
                <div class="header">
                    <div class="course-name">${hw.course}</div>
                    <div class="made ${hw.made ? "is-mad" : ""}">${hw.made ? "Fait" : "Non Fait"}</div>
                </div>
                <p class="homework-description">${hw.homework}</p>
                <div class="footer">
                    <label for="homework-${hw.id}-made">J'ai terminé</label>
                    <input class="classic-checkbox" type="checkbox" id="homework-${hw.id}-made" name="homework-${hw.id}-made" />
                </div>
            </div>
        </div>
        `;
        container.insertAdjacentHTML("beforeend", html);
    });
}


// Mes grands morts, gestion de la vue "week-view"
let eventDays = []; // liste des jours (Date sans heure)
let currentDayIndex = 0;


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
function renderDayView(index) {
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

    for (let ev of events) {
        const startTime = StyleFormatter.formatHeure(ev.start);

        const endTime = StyleFormatter.formatHeure(ev.end);

        const professorName = StyleFormatter.extractProfessor(ev.notes);

        let eventHeight = (ev.end - ev.start) / (1000 * 60 * 60);

        let color = StyleFormatter.stringToColor(ev.title);

        // événements sans lieu, généralement cours alternatifs
        if (ev.location === "") { color = "#888"; eventHeight = 0; }

        const div = document.createElement("div");
        div.setAttribute("data-course-name", ev.title);
        div.setAttribute("data-course-start", ev.start.toISOString());
        div.className = "event";
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
                    </div>
                </div>
            </div>
        `;
        container.appendChild(div);
    }

    if (events.length === 0) {
        container.innerHTML = "<p>Aucun événement ce jour</p>";
    }

    addHomeworkEvents();
}

// navigation jour précédent / suivant
function setupDayNavigation() {
    const prevBtn = document.getElementById("preview-day-btn");
    const nextBtn = document.getElementById("next-day-btn");

    prevBtn.addEventListener("click", () => {
        if (currentDayIndex > 0) {
            renderDayView(currentDayIndex - 1);
        }
    });

    nextBtn.addEventListener("click", () => {
        if (currentDayIndex < eventDays.length - 1) {
            renderDayView(currentDayIndex + 1);
        }
    });
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

// Fonction d’ajout de devoir
async function addHomeworkFromEvent(eventDiv) {
    const courseName = eventDiv.dataset.courseName;
    const courseDate = eventDiv.dataset.courseStart;

    const courseDateObj = new Date(courseDate);

    const homeworkText = prompt(`Ajouter un devoir pour ${courseName} le ${StyleFormatter.formatJour(courseDateObj)} :`);
    if (!homeworkText) return; // annulation ou texte vide

    // Récupérer la liste existante
    let homeworks = await StorageManager.getItemAsync("homeworks");
    try {
        homeworks = homeworks ? JSON.parse(homeworks) : [];
    } catch (e) {
        console.warn("[StorageManager] homeworks corrompu, reset.");
        homeworks = [];
    }

    // Créer le nouvel objet
    const newHomework = {
        id: generateUUID(),
        course: courseName,
        homework: homeworkText,
        made: false,
        date: courseDate
    };

    // Ajouter dans le tableau
    homeworks.push(newHomework);

    // Sauvegarder
    StorageManager.setItem("homeworks", JSON.stringify(homeworks));

    console.log("✅ Devoir ajouté :", newHomework);
}

function addHomeworkEvents() {
    document.querySelectorAll('#week-view .event').forEach(eventDiv => {
        let startX = 0;
        let currentX = 0;
        let dragging = false;

        function start(e) {
            dragging = true;
            startX = e.type.includes('mouse') ? e.pageX : e.touches[0].clientX;
            eventDiv.style.transition = 'none';
        }

        function move(e) {
            if (!dragging) return;
            currentX = e.type.includes('mouse') ? e.pageX : e.touches[0].clientX;
            let deltaX = currentX - startX;
            eventDiv.style.transform = `translateX(${deltaX}px)`;
        }

        function end() {
            if (!dragging) return;
            dragging = false;
            eventDiv.style.transition = 'transform 0.3s ease';

            let deltaX = currentX - startX;
            if (Math.abs(deltaX) > 80) {
                // action du swipe
                addHomeworkFromEvent(eventDiv).then(() => {
                    renderHomeworks();
                });
            }
            // reset position
            eventDiv.style.transform = 'translateX(0)';
        }

        // Events tactiles
        eventDiv.addEventListener('touchstart', start);
        eventDiv.addEventListener('touchmove', move);
        eventDiv.addEventListener('touchend', end);

        // Events souris
        eventDiv.addEventListener('mousedown', start);
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', end);
    });
}
