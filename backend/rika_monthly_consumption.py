import os
import json
from datetime import datetime, timedelta, time
import firebase_admin
from firebase_admin import credentials, firestore

# Configuration
SERVICE_ACCOUNT = os.environ.get('FIREBASE_SERVICE_ACCOUNT')

if not SERVICE_ACCOUNT:
    print("Erreur: Secret FIREBASE_SERVICE_ACCOUNT manquant")
    exit(1)

# Init Firebase
if not firebase_admin._apps:
    cred = credentials.Certificate(json.loads(SERVICE_ACCOUNT))
    firebase_admin.initialize_app(cred)

db = firestore.client()

def aggregate_last_month():
    # 1. Définir la période "Mois Dernier"
    # On considère que le script tourne le 1er du mois courant pour le mois passé
    today = datetime.now().date()
    
    # Premier jour du mois courant
    first_day_current_month = today.replace(day=1)
    
    # Dernier jour du mois dernier = premier jour du mois courant - 1 jour
    last_day_last_month = first_day_current_month - timedelta(days=1)
    
    # Premier jour du mois dernier
    first_day_last_month = last_day_last_month.replace(day=1)
    
    start_dt = datetime.combine(first_day_last_month, time.min)
    end_dt = datetime.combine(last_day_last_month, time.max)

    print(f"Calcul pour le mois de {first_day_last_month.strftime('%B %Y')}")
    print(f"Période : {start_dt} -> {end_dt}")

    # 2. Récupérer les logs bruts du mois
    # On utilise la collection brute 'stove' pour la fiabilité,
    # mais on pourrait optimiser en lisant 'stove_days'
    docs = db.collection('stove')\
        .where('timestamp', '>=', start_dt)\
        .where('timestamp', '<=', end_dt)\
        .stream()

    data_points = []
    for doc in docs:
        d = doc.to_dict()
        if 'consumption_kg' in d and 'consumption_h' in d:
            data_points.append(d)

    if not data_points:
        print("Aucune donnée trouvée pour le mois dernier.")
        return

    # 3. Calculs
    # Extraction des valeurs pour min/max des compteurs
    cons_kg_values = [d['consumption_kg'] for d in data_points]
    cons_h_values = [d['consumption_h'] for d in data_points]

    monthly_kg = max(cons_kg_values) - min(cons_kg_values)
    monthly_h = max(cons_h_values) - min(cons_h_values)
    
    # Moyennes de températures (Intérieure et Extérieure)
    temps_int = [d['temperature'] for d in data_points if 'temperature' in d]
    temps_ext = [d['temperature_ext'] for d in data_points if d.get('temperature_ext') is not None]

    avg_temp_int = sum(temps_int) / len(temps_int) if temps_int else 0
    avg_temp_ext = sum(temps_ext) / len(temps_ext) if temps_ext else None

    # 4. Créer le document agrégé
    # ID sous la forme "YYYY-MM" (ex: "2023-10")
    doc_id = first_day_last_month.strftime("%Y-%m")
    
    aggregate_data = {
        'month_start': datetime.combine(first_day_last_month, time(12, 0, 0)),
        'month_end': datetime.combine(last_day_last_month, time(12, 0, 0)),
        'doc_id': doc_id,
        'consumption_kg': round(monthly_kg, 2),
        'consumption_h': round(monthly_h, 2),
        'avg_temp_int': round(avg_temp_int, 1),
        'avg_temp_ext': round(avg_temp_ext, 1) if avg_temp_ext else None,
        'timestamp': firestore.SERVER_TIMESTAMP
    }

    # Sauvegarde dans une nouvelle collection 'stove_months'
    db.collection('stove_months').document(doc_id).set(aggregate_data, merge=True)
    
    print(f"Succès ! Données sauvegardées dans stove_months/{doc_id}")
    print(f"Conso Mois: {monthly_kg} kg, {monthly_h} h")
    print(f"Temp Moy Int: {avg_temp_int:.1f}°C, Ext: {avg_temp_ext:.1f}°C")

if __name__ == "__main__":
    aggregate_last_month()