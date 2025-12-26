import sys
import time
import requests
import os
import json
from bs4 import BeautifulSoup

import firebase_admin
from firebase_admin import credentials, firestore
import yaml


def connect(client, url_base, url_login, url_stove, user, pwd):
    data = {'email': user, 'password': pwd}
    r = client.post(url_base + url_login, data)
    if 'Log out' in r.text:
        soup = BeautifulSoup(r.content, "html.parser")
        text = soup.find("ul", {"id": "stoveList"})
        if text is not None:
            a = text.find('a', href=True)
            stove = a['href'].replace(url_stove, '')
            return stove
    return ""

def get_stove_informations(client, url_base, url_api, stove):
    r = client.get(url_base + url_api + stove + '/status?nocache=')
    return r.json()

def get_stove_consumption_kg(data): return data['sensors']['parameterFeedRateTotal']
def get_stove_consumption_h(data): return data['sensors']['parameterRuntimePellets']
def get_stove_thermostat(data): return data['controls']['targetTemperature']
def get_room_temperature(data): return data['sensors']['inputRoomTemperature']
def is_stove_burning(data):
    return data['sensors']['statusMainState'] in [4, 5]

# --- FONCTION POUR RÉCUPÉRER LA TEMPÉRATURE EXTERNE VIA OPEN-METEO ---
def get_external_weather(latitude, longitude):
    """Récupère la température actuelle via Open-Meteo"""
    try:
        url = f"https://api.open-meteo.com/v1/forecast?latitude={latitude}&longitude={longitude}&current_weather=true"
        response = requests.get(url, timeout=10)
        data = response.json()
        return data['current_weather']['temperature']
    except Exception as e:
        print(f"Erreur récupération météo : {e}")
        return None

def load_location_config(config_file='location.yml'):
    """Charge la configuration de localisation depuis un fichier YAML"""
    try:
        with open(config_file, 'r') as f:
            config = yaml.safe_load(f)
        return config['city'], config['latitude'], config['longitude']
    except Exception as e:
        print(f"Erreur lecture config : {e}")
        return None, None, None


# --- MAIN ADAPTÉ POUR GITHUB ACTIONS ---

if __name__ == "__main__":
    # Récupération des secrets depuis les variables d'environnement
    user = os.environ.get('RIKA_EMAIL')
    pwd = os.environ.get('RIKA_PASSWORD')
    firebase_json = os.environ.get('FIREBASE_SERVICE_ACCOUNT')

    # Paramètres Rika par défaut
    url_base = "https://www.rika-firenet.com"
    url_login = "/web/login"
    url_stove = "/web/stove/"
    url_api = "/api/client/"

    if not user or not pwd or not firebase_json:
        print("Erreur : Les variables d'environnement RIKA_EMAIL, RIKA_PASSWORD ou FIREBASE_SERVICE_ACCOUNT sont manquantes.")
        sys.exit(1)

    # Initialisation Firebase avec le secret JSON
    service_account_info = json.loads(firebase_json)
    cred = credentials.Certificate(service_account_info)
    firebase_admin.initialize_app(cred)
    db = firestore.client()

    # Connexion et exécution unique
    client = requests.session()
    stove = connect(client, url_base, url_login, url_stove, user, pwd)

    if stove:
        stove_infos = get_stove_informations(client, url_base, url_api, stove)
        
        room_temp = get_room_temperature(stove_infos)
        is_burning = is_stove_burning(stove_infos)
        thermostat = get_stove_thermostat(stove_infos)
        consumption_kg = get_stove_consumption_kg(stove_infos)
        consumption_h = get_stove_consumption_h(stove_infos)
        # Récupération de la météo extérieure (Seynod)
        city, latitude, longitude = load_location_config()  
        ext_temp = get_external_weather(latitude, longitude)
        if ext_temp is not None:
            print(f"Température extérieure actuelle à {city} : {ext_temp}°C")
        else:
            print("Impossible de récupérer la température extérieure.")

        data = {
            'temperature': float(room_temp),
            'thermostat': float(thermostat),
            'is_burning': is_burning,
            'consumption_kg': float(consumption_kg),
            'consumption_h': float(consumption_h),
            'temperature_ext': float(ext_temp) if ext_temp is not None else None,
            'timestamp': firestore.SERVER_TIMESTAMP
        }

        db.collection('stove').add(data)
        print(f"Succès : Poêle {room_temp}°C, Extérieur {ext_temp}°C envoyé.")
    else:
        print("Erreur : Impossible de trouver le poêle.")
        sys.exit(1)
