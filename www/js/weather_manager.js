export class WeatherManager {
    static apiKey = "6495cecbd5e2bccb40912b789586f196";
    static city = "Bordeaux,fr";

    // Dictionnaire pour mapper la condition 'main' à des icônes personnalisées
    static iconMapping = {
        "Clear": "clear.svg",        // Icône pour un ciel dégagé
        "Clouds": "cloudy.svg",      // Icône pour nuageux
        "Rain": "rainy.svg",          // Icône pour pluie
        "Drizzle": "cloudy.svg",    // Icône pour bruine
        "Thunderstorm": "rainy.svg", // Icône pour orage
        "Snow": "rainy.svg",          // Icône pour neige
        "Mist": "cloudy.svg",          // Icône pour brume
        // Ajoute d'autres mappages si nécessaire
    };

    /**
     * Récupère les prévisions météo pour une date et une heure approximative.
     * @param {Date} date - Objet Date pour lequel obtenir la météo.
     * @returns {Promise<{temperature: number, icon: string}|null>} - Un objet contenant la température arrondie et le nom de l'icône, ou `null` en cas d'erreur.
     */
    static async getWeather(date) {
        const url = `https://api.openweathermap.org/data/2.5/forecast?q=${this.city}&units=metric&appid=${this.apiKey}`;

        try {
            const response = await fetch(url);
            const data = await response.json();

            if (!data.list) {
                throw new Error("Format de données inattendu");
            }

            // Extraire le jour, mois, année, heure et minutes de la date donnée
            const targetDate = date.getDate(); // Jour
            const targetMonth = date.getMonth(); // Mois
            const targetYear = date.getFullYear(); // Année
            const targetHour = date.getHours(); // Heure
            const targetMinutes = date.getMinutes(); // Minutes

            // Initialiser une variable pour la prévision la plus proche
            let closestForecast = null;
            let closestTimeDiff = Infinity; // On utilise un écart de temps infini pour commencer

            // Parcourir toutes les prévisions horaires
            for (const forecast of data.list) {
                const forecastDate = new Date(forecast.dt * 1000); // Convertir timestamp UNIX en Date

                // Comparer l'année, le mois et le jour
                if (
                    forecastDate.getFullYear() === targetYear &&
                    forecastDate.getMonth() === targetMonth &&
                    forecastDate.getDate() === targetDate
                ) {
                    // Calculer la différence en minutes entre la prévision et l'heure demandée
                    const forecastTimeInMinutes = forecastDate.getHours() * 60 + forecastDate.getMinutes();
                    const targetTimeInMinutes = targetHour * 60 + targetMinutes;
                    const timeDiff = Math.abs(forecastTimeInMinutes - targetTimeInMinutes); // Différence absolue

                    // Si cette prévision est plus proche, on la garde
                    if (timeDiff < closestTimeDiff) {
                        closestTimeDiff = timeDiff;
                        closestForecast = forecast;
                    }
                }
            }

            if (!closestForecast) {
                console.warn("Aucune prévision trouvée pour cette date et heure.");
                return null;
            }

            // Extraire la température (arrondie à l'entier inférieur)
            const temperature = Math.round(closestForecast.main.temp);

            // Extraire la condition météo 'main' et obtenir le nom d'icône
            const condition = closestForecast.weather[0].main;
            const iconCode = closestForecast.weather[0].icon; // Code de l'icône
            // const icon = `https://openweathermap.org/img/wn/${iconCode}.png`; // URL de l'icône

            // Optionnellement, tu peux aussi faire un mapping personnalisé si tu veux changer d'icônes
            const icon = this.iconMapping[condition] || "clear.svg";
            console.log("Condition météo:", condition);

            return { temperature, icon };

        } catch (error) {
            console.error("Erreur de récupération de la météo:", error);
            return null;
        }
    }

    // renvoie code météo pour un datetime    
    static async getWeatherDetailsHTML(date){
        const eventWeather = await WeatherManager.getWeather(date);

        if (eventWeather) {
            return `
                <div class="weather-info">
                    <div class="weather-details">
                        <p class="weather-temp">${eventWeather.temperature}°C</p>
                        <img src="res/img/weather/${eventWeather.icon}" alt="Weather Icon" class="weather-icon" />
                    </div>
                </div>
            `;
        }

        return `??`;
    }
}
