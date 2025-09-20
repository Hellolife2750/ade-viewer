/**
 * Classe utilitaire pour formater des dates, heures, durées, et générer des couleurs depuis une chaîne.
 */
export class StyleFormatter {
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