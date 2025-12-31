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

def aggregate_last_week():
    # 1. Définir la période "Semaine Dernière"
    # On considère que le script tourne le Lundi matin pour la semaine passée (Lundi -> Dimanche)
    today = datetime.now().date()
    # Trouver le lundi de la semaine dernière
    start_of_last_week = today - timedelta(days=today.weekday() + 7)
    # Trouver le dimanche de la semaine dernière
    end_of_last_week = start_of_last_week + timedelta(days=6)
    
    start_dt = datetime.combine(start_of_last_week, time.min)
    end_dt = datetime.combine(end_of_last_week, time.max)

    print(f"Calcul pour la semaine du {start_of_last_week} au {end_of_last_week}")

    # 2. Récupérer les logs bruts de la semaine
    # On pourrait aussi agréger à partir de 'stove_days', ce qui serait encore plus optimisé,
    # mais pour rester simple et robuste, on repart des données brutes 'stove'.
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
        print("Aucune donnée trouvée pour la semaine dernière.")
        return

    # 3. Calculs
    # Extraction des valeurs pour min/max
    cons_kg_values = [d['consumption_kg'] for d in data_points]
    cons_h_values = [d['consumption_h'] for d in data_points]

    weekly_kg = max(cons_kg_values) - min(cons_kg_values)
    weekly_h = max(cons_h_values) - min(cons_h_values)
    
    # Moyennes de températures
    temps_int = [d['temperature'] for d in data_points if 'temperature' in d]
    temps_ext = [d['ext_temp'] for d in data_points if d.get('ext_temp') is not None]

    avg_temp_int = sum(temps_int) / len(temps_int) if temps_int else 0
    avg_temp_ext = sum(temps_ext) / len(temps_ext) if temps_ext else None

    # 4. Créer le document agrégé
    # ID sous la forme "2023-W43" (Année-SemaineISO)
    # isocalendar() renvoie (année, semaine, jour)
    iso_year, iso_week, _ = start_of_last_week.isocalendar()
    doc_id = f"{iso_year}-W{iso_week:02d}"
    
    aggregate_data = {
        'week_start': datetime.combine(start_of_last_week, time(12, 0, 0)),
        'week_end': datetime.combine(end_of_last_week, time(12, 0, 0)),
        'doc_id': doc_id,
        'consumption_kg': round(weekly_kg, 2),
        'consumption_h': round(weekly_h, 2),
        'avg_temp_int': round(avg_temp_int, 1),
        'avg_temp_ext': round(avg_temp_ext, 1) if avg_temp_ext else None,
        'timestamp': firestore.SERVER_TIMESTAMP
    }

    # Sauvegarde dans une nouvelle collection 'stove_weeks'
    db.collection('stove_weeks').document(doc_id).set(aggregate_data, merge=True)
    
    print(f"Succès ! Données sauvegardées dans stove_weeks/{doc_id}")
    print(f"Conso Semaine: {weekly_kg} kg, {weekly_h} h")

if __name__ == "__main__":
    aggregate_last_week()