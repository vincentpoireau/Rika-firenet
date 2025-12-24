import sys
import time
import requests
import os
import json
import xml.etree.ElementTree as ET
from bs4 import BeautifulSoup

import firebase_admin
from firebase_admin import credentials, firestore

# --- FONCTIONS EXISTANTES (connect, get_stove_informations, etc.) ---
# (Gardez toutes vos fonctions au début du fichier comme dans l'original)

def connect(client, url_base, url_login, url_stove, user, pwd):
    # ... (votre code existant)
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

def get_stove_consumption(data): return data['sensors']['parameterFeedRateTotal']
def get_stove_thermostat(data): return data['controls']['targetTemperature']
def get_room_temperature(data): return data['sensors']['inputRoomTemperature']
def is_stove_burning(data):
    return data['sensors']['statusMainState'] in [4, 5]

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
        consumption = get_stove_consumption(stove_infos)

        data = {
            'temperature': float(room_temp),
            'thermostat': float(thermostat),
            'is_burning': is_burning,
            'consumption': float(consumption),
            'timestamp': firestore.SERVER_TIMESTAMP
        }

        db.collection('stove').add(data)
        print(f"Succès : Données envoyées ({room_temp}°C).")
    else:
        print("Erreur : Impossible de trouver le poêle.")
        sys.exit(1)
