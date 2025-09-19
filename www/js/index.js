document.addEventListener('deviceready', onDeviceReady, false);

// const ICS_URL = "https://adeapp.bordeaux-inp.fr/jsp/custom/modules/plannings/anonymous_cal.jsp?resources=3972&projectId=1&calType=ical&firstDate=2025-08-18&lastDate=2026-08-23&displayConfigId=71";
const ICS_URL = "http://localhost:3000/ics"; // ton ICS

let eventsCache = [];

function toggleView(showId, hideId) {
    document.getElementById(showId).style.display = "block";
    document.getElementById(hideId).style.display = "none";
}

function onDeviceReady() {
    console.log("deviceready");
    setupUI();
    loadICS().then(() => renderNextCourses());


    document.getElementById("toggle-week-view").addEventListener("click", () => {
        toggleView("week-view", "home-view");

        if (eventDays.length > 0) {
            const idx = findNextEventDayIndex();
            renderDayView(idx);
        }
    });

    document.getElementById("toggle-home-view").addEventListener("click", () => {
        toggleView("home-view", "week-view");
    });

    document.getElementById("change-address-btn").addEventListener("click", function () {
        document.getElementById("change-address-modal").style.display = "flex";
    });

    document.getElementById("close-address-modal-btn").addEventListener("click", function () {
        document.getElementById("change-address-modal").style.display = "none";
    });
}

// écoute le bouton refresh
function setupUI() {
    const refreshBtn = document.getElementById("refresh");
    if (refreshBtn) {
        refreshBtn.addEventListener("click", async () => {
            await loadICS();
            renderNextCourses();
        });
    }
}

// get request
function httpGet(url) {
    return new Promise((resolve, reject) => {
        cordova.plugin.http.sendRequest(
            url,
            { method: "get" },
            (response) => resolve(response),
            (error) => reject(error)
        );
    });
}

async function fetchICS() {
    try {
        const response = await httpGet(ICS_URL); // response.data contient le texte ICS
        return response.data; // <- renvoyer le texte directement
    } catch (err) {
        console.error("❌ Erreur:", err);
        alert("Erreur chargement ICS: " + err.error || err);
        return ""; // ou throw err si tu veux propager l'erreur
    }
}


// helper : parse une date iCal (ex: 20250916T140000Z ou 20250916T140000 ou 20250916)
function parseICalDate(value) {
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
function parseICS(icsText) {
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

        const start = startRaw ? parseICalDate(startRaw) : null;
        const end = endRaw ? parseICalDate(endRaw) : null;

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

// charge et parse ICS
// async function loadICS() {
//     try {
//         const icsText = await fetchICS();
//         eventsCache = parseICS(icsText);
//         eventsCache.sort((a, b) => a.start - b.start); // tri par date
//         console.log("Events chargés:", eventsCache);
//     } catch (err) {
//         console.error("Erreur ICS:", err);
//     }
// }

// Palette : 12 couleurs distinctes en HSL (360° / 12 = 30° entre chaque)
function stringToColor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
        hash = hash & hash; // 32bit int
    }
    const index = Math.abs(hash) % 12; // 12 couleurs
    const hue = index * 30; // 0,30,60,...330
    return `hsl(${hue}, 70%, 50%)`;
}

// formate une date en "14h30"
function formatHeure(date) {
    return date
        .toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
        .replace(":", "h");
}

// affiche les 3 prochains cours
function renderNextCourses() {
    const container = document.getElementById("next-events");
    if (!container) return;

    container.innerHTML = `<p class="next-events-title">3 prochains cours</p>`;

    const now = new Date();
    const upcoming = eventsCache.filter(e => e.end > now).slice(0, 3);
    console.log("Prochains cours:", upcoming);

    // groupement par jour
    let currentDay = "";
    let dayContainer = null;

    for (let event of upcoming) {
        const dayLabel = event.start.toLocaleDateString("fr-FR", {
            weekday: "short",
            day: "numeric",
            month: "short"
        });

        if (dayLabel !== currentDay) {
            currentDay = dayLabel;
            dayContainer = document.createElement("div");
            dayContainer.className = "day-events";
            dayContainer.innerHTML = `<p class="day-title">${dayLabel}</p>`;
            container.appendChild(dayContainer);
        }

        // const startTime = event.start.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
        // const endTime = event.end.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
        const startTime = formatHeure(event.start);
        const endTime = formatHeure(event.end);

        const color = stringToColor(event.title);

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
}

// Mes grands morts, gestion de la vue "week-view"
let eventDays = []; // liste des jours (Date sans heure)
let currentDayIndex = 0;

// utilitaire pour normaliser une date à minuit
function normalizeDate(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// construit la liste des jours uniques avec événements
function buildEventDays() {
    const dayMap = new Map();
    for (let e of eventsCache) {
        const day = normalizeDate(e.start).getTime();
        if (!dayMap.has(day)) {
            dayMap.set(day, normalizeDate(e.start));
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
    navLabel.textContent = day.toLocaleDateString("fr-FR", {
        weekday: "short",
        day: "numeric",
        month: "long"
    });

    // événements de ce jour
    const container = document.getElementById("week-events-container");
    container.innerHTML = "";

    const events = eventsCache.filter(e =>
        normalizeDate(e.start).getTime() === day.getTime()
    );

    for (let ev of events) {
        const startTime = formatHeure(ev.start);

        const endTime = formatHeure(ev.end);

        const eventHeight = (ev.end - ev.start) / (1000 * 60 * 60);

        const color = stringToColor(ev.title);

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

// après chargement ICS → construire la liste des jours et initialiser la vue
async function loadICS() {
    try {
        const icsText = await fetchICS();
        eventsCache = parseICS(icsText);
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

// trouve l'index du jour du prochain cours à venir
function findNextEventDayIndex() {
    const now = new Date();
    for (let i = 0; i < eventDays.length; i++) {
        const day = eventDays[i];
        const hasFutureEvent = eventsCache.some(e =>
            normalizeDate(e.start).getTime() === day.getTime() && e.end > now
        );
        if (hasFutureEvent) {
            return i;
        }
    }
    // fallback: si rien trouvé (par ex. tous passés) → dernier jour dispo
    return eventDays.length - 1;
}
