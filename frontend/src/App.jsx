import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from "firebase/app";
import { 
  getFirestore, 
  collection, 
  query, 
  onSnapshot, 
  orderBy, 
  limit
} from "firebase/firestore";
import { 
  getAuth, 
  signInAnonymously, 
  onAuthStateChanged 
} from "firebase/auth";
import { 
  Chart as ChartJS, 
  CategoryScale, 
  LinearScale, 
  PointElement, 
  LineElement, 
  BarElement,
  Title, 
  Tooltip, 
  Legend, 
  Filler
} from 'chart.js';
import { Line, Bar } from 'react-chartjs-2';
import { Thermometer, Target, Flame, RefreshCw, ShieldCheck, AlertCircle, CloudSun, Calendar } from 'lucide-react';

// Enregistrement des composants Chart.js
ChartJS.register(
  CategoryScale, 
  LinearScale, 
  PointElement, 
  LineElement, 
  BarElement, 
  Title, 
  Tooltip, 
  Legend, 
  Filler
);

// Import des configurations depuis le fichier externe
import { firebaseConfig, appSettings } from './config';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

export default function App() {
  const [logs, setLogs] = useState([]);
  const [dailyStats, setDailyStats] = useState([]);
  const [weeklyStats, setWeeklyStats] = useState([]);
  const [monthlyStats, setMonthlyStats] = useState([]);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [timeRange, setTimeRange] = useState('24h'); 

  // Authentification
  useEffect(() => {
    signInAnonymously(auth).catch(err => setError(`Erreur Auth : ${err.message}`));
    const unsubscribeAuth = onAuthStateChanged(auth, (u) => u && setUser(u));
    return () => unsubscribeAuth();
  }, []);

  // 1. Récupération des logs TEMPS RÉEL (Graphique 1)
  useEffect(() => {
    if (!user) return;
    
    const stoveCollectionName = appSettings.stoveCollection || 'stove';
    const q = query(collection(db, stoveCollectionName), orderBy('timestamp', 'desc'), limit(1500));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => {
        const d = doc.data();
        let dateObj = new Date();
        if (d.timestamp?.toDate) dateObj = d.timestamp.toDate();
        else if (d.timestamp?.seconds) dateObj = new Date(d.timestamp.seconds * 1000);
        
        return { 
          id: doc.id,
          date: dateObj,
          temperature: Number(d.temperature) || 0,
          thermostat: Number(d.thermostat) || 0,
          temperature_ext: Number(d.temperature_ext) || 0,
          is_burning: Boolean(d.is_burning)
        };
      }).reverse();
      
      setLogs(data);
      setLoading(false);
    }, (err) => console.error("Erreur logs temps réel:", err));

    return () => unsubscribe();
  }, [user]);

  // 2. Récupération des données AGRÉGÉES (Graphiques 2, 3, 4)
  useEffect(() => {
    if (!user) return;

    // Fonction générique pour s'abonner aux collections agrégées
    const subscribeToStats = (collName, setter, limitCount) => {
      // Pas de tri 'orderBy' pour éviter les erreurs d'index manquant, tri manuel ensuite
      const q = query(collection(db, collName), limit(limitCount));
      
      return onSnapshot(q, (snapshot) => {
        const data = snapshot.docs.map(doc => {
            const d = doc.data();
            return {
                id: doc.id,
                label: doc.id, // L'ID sert de label (ex: 2023-10-27)
                consumption_kg: Number(d.consumption_kg) || 0,
                consumption_h: Number(d.consumption_h) || 0,
                avg_temp_int: Number(d.avg_temp_int) || 0,
                avg_temp_ext: Number(d.avg_temp_ext) || 0
            };
        });
        // Tri manuel par ID pour l'ordre chronologique
        setter(data.sort((a, b) => a.id.localeCompare(b.id)));
      }, (err) => console.warn(`Erreur lecture ${collName}:`, err));
    };

    // Abonnement aux 3 collections
    const unsubDay = subscribeToStats(appSettings.stove_days, setDailyStats, 60);    // 60 derniers jours
    const unsubWeek = subscribeToStats(appSettings.stove_weeks, setWeeklyStats, 52);  // 52 dernières semaines
    const unsubMonth = subscribeToStats(appSettings.stove_months, setMonthlyStats, 24); // 24 derniers mois

    return () => {
        unsubDay();
        unsubWeek();
        unsubMonth();
    };
  }, [user]);

  // Filtrage et Limites pour le Graphique 1
  const filteredLogs = useMemo(() => {
    if (timeRange === 'all' || logs.length === 0) return logs;
    const now = new Date();
    let startTime = new Date();
    if (timeRange === '24h') startTime.setHours(now.getHours() - 24);
    else if (timeRange === '7d') startTime.setDate(now.getDate() - 7);
    else if (timeRange === '30d') startTime.setDate(now.getDate() - 30);
    return logs.filter(log => log.date >= startTime);
  }, [logs, timeRange]);

  const tempLimits = useMemo(() => {
    if (filteredLogs.length === 0) return { min: 0, max: 30 };
    const allValues = filteredLogs.flatMap(l => [l.temperature, l.thermostat, l.temperature_ext].filter(v => v !== null));
    return {
      min: Math.floor(Math.min(...allValues)) - 2,
      max: Math.ceil(Math.max(...allValues)) + 2
    };
  }, [filteredLogs]);

  const latest = logs.length > 0 ? logs[logs.length - 1] : { temperature: 0, thermostat: 0, is_burning: false, date: new Date(), temperature_ext: null };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-slate-900 text-white gap-4">
        <RefreshCw className="animate-spin w-8 h-8 text-orange-500" />
        <p className="font-bold tracking-widest uppercase text-sm italic">Connexion {appSettings.title}...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8 font-sans text-slate-900">
      <div className="max-w-7xl mx-auto">
        
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-2xl flex items-start gap-3 shadow-sm">
            <AlertCircle className="w-6 h-6 shrink-0 mt-0.5" />
            <div className="text-sm"><p className="font-bold">Erreur : {error}</p></div>
          </div>
        )}

        <header className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black text-slate-800 tracking-tight italic uppercase">{appSettings.title}</h1>
            <p className="text-slate-500 flex items-center gap-2 text-sm font-semibold uppercase tracking-tighter">
               <ShieldCheck className="w-4 h-4 text-emerald-500" /> {appSettings.location}
            </p>
          </div>
        </header>

        {/* Indicateurs Clés */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard title="Intérieur" value={`${latest.temperature.toFixed(1)}°C`} icon={Thermometer} color="rose" />
          <StatCard title="Extérieur" value={latest.temperature_ext !== null ? `${latest.temperature_ext.toFixed(1)}°C` : '--'} icon={CloudSun} color="blue" />
          <StatCard title="Consigne" value={`${latest.thermostat.toFixed(1)}°C`} icon={Target} color="slate" />
          <StatCard title="En fonctionnement" value={latest.is_burning ? "Oui" : "Non"} icon={Flame} color={latest.is_burning ? "orange" : "slate"} />
        </div>

        <div className="grid grid-cols-1 gap-8">
          
          {/* GRAPHIQUE 1 : Temps réel */}
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm relative">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
              <h3 className="text-sm font-black flex items-center gap-2 text-slate-700 uppercase italic tracking-tight">
                <Thermometer className="w-4 h-4 text-rose-500" /> Températures temps réel
              </h3>
              <div className="flex items-center bg-slate-100 p-1 rounded-xl">
                {[
                  { label: '24h', value: '24h' },
                  { label: '7j', value: '7d' },
                  { label: '30j', value: '30d' },
                  { label: 'Tout', value: 'all' }                
                ].map((opt) => (
                  <button key={opt} onClick={() => setTimeRange(opt.value)} className={`px-4 py-1.5 rounded-lg text-[10px] font-black transition-all ${timeRange === opt.value ? 'bg-white text-orange-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="h-[400px]">
              <Line 
                data={{
                  labels: filteredLogs.map(l => l.date.toLocaleString('fr-FR', { day: timeRange === '24h' ? undefined : '2-digit', month: timeRange === '24h' ? undefined : '2-digit', hour: '2-digit', minute: '2-digit' })),
                  datasets: [
                    { label: 'Intérieur', data: filteredLogs.map(l => l.temperature), borderColor: '#f43f5e', borderWidth: 3, tension: 0.4, pointRadius: 0 },
                    { label: 'Extérieur', data: filteredLogs.map(l => l.temperature_ext), borderColor: '#94a3b8', borderWidth: 2, backgroundColor: 'rgba(148, 163, 184, 0.1)', fill: true, tension: 0.4, pointRadius: 0 },
                    { label: 'Consigne', data: filteredLogs.map(l => l.thermostat), borderColor: '#3b82f6', borderDash: [5, 5], borderWidth: 1.5, tension: 0, pointRadius: 0 },
                    { label: 'Chauffe', data: filteredLogs.map(l => l.is_burning ? tempLimits.max : -50), borderColor: 'rgba(104, 52, 10, 0.08)', borderWidth: 2, backgroundColor: 'rgba(251, 146, 60, 0.08)', fill: 'start', pointRadius: 0, stepped: true, tension: 0 }
                  ]
                }}
                options={{ 
                  responsive: true, maintainAspectRatio: false,
                  interaction: { intersect: false, mode: 'index' },
                  scales: { y: { min: tempLimits.min, max: tempLimits.max, grid: { color: '#f1f5f9' } } },
                  plugins: { legend: { position: 'top', align: 'end', labels: { usePointStyle: true, font: { size: 10, weight: 'bold' } } }, tooltip: { mode: 'index', intersect: false, filter: (i) => i.datasetIndex !== 3 } }
                }}
              />
            </div>
          </div>

          {/* GRAPHIQUES DE BILAN (1 par ligne, 4 données, 3 échelles) */}
          <div className="grid grid-cols-1 gap-6">
            <StatsGraph title="Bilan Quotidien" data={dailyStats} />
            <StatsGraph title="Bilan Hebdomadaire" data={weeklyStats} />
            <StatsGraph title="Bilan Mensuel" data={monthlyStats} />
          </div>
        </div>
      </div>
    </div>
  );
}

// Composant Graphique de Bilan (4 Datasets, 3 Axes)
function StatsGraph({ title, data }) {
  const chartData = useMemo(() => ({
    labels: data.map(d => d.label),
    datasets: [
      {
        type: 'bar',
        label: ' Pellets (kg)',
        data: data.map(d => d.consumption_kg),
        backgroundColor: 'rgba(251, 146, 60, 0.8)',
        borderRadius: 4,
        order: 4,
        yAxisID: 'y', // Axe Gauche : kg
      },
      {
        type: 'line',
        label: ' Fonctionnement (h)',
        data: data.map(d => d.consumption_h),
        borderColor: '#3b82f6',
        backgroundColor: '#3b82f6',
        borderWidth: 2,
        tension: 0.3,
        pointRadius: 3,
        order: 1,
        yAxisID: 'y1', // Axe Droite 1 : Heures
      },
      {
        type: 'line',
        label: ' t° int. moy.',
        data: data.map(d => d.avg_temp_int),
        borderColor: '#f43f5e',
        borderWidth: 1.5,
        borderDash: [4, 4],
        pointRadius: 3,
        order: 2,
        yAxisID: 'y2', // Axe Droite 2 : Degrés
      },
      {
        type: 'line',
        label: ' t° ext. moy.',
        data: data.map(d => d.avg_temp_ext),
        borderColor: '#94a3b8',
        borderWidth: 1.5,
        borderDash: [4, 4],
        pointRadius: 3,
        order: 3,
        yAxisID: 'y2', // Axe Droite 2 : Degrés
      }
    ]
  }), [data]);

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: { 
      legend: { position: 'top', labels: { font: { size: 9, weight: 'bold' }, usePointStyle: true, boxWidth: 6 } },
      tooltip: { 
        callbacks: {
          label: (ctx) => {
            const val = ctx.raw;
            if (val === null || val === undefined) return null;
            if (ctx.dataset.label.includes('Pellets')) return `${ctx.dataset.label}: ${val.toFixed(1)} kg`;
            if (ctx.dataset.label.includes('Marche')) return `${ctx.dataset.label}: ${val.toFixed(1)} h`;
            return `${ctx.dataset.label}: ${val.toFixed(1)} °C`;
          }
        }
      }
    },
    scales: {
      x: { grid: { display: false }, ticks: { font: { size: 9 } } },
      // Axe Gauche : KG
      y: { 
        type: 'linear', 
        position: 'left', 
        title: { display: true, text: 'kg', color: '#fb923c', font: {size: 9} },
        grid: { display: false } 
      },
      // Axe Droite 1 : Heures
      y1: { 
        type: 'linear', 
        position: 'right', 
        title: { display: true, text: 'h', color: '#3b82f6', font: {size: 9} },
        grid: { display: false }
      },
      // Axe Droite 2 : Degrés (sans grille, pour info)
      y2: {
        type: 'linear',
        position: 'right',
        display: true, // On l'affiche pour voir l'échelle
        title: { display: true, text: '°C', color: '#f43f5e', font: {size: 9} },
        grid: { display: false },
        min: -10, // Plage fixe pour éviter que les températures écrasent le reste visuellement
        max: 35
      }
    }
  };

  return (
    <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm h-[350px] flex flex-col">
      <h3 className="text-[11px] font-black mb-4 flex items-center gap-2 text-slate-600 uppercase italic tracking-tight">
        <Calendar className="w-3.5 h-3.5 text-orange-500" /> {title}
      </h3>
      <div className="flex-1 min-h-0">
        {data.length > 0 ? (
          <Bar data={chartData} options={options} />
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-xs text-slate-400 italic border-2 border-dashed border-slate-100 rounded-xl">
            En attente de données agrégées...
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ title, value, icon: Icon, color }) {
  const colors = { rose: "bg-rose-50 text-rose-500", blue: "bg-blue-50 text-blue-500", orange: "bg-orange-50 text-orange-500", slate: "bg-slate-50 text-slate-500" };
  return (
    <div className="bg-white p-6 rounded-3xl border border-slate-200 flex items-center justify-between shadow-sm group hover:border-slate-300 transition-colors">
      <div>
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{title}</p>
        <p className="text-2xl font-black text-slate-800">{value}</p>
      </div>
      <div className={`p-3.5 rounded-2xl transition-transform group-hover:scale-105 ${colors[color] || colors.slate}`}>
        <Icon className="w-6 h-6" />
      </div>
    </div>
  );
}