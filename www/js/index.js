document.addEventListener('deviceready', onDeviceReady, false);

// let ICS_URL = "https://adeapp.bordeaux-inp.fr/jsp/custom/modules/plannings/anonymous_cal.jsp?resources=3972&projectId=1&calType=ical&firstDate=2025-08-18&lastDate=2026-08-23&displayConfigId=71";
let ICS_URL = "http://localhost:3000/ics"; // ton ICS

let eventsCache = [];

// accès au stockage de variables en interne
class StorageManager {
    static setItem(key, value) {
        if (window.NativeStorage) {
            NativeStorage.setItem(key, value,
                () => console.log(`[NativeStorage] ${key} enregistré.`),
                err => console.error(`[NativeStorage] Erreur setItem(${key}) :`, err)
            );
        } else {
            localStorage.setItem(key, value);
            console.log(`[localStorage] ${key} enregistré.`);
        }
    }

    static getItem(key, callback) {
        if (window.NativeStorage) {
            NativeStorage.getItem(key,
                value => callback(value),
                err => {
                    console.error(`[NativeStorage] Erreur getItem(${key}) :`, err);
                    callback(null);
                }
            );
        } else {
            const val = localStorage.getItem(key);
            callback(val);
        }
    }

    static removeItem(key) {
        if (window.NativeStorage) {
            NativeStorage.remove(key,
                () => console.log(`[NativeStorage] ${key} supprimé.`),
                err => console.error(`[NativeStorage] Erreur removeItem(${key}) :`, err)
            );
        } else {
            localStorage.removeItem(key);
            console.log(`[localStorage] ${key} supprimé.`);
        }
    }
}

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
        // Natif uniquement
        console.log("on rentre dans le load");
        if (this.isNativeFileSystemAvailable()) {
            console.log("on considère natif");

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

                return result;
            } catch (err) {
                console.warn("⚠️ Fichier ICS introuvable ou erreur lecture :", err);
                // => fallback : fetch depuis l’URL
            }
        } else {
            console.warn("💡 Mode browser ou plugin fichier indisponible. Téléchargement direct.");
        }

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


class RequestsManager {
    // get request
    static httpGet(url) {
        return new Promise((resolve, reject) => {
            cordova.plugin.http.sendRequest(
                url,
                { method: "get" },
                (response) => resolve(response),
                (error) => reject(error)
            );
        });
    }
}

class ICSParser {

    // helper : parse une date iCal (ex: 20250916T140000Z ou 20250916T140000 ou 20250916)
    static parseICalDate(value) {
        if (!value) return null;
        // match : YYYY MM DD [T HH MM SS [Z]]
        const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/i);
        if (!m) return null;

        const year = parseInt(m[1], 10);
        const month = parseInt(m[2], 10) - 1; // month index 0-11
        const day = parseInt(m[3], 10);
        const hour = m[4] ? parseInt(m[4], 10) : 0;
        const minute = m[5] ? parseInt(m[5], 10) : 0;
        const second = m[6] ? parseInt(m[6], 10) : 0;
        const hasZ = !!m[7];

        if (hasZ) {
            // temps exprimé en UTC -> utiliser Date.UTC pour éviter les parsers foireux
            return new Date(Date.UTC(year, month, day, hour, minute, second));
        } else {
            // pas de Z -> on considère temps local (si TZID était présent on pourrait améliorer)
            return new Date(year, month, day, hour, minute, second);
        }
    }

    // parse ICS : renvoie tableau d'événements avec start/end en Date objets
    static parseICS(icsText) {
        // déplier les lignes (RFC 5545 : les lignes peuvent être "folded")
        const unfolded = icsText.replace(/\r?\n[ \t]/g, "");

        // découper par VEVENT
        const vevents = unfolded.split(/BEGIN:VEVENT/).slice(1);
        const events = [];

        for (let vevent of vevents) {
            // fonction utilitaire pour récupérer la valeur d'une propriété (gère aussi les params après ;)
            const getProp = (prop) => {
                const re = new RegExp(prop + '(?:;[^:]*)?:(.+)', 'i');
                const m = vevent.match(re);
                if (!m) return null;
                // on prend seulement jusqu'au premier retour à la ligne (s'il y en a)
                return m[1].split(/\r?\n/)[0].trim();
            };

            const title = getProp('SUMMARY') || '';
            const location = getProp('LOCATION') || '';
            const description = getProp('DESCRIPTION') || '';

            const startRaw = getProp('DTSTART'); // ex: 20250916T140000Z OR 20250916T140000
            const endRaw = getProp('DTEND');

            const start = startRaw ? ICSParser.parseICalDate(startRaw) : null;
            const end = endRaw ? ICSParser.parseICalDate(endRaw) : null;

            // si on veut, on peut aussi récupérer TZID depuis la ligne (extraction basique)
            // const tzMatch = vevent.match(/DTSTART;(.*?TZID=.*?):/i);

            if (start && end) {
                events.push({
                    title,
                    location,
                    notes: description.replace(/\\n/g, '\n'),
                    start,
                    end
                });
            }
        }

        return events;
    }

}

class StyleFormatter {
    // formate une date en "14h30"
    static formatHeure(date) {
        return date
            .toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
            .replace(":", "h");
    }

    static formatJour(date, month_format = "short") {
        return date.toLocaleDateString("fr-FR", {
            weekday: "short",
            day: "numeric",
            month: month_format
        });
    }

    // formate une durée ISO en "5mn", "2h" ou "3j"    
    static formatDuree(isoDateStr) {
        const then = new Date(isoDateStr);
        const now = new Date();

        const diffMs = now - then;
        const diffMinutes = Math.floor(diffMs / 60000);

        if (diffMinutes < 60) {
            return `${diffMinutes}mn`;
        } else if (diffMinutes < 1440) {
            const hours = Math.floor(diffMinutes / 60);
            return `${hours}h`;
        } else {
            const days = Math.floor(diffMinutes / 1440);
            return `${days}j`;
        }
    }

    // normaliser une date à minuit
    static normalizeDate(d) {
        return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }

    // Palette : 12 couleurs distinctes en HSL (360° / 12 = 30° entre chaque)
    static stringToColor(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = str.charCodeAt(i) + ((hash << 5) - hash);
            hash = hash & hash; // 32bit int
        }
        const index = Math.abs(hash) % 12; // 12 couleurs
        const hue = index * 30; // 0,30,60,...330
        return `hsl(${hue}, 70%, 50%)`;
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

// afficjer le popup de changement du lien
function showChangeAddressModal(can_close = true) {
    toggleView(["change-address-modal"], [], "flex");
    document.getElementById("close-address-modal-btn").style.display = can_close ? "block" : "none";
}


// binder les boutons / événements au clic
function initEvents() {
    document.getElementById("toggle-week-view").addEventListener("click", () => {
        toggleView(["week-view"], ["home-view"]);

        if (eventDays.length > 0) {
            const idx = findNextEventDayIndex();
            renderDayView(idx);
        }
    });

    document.getElementById("toggle-home-view").addEventListener("click", () => {
        toggleView(["home-view"], ["week-view"]);
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
}

function refreshCalendar() {
    fetchICS().then(() => loadICS()).then(() => renderNextCourses());
}

function onDeviceReady() {
    // setupUI();
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

// récupère le fichier ICS depuis le serveur et le sauvegarde en local
async function fetchICS() {
    try {
        const response = await RequestsManager.httpGet(ICS_URL); // response.data contient le texte ICS
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

        console.log("Events chargés:", eventsCache);
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
    console.log("Prochains cours:", upcoming);

    // groupement par jour
    let currentDay = "";
    let dayContainer = null;

    for (let event of upcoming) {
        const dayLabel = StyleFormatter.formatJour(event.start);

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
    console.log("Jours avec événements:", eventDays);
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

        const eventHeight = (ev.end - ev.start) / (1000 * 60 * 60);

        const color = StyleFormatter.stringToColor(ev.title);

        const div = document.createElement("div");
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
                </div>
            </div>
        `;
        container.appendChild(div);
    }

    if (events.length === 0) {
        container.innerHTML = "<p>Aucun événement ce jour</p>";
    }
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
