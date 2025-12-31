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

def aggregate_yesterday():
    # 1. Définir la période "Hier" (de 00:00:00 à 23:59:59)
    today = datetime.now().date()
    yesterday = today - timedelta(days=1)
    
    start_dt = datetime.combine(yesterday, time.min)
    end_dt = datetime.combine(yesterday, time.max)

    print(f"Calcul pour la journée du : {yesterday}")

    # 2. Récupérer les logs bruts d'hier
    # Note : On a juste besoin des valeurs min et max, pas de tout télécharger si possible, 
    # mais Firestore ne permet pas facilement le min/max natif sans tout lire ou indexer lourdement.
    # Ici on lit tout 'stove' pour la journée (environ 96 documents), c'est très léger pour le backend.
    docs = db.collection('stove')\
        .where('timestamp', '>=', start_dt)\
        .where('timestamp', '<=', end_dt)\
        .stream()

    data_points = []
    for doc in docs:
        d = doc.to_dict()
        # On sécurise les données
        if 'consumption_kg' in d and 'consumption_h' in d:
            data_points.append(d)

    if not data_points:
        print("Aucune donnée trouvée pour hier.")
        return

    # 3. Trouver le Min et le Max des compteurs cumulés
    # Puisque ce sont des compteurs qui ne font qu'augmenter :
    # Conso du jour = Max(jour) - Min(jour)
    # (Ou plus précisément : Dernière valeur du jour - Première valeur du jour)
    
    # On trie par timestamp localement pour être sûr
    # (Note: data_points peut être désordonné selon le stream)
    # On suppose que 'timestamp' est un objet datetime compatible
    
    # Extraction des valeurs
    cons_kg_values = [d['consumption_kg'] for d in data_points]
    cons_h_values = [d['consumption_h'] for d in data_points]

    daily_kg = max(cons_kg_values) - min(cons_kg_values)
    daily_h = max(cons_h_values) - min(cons_h_values)
    
    # Moyennes / Extrêmes pour la météo et températures
    temps_int = [d['temperature'] for d in data_points if 'temperature' in d]
    temps_ext = [d['temperature_ext'] for d in data_points if d.get('temperature_ext') is not None]

    avg_temp_int = sum(temps_int) / len(temps_int) if temps_int else 0
    avg_temp_ext = sum(temps_ext) / len(temps_ext) if temps_ext else None

    # 4. Créer le document agrégé
    # On utilise la date comme ID du document (ex: "2023-10-27") pour éviter les doublons
    doc_id = yesterday.isoformat()
    
    aggregate_data = {
        'date': datetime.combine(yesterday, time(12, 0, 0)), # Midi pour éviter les soucis de timezone
        'date_str': doc_id,
        'consumption_kg': round(daily_kg, 2),
        'consumption_h': round(daily_h, 2),
        'avg_temp_int': round(avg_temp_int, 1),
        'avg_temp_ext': round(avg_temp_ext, 1) if avg_temp_ext else None,
        'timestamp': firestore.SERVER_TIMESTAMP
    }

    # Set avec merge=True permet d'écraser proprement si on relance le script
    db.collection('stove_days').document(doc_id).set(aggregate_data, merge=True)
    
    print(f"Succès ! Données sauvegardées dans stove_days/{doc_id}")
    print(f"Conso: {daily_kg} kg, {daily_h} h")
    print(f"Temp Moy Int: {avg_temp_int:.1f}°C, Ext: {avg_temp_ext:.1f}°C")


if __name__ == "__main__":
    aggregate_yesterday()