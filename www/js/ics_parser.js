/**
 * Parser basique de fichiers ICS (iCalendar) pour extraire les événements avec leurs dates.
 */
export class ICSParser {

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